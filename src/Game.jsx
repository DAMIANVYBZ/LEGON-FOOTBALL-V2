import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import TouchControls from './TouchControls.jsx';
import { touchActions } from './touchActions.js';
import { getVenue } from './venues.js';
import { teamSizeForVenue, fieldPositions, kickoffRoles } from './roster.js';
import { buildVenueScene } from './VenueScene.js';
import { createStadiumGrassMaterial, textureStadiumGrass } from './stadiumGrass.js';
import { RUN_PACE } from './movementConfig.js';
import { activeGamepad, readGamepad } from './gamepad.js';
import { keyLabel } from './preferences.js';
import { abilityForWins, readTeamProgress, recordTeamWin } from './progression.js';
import { loadAnimation, loadGLTF, loadPlayerModel, loadVenueManifest } from './assets.js';
import { GOAL, KICK_SPIN, MAX_SIM_STEPS, SIM_DT, STAMINA, difficultyFor } from './physicsConfig.js';
import { createRandom, keeperPosition, saveOutcome, shotOnGoal } from './keeper.js';
import { bestPassOption, decideCarrier, markingAssignments } from './cpuBrain.js';
import { createTeamAttributes, hashSeed, paceFactor, accelerationFactor, agilityFactor, finishingAccuracy, staminaFactor, handlingFactor, looseTouchChance, passError, tackleChance } from './attributes.js';
import { createMatchAudio } from './audio.js';
import { matchKits, teamShort } from './teams.js';
import { createCommentary, resultLine, scoreLine, goalContext } from './commentary.js';
import { playerName } from './players.js';
import { vibrate } from './haptics.js';
import { flight, groundPassSpeed, liftFor } from './ballistics.js';
import { aimShot, aimChip, gaussian, SHOT_STYLES, spinStyle, stickZone } from './shooting.js';
import { createOffsideTracker, offsidePositions, offsideInterference, goalCrossing } from './rules.js';
import { assessChallenge, defensiveApproach, SLIDE_TIMING } from './challenges.js';
import { playerMaterial } from './playerMaterial.js';
import { groundedSlideClip, transitionPlayerAction } from './playerAnimation.js';
import { slideAim, slideVelocity, slideBallContact, slideDeflection, sweepContact, slideVerdict, slideApproachSpeed } from './sliding.js';
import { createBallControl, footTouch, controlStrideLimit, controlStrideInput, needsControlTrap, needsStrideTouch, INPUT_BUFFER_SECONDS, withinKickReach } from './ballControl.js';
import { plantControlFoot, placeSlideFoot } from './footPlant.js';
import { restartFraming, gameplayFraming } from './camera.js';
import { receivingPath, receivingPoint, assistedReceivingInput, RECEIVING_ASSIST } from './receiving.js';
import { throwInPlan } from './throwIns.js';
import { planPass, passingMode } from './passing.js';
import { createGoalRecorder, sampleGoalReplay, replayCamera, GOAL_ANGLES, CELEBRATION_SECONDS } from './goalReplay.js';
import { advancePlayer, goalKickPosition, groundPassProfile, groundPassVelocity, skillTurn, canWinTackle, canReceivePass, receivingInput, forwardFromHeading, meshYawForHeading, pickPassTarget, pitchExit, supportPosition } from './gameplay.js';

const BALL_RADIUS = 0.11;
const clipsToLoad = {
  kick: 'kick-soccerball', scissor: 'scissor-kick', spin: 'soccer-spin',
  header: 'header', headerBall: 'header-soccerball', goalkeeperPass: 'goalkeeper-pass',
  goalkeeperCatch: 'goalkeeper-catch', goalkeeperPlace: 'goalkeeper-placing-ball',
  dribble: 'dribble', sprint: 'jog-forward', tackleAlternate: 'soccer-tackle-alternate',
  celebration: 'swing-dancing', fallen: 'fallen-idle', goalkeeperSidestep: 'goalkeeper-sidestep',
  jogDiagonal: 'jog-forward-diagonal', receive: 'receive-soccerball',
  goalkeeperBlock: 'goalkeeper-body-block', jog: 'jog-forward', goalkeeperIdle: 'goalkeeper-idle',
  goalkeeperDive: 'goalkeeper-diving-save', penaltyKick: 'soccer-penalty-kick',
  // Standing outfielders use the relaxed upright stance; the Mixamo "soccer
  // idle" hops between feet like a warm-up drill.
  stand: 'standing-up', throwIn: 'throw-in', idle: 'offensive-idle', chip: 'chip',
  jogBack: 'jog-backward-diagonal', tackle: 'soccer-tackle', pass: 'soccer-pass',
  offensiveIdle: 'offensive-idle',
};

// Campus models exported with a full-size pitch baked in: remove its white
// lines and its goals (frames and nets) so the seven-a-side pitch, drawn by the
// game at its own size, is the only one on the grass. Stands and track stay.
function stripBakedPitch(root, { length, width }) {
  root.updateMatrixWorld(true);
  const corner = new THREE.Vector3(), centre = new THREE.Vector3();
  root.traverse(node => {
    if (!node.isMesh || !node.geometry.attributes.color) return;
    const source = node.geometry, position = source.attributes.position, color = source.attributes.color, index = source.index;
    const count = index ? index.count : position.count, vertex = i => index ? index.getX(i) : i, keep = [];
    let removed = 0;
    for (let t = 0; t < count; t += 3) {
      centre.set(0, 0, 0);
      for (let k = 0; k < 3; k++) centre.add(corner.fromBufferAttribute(position, vertex(t + k)).applyMatrix4(node.matrixWorld));
      centre.divideScalar(3);
      const first = vertex(t);
      const white = color.getX(first) > 0.8 && color.getY(first) > 0.8 && color.getZ(first) > 0.8;
      const marking = white && centre.y < 0.3 && Math.abs(centre.x) < length / 2 + 1 && Math.abs(centre.z) < width / 2 + 1;
      const goal = centre.y < 3 && Math.abs(centre.z) < 4.2 && Math.abs(Math.abs(centre.x) - length / 2) < 3;
      if (marking || goal) removed++;
      else keep.push(vertex(t), vertex(t + 1), vertex(t + 2));
    }
    if (!removed) return;
    // The loaded model is shared between matches, so edit a copy.
    node.geometry = source.clone();
    node.geometry.setIndex(keep);
  });
}

// Dark text on light kits, white text on dark ones.
const textOn = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return r * 0.3 + g * 0.59 + b * 0.11 > 150 ? '#161513' : '#ffffff'; };

export default function Game({ config, cameraMode, exit, preferences, orientationBlocked = false }) {
  const venue = getVenue(config.venueId);
  const LENGTH = venue.length, WIDTH = venue.width;
  const TEAM_SIZE = teamSizeForVenue(venue), kickoffOrder = kickoffRoles(TEAM_SIZE), FIRST_FORWARD = kickoffOrder[0];
  const GOAL_WIDTH = venue.kind === 'astro' ? 5.5 : 7.32;
  const GOAL_HEIGHT = venue.kind === 'astro' ? 2.2 : 2.44;
  const isTouch = config.inputMode === 'touch';
  const passingAssistance = passingMode(preferences.passingAssistance);
  const mount = useRef(null);
  const engine = useRef(null);
  const [score, setScore] = useState([0, 0]);
  const [goalMoment, setGoalMoment] = useState(null);
  const [seconds, setSeconds] = useState(Math.ceil(config.matchMinutes * 30));
  const [half, setHalf] = useState(1);
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState('KICK OFF');
  const [modelStatus, setModelStatus] = useState('LOADING PLAYERS');
  const [selectedPlayer, setSelectedPlayer] = useState(FIRST_FORWARD + 1);
  const [gamepadStatus, setGamepadStatus] = useState('');
  const [progress, setProgress] = useState(() => readTeamProgress(config.home));
  const [progressNotice, setProgressNotice] = useState('');
  const matchId = useRef(crypto.randomUUID());
  const resultRecorded = useRef(false);
  const teamAbility = abilityForWins(progress.wins);
  const difficulty = difficultyFor(config.difficulty);
  const kits = matchKits(config.home, config.away);
  const homeName = teamShort(config.home).toUpperCase(), awayName = teamShort(config.away).toUpperCase();
  const radar = useRef(null);
  const powerMeter = useRef(null);
  const staminaMeter = useRef(null);
  const [loading, setLoading] = useState({ done: false, progress: 0, step: 'Preparing the pitch' });
  const [keeperBall, setKeeperBall] = useState(false);
  const [touchAttacking, setTouchAttacking] = useState(true);
  const [caption, setCaption] = useState('');
  const [padPhase, setPadPhase] = useState('attack');

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    let disposed = false;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#809db4');
    scene.fog = new THREE.Fog('#809db4', 145, 270);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    const cam = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    let viewMode = cameraMode;
    const cameraFocus = new THREE.Vector3();
    const clock = new THREE.Clock();
    scene.add(new THREE.HemisphereLight(0xf8fcff, 0x466235, 2.2));
    const sun = new THREE.DirectionalLight(0xffe7ba, 2.6);
    sun.position.set(-50, 95, 48);
    sun.castShadow = true;
    const shadowSize = config.device === 'phone' ? 1024 : 2048;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    sun.shadow.bias = -0.00015; sun.shadow.normalBias = 0.02;
    // Fit the shadow map to the pitch so its detail is not spent on the stands.
    sun.shadow.camera.left = -LENGTH / 2 - 8; sun.shadow.camera.right = LENGTH / 2 + 8;
    sun.shadow.camera.top = WIDTH / 2 + 8; sun.shadow.camera.bottom = -WIDTH / 2 - 8;
    scene.add(sun);
    const material = (color, roughness = 1) => new THREE.MeshStandardMaterial({ color, roughness });
    const box = (w, h, d, color, x, y, z, parent = scene) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
      mesh.position.set(x, y, z); mesh.receiveShadow = true; mesh.castShadow = h > 0.4;
      parent.add(mesh); return mesh;
    };

    const fallbackEnvironment = new THREE.Group();
    scene.add(fallbackEnvironment);
    const fieldGroup = new THREE.Group();
    scene.add(fieldGroup);
    const venueBox = (w, h, d, color, x, y, z, parent = fallbackEnvironment) => box(w, h, d, color, x, y, z, parent);
    const stadiumGrass = venue.id === 'ug-stadium' ? createStadiumGrassMaterial(Math.min(8, renderer.capabilities.getMaxAnisotropy())) : null;
    let disposeStadiumGrass = () => {};
    buildVenueScene({ scene: fallbackEnvironment, venue, box: venueBox, material, stadiumGrass });
    // Scenery receives shadows but does not cast them: players, ball and goals
    // are what the eye follows, and stadium shadows cost the most to draw.
    fallbackEnvironment.traverse(node => { node.castShadow = false; });
    // Everything must be ready before kickoff: physics, players, moves, venue.
    const ready = { physics: false, model: false, clips: 0, venue: false, started: false };
    const clipTotal = Object.keys(clipsToLoad).length;
    function updateLoading() {
      const parts = [ready.venue, ready.physics, ready.model].filter(Boolean).length + ready.clips / clipTotal * 3;
      const step = !ready.venue ? `Building ${venue.name}` : !ready.model ? 'Bringing out the players' : ready.clips < clipTotal ? 'Warming up' : !ready.physics ? 'Checking the ball' : 'Kick off';
      setLoading(previous => previous.done ? previous : { done: false, progress: parts / 6, step });
    }
    // The parent campus game's exported surroundings can replace this scene.
    // Keep pitch markings, players and match logic in football coordinates.
    loadVenueManifest().then(manifest => {
      const asset = manifest[venue.id];
      if (!asset?.url || disposed) { ready.venue = true; updateLoading(); return; }
      return loadGLTF(asset.url).then(gltf => {
        if (disposed) return;
        const surroundings = gltf.scene.clone(true);
        surroundings.position.set(...(asset.position || [0, 0, 0]));
        surroundings.rotation.y = asset.rotationY || 0;
        surroundings.scale.setScalar(asset.scale || 1);
        surroundings.traverse(node => { if (node.isMesh) { node.castShadow = false; node.receiveShadow = true; } });
        if (asset.bakedPitch) {
          stripBakedPitch(surroundings, asset.bakedPitch);
          // Align imported grass with the same y=0 ground used by the ball.
          surroundings.updateMatrixWorld(true);
          const ray = new THREE.Raycaster(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), 0, 2);
          const turf = ray.intersectObject(surroundings, true).find(hit => Math.abs(hit.point.y) < 0.2);
          if (turf) surroundings.position.y -= turf.point.y;
        }
        if (stadiumGrass) disposeStadiumGrass = textureStadiumGrass(surroundings, stadiumGrass);
        box(420, 0.16, 420, venue.kind === 'stadium' ? '#526c50' : '#78865a', 0, -0.3, 0);
        scene.add(surroundings);
        fallbackEnvironment.visible = false;
        if (asset.includesPitch && !asset.bakedPitch) fieldGroup.visible = false;
        ready.venue = true; updateLoading();
      });
    }).catch(() => { ready.venue = true; updateLoading(); }); // the built-in scene is used instead
    const halfLength = LENGTH / 2, halfWidth = WIDTH / 2;
    const lineMaterial = new THREE.LineBasicMaterial({ color: venue.surface === 'soil' ? 0xe8dfcb : 0xf4f7eb });
    function line(points) {
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, 0.015, z)));
      fieldGroup.add(new THREE.Line(geometry, lineMaterial));
    }
    function arc(cx, cz, radius, start = 0, end = Math.PI * 2) {
      line(Array.from({ length: 81 }, (_, i) => {
        const angle = start + (end - start) * i / 80;
        return [cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius];
      }));
    }
    line([[-halfLength, -halfWidth], [halfLength, -halfWidth], [halfLength, halfWidth], [-halfLength, halfWidth], [-halfLength, -halfWidth]]);
    line([[0, -halfWidth], [0, halfWidth]]);
    arc(0, 0, Math.min(9.15, WIDTH * .16));
    for (const side of [-1, 1]) {
      const goalLine = side * halfLength;
      const area = goalLine - side * Math.min(16.5, LENGTH * .17);
      const six = goalLine - side * Math.min(5.5, LENGTH * .075);
      const penaltyWidth = Math.min(20.16, WIDTH * .35);
      const sixWidth = Math.min(9.16, WIDTH * .2);
      line([[goalLine, -penaltyWidth], [area, -penaltyWidth], [area, penaltyWidth], [goalLine, penaltyWidth]]);
      line([[goalLine, -sixWidth], [six, -sixWidth], [six, sixWidth], [goalLine, sixWidth]]);
      arc(goalLine - side * Math.min(11, LENGTH * .12), 0, 0.16);
      arc(goalLine, side > 0 ? halfWidth : -halfWidth, 1, 0, Math.PI / 2);
    }
    arc(0, 0, 0.16);

    // Each goal: a frame that can shudder when struck, and a net whose
    // strands are cut into short pieces so it can bulge and ripple.
    const netMaterial = new THREE.LineBasicMaterial({ color: 0xdce5df, transparent: true, opacity: 0.48 });
    const goalsBySide = {};
    for (const side of [-1, 1]) {
      const front = side * halfLength, back = side * (halfLength + GOAL.depth);
      const frame = new THREE.Group(); fieldGroup.add(frame);
      const frameMaterial = material('#f9faf6', 0.6);
      for (const z of [-GOAL_WIDTH / 2, GOAL_WIDTH / 2]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(GOAL.postRadius, GOAL.postRadius, GOAL_HEIGHT, 16), frameMaterial);
        post.position.set(front, GOAL_HEIGHT / 2, z); post.castShadow = true; frame.add(post);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(GOAL.postRadius, GOAL.postRadius, GOAL_WIDTH + GOAL.postRadius * 2, 16), frameMaterial);
      bar.rotation.x = Math.PI / 2; bar.position.set(front, GOAL_HEIGHT, 0); bar.castShadow = true; frame.add(bar);
      const segments = [];
      const strand = points => {
        for (let i = 0; i < points.length - 1; i++) {
          const [a, b] = [points[i], points[i + 1]];
          const pieces = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.3));
          for (let k = 0; k < pieces; k++) {
            const at = t => a.map((v, j) => v + (b[j] - v) * t);
            segments.push(...at(k / pieces), ...at((k + 1) / pieces));
          }
        }
      };
      for (let z = -GOAL_WIDTH / 2; z <= GOAL_WIDTH / 2 + 0.001; z += 0.61) strand([[front, GOAL_HEIGHT, z], [back, GOAL_HEIGHT, z], [back, 0, z]]);
      for (let y = 0; y <= GOAL_HEIGHT + 0.001; y += 0.61) strand([[front, y, -GOAL_WIDTH / 2], [back, y, -GOAL_WIDTH / 2], [back, y, GOAL_WIDTH / 2], [front, y, GOAL_WIDTH / 2]]);
      const base = new Float32Array(segments);
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3));
      const netLines = new THREE.LineSegments(geometry, netMaterial); netLines.frustumCulled = false; fieldGroup.add(netLines);
      goalsBySide[side] = { side, front, frame, net: netLines, base, ripple: null, shake: null };
    }

    const playerRoot = new THREE.Group(); scene.add(playerRoot);
    const people = [];
    function placeholder(color) {
      const group = new THREE.Group();
      const shirt = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.55, 8), material(color));
      shirt.position.y = 1.25; group.add(shirt);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), material('#8a5b3d'));
      head.position.y = 1.7; group.add(head);
      return group;
    }
    for (const [home, side] of [[true, 1], [false, -1]]) {
      // Every footballer has their own attributes (src/attributes.js): the same hall
      // always fields the same players. The CPU side's quality follows the difficulty.
      const teamAttributes = createTeamAttributes(TEAM_SIZE, { seed: hashSeed(home ? config.home : config.away), quality: home ? (teamAbility - 1) * 0.5 : difficulty.quality });
      fieldPositions(config.formation, side, LENGTH, WIDTH, TEAM_SIZE).forEach((spawn, index) => {
        const mesh = placeholder(home ? kits.home : kits.away);
        mesh.position.set(spawn[0], 0, spawn[1]); playerRoot.add(mesh);
        const heading = home ? 0 : Math.PI;
        mesh.rotation.y = meshYawForHeading(heading);
        people.push({ index: people.length, mesh, home, keeper: index === 0, role: index, spawn, attrs: teamAttributes[index], actionName: '', actionUntil: 0, stamina: 1,
          nextTackleAt: 0, saveUntil: 0, diveDirection: 0, motion: { x: spawn[0], z: spawn[1], vx: 0, vz: 0, heading } });
      });
    }
    let controlled = FIRST_FORWARD, possessor = FIRST_FORWARD, awayCarrier = -1, awayKickUntil = 0, lastAutoSwitch = 0;
    people[controlled].mesh.position.set(-0.8, 0, 0);
    people[controlled].motion.x = -0.8;
    people[controlled].motion.z = 0;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 28), new THREE.MeshBasicMaterial({ color: 0x30d8f4, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; scene.add(ring);
    // Shows who the keeper's throw will go to: yellow when free, orange when marked.
    const targetRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.68, 32), new THREE.MeshBasicMaterial({ color: 0xffc20e, side: THREE.DoubleSide }));
    targetRing.rotation.x = -Math.PI / 2; targetRing.position.y = 0.03; targetRing.visible = false; scene.add(targetRing);
    // Set pieces: the predicted flight as a dotted line, and the aiming reticle.
    const AIM_DOTS = 32;
    const aimDots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd23f }), AIM_DOTS);
    aimDots.visible = false; aimDots.frustumCulled = false; scene.add(aimDots);
    const aimReticle = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.44, 28), new THREE.MeshBasicMaterial({ color: 0xff8a00, side: THREE.DoubleSide }));
    aimReticle.visible = false; scene.add(aimReticle);
    const dotMatrix = new THREE.Matrix4();
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.5, 3), new THREE.MeshBasicMaterial({ color: 0x2ee6f4 }));
    marker.rotation.z = Math.PI; scene.add(marker);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 20, 14), material('#fffaf2', 0.5));
    ball.castShadow = true; ball.position.set(-0.25, BALL_RADIUS, 0); scene.add(ball);
    const ballVelocity = new THREE.Vector3();
    const boundaryFrom = new THREE.Vector3();
    let physics = null;
    import('./matchPhysics.js').then(({ createMatchPhysics }) => createMatchPhysics({
      length: LENGTH, width: WIDTH, goalWidth: GOAL_WIDTH, goalHeight: GOAL_HEIGHT, ballRadius: BALL_RADIUS,
      surface: venue.surface, goalDepth: GOAL.depth,
      playerPositions: people.map(person => person.mesh.position),
    }))
      .then(simulation => { if (disposed) simulation.free(); else { physics = simulation; physics.reset(ball.position, ballVelocity); ready.physics = true; updateLoading(); } })
      .catch(error => { console.error('Match physics unavailable', error); ready.physics = true; updateLoading(); });
    let elapsed = 0, lastHUD = 0, goalCooldown = 0, messageUntil = 2, resetAt = 0, controlLockUntil = 0;
    let kickoffGraceUntil = difficulty.kickoffGrace, cutCamera = true, renderPending = true;
    let kickoffWaiting = true; // everyone holds position until the kickoff is taken
    let passHold = false, throughHold = false, shootHold = false, power = 0, pausedLocal = false, periodEnded = false, lastTouchHome = true, touchSprint = false, shieldHold = false;
    let finesseHold = false, teammateContain = false, jockeyHold = false, keeperRushHold = false, runUntil = 0;
    // Controller-only holds and modes (EA FC classic layout).
    let controlledSprint = false, strafeHold = false, containHold = false, sprintJockey = false;
    let playerLock = false, manualKeeper = false, shotStyle = 'normal', slideUntil = 0, sliding = null, padWant = {}; // sliding: the player mid slide tackle
    let slideStartedAt = 0, skill = null, nextSkillAt = 0, pendingRestart = null;
    let menuDirection = 0, menuNextAt = 0;
    let penaltyDive = 0; // facing a penalty: the side you lean to dive (-1, 0, 1 across the goal)
    let setPiece = null, setPieceCam = null; // the set piece you are aiming, and the camera framing it
    let lobHold = false, pendingShot = null, aimOverride = null; // a released shot waits a moment for a second ▢ tap (low driven)
    let passTarget = -1, passDeadline = 0, passDestination = null;
    let receivingForecast = null, receivingGuidance = null;
    const goalRecorder = createGoalRecorder();
    let goalSequence = null, replayPose = null;
    const offside = createOffsideTracker();
    let lastRuleTouch = -1, lastRuleDeliberate = false, restartTouch = null;
    let carryOwner = -1, ballControl = createBallControl(), pendingKick = null;
    let keeperHolding = -1, keeperReleaseAt = 0;
    let keeperHoldStart = 0, throwHold = false, catchFrom = null, catchStart = 0, keeperTarget = -1;
    let awayPassTarget = -1, awayPassDestination = null, awayPassDeadline = 0;
    let restart = null; // a corner, goal kick or free kick waiting to be taken
    let marking = new Map(), markingAt = 0, lastCrowd = 0;
    let markingCpu = new Map(), markingCpuAt = 0;
    let random = createRandom(Math.floor(Math.random() * 2 ** 31));
    const sound = createMatchAudio(preferences.hud.sound !== false);
    let captionTimer = 0;
    const commentary = createCommentary({ enabled: preferences.hud.commentary !== false, onCaption: text => {
      setCaption(text); clearTimeout(captionTimer); captionTimer = setTimeout(() => setCaption(''), 3800);
    } });
    const goals = [0, 0];
    let lastShooter = -1, lastShotAt = -10, nextBuildAt = 8, lastBoxCarrier = -1;
    const hallName = home => teamShort(home ? config.home : config.away);
    // The username of a real player when the campus game supplies one; empty
    // otherwise, so the commentator speaks of the hall instead.
    const who = index => playerName(index, controlled, TEAM_SIZE);
    const say = (event, values = {}) => {
      commentary.say(event, { venue: venue.shortName, home: hallName(true), away: hallName(false), ...values });
      nextBuildAt = Math.max(nextBuildAt, elapsed + 7 + random() * 5);
    };
    const clamp = THREE.MathUtils.clamp;
    const boxDepth = Math.min(16.5, LENGTH * .17), boxHalfWidth = Math.min(20.16, WIDTH * .35);
    const penaltyDistance = Math.min(11, LENGTH * .12); // the spot drawn on the pitch
    const sixDepth = Math.min(5.5, LENGTH * .075), sixHalfWidth = Math.min(9.16, WIDTH * .2);
    const ownGoalX = home => home ? -LENGTH / 2 : LENGTH / 2;
    const insideBox = (x, z, home) => Math.abs(x - ownGoalX(home)) < boxDepth && Math.abs(z) < boxHalfWidth;
    const point = index => ({ index, x: people[index].motion.x, z: people[index].motion.z, vx: people[index].motion.vx, vz: people[index].motion.vz });
    const team = (home, withKeeper = false) => people.map((p, index) => index).filter(index => people[index].home === home && !people[index].sentOff && (withKeeper || !people[index].keeper)).map(point);
    const nearestOf = (home, x, z, exclude = -1) => team(home).filter(p => p.index !== exclude)
      .reduce((best, p) => !best || Math.hypot(p.x - x, p.z - z) < Math.hypot(best.x - x, best.z - z) ? p : best, null)?.index ?? -1;
    // Off-pitch defenders count at their goal line, not at an arbitrary x
    // beyond it. This also keeps isolated test fixtures from moving the line.
    const rulePlayers = () => people.map((p, index) => ({ index, home: p.home, keeper: p.keeper, sentOff: p.sentOff,
      x: clamp(p.motion.x, -LENGTH / 2, LENGTH / 2), z: p.motion.z }));
    function ruleTouch(index, { deliberate = false, save = false, kick = false } = {}) {
      if (restart && !kick) return false;
      const player = rulePlayers()[index];
      if (!player.home) pendingKick = null;
      if (restartTouch && index !== restartTouch.taker) restartTouch = null;
      else if (restartTouch && elapsed > restartTouch.at + 0.02) {
        startRestart('indirectFreeKick', !player.home, { x: ball.position.x, z: ball.position.z });
        show('DOUBLE TOUCH · INDIRECT FREE KICK', 1.8); count('double touches'); return true;
      }
      if (!kick && lastRuleTouch === index && (!deliberate || lastRuleDeliberate)) return false;
      const exempt = kick && ['corner', 'goalKick', 'throwIn'].includes(restart?.type);
      const offence = offside.touch(player, ball.position, rulePlayers(), { deliberate, save, exempt });
      lastRuleTouch = index;
      lastRuleDeliberate = deliberate && !save;
      if (offence) {
        startRestart('indirectFreeKick', !player.home, { x: player.x, z: player.z });
        show('OFFSIDE · INDIRECT FREE KICK', 1.8); sound.whistle('short'); count('offsides'); return true;
      }
      if (kick && restart) restartTouch = { taker: index, home: player.home, type: restart.type, at: elapsed };
      return false;
    }
    // Outfield movement with stamina: sprinting drains it, a tired player is slower.
    function run(person, input, dt, options) {
      const sprint = options.sprint && person.stamina > STAMINA.minimumToSprint;
      const carrying = options.dribbling && !restart && keeperHolding < 0;
      const strideInput = carrying ? controlStrideInput(person.motion, input, ball.position) : input;
      const speedLimit = carrying ? controlStrideLimit(person.motion, strideInput, ball.position, ballVelocity, { sprint, controlledSprint: options.controlledSprint }) : Infinity;
      // The team-wide ability multiplier (win progression, CPU difficulty) now moves speed
      // only a little; individual pace, acceleration and agility come from the player's attributes.
      const teamSpeed = 1 + ((options.ability ?? 1) - 1) * 0.3;
      const speed = advancePlayer(person.motion, strideInput, dt, { ...options, sprint, speedLimit,
        ability: teamSpeed * paceFactor(person.attrs) * (1 - STAMINA.speedLoss * (1 - person.stamina)),
        accelFactor: accelerationFactor(person.attrs), agilityFactor: agilityFactor(person.attrs) });
      const fitness = staminaFactor(person.attrs);
      person.stamina = sprint && speed > 4.5 ? Math.max(0, person.stamina - STAMINA.sprintDrain / fitness * dt)
        : Math.min(1, person.stamina + (speed < 2 ? STAMINA.restRecover : STAMINA.jogRecover) * fitness * dt);
      return speed;
    }
    const events = { tackles: 0, catches: 0, parries: 0, punches: 0, awayShots: 0, passes: 0 };
    const count = name => { events[name] = (events[name] || 0) + 1; };
    const touchAxis = { x: 0, z: 0 };
    const padAxis = { x: 0, z: 0 };
    let padActions = {}, padRightActive = false, padName = '';
    const keys = new Set(), heldKeys = new Map(), mixers = [], clips = {};
    let diveLocalSign = 1;
    const keyboard = preferences.keyboard;
    let shownTouchAttack = null;
    const isTouchAttack = () => restart ? restart.home : keeperHolding >= 0 ? people[keeperHolding].home
      : awayCarrier >= 0 ? false : possessor >= 0 ? people[possessor].home : lastTouchHome;
    const state = {
      touchAction(id) {
        const attacking = isTouchAttack();
        // Off-ball attack taps must not fall through to the keyboard's dual-use
        // tackle action. Only the defensive labels initiate tackles on touch.
        if (attacking && (id === 'circle' || id === 'cross') && !restart && keeperHolding !== 0
          && Math.hypot(people[controlled].motion.x - ball.position.x, people[controlled].motion.z - ball.position.z) >= 1.8) return 'touchIgnore';
        return touchActions(attacking, keeperHolding === 0).find(input => input.id === id)?.key;
      },
      setPeriodEnded(value) { periodEnded = value; },
      setPause(value) { if (periodEnded && !value) return; clearInput(); renderPending = true; pausedLocal = value; setPaused(value); },
      togglePause() { state.setPause(!pausedLocal); },
      setAxis(x, z) { touchAxis.x = x; touchAxis.z = z; },
      press(key) { pressAction(key); },
      release(key) { releaseAction(key); },
      skipGoal() { if (!pausedLocal) skipGoalSequence(); },
      cancel(key) { cancelAction(key); },
      whistle(kind) { sound.whistle(kind); },
      kickoff() { people.forEach(person => { person.stamina = Math.min(1, person.stamina + 0.5); }); reset(false); say('secondHalf'); },
      endOfHalf(final) {
        const score = scoreLine(hallName(true), hallName(false), goals), result = resultLine(hallName(true), hallName(false), goals);
        say(final ? 'fullTime' : 'halfTime', { score, result });
      },
      setSound(on) { sound.setEnabled(on); },
    };
    engine.current = state;
    const resize = () => { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h); cam.aspect = w / h; cam.fov = cam.aspect < 0.8 ? 46 : viewMode === 'Co-op' ? 42 : 48; cam.zoom = config.device === 'phone' ? 1.25 : 1; cam.updateProjectionMatrix(); renderPending = true; };
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    function show(text, duration = 1.1) { setMessage(text); messageUntil = elapsed + duration; }
    function action(person, name, once = false, strike = false) {
      const clip = clips[name];
      if (!clip || !person.mixer || (person.actionName === name && !once)) return;
      // A celebration plays at its natural speed for as long as the goal lasts;
      // other one-off moves are fitted to a short window.
      const natural = name === 'celebration';
      const duration = natural ? Math.min(clip.duration, 2.2) : Math.min(clip.duration, name === 'goalkeeperDive' ? 1.1
        : name === 'spin' ? 1.25 : name === 'tackleAlternate' || name === 'tackle' ? SLIDE_TIMING.animation
        : name === 'stand' ? SLIDE_TIMING.getUp : name === 'fallen' ? 1.1 : name.startsWith('goalkeeper') ? 0.8 : 0.55);
      const contactPhase = strike && (name === 'pass' || name === 'kick') ? 0.28 : 0;
      transitionPlayerAction(person, clip, { once, duration, natural, fade: contactPhase ? 0.03 : name === 'tackleAlternate' ? .08 : .17, startPhase: contactPhase });
      person.actionName = name;
      person.actionUntil = once ? elapsed + duration * (1 - contactPhase) : 0;
    }
    function idle(person) {
      action(person, person.keeper ? 'goalkeeperIdle' : 'idle');
      if (!person.keeper && person.actionName === 'idle' && person.currentAction) person.currentAction.timeScale = 0.8;
    }
    function moveAction(person, speed) {
      if (elapsed < person.actionUntil) return;
      const carrying = people.indexOf(person) === possessor || people.indexOf(person) === awayCarrier;
      if (speed < (carrying ? 0.1 : 0.25)) { idle(person); return; }
      action(person, person.keeper ? 'goalkeeperSidestep' : carrying ? 'dribble' : 'jog');
      if (person.currentAction) person.currentAction.timeScale = THREE.MathUtils.clamp(speed / 4.5, 0.7, 1.45);
    }
    const footPoint = new THREE.Vector3();
    function feetOf(person) {
      return (person.footBones || []).map(bone => {
        bone.getWorldPosition(footPoint);
        return { x: footPoint.x, y: footPoint.y, z: footPoint.z };
      });
    }
    function slideBodyOf(person) {
      if (!person.hipBone) return { x: person.motion.x, y: .85, z: person.motion.z };
      person.hipBone.getWorldPosition(footPoint);
      return { x: footPoint.x, y: footPoint.y, z: footPoint.z };
    }
    function legsOf(person) {
      return (person.footBones || []).flatMap(toe => {
        const joints = [toe, toe.parent, toe.parent?.parent, toe.parent?.parent?.parent].filter(Boolean).map(bone => {
          bone.getWorldPosition(footPoint); return { x: footPoint.x, y: footPoint.y, z: footPoint.z };
        });
        const points = [];
        for (let joint = 0; joint < joints.length - 1; joint++) {
          const from = joints[joint], to = joints[joint + 1];
          // Fixed subdivisions keep correspondence between ticks while
          // covering the ankle, shin and thigh, not just their endpoints.
          for (let sample = 0; sample < 4; sample++) points.push({ x: from.x + (to.x - from.x) * sample / 4,
            y: from.y + (to.y - from.y) * sample / 4, z: from.z + (to.z - from.z) * sample / 4 });
        }
        points.push(joints.at(-1)); return points;
      });
    }
    function animatePlayers(dt) {
      if (goalSequence?.phase === 'replay') return;
      mixers.forEach(mixer => mixer.update(dt));
      for (const person of people) if (elapsed < (person.slideRecoveryUntil || 0)) poseSlidePlayer(person, 1);
      for (const person of people) if (person.slideStandAt && elapsed < person.slideStandAt + SLIDE_TIMING.getUp) {
        poseSlidePlayer(person, 1, (elapsed - person.slideStandAt) / SLIDE_TIMING.getUp);
      }
      if (sliding && !restart && !pendingRestart && !resetAt) {
        poseSlidePlayer(sliding, elapsed - slideStartedAt);
        resolveSlide(dt);
      }
      const owner = possessor >= 0 ? possessor : awayCarrier;
      if (restart || keeperHolding >= 0 || owner < 0) return;
      const person = people[owner];
      if (elapsed >= ballControl.trapUntil || elapsed < (person.downUntil || 0) || !(needsControlTrap(ball.position, ballVelocity, person.motion) || needsStrideTouch(ball.position, ballVelocity, person.motion))) return;
      const toes = person.footBones || [];
      const nearest = toes.reduce((best, toe) => {
        toe.getWorldPosition(footPoint);
        const gap = Math.hypot(footPoint.x - ball.position.x, footPoint.z - ball.position.z);
        return !best || gap < best.gap ? { toe, gap } : best;
      }, null);
      if (nearest) plantControlFoot(nearest.toe, ball.position);
    }
    function poseSlidePlayer(person, age, standing = 0) {
      const forward = forwardFromHeading(person.motion.heading), amount = clamp((age - .06) / .18, 0, 1);
      if (age < .12) {
        const side = (ball.position.x - person.motion.x) * -forward.z + (ball.position.z - person.motion.z) * forward.x;
        if (Math.abs(side) > .03) person.slideState.foot = side < 0 ? 0 : 1;
      }
      (person.footBones || []).forEach((toe, index) => {
        const extended = index === person.slideState.foot, side = index === 0 ? -1 : 1;
        const stand = clamp(standing * 1.6, 0, 1), blend = stand * stand * (3 - 2 * stand);
        const ahead = (extended ? .78 : .02) * (1 - blend) + .1 * blend;
        const across = side * ((extended ? .12 : .3) * (1 - blend) + .18 * blend);
        placeSlideFoot(toe, { x: person.motion.x + forward.x * ahead - forward.z * across,
          y: .06, z: person.motion.z + forward.z * ahead + forward.x * across }, amount * clamp((1 - standing) * 4, 0, 1));
      });
    }
    function inputDirection() {
      const dx = Number(keys.has(keyboard.right)) - Number(keys.has(keyboard.left)) + touchAxis.x + padAxis.x;
      const dz = Number(keys.has(keyboard.down)) - Number(keys.has(keyboard.up)) + touchAxis.z + padAxis.z;
      return new THREE.Vector3(THREE.MathUtils.clamp(dx, -1, 1), 0, THREE.MathUtils.clamp(dz, -1, 1));
    }
    function aim() {
      const direction = aimOverride ? new THREE.Vector3(aimOverride.x, 0, aimOverride.z) : inputDirection();
      if (direction.lengthSq() < 0.01) {
        const heading = people[controlled].motion.heading;
        const forward = forwardFromHeading(heading);
        direction.set(forward.x, 0, forward.z);
      }
      return direction.normalize();
    }
    // Spin for a kick along direction: topspin turns about the axis up x
    // direction, side spin about the vertical. curlTowardZ picks which way a
    // side-spun ball bends across the pitch.
    function spinFor(kind, direction, curlTowardZ = 0) {
      const { top, side } = KICK_SPIN[kind];
      const length = Math.hypot(direction.x, direction.z) || 1;
      const dx = direction.x / length, dz = direction.z / length;
      const bend = side && curlTowardZ && Math.abs(dx) > 1e-3 ? Math.sign(curlTowardZ) * Math.sign(-dx) : 0;
      return { x: top * dz, y: side * bend, z: -top * dx };
    }
    const spinBall = (spin = { x: 0, y: 0, z: 0 }) => physics?.setSpin(spin);
    // Where a kick from the ball along direction would cross the goal line.
    function goalLineZ(direction, goalX) {
      if (Math.abs(direction.x) < 0.1) return ball.position.z;
      return ball.position.z + direction.z / direction.x * (goalX - ball.position.x);
    }
    // Strikes the ball so it passes over target (x, z) at `height`, allowing
    // for drag, dip and curl (src/ballistics.js).
    function launchTo(target, height, speed, kind, curlTowardZ = 0) {
      const { velocity, spin } = solveLaunch(target, height, speed, direction => spinFor(kind, direction, curlTowardZ));
      ballVelocity.set(velocity.x, velocity.y, velocity.z);
      spinBall(spin);
    }
    // The launch velocity and spin (spinOf(direction)) for a ball from where it
    // lies to pass over target at height.
    function solveLaunch(target, height, speed, spinOf, minLift = 0, origin = ball.position) {
      const from = { x: origin.x, y: origin.y, z: origin.z };
      const distance = Math.max(1, Math.hypot(target.x - from.x, target.z - from.z));
      const wanted = Math.atan2(target.z - from.z, target.x - from.x);
      let angle = wanted, spin, lift = 0;
      for (let pass = 0; pass < 3; pass++) {
        const direction = { x: Math.cos(angle), z: Math.sin(angle) };
        spin = spinOf(direction);
        const ground = { x: direction.x * speed, z: direction.z * speed };
        lift = liftFor({ from, ground, spin, distance, height, minLift });
        if (!spin.y) break;
        // Curl bends the ball off its line: aim off by the miss.
        const end = flight(from, { ...ground, y: lift }, spin, { distance, sample: false }).position;
        angle -= Math.atan2(end.z - from.z, end.x - from.x) - wanted;
      }
      return { velocity: { x: Math.cos(angle) * speed, y: lift, z: Math.sin(angle) * speed }, spin, distance };
    }

    // ---- Set pieces you take, including overhead throw-ins ----
    // The left stick moves the reticle, a held button sets the power (▢ shot,
    // ◯ cross or lofted, ✕ pass), then during the run-up the right stick adds
    // spin and a second ▢ tap at the strike is timed finishing.
    function beginSetPiece() {
      const spot = restart.spot, goalX = LENGTH / 2, side = Math.sign(spot.z) || 1;
      const distance = Math.hypot(goalX - spot.x, spot.z);
      const shot = restart.type === 'penalty' || (restart.type === 'freeKick' && distance < 30);
      const reticle = shot ? new THREE.Vector3(goalX, 1.6, -side * (GOAL_WIDTH / 2 - 1))
        : restart.type === 'throwIn' ? new THREE.Vector3(clamp(spot.x + 8, -goalX + 1, goalX - 1), 0, spot.z - side * 10)
        : restart.type === 'corner' ? new THREE.Vector3(goalX - 6, 0, 0)
        : new THREE.Vector3(Math.min(goalX - 8, spot.x + 26), 0, spot.z * 0.4);
      setPiece = { restart, mode: shot ? 'shot' : 'cross', reticle, button: null, phase: 'aim', power: 0, strikeAt: 0, gesture: [], timing: null, previewAt: 0 };
      restart.autoAt = elapsed + 30;
      // Stand back from the ball for the run-up.
      const taker = people[restart.taker], facing = Math.atan2(reticle.z - spot.z, reticle.x - spot.x);
      const forward = forwardFromHeading(facing), throwing = restart.type === 'throwIn';
      Object.assign(taker.motion, { x: throwing ? spot.x : spot.x - forward.x * 2.3,
        z: throwing ? spot.z + side * 0.25 : spot.z - forward.z * 2.3, heading: facing, vx: 0, vz: 0 });
      taker.mesh.position.set(taker.motion.x, 0, taker.motion.z);
    }
    function setPieceSpin(style, direction, fallback) {
      const right = { x: -direction.z, z: direction.x };
      if (style === 'dip') return { x: -right.x * 45, y: 0, z: -right.z * 45 };
      if (style === 'curlRight') return { x: -right.x * 8, y: -42, z: -right.z * 8 };
      if (style === 'curlLeft') return { x: -right.x * 8, y: 42, z: -right.z * 8 };
      if (style === 'knuckle') return { x: 0, y: 0, z: 0 };
      return fallback(direction);
    }
    // What a strike at this power would do: where it goes, how high, how fast.
    function setPiecePlan(strength) {
      const piece = setPiece, r = piece.reticle;
      if (piece.deliveryPlan) return piece.deliveryPlan;
      if (piece.restart.type === 'throwIn') return throwInPlan(piece.restart.spot, r, strength, { length: LENGTH, width: WIDTH });
      const button = piece.button || (piece.mode === 'shot' ? 'k' : 'l');
      if (passingAssistance !== 'assisted' && piece.restart.type !== 'penalty' && (button === 'j' || button === 'l' || piece.mode === 'cross')) {
        const delivery = planPass({ mode: passingAssistance, origin: { x: ball.position.x, y: ball.position.y, z: ball.position.z },
          direction: { x: r.x - ball.position.x, z: r.z - ball.position.z }, power: strength,
          players: team(true).map(p => ({ ...p, home: true })), opponents: team(false, true), controlled, surface: venue.surface,
          lofted: button !== 'j', crossing: piece.restart.type === 'corner' });
        return { target: delivery.destination, height: button === 'j' ? .15 : 1.4, speed: delivery.speed,
          spin: () => delivery.spin, style: 'none', ground: button === 'j', velocity: delivery.velocity, directed: true, receiver: delivery.receiver };
      }
      const distance = Math.hypot(r.x - ball.position.x, r.z - ball.position.z);
      const style = spinStyle(piece.gesture);
      const target = { x: r.x, z: r.z };
      if (button === 'j') {
        if (piece.restart.type === 'penalty') return { target: { x: piece.restart.spot.x + (piece.restart.home ? 1 : -1) * 2.5, z: piece.restart.spot.z },
          height: 0.15, speed: groundPassSpeed(2.5, venue.surface, 2 + strength), spin: d => spinFor('pass', d), style: 'none', ground: true };
        const direction = { x: r.x - ball.position.x, z: r.z - ball.position.z }, size = Math.hypot(direction.x, direction.z) || 1;
        direction.x /= size; direction.z /= size;
        const mates = team(true).filter(p => p.index !== controlled && Math.hypot(p.x - ball.position.x, p.z - ball.position.z) < 18);
        const receiver = pickPassTarget(mates.map(p => ({ ...p, home: true })), ball.position, direction, controlled, team(false, true));
        const mate = mates.find(p => p.index === receiver) || mates.sort((a, b) => Math.hypot(a.x - ball.position.x, a.z - ball.position.z) - Math.hypot(b.x - ball.position.x, b.z - ball.position.z))[0];
        const shortTarget = piece.deliveryTarget || (mate ? { x: mate.x + mate.vx * 0.5, z: mate.z + mate.vz * 0.5 }
          : { x: ball.position.x + direction.x * 7, z: ball.position.z + direction.z * 7 });
        const reach = Math.hypot(shortTarget.x - ball.position.x, shortTarget.z - ball.position.z);
        return { target: shortTarget, height: 0.15, speed: groundPassSpeed(reach, venue.surface, 3.5 + strength * 2),
          spin: d => spinFor('pass', d), style: 'none', ground: true };
      }
      if (button === 'k' && piece.mode === 'shot') {
        // Two to three and a half bars (of five) suits most distances; more sends it over.
        const ideal = clamp(0.4 + (distance - 16) / 16 * 0.3, 0.4, 0.7);
        return { target, height: r.y + (strength - ideal) * 2.6, speed: 22 + strength * 14, spin: d => setPieceSpin(style, d, dd => spinFor('shot', dd)), style };
      }
      if (button === 'k') return { target, height: 0.9, speed: 20 + strength * 10, spin: d => setPieceSpin(style, d, dd => spinFor('shot', dd)), style };
      if (piece.mode === 'shot') return { target, height: r.y, speed: 13 + strength * 8, spin: d => setPieceSpin(style, d, dd => spinFor('pass', dd)), style, minLift: 2 };
      // A cross arrives at head height; more power whips it in flatter and quicker.
      const hang = clamp(1.1 + distance * 0.025, 1.3, 2) * (1.2 - strength * 0.45);
      return { target, height: 1.4, speed: clamp(distance / hang * (1.05 + distance * 0.005), 9, 30),
        spin: d => setPieceSpin(style, d, dd => spinFor('cross', dd, -(ball.position.z || 1))), style, minLift: 3 };
    }
    function previewStrength() {
      if (setPiece.phase === 'charge') return power;
      if (setPiece.phase === 'runup') return setPiece.power;
      return setPiece.mode === 'shot' ? clamp(0.4 + (Math.hypot(setPiece.reticle.x - ball.position.x, setPiece.reticle.z - ball.position.z) - 16) / 16 * 0.3, 0.4, 0.7) : 0.5;
    }
    function updateSetPieceView() {
      const show = Boolean(setPiece);
      aimDots.visible = show; aimReticle.visible = show;
      if (!show) return;
      const r = setPiece.reticle;
      aimReticle.position.set(r.x, setPiece.mode === 'shot' ? r.y : 0.05, r.z);
      if (setPiece.mode === 'shot') aimReticle.rotation.set(0, Math.PI / 2, 0); else aimReticle.rotation.set(-Math.PI / 2, 0, 0);
      if (elapsed < setPiece.previewAt) return;
      setPiece.previewAt = elapsed + 0.05; // a few times a second is plenty
      const plan = setPiecePlan(previewStrength());
      if (plan.ground) { aimReticle.position.set(plan.target.x, 0.05, plan.target.z); aimReticle.rotation.set(-Math.PI / 2, 0, 0); }
      if (plan.thrown) aimReticle.position.set(plan.target.x, 0.05, plan.target.z);
      const launch = plan.velocity ? { velocity: plan.velocity, spin: plan.spin(), distance: Math.hypot(plan.target.x - ball.position.x, plan.target.z - ball.position.z) }
        : plan.ground ? null : solveLaunch(plan.target, plan.height, plan.speed, plan.spin, plan.minLift, plan.origin);
      const path = plan.ground ? Array.from({ length: AIM_DOTS + 1 }, (_, i) => ({ x: THREE.MathUtils.lerp(ball.position.x, plan.target.x, i / AIM_DOTS),
        y: BALL_RADIUS, z: THREE.MathUtils.lerp(ball.position.z, plan.target.z, i / AIM_DOTS) }))
        : flight(plan.origin || { x: ball.position.x, y: ball.position.y, z: ball.position.z }, launch.velocity, launch.spin,
          { distance: plan.directed ? Infinity : launch.distance + (setPiece.mode === 'shot' ? 0.5 : 0), maxTime: 3.5 }).points;
      for (let i = 0; i < AIM_DOTS; i++) {
        const point = path[Math.min(path.length - 1, Math.round((i + 1) / AIM_DOTS * (path.length - 1)))];
        dotMatrix.makeTranslation(point.x, Math.max(0.06, point.y), point.z);
        aimDots.setMatrixAt(i, dotMatrix);
      }
      aimDots.instanceMatrix.needsUpdate = true;
    }
    function strikeSetPiece() {
      const piece = setPiece, taker = people[controlled];
      if (ruleTouch(controlled, { deliberate: true, kick: true })) return;
      const strength = piece.power, plan = setPiecePlan(strength);
      // Timed finishing: a second ▢ right at the strike sharpens it.
      let accuracy = 1, verdict = '';
      if (piece.button === 'k' && piece.timing !== null) {
        const off = Math.abs(piece.timing);
        accuracy = off < 0.07 ? 0.35 : off < 0.18 ? 0.8 : 1.6;
        verdict = off < 0.07 ? 'GREEN TIMING · ' : off < 0.18 ? '' : piece.timing < 0 ? 'EARLY · ' : 'LATE · ';
      }
      const distance = Math.hypot(plan.target.x - ball.position.x, plan.target.z - ball.position.z);
      const spread = plan.thrown || plan.directed ? 0 : (0.3 + distance * 0.014) * accuracy / teamAbility;
      const target = { x: plan.target.x, z: plan.target.z + gaussian(random) * spread };
      if (piece.mode === 'cross' && !plan.ground) target.x += gaussian(random) * spread;
      let height = plan.height + (plan.ground ? 0 : gaussian(random) * spread * 0.6);
      if (plan.style === 'knuckle') { target.z += (random() - 0.5) * 1.2; height -= random() * 0.4; } // it moves late
      const direction = new THREE.Vector3(target.x - ball.position.x, 0, target.z - ball.position.z).normalize();
      const launch = plan.velocity ? { velocity: plan.velocity, spin: plan.spin() }
        : plan.ground ? { velocity: { x: direction.x * plan.speed * teamAbility, y: 0.15, z: direction.z * plan.speed * teamAbility }, spin: plan.spin(direction) }
        : solveLaunch(target, Math.max(0.15, height), plan.speed * (plan.thrown ? 1 : teamAbility), plan.spin, plan.minLift, plan.origin);
      if (plan.thrown) ball.position.set(plan.origin.x, plan.origin.y, plan.origin.z);
      ballVelocity.set(launch.velocity.x, launch.velocity.y, launch.velocity.z); spinBall(launch.spin);
      const shot = !plan.directed && piece.mode === 'shot' && piece.button !== 'j';
      if (restart?.type === 'penalty') keeperGuess(TEAM_SIZE);
      possessor = -1; awayCarrier = -1; passDestination = null; restart = null; setPiece = null;
      controlLockUntil = elapsed + 0.35; lastTouchHome = true;
      if (shot) { lastShooter = controlled; lastShotAt = elapsed; if (people[TEAM_SIZE].reactAt < elapsed) people[TEAM_SIZE].reactAt = elapsed + (0.24 + random() * 0.12) / difficulty.keeper; /* partly screened by the wall */ passTarget = -1; say('shot', { who: who(controlled), team: hallName(true) }); }
      else {
        // The teammate nearest the target attacks the ball.
        const near = plan.directed ? plan.receiver : nearestOf(true, target.x, target.z, controlled);
        passTarget = near; passDestination = new THREE.Vector3(target.x, 0, target.z); passDeadline = elapsed + 4; events.passes++;
        if (piece.button === 'l') say('cross', { team: hallName(true) });
      }
      physics?.releaseFrom(controlled);
      action(taker, plan.thrown ? 'throwIn' : piece.button === 'j' ? 'pass' : 'kick', true, !plan.thrown); sound.kick(Math.min(1, plan.speed / 30));
      const spinName = { dip: 'DIP', curlLeft: 'CURL', curlRight: 'CURL', knuckle: 'KNUCKLEBALL' }[plan.style];
      show(plan.thrown ? 'THROW IN' : `${verdict}${spinName ? spinName + ' · ' : ''}${shot ? (piece.restart.type === 'penalty' ? 'PENALTY KICK!' : 'FREE KICK!') : piece.button === 'j' ? 'SHORT PASS' : 'CROSS!'}`, 1.2);
    }
    function kick(speed, name = 'kick', lift = 0.15, shot = null, loft = null) {
      const person = people[controlled];
      if (keeperHolding >= 0 || awayCarrier >= 0 || person.sentOff || elapsed < (person.downUntil || 0) || elapsed < controlLockUntil || !withinKickReach(person.motion, ball.position)) return false;
      if (ruleTouch(controlled, { deliberate: true, kick: true })) return true;
      const throwIn = restart?.type === 'throwIn';
      if (throwIn) ball.position.y = 1.8;
      const direction = aim();
      possessor = -1; awayCarrier = -1; passTarget = -1; passDestination = null; restart = null;
      controlLockUntil = elapsed + 0.35;
      let crossing = false, delivery = null;
      if (name === 'pass' || name === 'goalkeeperPass' || name === 'chip') {
        crossing = name === 'chip' && Math.abs(ball.position.z) > WIDTH * .27 && ball.position.x > LENGTH * .08;
        const side = Math.sign(ball.position.z) || 1;
        const zones = [{ x: LENGTH / 2 - 4.5, z: side * 2.2 }, { x: LENGTH / 2 - 8, z: 0 }, { x: LENGTH / 2 - 5.5, z: -side * 3.2 }];
        const zone = crossing ? zones.reduce((best, zone) => {
          const score = ((zone.x - ball.position.x) * direction.x + (zone.z - ball.position.z) * direction.z) / Math.hypot(zone.x - ball.position.x, zone.z - ball.position.z);
          return !best || score > best.score ? { ...zone, score } : best;
        }, null) : null;
        delivery = planPass({ mode: passingAssistance, origin: { x: ball.position.x, y: ball.position.y, z: ball.position.z },
          direction, power: loft?.power ?? (name === 'chip' ? .45 : name === 'goalkeeperPass' ? .4 : 0),
          players: team(true).map(p => ({ ...p, home: true, keeper: people[p.index].keeper })), opponents: team(false, true),
          controlled, surface: venue.surface, lofted: name === 'chip', crossing, through: name === 'goalkeeperPass', zone });
        direction.set(delivery.direction.x, 0, delivery.direction.z);
        speed = delivery.speed; lift = delivery.lift;
        passTarget = delivery.receiver;
        passDestination = new THREE.Vector3(delivery.destination.x, 0, delivery.destination.z);
        passDeadline = elapsed + 4; events.passes++;
      }
      // Finesse shots curl back toward the middle of the goal; crosses curl in
      // toward the box; chips carry backspin; driven shots dip with topspin.
      const kind = crossing ? 'cross' : name === 'chip' ? 'chip' : name === 'pass' || name === 'goalkeeperPass' ? 'pass'
        : name === 'scissor' || name === 'powerShot' ? 'powerShot' : name === 'chipShot' ? 'chip' : finesseHold ? 'finesse' : 'shot';
      const towardMiddle = -(Math.abs(goalLineZ(direction, LENGTH / 2)) > 0.3 ? goalLineZ(direction, LENGTH / 2) : ball.position.z || 1);
      spinBall(delivery ? delivery.spin : spinFor(kind, direction, kind === 'cross' ? -(ball.position.z || 1) : towardMiddle));
      if (delivery && name === 'chip') {
        if (passingAssistance === 'assisted' && passTarget >= 0) {
          launchTo(passDestination, crossing ? 1.5 : .35, speed * teamAbility, crossing ? 'cross' : 'chip', crossing ? -(ball.position.z || 1) : 0);
          ballVelocity.y = Math.max(3, ballVelocity.y);
        } else ballVelocity.set(delivery.velocity.x, delivery.velocity.y, delivery.velocity.z);
      } else       if (shot) {
        // Shots are aimed at the goal mouth (src/shooting.js), chips dropped under the bar.
        const goalX = LENGTH / 2;
        const shooterAccuracy = finishingAccuracy(people[controlled].attrs) * teamAbility;
        const shotPressure = Math.max(0, Math.min(1, 1 - Math.min(Infinity, ...team(false).map(p => Math.hypot(p.x - ball.position.x, p.z - ball.position.z))) / 4));
        if (name === 'chipShot') {
          const aimed = aimChip({ ball: ball.position, direction, goalX, goalWidth: GOAL_WIDTH, goalHeight: GOAL_HEIGHT,
            power: shot.power, accuracy: shooterAccuracy, pressure: shotPressure, random });
          speed = aimed.speed;
          launchTo({ x: aimed.x, z: aimed.z }, aimed.height, speed * teamAbility, 'chip');
        } else {
          const aimed = aimShot({ ball: ball.position, direction, goalX, goalWidth: GOAL_WIDTH, goalHeight: GOAL_HEIGHT,
            power: shot.power, style: shot.style, accuracy: shooterAccuracy * (controlledSprint ? 1.05 : 1), pressure: shotPressure, random });
          speed = aimed.speed;
          launchTo({ x: aimed.x, z: aimed.z }, aimed.height, speed * teamAbility, SHOT_STYLES[shot.style]?.spin || 'shot', -aimed.z || -ball.position.z || 1);
        }
        // The keeper needs a moment to read the strike.
        people[TEAM_SIZE].reactAt = elapsed + (0.2 + random() * 0.12) / difficulty.keeper;
      } else if (delivery) {
        const launch = passingAssistance === 'manual' ? delivery.velocity : groundPassVelocity(speed, direction, person.motion, teamAbility);
        ballVelocity.set(launch.x, launch.y, launch.z);
      } else { ballVelocity.copy(direction.multiplyScalar(speed * teamAbility)); ballVelocity.y = lift; }
      if (throwIn) { ballVelocity.y = Math.max(2, ballVelocity.y); action(person, 'throwIn', true); }
      physics?.releaseFrom(controlled);
      sound.kick(Math.min(1, speed / 30));
      if (shot || kind === 'shot' || kind === 'powerShot' || kind === 'finesse' || name === 'chipShot') { lastShooter = controlled; lastShotAt = elapsed; say('shot', { who: who(controlled), team: hallName(true) }); }
      else if (kind === 'cross') say('cross', { team: hallName(true) });
      else if (name === 'goalkeeperPass' && passTarget >= 0) say('through', { who: who(passTarget), team: hallName(true) });
      const animation = throwIn ? 'throwIn' : { goalkeeperPass: 'pass', chipShot: 'chip', powerShot: 'kick' }[name] || name;
      lastTouchHome = true; action(person, animation, true, true);
      show(name === 'pass' ? 'PASS!' : name === 'goalkeeperPass' ? 'THROUGH BALL!' : name === 'chip' ? (crossing ? 'CROSS!' : 'LOFTED PASS!')
        : name === 'chipShot' ? 'CHIP SHOT!' : name === 'powerShot' ? 'POWER SHOT!' : shot?.style === 'finesse' || finesseHold ? 'FINESSE SHOT!'
        : shot?.style === 'low' ? 'LOW DRIVEN SHOT!' : 'SHOT!');
      return true;
    }
    function requestKick(speed, name, lift = 0.15, shot = null, loft = null) {
      pendingKick = null;
      if (kick(speed, name, lift, shot, loft)) { pendingKick = null; return; }
      const player = people[controlled];
      if (!player.sentOff && keeperHolding < 0 && awayCarrier < 0 && !pendingRestart && !resetAt
        && (!restart || restart.home) && Math.hypot(player.motion.x - ball.position.x, player.motion.z - ball.position.z) < 1.8)
        pendingKick = { speed, name, lift, shot, loft, owner: controlled, until: elapsed + INPUT_BUFFER_SECONDS };
    }
    // The teammate a held ball would be thrown to: the one the player aims at,
    // otherwise the best-placed free teammate.
    function keeperThrowTarget(index = 0) {
      const keeper = people[index], direction = keeper.home ? inputDirection() : new THREE.Vector3();
      if (keeper.home && passingAssistance !== 'assisted') {
        if (passingAssistance === 'manual') return -1;
        return planPass({ mode: passingAssistance, origin: { x: keeper.motion.x, y: 1.6, z: keeper.motion.z },
          direction: direction.lengthSq() > .01 ? direction : forwardFromHeading(keeper.motion.heading), power: throwHold ? power : .4,
          players: team(true).map(p => ({ ...p, home: true })), opponents: team(false, true), controlled: index, surface: venue.surface,
          lofted: !throwHold || power >= .25, selectionOnly: true }).receiver;
      }
      if (direction.lengthSq() > 0.01) {
        const aimed = pickPassTarget(people.map((p, i) => ({ index: i, home: p.home === keeper.home && !p.sentOff, keeper: p.keeper, x: p.motion.x, z: p.motion.z })),
          keeper.motion, direction.normalize(), index);
        if (aimed >= 0) return aimed;
      }
      const option = bestPassOption(point(index), team(keeper.home), team(!keeper.home, true), { x: -ownGoalX(keeper.home), width: GOAL_WIDTH },
        { minDistance: 5, maxDistance: 45 });
      return option ? option.index : nearestOf(keeper.home, keeper.motion.x, keeper.motion.z);
    }
    // mode: 'roll' (along the ground), 'throw' (overarm) or 'kick' (long punt).
    function keeperDistribute(index, mode, targetIndex, strength = 0.4) {
      if (ruleTouch(index, { deliberate: true, kick: true })) return;
      const keeper = people[index], from = new THREE.Vector3(keeper.motion.x, 0, keeper.motion.z);
      let receiver = targetIndex >= 0 ? people[targetIndex] : null;
      let destination;
      if (receiver) {
        destination = new THREE.Vector3(receiver.motion.x, 0, receiver.motion.z);
        const lead = Math.min(0.8, destination.distanceTo(from) / 16);
        destination.x += receiver.motion.vx * lead; destination.z += receiver.motion.vz * lead;
      } else {
        const forward = forwardFromHeading(keeper.motion.heading);
        destination = from.clone().add(new THREE.Vector3(forward.x, 0, forward.z).multiplyScalar(38));
      }
      const direction = destination.clone().sub(from); const distance = direction.length(); direction.normalize();
      let speed = mode === 'roll' ? groundPassSpeed(Math.max(0, distance - 0.7), venue.surface, 4)
        : mode === 'throw' ? clamp(9 + distance * 0.42 + strength * 3, 11, 21) : clamp(13 + distance * 0.3, 20, 27);
      let lift = mode === 'roll' ? 0.2 : mode === 'throw' ? clamp(1.8 + distance * 0.07, 2, 4.5) : clamp(4 + distance * 0.11, 6, 10);
      let distribution = null;
      if (keeper.home && passingAssistance !== 'assisted') {
        const input = inputDirection(), forward = forwardFromHeading(keeper.motion.heading);
        distribution = planPass({ mode: passingAssistance, origin: { x: from.x, y: mode === 'roll' ? BALL_RADIUS : mode === 'throw' ? 1.6 : .35, z: from.z },
          direction: input.lengthSq() > .01 ? input : forward, power: strength,
          players: team(true).map(p => ({ ...p, home: true })), opponents: team(false, true), controlled: index, surface: venue.surface, lofted: mode !== 'roll' });
        direction.set(distribution.direction.x, 0, distribution.direction.z);
        destination.set(distribution.destination.x, 0, distribution.destination.z);
        receiver = distribution.receiver >= 0 ? people[distribution.receiver] : null;
        targetIndex = distribution.receiver; speed = distribution.speed; lift = distribution.lift;
      }
      ball.position.set(from.x + direction.x * 0.7, mode === 'throw' ? 1.6 : mode === 'roll' ? BALL_RADIUS : 0.35, from.z + direction.z * 0.7);
      ballVelocity.copy(direction).multiplyScalar(speed); ballVelocity.y = lift;
      spinBall(distribution ? distribution.spin : mode === 'kick' ? spinFor('chip', direction) : mode === 'roll' ? spinFor('pass', direction) : undefined);
      keeperHolding = -1; throwHold = false; power = 0; targetRing.visible = false; setKeeperBall(false);
      controlLockUntil = elapsed + 0.3; awayKickUntil = elapsed + 0.3; lastTouchHome = keeper.home;
      if (keeper.home) { passTarget = receiver ? targetIndex : -1; passDestination = receiver ? destination.clone() : null; passDeadline = elapsed + 4; }
      else { awayPassTarget = receiver ? targetIndex : -1; awayPassDestination = receiver ? destination.clone() : null; awayPassDeadline = elapsed + 4; }
      action(keeper, mode === 'kick' ? 'kick' : 'goalkeeperPass', true);
      sound.kick(mode === 'kick' ? 0.8 : 0.2);
      if (keeper.home) show(mode === 'kick' ? 'LONG KICK' : 'THROW', 0.8);
    }
    function keeperPutDown() {
      if (ruleTouch(0, { deliberate: true, kick: true })) return;
      const keeper = people[0], forward = forwardFromHeading(keeper.motion.heading);
      keeperHolding = -1; throwHold = false; power = 0; targetRing.visible = false; setKeeperBall(false);
      ball.position.set(keeper.motion.x + forward.x * 0.6, BALL_RADIUS, keeper.motion.z + forward.z * 0.6);
      ballVelocity.set(0, 0, 0); spinBall(); possessor = 0; controlLockUntil = elapsed; show('BALL DOWN', 0.8);
    }
    // A computer player plays the ball: 'pass', 'through', 'cross' or 'shoot'.
    function cpuPlay(index, kind, target) {
      if (ruleTouch(index, { deliberate: true, kick: true })) return;
      const throwIn = restart?.type === 'throwIn';
      if (throwIn) ball.position.y = 1.8;
      const person = people[index], attack = person.home ? 1 : -1;
      const from = ball.position.clone().setY(0);
      let destination, speed, lift, height;
      if (kind === 'shoot') {
        destination = new THREE.Vector3(target.x, 0, target.z);
        speed = (19 + random() * 6) * difficulty.shot;
        height = target.high ? 1.6 + random() * 0.6 : 0.25 + random() * 0.4;
      } else {
        const mate = people[target];
        destination = new THREE.Vector3(mate.motion.x, 0, mate.motion.z);
        if (kind === 'through') destination.add(new THREE.Vector3(mate.motion.vx * 0.9 + attack * 2.5, 0, mate.motion.vz * 0.9));
        // Keep the ball inside the pitch: a through ball must not run out of play.
        destination.x = clamp(destination.x, -LENGTH / 2 + 4, LENGTH / 2 - 4);
        destination.z = clamp(destination.z, -WIDTH / 2 + 3, WIDTH / 2 - 3);
        const distance = destination.distanceTo(from);
        if (kind === 'cross') { speed = clamp(distance * 0.62, 15, 25); height = 1.5; }
        else {
          // Account for the initial skid, drag and this pitch's resistance.
          const arrival = kind === 'through' ? 3 : 5;
          speed = groundPassSpeed(distance, venue.surface, arrival); lift = 0.2;
        }
      }
      const direction = destination.clone().sub(from).normalize();
      if (throwIn) {
        const plan = throwInPlan(restart.spot, destination, 0.5, { length: LENGTH, width: WIDTH });
        destination.set(plan.target.x, 0, plan.target.z);
        ball.position.set(plan.origin.x, plan.origin.y, plan.origin.z);
        const launch = solveLaunch(plan.target, plan.height, plan.speed, plan.spin, plan.minLift, plan.origin);
        ballVelocity.set(launch.velocity.x, launch.velocity.y, launch.velocity.z); spinBall(launch.spin);
      } else if (kind === 'shoot' || kind === 'cross') {
        // CPU and human kicks obey the same drag, spin and target-height model.
        launchTo(destination, height, speed, kind === 'shoot' ? 'cpuShot' : 'cross', -(ball.position.z || 1));
      } else {
        // A CPU pass is not perfectly struck: a weaker passer sends it slightly off line.
        direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), gaussian(random) * passError(person.attrs));
        spinBall(spinFor('pass', direction));
        ballVelocity.copy(direction).multiplyScalar(speed); ballVelocity.y = lift;
      }
      if (person.home) { possessor = -1; passTarget = kind === 'shoot' ? -1 : target; passDestination = kind === 'shoot' ? null : destination; passDeadline = elapsed + 4; }
      else { awayCarrier = -1; awayPassTarget = kind === 'shoot' ? -1 : target; awayPassDestination = kind === 'shoot' ? null : destination; awayPassDeadline = elapsed + 4; }
      lastTouchHome = person.home; awayKickUntil = elapsed + (kind === 'shoot' ? 0.8 : 0.3); controlLockUntil = elapsed + 0.25;
      if (kind === 'shoot') people[person.home ? TEAM_SIZE : 0].reactAt = elapsed + 0.2 + random() * 0.12;
      if (kind === 'shoot') { events.awayShots++; lastShooter = index; lastShotAt = elapsed; say('shot', { who: who(index), team: hallName(person.home) }); }
      else if (kind === 'cross') say('cross', { team: hallName(person.home) });
      else if (kind === 'through') say('through', { who: who(target), team: hallName(person.home) });
      physics?.releaseFrom(index);
      count(`cpu ${kind}`);
      action(person, kind === 'shoot' ? 'kick' : kind === 'cross' ? 'chip' : 'pass', true, true);
      if (throwIn) action(person, 'throwIn', true);
      sound.kick(kind === 'shoot' ? 0.85 : kind === 'cross' ? 0.6 : 0.35);
      restart = null;
    }
    // Corners, goal kicks and free kicks: the ball waits on its spot, the taker
    // stands behind it and the other side keeps its distance.
    function startRestart(type, home, spot) {
      pendingRestart = null; pendingKick = null; pendingShot = null; passHold = throughHold = false; skill = null;
      offside.clear(); lastRuleTouch = -1; lastRuleDeliberate = false; restartTouch = null; setPiece = null;
      possessor = -1; awayCarrier = -1; passTarget = -1; awayPassTarget = -1; keeperHolding = -1; setKeeperBall(false); targetRing.visible = false;
      if (type === 'freeKick' && insideBox(spot.x, spot.z, !home)) spot = { x: ownGoalX(!home) + (home ? -1 : 1) * (boxDepth + 0.8), z: spot.z };
      ball.position.set(spot.x, BALL_RADIUS, spot.z); ballVelocity.set(0, 0, 0);
      const taker = type === 'goalKick' ? (home ? 0 : TEAM_SIZE) : nearestOf(home, spot.x, spot.z);
      const goalAhead = -ownGoalX(home);
      const facing = type === 'corner' ? Math.atan2(-spot.z, goalAhead * 0.85 - spot.x) : type === 'freeKick' || type === 'penalty'
        ? Math.atan2(-spot.z * 0.5, goalAhead - spot.x) : (home ? 0 : Math.PI);
      const forward = forwardFromHeading(facing), p = people[taker];
      Object.assign(p.motion, { x: spot.x - forward.x * 0.7, z: spot.z - forward.z * 0.7, vx: 0, vz: 0, heading: facing });
      p.mesh.position.set(p.motion.x, 0, p.motion.z); p.mesh.rotation.y = meshYawForHeading(facing); idle(p);
      restart = { type, home, spot: { ...spot }, taker, readyAt: elapsed + (type === 'penalty' ? 3 : type === 'throwIn' ? 0.4 : 1.4), autoAt: elapsed + 10 };
      // A wall for a free kick in shooting range: two defenders shoulder to
      // shoulder 7.2 m from the ball, covering the near half of the goal.
      const toGoal = new THREE.Vector3(-ownGoalX(home) - spot.x, 0, -spot.z);
      if (type === 'freeKick' && toGoal.length() < 30) {
        const line = toGoal.normalize(), across = { x: -line.z, z: line.x };
        const centre = { x: spot.x + line.x * 7.2 + across.x * 0.35 * Math.sign(spot.z || 1), z: spot.z + line.z * 7.2 + across.z * 0.35 * Math.sign(spot.z || 1) };
        restart.wall = team(!home).sort((a, b) => Math.hypot(a.x - centre.x, a.z - centre.z) - Math.hypot(b.x - centre.x, b.z - centre.z))
          .slice(0, 2).map((p, k) => ({ index: p.index, x: centre.x + across.x * (k - 0.5) * 0.6, z: centre.z + across.z * (k - 0.5) * 0.6 }));
      }
      const goalDistance = Math.hypot(-ownGoalX(home) - spot.x, spot.z);
      if (type === 'throwIn') say('throwIn', { team: hallName(home) });
      else if (type === 'corner') say('corner', { team: hallName(home) });
      else if (type === 'goalKick') say(elapsed - lastShotAt < 3 ? 'wide' : 'goalKick', { team: hallName(home) });
      else if (type === 'freeKick' && goalDistance < 26) say('freeKickNear', { team: hallName(home) });
      else if (type === 'penalty') say('penalty', { team: hallName(home) });
      count(type);
      lastTouchHome = home; controlLockUntil = elapsed + 0.4;
      if (home) { controlled = taker; setSelectedPlayer(taker + 1); possessor = taker; }
      // Facing a penalty you are the keeper: the stick picks your dive.
      else if (type === 'penalty') { controlled = 0; setSelectedPlayer(1); manualKeeper = true; penaltyDive = 0; }
      if (type === 'penalty') { sound.whistle('long'); count('penalties'); }
      physics?.reset(ball.position, ballVelocity, undefined, people.map(person => person.mesh.position));
      show(type === 'corner' ? 'CORNER' : type === 'goalKick' ? 'GOAL KICK' : type === 'throwIn' ? 'THROW IN' : type === 'indirectFreeKick' ? 'INDIRECT FREE KICK' : type === 'penalty' ? 'PENALTY!' : 'FREE KICK', 1.6);
    }
    // The computer side takes its set piece.
    function cpuTakeRestart() {
      const { type, taker, home } = restart;
      const goal = { x: -ownGoalX(home), width: GOAL_WIDTH };
      if (type === 'penalty') {
        // Mostly toward a corner, now and then down the middle; the odd one misses.
        const side = random() < 0.1 ? 0 : random() < 0.5 ? -1 : 1;
        const z = side * (GOAL_WIDTH / 2 - 0.4 - random() * 0.6) + gaussian(random) * 0.25 * difficulty.accuracy;
        const high = random() < 0.35;
        cpuPlay(taker, 'shoot', { x: goal.x, z, high });
        // Struck firmly, as a penalty is.
        launchTo({ x: goal.x, z }, high ? 1.3 + random() * 0.6 : 0.3 + random() * 0.4, (24 + random() * 5) * difficulty.shot, 'shot');
        keeperGuess(home ? TEAM_SIZE : 0, home ? null : penaltyDive);
        return;
      }
      if (type === 'corner') {
        const inBox = team(home).filter(m => m.index !== taker && Math.abs(goal.x - m.x) < boxDepth && Math.abs(m.z) < boxHalfWidth);
        if (inBox.length) { cpuPlay(taker, 'cross', inBox[Math.floor(random() * inBox.length)].index); return; }
      }
      const distance = Math.hypot(goal.x - ball.position.x, ball.position.z);
      if (type === 'freeKick' && distance < difficulty.shotRange + 5) {
        cpuPlay(taker, 'shoot', { x: goal.x, z: (random() < 0.5 ? -1 : 1) * (GOAL_WIDTH / 2 - 0.6), high: true }); return;
      }
      const option = bestPassOption(point(taker), team(home).filter(m => m.index !== taker), team(!home, true), goal,
        { minDistance: 5, maxDistance: type === 'goalKick' ? 50 : 35 });
      const target = option ? option.index : nearestOf(home, ball.position.x, ball.position.z, taker);
      cpuPlay(taker, Math.hypot(people[target].motion.x - ball.position.x, people[target].motion.z - ball.position.z) > 28 ? 'cross' : 'pass', target);
    }
    function foul(fouledHome, victim, offender = null, card = null) {
      if (victim) { action(victim, 'fallen', true); victim.actionUntil = elapsed + 1.1; }
      sound.whistle('short'); show('FOUL!', 1.2); count('fouls');
      // Inside the offenders' own box it is a penalty.
      const penalty = insideBox(ball.position.x, ball.position.z, !fouledHome);
      if (penalty) startRestart('penalty', fouledHome, { x: -ownGoalX(fouledHome) + (fouledHome ? -1 : 1) * penaltyDistance, z: 0 });
      else startRestart('freeKick', fouledHome, { x: ball.position.x, z: ball.position.z });
      if (offender && card) book(offender, card);
      else if (!penalty) say('foul', { team: hallName(fouledHome) });
    }
    // Cards: a second yellow is a red, and a red card sends the player off
    // for the rest of the match.
    function book(person, card) {
      const index = people.indexOf(person);
      person.yellows = (person.yellows || 0) + (card === 'yellow' ? 1 : 0);
      const red = card === 'red' || person.yellows >= 2;
      count(red ? 'red cards' : 'yellow cards');
      show(red ? (card === 'red' ? 'RED CARD!' : 'SECOND YELLOW · RED CARD!') : 'YELLOW CARD', 2);
      say(red ? 'redCard' : 'yellowCard', { who: who(index), team: hallName(person.home) });
      if (!red) return;
      person.sentOff = true; person.mesh.visible = false;
      Object.assign(person.motion, { x: 0, z: WIDTH / 2 + 30, vx: 0, vz: 0 }); person.mesh.position.set(0, 0, WIDTH / 2 + 30);
      if (radarDots[index]) radarDots[index].style.display = 'none';
      if (controlled === index) { controlled = nearestOf(true, ball.position.x, ball.position.z); setSelectedPlayer(controlled + 1); }
    }
    // Switch to the teammate nearest the ball, or, with a right-stick flick,
    // to the teammate lying in the flicked direction.
    function switchPlayer(direction = null) {
      if (sliding) return;
      // In solo play the ball carrier owns control. Manual switching is for defense.
      if (lastTouchHome && (possessor >= 0 || passTarget >= 0)) return;
      manualKeeper = false;
      let best = controlled, distance = Infinity;
      const from = people[controlled].motion, size = direction ? Math.hypot(direction.x, direction.z) || 1 : 1;
      people.forEach((person, index) => {
        if (!person.home || person.keeper || person.sentOff || index === controlled) return;
        let next;
        if (direction) {
          const dx = person.motion.x - from.x, dz = person.motion.z - from.z, gap = Math.hypot(dx, dz) || 1;
          const alignment = (dx * direction.x + dz * direction.z) / gap / size;
          if (alignment < 0.35) return;
          next = gap * (2 - alignment);
        } else next = person.mesh.position.distanceToSquared(ball.position);
        if (next < distance) { best = index; distance = next; }
      });
      controlled = best;
      setSelectedPlayer(best + 1);
      show(`PLAYER ${best + 1}`, 0.8);
      lastAutoSwitch = elapsed + 1.5; // a manual switch is not overridden for two seconds
    }
    // style: 'standing' (▢: a foot poked in, or a shoulder barge when running
    // alongside), 'hard' (R1 + ▢: longer reach, more fouls) or 'slide' (◯: a
    // lunge along the grass that reaches furthest but, when it misses, leaves
    // the player on the ground for seconds; reckless body-first contact can
    // warrant a red, while a clean ball-first slide remains legal).
    function beginSkill() {
      const player = people[controlled];
      if (possessor !== controlled || restart || pendingRestart || sliding || skill || elapsed < nextSkillAt || elapsed < (player.downUntil || 0)) return;
      skill = { owner: controlled, at: elapsed, heading: player.motion.heading, duration: 1.25 };
      nextSkillAt = elapsed + 1.8;
      action(player, 'spin', true);
    }
    function tackle(move = 'tackle', style = 'standing') {
      if (keeperHolding >= 0 || restart || pendingRestart || resetAt) return;
      const player = people[controlled];
      if (elapsed < player.nextTackleAt || sliding || elapsed < (player.downUntil || 0)) return;
      const slide = style === 'slide';
      player.nextTackleAt = elapsed + (slide ? 1.5 : style === 'hard' ? 1.1 : 0.85);
      if (slide) {
        player.motion.heading = slideAim(inputDirection(), player.motion, ball.position, ballVelocity);
        slideStartedAt = elapsed;
        action(player, 'tackleAlternate', true);
        player.mesh.rotation.y = meshYawForHeading(player.motion.heading);
        const forward = forwardFromHeading(player.motion.heading);
        const side = (ball.position.x - player.motion.x) * -forward.z + (ball.position.z - player.motion.z) * forward.x;
        player.slideState = { initial: { x: player.motion.vx, z: player.motion.vz }, foot: side <= 0 ? 0 : 1,
          feet: feetOf(player), ball: ball.position.clone(),
          targetFeet: people.map(legsOf),
          targetBodies: people.map(slideBodyOf),
          body: slideBodyOf(player), ballWon: false, bodyHits: [], contacts: [] };
        pendingKick = null; pendingShot = null; skill = null;
        if (possessor === controlled) { possessor = -1; controlLockUntil = elapsed + .15; }
        slideUntil = elapsed + SLIDE_TIMING.animation; sliding = player;
        player.slideDecided = false; player.downUntil = slideUntil + SLIDE_TIMING.missedRecovery;
        return;
      }
      action(player, 'pass', true); // the short swing of a foot poked at the ball
      if (!challenge(player, style)) { player.stumbleUntil = elapsed + 0.45; } // missed: a stumble, then on again
    }
    function recoverSlide(player) {
      player.motion.vx = 0; player.motion.vz = 0;
      const hold = player.slideDecided ? 0 : SLIDE_TIMING.groundHold;
      player.downUntil = elapsed + hold + SLIDE_TIMING.getUp;
      if (hold) {
        // Keep the grounded slide pose rather than blend into the unrelated
        // fallen-idle clip, which lifts the legs back into the air.
        player.actionName = 'fallen'; player.currentAction.paused = true;
        player.slideRecoveryUntil = elapsed + hold;
      } else { action(player, 'stand', true); player.slideStandAt = elapsed; }
      player.actionUntil = elapsed + (hold || SLIDE_TIMING.getUp);
      player.getUpAt = hold ? player.actionUntil : 0;
    }
    // Resolve the actual posed boots after the animation and movement for this
    // tick. A clean poke and a subsequent trip are separate ordered contacts.
    function resolveSlide(dt) {
      const player = sliding, data = player.slideState, feet = feetOf(player);
      const age = elapsed - slideStartedAt;
      const body = slideBodyOf(player);
      const targetFeet = people.map(legsOf);
      const targetBodies = people.map(slideBodyOf);
      if (age > 0) {
        const ballHit = !data.ballWon ? slideBallContact(data.feet, feet, data.ball, ball.position) : null;
        const hits = [];
        people.forEach((opponent, index) => {
          if (opponent.home === player.home || opponent.sentOff || data.bodyHits.includes(index)) return;
          let time = sweepContact(data.body, body, data.targetBodies[index], targetBodies[index], .5);
          let target = targetBodies[index];
          const contactTarget = (from, to, t) => ({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t });
          for (let foot = 0; foot < feet.length; foot++) {
            const t = sweepContact(data.feet[foot] || feet[foot], feet[foot], data.targetBodies[index], targetBodies[index], .32);
            if (t !== null && (time === null || t < time)) { time = t; target = contactTarget(data.targetBodies[index], targetBodies[index], t); }
          }
          for (let leg = 0; leg < targetFeet[index].length; leg++) {
            const legNow = targetFeet[index][leg], legBefore = data.targetFeet[index]?.[leg] || legNow;
            const bodyTime = sweepContact(data.body, body, legBefore, legNow, .32);
            if (bodyTime !== null && (time === null || bodyTime < time)) { time = bodyTime; target = contactTarget(legBefore, legNow, bodyTime); }
            for (let foot = 0; foot < feet.length; foot++) {
              const t = sweepContact(data.feet[foot] || feet[foot], feet[foot], legBefore, legNow, .2);
              if (t !== null && (time === null || t < time)) { time = t; target = contactTarget(legBefore, legNow, t); }
            }
          }
          if (time !== null) hits.push({ opponent, index, time, target });
        });
        hits.sort((a, b) => a.time - b.time);
        for (const first of hits) {
          const speed = slideApproachSpeed(player.motion, { ...first.opponent.motion, ...first.target });
          const verdict = slideVerdict(ballHit?.time ?? null, first.time, data.ballWon, speed);
          if (verdict.foul) {
            data.contacts.push({ type: 'foul', at: elapsed, speed, card: verdict.card });
            player.slideDecided = true; sliding = null; recoverSlide(player);
            foul(first.opponent.home, first.opponent, player, verdict.card);
            return;
          }
        }
        if (ballHit) {
          const index = people.indexOf(player);
          if (ruleTouch(index, { deliberate: true })) { sliding = null; recoverSlide(player); return; }
          const oldFoot = data.feet[ballHit.index] || feet[ballHit.index], foot = feet[ballHit.index];
          const footVelocity = { x: (foot.x - oldFoot.x) / dt, z: (foot.z - oldFoot.z) / dt };
          const contactBall = data.ball.clone().lerp(ball.position, ballHit.time);
          const deflection = slideDeflection(ballVelocity, footVelocity, ballHit.point, contactBall, player.motion.heading);
          ballVelocity.set(deflection.velocity.x, deflection.velocity.y, deflection.velocity.z); spinBall(deflection.spin);
          // Let the struck ball leave the tackler and the previous carrier's
          // approximate body capsules before normal collision resumes.
          physics?.releaseFrom(awayCarrier >= 0 ? awayCarrier : index);
          awayCarrier = possessor = passTarget = awayPassTarget = -1;
          passDestination = awayPassDestination = null; pendingKick = null; carryOwner = -1;
          lastTouchHome = player.home; controlLockUntil = Math.max(controlLockUntil, elapsed + .3);
          awayKickUntil = Math.max(awayKickUntil, elapsed + .3);
          data.ballWon = true; player.slideDecided = true; events.tackles++; count('slide boot contacts');
          data.contacts.push({ type: 'ball', at: elapsed, foot: ballHit.point, ball: contactBall.toArray(), velocity: ballVelocity.toArray() });
          sound.kick(.35); say('tackle', { who: who(index), team: hallName(player.home) });
        }
        for (const hit of hits) {
          data.bodyHits.push(hit.index);
          const dx = hit.target.x - player.motion.x, dz = hit.target.z - player.motion.z, gap = Math.hypot(dx, dz) || 1;
          const impact = Math.max(0, ((player.motion.vx - hit.opponent.motion.vx) * dx + (player.motion.vz - hit.opponent.motion.vz) * dz) / gap);
          data.contacts.push({ type: 'body', at: elapsed, index: hit.index, impact });
          if (impact > 1.5 && elapsed >= (hit.opponent.downUntil || 0)) {
            action(hit.opponent, 'fallen', true); hit.opponent.actionUntil = elapsed + 1.1;
            hit.opponent.getUpAt = hit.opponent.actionUntil; hit.opponent.downUntil = hit.opponent.actionUntil + SLIDE_TIMING.getUp;
            if (awayCarrier === hit.index) { awayCarrier = -1; controlLockUntil = Math.max(controlLockUntil, elapsed + .3); }
          } else hit.opponent.stumbleUntil = elapsed + .3;
        }
      }
      data.feet = feet; data.ball.copy(ball.position); data.targetFeet = targetFeet; data.targetBodies = targetBodies; data.body = body;
    }
    // Upright poke or shoulder challenge. Slides use the posed boot sweep.
    function challenge(player, style) {
      const hard = style === 'hard';
      const reach = player.mesh.position;
      const carrier = awayCarrier >= 0 ? people[awayCarrier] : null;
      if (carrier && shoulderToShoulder(player, carrier)) {
        // Running alongside: push, tug and barge him off the ball.
        const away = new THREE.Vector3(carrier.motion.x - player.motion.x, 0, carrier.motion.z - player.motion.z).normalize();
        carrier.motion.vx += away.x * 2.2; carrier.motion.vz += away.z * 2.2;
        if (random() < (hard ? 0.62 : 0.5) * teamAbility / difficulty.pace) {
          winBall(carrier, false); show('SHOULDER CHARGE!');
        } else { player.stumbleUntil = elapsed + 0.3; show('HELD OFF', 0.7); }
        return true;
      }
      const wins = person => hard
        ? Math.hypot(reach.x - ball.position.x, reach.z - ball.position.z) < 1.7 && reach.distanceTo(person.mesh.position) < 2.1 && ball.position.y < 0.7
        : canWinTackle(reach, person.mesh.position, ball.position);
      const opponent = people.find(person => !person.home && !person.keeper && !person.sentOff && wins(person));
      if (!opponent) return false;
      const onBall = awayCarrier === people.indexOf(opponent) || opponent.mesh.position.distanceTo(ball.position) < 1.25;
      const verdict = assessChallenge(player.motion, opponent.motion, ball.position, { style, reach });
      if (onBall && verdict.foul) { foul(false, opponent, player, verdict.card); return true; }
      if (verdict.blocked) return false;
      if (onBall) { winBall(opponent, hard && player.mesh.position.distanceTo(opponent.mesh.position) < .95); return true; }
      return false;
    }
    // Side by side with the carrier, both running the same way.
    function shoulderToShoulder(player, carrier) {
      const gap = Math.hypot(player.motion.x - carrier.motion.x, player.motion.z - carrier.motion.z);
      const forward = forwardFromHeading(carrier.motion.heading);
      const along = (player.motion.x - carrier.motion.x) * forward.x + (player.motion.z - carrier.motion.z) * forward.z;
      const sameWay = player.motion.vx * forward.x + player.motion.vz * forward.z > 2.5;
      return gap < 1.5 && gap > 0.5 && Math.abs(along) < 0.7 && sameWay;
    }
    function winBall(opponent, knockedDown) {
      if (ruleTouch(controlled, { deliberate: true })) return;
      if (knockedDown) { action(opponent, 'fallen', true); opponent.actionUntil = elapsed + 1.1; opponent.getUpAt = opponent.actionUntil; opponent.downUntil = opponent.actionUntil + SLIDE_TIMING.getUp; }
      else { opponent.actionUntil = elapsed + 0.4; }
      ballVelocity.set(3, 0.15, (random() - 0.5) * 2); spinBall();
      awayCarrier = -1; possessor = controlled; passTarget = -1; lastTouchHome = true; events.tackles++;
      if (knockedDown) show('TACKLE!');
      say('tackle', { who: who(controlled), team: hallName(true) });
    }
    function pressAction(key) {
      if (goalSequence) { if (!pausedLocal && ['j', 'k', 'l', 'i'].includes(key)) skipGoalSequence(); return; }
      if (key === 'shift') { touchSprint = true; return; }
      if (pausedLocal || pendingRestart) return;
      if (setPiece && (key === 'k' || key === 'l' || key === 'j')) {
        if (setPiece.phase === 'aim') { setPiece.phase = 'charge'; setPiece.button = key; power = 0; }
        else if (setPiece.phase === 'runup' && key === 'k' && setPiece.button === 'k' && setPiece.timing === null) setPiece.timing = elapsed - setPiece.strikeAt;
        return;
      }
      if (key === 'touchTackle') { tackle('tackle', 'standing'); return; }
      if (key === 'touchSwitch') { switchPlayer(); return; }
      if (key === 'h') { shieldHold = true; if (!lastTouchHome) tackle(); return; }
      if (key === 'f') { finesseHold = true; return; }
      if (key === 't') { teammateContain = true; return; }
      if (key === 'v') { jockeyHold = true; return; }
      if (key === 'g') { keeperRushHold = true; return; }
      // The keeper has the ball in his hands: pass throws (hold for a longer,
      // overarm throw), through ball or shoot kicks it long, lob puts it down.
      if (keeperHolding === 0 && controlled === 0) {
        if (elapsed - keeperHoldStart < 0.35) return;
        if (key === 'j') { throwHold = true; power = 0; }
        if (key === 'i' || key === 'k') keeperDistribute(0, 'kick', keeperTarget >= 0 && Math.abs(people[keeperTarget].motion.x - people[0].motion.x) > 18 ? keeperTarget : -1);
        if (key === 'l' || key === 'q') keeperPutDown(); // q: phones have no lob button
        return;
      }
      if (key === 'q') { if (lastTouchHome) { runUntil = elapsed + 2; show('TEAMMATE RUN'); } else switchPlayer(); }
      if (key === 'j') { if (awayCarrier < 0 && Math.hypot(people[controlled].motion.x - ball.position.x, people[controlled].motion.z - ball.position.z) < 1.8) { passHold = true; power = 0; } else tackle(); }
      if (key === 'i') { throughHold = true; power = 0; }
      if (key === 'k') {
        if (pendingShot) { if (pendingShot.style === 'normal') pendingShot.style = 'low'; return; } // second tap: low driven
        if (awayCarrier >= 0 || Math.hypot(people[controlled].motion.x - ball.position.x, people[controlled].motion.z - ball.position.z) > 1.8) tackle(); else { shootHold = true; power = 0; }
      }
      if (key === 'l') { lobHold = true; power = 0; } // ◯ is power-sensitive: released in releaseAction
      if (key === 'p') kick(24, 'penaltyKick', 1.5);
      if (key === 'o') beginSkill();
      if (key === 'u') tackle('tackleAlternate', 'slide');
    }
    function releaseAction(key) {
      if (goalSequence) return;
      if (key === 'shift') { touchSprint = false; return; }
      if (setPiece) {
        if (setPiece.phase === 'charge' && key === setPiece.button) {
          setPiece.phase = 'runup'; setPiece.power = power; setPiece.strikeAt = Math.max(elapsed + 0.7, setPiece.restart.readyAt); power = 0;
          if (passingAssistance !== 'assisted' && setPiece.restart.type !== 'throwIn') {
            const plan = setPiecePlan(setPiece.power); if (plan.directed) setPiece.deliveryPlan = plan;
          }
          if (key === 'j' && setPiece.restart.type !== 'throwIn') setPiece.deliveryTarget = setPiecePlan(setPiece.power).target;
          setPiece.runupFrom = { x: people[controlled].motion.x, z: people[controlled].motion.z };
          action(people[controlled], setPiece.restart.type === 'throwIn' ? 'idle' : 'jog', false);
        }
        if (key === 'k' || key === 'l' || key === 'j') return;
      }
      if (key === 'j' && throwHold) {
        throwHold = false;
        if (keeperHolding === 0 && !pausedLocal) keeperDistribute(0, power < 0.25 ? 'roll' : 'throw', keeperTarget >= 0 ? keeperTarget : keeperThrowTarget(), power);
        power = 0; return;
      }
      if (key === 'i' && throughHold) {
        throughHold = false; const charge = power; power = 0;
        if (!pausedLocal && !pendingRestart) requestKick(groundPassProfile(charge).speed, 'goalkeeperPass', 0, null, { ground: true, power: charge });
        return;
      }
      if (key === 'j' && passHold) {
        passHold = false; const charge = power; power = 0;
        if (!pausedLocal && !pendingRestart) requestKick(groundPassProfile(charge).speed, 'pass', 0, null, { ground: true, power: charge });
        return;
      }
      if (key === 'h') { shieldHold = false; return; }
      if (key === 'f') { finesseHold = false; return; }
      if (key === 't') { teammateContain = false; return; }
      if (key === 'v') { jockeyHold = false; return; }
      if (key === 'g') { keeperRushHold = false; return; }
      if (key === 'l' && lobHold) {
        lobHold = false;
        if (!pausedLocal) requestKick(18, 'chip', 3.5, null, { power, goalKick: restart?.type === 'goalKick' });
        power = 0; return;
      }
      if (key === 'k' && shootHold) {
        shootHold = false;
        if (!pausedLocal) {
          // The strike follows a moment later, so a second tap can still make it low driven.
          const style = shotStyle === 'chip' || shotStyle === 'power' ? shotStyle : shotStyle === 'finesse' || finesseHold ? 'finesse' : 'normal';
          pendingShot = { power, style, at: elapsed + 0.2 };
        }
        power = 0;
      }
    }
    function keyboardAction(key) {
      if (key === keyboard.sprint) return 'shift';
      if (key === keyboard.switch) return 'q';
      if (key === keyboard.finesse) return 'f';
      if (key === keyboard.shield) return 'h';
      if (key === keyboard.teammate) return 't';
      if (key === keyboard.jockey) return 'v';
      if (key === keyboard.skill) return 'o';
      if (!lastTouchHome && key === keyboard.keeperRush) return 'g';
      if (!lastTouchHome && key === keyboard.slide) return 'u';
      if (!lastTouchHome && key === keyboard.tackle) return 'k';
      if (key === keyboard.pass) return 'j';
      if (key === keyboard.through) return 'i';
      if (key === keyboard.shoot) return 'k';
      if (key === keyboard.lob) return 'l';
      return null;
    }
    function keydown(event) {
      const key = event.key.toLowerCase();
      if (Object.values(keyboard).includes(key) || key === 'escape' || key === ' ') event.preventDefault();
      if (!ready.started) return;
      if (goalSequence && !pausedLocal && (key === 'enter' || key === ' ')) {
        event.preventDefault(); if (!event.repeat) skipGoalSequence(); return;
      }
      if (key === 'escape' || key === ' ') { if (!event.repeat) state.togglePause(); return; }
      keys.add(key);
      if (!event.repeat) { const actionKey = keyboardAction(key); if (actionKey) { heldKeys.set(key, actionKey); pressAction(actionKey); } }
    }
    function keyup(event) {
      const key = event.key.toLowerCase(); keys.delete(key);
      const actionKey = heldKeys.get(key); heldKeys.delete(key); if (actionKey) releaseAction(actionKey);
    }
    function clearInput() {
      keys.clear(); heldKeys.clear(); touchAxis.x = 0; touchAxis.z = 0; padAxis.x = 0; padAxis.z = 0;
      touchSprint = shieldHold = passHold = throughHold = shootHold = lobHold = finesseHold = teammateContain = jockeyHold = keeperRushHold = false;
      controlledSprint = strafeHold = containHold = sprintJockey = throwHold = false;
      pendingShot = null; pendingKick = null; power = 0; shotStyle = 'normal'; padWant = {};
      if (setPiece?.phase === 'charge') { setPiece.phase = 'aim'; setPiece.button = null; }
    }
    function cancelAction(key) {
      if (setPiece?.phase === 'charge' && setPiece.button === key) { setPiece.phase = 'aim'; setPiece.button = null; power = 0; }
      if (key === 'k') { shootHold = false; pendingShot = null; if (pendingKick?.shot) pendingKick = null; power = 0; }
      else if (key === 'l') { lobHold = false; if (pendingKick?.name === 'chip') pendingKick = null; power = 0; }
      else if (key === 'i') { throughHold = false; if (pendingKick?.name === 'goalkeeperPass') pendingKick = null; power = 0; }
      else if (key === 'j') { passHold = false; throwHold = false; if (pendingKick?.name === 'pass') pendingKick = null; power = 0; }
      else releaseAction(key);
    }
    function blur() { clearInput(); }
    const unlockSpeech = () => commentary.unlock();
    const speechGestures = ['touchend', 'click', 'keydown'];
    speechGestures.forEach(type => window.addEventListener(type, unlockSpeech));
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);

    // EA FC classic controller layout: the same button attacks or defends
    // depending on which side has the ball.
    function pollGamepad() {
      const pad = activeGamepad();
      const snapshot = readGamepad(pad, preferences.gamepad);
      const nextName = snapshot ? `${snapshot.family} controller${snapshot.standard ? '' : ' · generic mapping'}` : '';
      if (nextName !== padName) { padName = nextName; setGamepadStatus(nextName); }
      padAxis.x = snapshot?.x || 0; padAxis.z = snapshot?.z || 0;
      const b = snapshot?.actions || {};
      const pressed = name => b[name] && !padActions[name];
      const released = name => !b[name] && padActions[name];
      if (pressed('pause')) state.togglePause();
      if (pausedLocal) {
        const buttons = Array.from(host.parentElement.querySelectorAll('.pause-card button'));
        if (buttons.length) {
          let selected = buttons.indexOf(document.activeElement);
          if (selected < 0) { selected = 0; buttons[0].focus(); }
          const axis = Math.abs(snapshot?.z || 0) > .5 ? snapshot.z : snapshot?.x || 0;
          const direction = Math.abs(axis) > .5 ? Math.sign(axis) : 0;
          if (direction && (direction !== menuDirection || performance.now() >= menuNextAt)) {
            selected = (selected + direction + buttons.length) % buttons.length;
            buttons[selected].focus(); menuNextAt = performance.now() + 300;
          }
          menuDirection = direction;
          if (pressed('cross')) buttons[selected].click();
          else if (pressed('circle')) { if (!periodEnded) state.setPause(false); else buttons.at(-1).focus(); }
        }
        padActions = b; padWant = {}; return;
      }
      menuDirection = 0;
      if (goalSequence) {
        if (['cross', 'circle', 'square', 'triangle'].some(pressed)) skipGoalSequence();
        padActions = b; padWant = {}; return;
      }
      const attacking = lastTouchHome;
      // Held controls: applied when they start or stop, so the keyboard keeps working too.
      const want = !snapshot ? {} : attacking ? {
        sprint: b.r1 || b.r2, controlledSprint: b.r2 && !b.r1, shield: b.l2, strafe: b.l1,
      } : {
        sprint: b.r1 || b.r2, controlledSprint: b.r2 && !b.r1, jockey: b.l2, sprintJockey: b.l2 && b.r2, contain: b.cross, teammate: b.r1, rush: b.triangle,
      };
      const apply = {
        sprint: v => { touchSprint = v; }, controlledSprint: v => { controlledSprint = v; }, shield: v => { shieldHold = v; },
        strafe: v => { strafeHold = v; }, jockey: v => { jockeyHold = v; }, sprintJockey: v => { sprintJockey = v; },
        contain: v => { containHold = v; }, teammate: v => { teammateContain = v; }, rush: v => { keeperRushHold = v; },
      };
      for (const key of Object.keys(apply)) if (Boolean(want[key]) !== Boolean(padWant[key])) apply[key](Boolean(want[key]));
      padWant = want;
      if (snapshot && !pausedLocal) {
        if (b.l3 && b.r3 && (pressed('l3') || pressed('r3'))) {
          playerLock = !playerLock; show(playerLock ? 'PLAYER LOCK ON' : 'PLAYER LOCK OFF', 1);
        } else if (attacking) {
          if (pressed('cross')) pressAction('j');
          if (released('cross')) releaseAction('j');
          if (pressed('triangle')) pressAction('i');
          if (released('triangle')) releaseAction('i');
          if (pressed('circle')) pressAction('l');
          if (released('circle')) releaseAction('l');
          if (pressed('square')) {
            shotStyle = b.l1 && b.r1 ? 'power' : b.l1 ? 'chip' : b.r2 ? 'finesse' : 'normal';
            if (shotStyle === 'finesse') finesseHold = true;
            pressAction('k');
          }
          if (released('square')) { releaseAction('k'); if (shotStyle === 'finesse') finesseHold = false; shotStyle = 'normal'; }
        } else {
          if (pressed('square')) tackle('tackle', b.r1 ? 'hard' : 'standing');
          if (pressed('circle')) tackle('tackleAlternate', 'slide');
          if (pressed('l1')) switchPlayer();
          if (pressed('r3') && !b.l3) toggleKeeperControl();
        }
      }
      // At a set piece the right stick draws spin (see spinStyle).
      if (setPiece && setPiece.phase !== 'aim' && snapshot) {
        const zone = stickZone(snapshot.rightX, snapshot.rightZ);
        if (zone && setPiece.gesture[setPiece.gesture.length - 1] !== zone) setPiece.gesture.push(zone);
      }
      // Right stick: a skill move when attacking, a flick to switch player when defending.
      const rightActive = Boolean(snapshot && !setPiece && Math.hypot(snapshot.rightX, snapshot.rightZ) > 0.72);
      if (rightActive && !padRightActive && !pausedLocal) {
        if (attacking) pressAction('o');
        else switchPlayer({ x: snapshot.rightX, z: snapshot.rightZ });
      }
      padRightActive = rightActive;
      padActions = b;
    }
    // R3 while defending: take the goalkeeper yourself, and press again to hand back.
    function toggleKeeperControl() {
      if (manualKeeper || controlled === 0) {
        manualKeeper = false;
        const next = nearestOf(true, ball.position.x, ball.position.z);
        if (next >= 0) { controlled = next; setSelectedPlayer(next + 1); }
        show('KEEPER CONTROL OFF', 0.8);
      } else if (keeperHolding < 0) {
        manualKeeper = true; controlled = 0; setSelectedPlayer(1); show('KEEPER CONTROL', 0.8);
      }
    }

    // kickoffHome: which side takes the kickoff (the side that conceded, and
    // the side that did not start the first half for the second).
    let kickoffHome = true, nextKickoffHome = true, kickoffTakeAt = 0;
    function reset(home = nextKickoffHome) {
      goalSequence = replayPose = null; setGoalMoment(null); goalRecorder.clear(); goalCooldown = 0;
      lastShooter = -1; lastShotAt = -10;
      receivingForecast = receivingGuidance = null;
      setPieceCam = null;
      offside.clear(); lastRuleTouch = -1; lastRuleDeliberate = false; restartTouch = null;
      carryOwner = -1; ballControl = createBallControl(elapsed); pendingKick = null;
      kickoffHome = home; nextKickoffHome = true; slideUntil = 0; sliding = null; skill = null; pendingRestart = null; passHold = throughHold = false; pendingShot = null; setPiece = null;
      people.forEach(person => {
        person.downUntil = 0; person.getUpAt = 0; person.slideState = null; person.slideRecoveryUntil = 0; person.slideStandAt = 0;
        if (import.meta.env.DEV) person.fixtureFreezeUntil = 0;
        person.mesh.visible = !person.sentOff;
        if (person.sentOff) return;
        if (person.currentAction) person.currentAction.paused = false;
        person.mesh.position.set(person.spawn[0], 0, person.spawn[1]);
        Object.assign(person.motion, { x: person.spawn[0], z: person.spawn[1], vx: 0, vz: 0,
          heading: person.home ? 0 : Math.PI });
        person.mesh.rotation.y = meshYawForHeading(person.motion.heading);
        person.nextTackleAt = 0; person.nextSaveAt = 0; person.saveUntil = 0; person.actionUntil = 0; person.mesh.rotation.x = 0;
        idle(person);
      });
      ball.position.set(0, BALL_RADIUS, 0); ballVelocity.set(0, 0, 0);
      controlled = kickoffOrder.find(i => !people[i].sentOff) ?? 0; awayCarrier = -1; awayKickUntil = 0; controlLockUntil = 0; keeperHolding = -1;
      // The kicking-off forward stands at the centre spot, behind the ball.
      const takerIndex = kickoffOrder.map(i => home ? i : i + TEAM_SIZE).find(i => !people[i].sentOff), taker = people[takerIndex];
      Object.assign(taker.motion, { x: home ? -0.8 : 0.8, z: 0 });
      taker.mesh.position.set(taker.motion.x, 0, 0);
      possessor = home ? takerIndex : -1; awayCarrier = home ? -1 : takerIndex; kickoffTakeAt = elapsed + 1.4;
      ball.position.set(home ? -0.25 : 0.25, BALL_RADIUS, 0); setSelectedPlayer(controlled + 1); resetAt = 0; passTarget = -1;
      kickoffGraceUntil = elapsed + (home ? difficulty.kickoffGrace : 0); cutCamera = true;
      restart = null; awayPassTarget = -1; throwHold = false; targetRing.visible = false; setKeeperBall(false);
      kickoffWaiting = true;
      people.forEach(person => { person.nextDecisionAt = 0; person.dribbleDir = null; });
      physics?.reset(ball.position, ballVelocity, undefined, people.map(person => person.mesh.position));
      sound.whistle('short');
    }
    function goal(homeScored) {
      setScore(previous => homeScored ? [previous[0] + 1, previous[1]] : [previous[0], previous[1] + 1]);
      show('GOAL!', CELEBRATION_SECONDS); goalCooldown = 2.5; resetAt = Infinity; sound.goal(); feel('goal', 0.08); count(homeScored ? 'goals home' : 'goals away');
      nextKickoffHome = !homeScored; // the side that conceded kicks off
      goals[homeScored ? 0 : 1]++;
      const scorer = lastShooter >= 0 && people[lastShooter].home === homeScored ? who(lastShooter) : '';
      say('goal', { team: hallName(homeScored), who: scorer, goalMoment: goalContext(goals, homeScored), score: scoreLine(hallName(true), hallName(false), goals) });
      const eligible = people.filter(p => p.home === homeScored && !p.sentOff && !p.keeper);
      const scorerIndex = lastShooter >= 0 && elapsed - lastShotAt < 8 && people[lastShooter].home === homeScored ? lastShooter
        : lastRuleTouch >= 0 && people[lastRuleTouch].home === homeScored ? lastRuleTouch
        : eligible.sort((a, b) => a.mesh.position.distanceToSquared(ball.position) - b.mesh.position.distanceToSquared(ball.position))[0]?.index;
      const hero = people[scorerIndex ?? (homeScored ? 5 : 12)];
      const anchor = { x: clamp(hero.motion.x, -LENGTH / 2 + 2, LENGTH / 2 - 2), z: clamp(hero.motion.z, -WIDTH / 2 + 2, WIDTH / 2 - 2) };
      const teammates = eligible.filter(p => p !== hero).sort((a, b) => a.mesh.position.distanceToSquared(hero.mesh.position) - b.mesh.position.distanceToSquared(hero.mesh.position)).slice(0, 5).map(p => p.index);
      goalRecorder.push(elapsed, captureGoalFrame());
      goalSequence = { phase: 'celebration', age: 0, at: elapsed, home: homeScored, scorer: hero.index, anchor, teammates,
        frames: goalRecorder.clip(), angle: 0, playTime: 0, clockRemainder: elapsed - lastHUD };
      clearInput(); possessor = awayCarrier = passTarget = awayPassTarget = -1; receivingGuidance = null;
      people.forEach(person => { person.motion.vx = person.motion.vz = 0; if (!person.sentOff && elapsed >= (person.downUntil || 0)) idle(person); });
      action(hero, 'celebration', false);
      setGoalMoment({ phase: 'celebration', scorer: who(hero.index) || `PLAYER #${hero.index + 1}`, team: hallName(homeScored), angle: 0 });
    }
    function captureGoalFrame() {
      return { ball: ball.position.toArray(), rotation: ball.quaternion.toArray(), players: people.map(p => ({
        x: p.mesh.position.x, z: p.mesh.position.z, heading: p.motion.heading, action: p.actionName,
        time: p.currentAction?.time || 0, visible: !p.sentOff })) };
    }
    function beginGoalReplay() {
      if (!goalSequence) return;
      goalSequence.phase = 'replay'; goalSequence.angle = 0; goalSequence.playTime = 0;
      people.forEach(person => { person.mixer?.stopAllAction(); person.actionName = ''; });
      setMessage(''); cameraShake = null; clearInput(); cutCamera = true;
      setGoalMoment(previous => ({ ...previous, phase: 'replay', angle: 0 }));
      applyGoalReplay();
    }
    function finishGoalSequence() {
      clearInput(); lastHUD = elapsed - (goalSequence?.clockRemainder || 0); reset(nextKickoffHome); setMessage('KICK OFF');
    }
    function skipGoalSequence() {
      if (!goalSequence) return;
      if (goalSequence.phase === 'celebration') beginGoalReplay(); else finishGoalSequence();
      renderPending = true;
    }
    function applyGoalReplay() {
      const sequence = goalSequence;
      replayPose = sampleGoalReplay(sequence.frames, sequence.playTime);
      if (!replayPose) return;
      ball.position.fromArray(replayPose.ball); ball.quaternion.fromArray(replayPose.rotation);
      replayPose.players.forEach((pose, index) => {
        const person = people[index];
        person.mesh.visible = pose.visible; person.mesh.position.set(pose.x, 0, pose.z); person.mesh.rotation.y = meshYawForHeading(pose.heading);
        if (person.actionName !== pose.action) person.currentAction?.stop();
        action(person, pose.action, false);
        if (person.currentAction) {
          person.currentAction.stopFading().setEffectiveWeight(1);
          person.currentAction.paused = true; person.currentAction.time = pose.time; person.mixer.update(0);
        }
      });
    }
    function updateGoalSequence(dt) {
      const sequence = goalSequence;
      sequence.age += dt;
      if (sequence.phase === 'replay') {
        sequence.playTime += dt * 0.9;
        const duration = Math.max(0.5, sequence.frames.at(-1).t - sequence.frames[0].t);
        if (sequence.playTime > duration + 0.45) {
          sequence.angle++; sequence.playTime = 0; cutCamera = true;
          if (sequence.angle >= GOAL_ANGLES) { finishGoalSequence(); return; }
          setGoalMoment(previous => ({ ...previous, angle: sequence.angle }));
        }
        applyGoalReplay(); return;
      }
      elapsed += dt; lastHUD = elapsed;
      const hero = people[sequence.scorer];
      sequence.teammates.forEach((index, slot) => {
        const person = people[index];
        if (elapsed < (person.downUntil || 0)) return;
        const angle = slot / sequence.teammates.length * Math.PI * 2;
        const tx = sequence.anchor.x + Math.cos(angle) * 1.5, tz = sequence.anchor.z + Math.sin(angle) * 1.5;
        const delta = { x: tx - person.motion.x, z: tz - person.motion.z }, gap = Math.hypot(delta.x, delta.z);
        if (gap > 0.3) {
          const speed = advancePlayer(person.motion, receivingInput(delta, 8.1), dt, { sprint: true }); moveAction(person, speed);
        } else { person.motion.vx = person.motion.vz = 0; action(person, 'celebration', false); }
        person.mesh.position.set(person.motion.x, 0, person.motion.z); person.mesh.rotation.y = meshYawForHeading(person.motion.heading);
      });
      action(hero, 'celebration', false);
      if (physics) {
        const before = ballVelocity.clone();
        const next = physics.step(dt, ball.position, ballVelocity, people.map(p => p.mesh.position), -1);
        ball.position.set(next.position.x, next.position.y, next.position.z); ballVelocity.set(next.velocity.x, next.velocity.y, next.velocity.z);
        ball.quaternion.set(next.rotation.x, next.rotation.y, next.rotation.z, next.rotation.w); checkGoalContact(before);
      }
      if (sequence.age <= 0.7 && goalRecorder.wants(elapsed)) {
        goalRecorder.push(elapsed, captureGoalFrame()); sequence.frames = goalRecorder.clip();
      }
      if (sequence.age >= CELEBRATION_SECONDS) beginGoalReplay();
    }
    function queueBoundaryRestart(type, home, spot, exit) {
      pendingRestart = { type, home, spot, at: elapsed + .85 };
      ball.position.set(exit.point.x, exit.point.y, exit.point.z);
      ballVelocity.set(0, 0, 0); clearInput();
      people.forEach(person => { person.motion.vx = 0; person.motion.vz = 0; if (elapsed >= (person.downUntil || 0)) idle(person); });
      show(type === 'goalKick' ? 'BALL OUT · GOAL KICK' : type === 'corner' ? 'BALL OUT · CORNER' : 'BALL OUT · THROW IN', 1.4);
    }
    function boundary(from) {
      if (keeperHolding >= 0 || resetAt || restart || pendingRestart) return;
      const exit = pitchExit(from, ball.position, { length: LENGTH, width: WIDTH }, BALL_RADIUS);
      if (!exit) return;
      possessor = -1; awayCarrier = -1; passTarget = -1; awayPassTarget = -1;
      if (exit.line === 'touchline') {
        const z = exit.side * (WIDTH / 2 - 0.2);
        queueBoundaryRestart('throwIn', !lastTouchHome, { x: clamp(exit.point.x, -LENGTH / 2, LENGTH / 2), z }, exit);
        return;
      }
      const side = exit.side;
      if (goalCrossing(from, exit, { length: LENGTH, width: GOAL_WIDTH, height: GOAL_HEIGHT }, BALL_RADIUS) && goalCooldown <= 0) {
        if (restartTouch && (restartTouch.type === 'indirectFreeKick' || restartTouch.type === 'throwIn' || restartTouch.home !== (side > 0))) {
          const ownGoal = restartTouch.home !== (side > 0);
          queueBoundaryRestart(ownGoal ? 'corner' : 'goalKick', ownGoal ? !restartTouch.home : side < 0,
            ownGoal ? { x: side * (LENGTH / 2 - 0.4), z: (Math.sign(exit.point.z) || 1) * (WIDTH / 2 - 0.4) }
              : { x: side * (LENGTH / 2 - sixDepth), z: sixHalfWidth * 0.6 }, exit);
        } else goal(side > 0);
        return;
      }
      // Over the goal line: a corner if the defending side touched it last,
      // otherwise a goal kick to them.
      const defendingHome = side < 0, cornerSide = Math.sign(exit.point.z) || 1;
      if (lastTouchHome === defendingHome) queueBoundaryRestart('corner', !defendingHome, { x: side * (LENGTH / 2 - 0.4), z: cornerSide * (WIDTH / 2 - 0.4) }, exit);
      else queueBoundaryRestart('goalKick', defendingHome, { x: side * (LENGTH / 2 - sixDepth), z: cornerSide * sixHalfWidth * 0.6 }, exit);
    }
    // manual: the player is moving this keeper (R3); he still dives and saves.
    // A cross met at head height in the opponents' box is headed at goal,
    // down toward a corner. Nobody is placed perfectly, so some go wide.
    // ---- Goal frame and net: ripples, shudders and the feel of them ----
    let cameraShake = null, lastFrameHitAt = -1, lastNetHitAt = -1;
    function feel(effect, shakeStrength) {
      if (preferences.hud.vibration !== false) vibrate(effect, activeGamepad());
      cameraShake = { at: elapsed, strength: shakeStrength };
    }
    // The ball has hit the net: it bulges where the ball struck, then ripples out.
    function netHit(goalSide, point, speed) {
      const goal = goalsBySide[goalSide];
      goal.ripple = { at: elapsed, point: point.clone(), strength: clamp(speed * 0.028, 0.08, 0.5) };
      if (speed > 6) feel('net', 0.04);
    }
    // The ball has struck a post or the bar: the frame shudders.
    function frameHit(goalSide, bar, speed) {
      const goal = goalsBySide[goalSide];
      goal.shake = { at: elapsed, strength: clamp(speed * 0.0025, 0.015, 0.06), bar };
      goal.ripple = { at: elapsed, point: ball.position.clone(), strength: 0.06 };
      sound.post(Math.min(1, speed / 25));
      show(bar ? 'OFF THE BAR!' : 'OFF THE POST!', 1.2); count('woodwork');
      say('woodwork', { team: hallName(lastTouchHome) });
      feel('post', 0.18);
    }
    // Contact with the woodwork or the net shows up as a sudden change of the
    // ball's velocity next to it.
    function checkGoalContact(before) {
      const change = Math.hypot(ballVelocity.x - before.x, ballVelocity.y - before.y, ballVelocity.z - before.z);
      if (change < 2.5) return;
      const goalSide = Math.sign(ball.position.x) || 1, front = goalSide * LENGTH / 2;
      const near = BALL_RADIUS + GOAL.postRadius + 0.14;
      const offLine = Math.abs(ball.position.x - front);
      const post = offLine < near && ball.position.y < GOAL_HEIGHT + 0.1 && Math.abs(Math.abs(ball.position.z) - GOAL_WIDTH / 2) < near;
      const bar = !post && offLine < near && Math.abs(ball.position.y - GOAL_HEIGHT) < near && Math.abs(ball.position.z) < GOAL_WIDTH / 2 + 0.1;
      if ((post || bar) && elapsed - lastFrameHitAt > 0.3) { lastFrameHitAt = elapsed; frameHit(goalSide, bar, Math.hypot(before.x, before.y, before.z)); return; }
      const inNet = Math.abs(ball.position.x) > LENGTH / 2 + 0.1 && Math.abs(ball.position.z) < GOAL_WIDTH / 2 + 0.2 && ball.position.y < GOAL_HEIGHT + 0.2;
      if (inNet && elapsed - lastNetHitAt > 0.35) { lastNetHitAt = elapsed; netHit(goalSide, ball.position, Math.hypot(before.x, before.y, before.z)); }
    }
    // Animate any shuddering frame or rippling net (a few hundred points, only while moving).
    function updateGoalEffects() {
      for (const goal of Object.values(goalsBySide)) {
        if (goal.shake) {
          const t = elapsed - goal.shake.at, fade = Math.exp(-t / 0.22);
          const wobble = goal.shake.strength * fade * Math.sin(t * 70);
          if (goal.shake.bar) goal.frame.position.set(0, wobble * 0.6, 0); else goal.frame.position.set(0, 0, wobble);
          if (t > 1) { goal.shake = null; goal.frame.position.set(0, 0, 0); }
        }
        if (!goal.ripple) continue;
        const t = elapsed - goal.ripple.at, positions = goal.net.geometry.attributes.position;
        const array = positions.array, base = goal.base, depth = GOAL.depth;
        const swing = goal.ripple.strength * Math.exp(-t / 0.45) * Math.cos(t * 13);
        const { point } = goal.ripple;
        for (let i = 0; i < array.length; i += 3) {
          const x = base[i], y = base[i + 1], z = base[i + 2];
          const backness = Math.min(1, Math.abs(x - goal.front) / depth); // the frame edge stays put
          const reach = (y - point.y) ** 2 + (z - point.z) ** 2;
          const pull = backness * Math.exp(-reach / 1.1) * swing;
          array[i] = x + goal.side * pull; array[i + 1] = y - Math.abs(pull) * 0.25;
        }
        positions.needsUpdate = true;
        if (t > 2) { array.set(base); positions.needsUpdate = true; goal.ripple = null; }
      }
    }
    function attackingHeader() {
      if (ball.position.y < 1.05 || ball.position.y > 2.4 || ballVelocity.length() < 5 || keeperHolding >= 0) return;
      const header = people.find(person => !person.keeper && !person.sentOff && elapsed >= (person.downUntil || 0) && elapsed >= (person.nextHeaderAt || 0)
        && Math.hypot(person.motion.x - ball.position.x, person.motion.z - ball.position.z) < 0.85
        && insideBox(person.motion.x, person.motion.z, !person.home));
      if (!header) return;
      const index = people.indexOf(header), goalX = header.home ? LENGTH / 2 : -LENGTH / 2;
      if (ruleTouch(index, { deliberate: true, kick: true })) return;
      header.nextHeaderAt = elapsed + 1;
      const z = (random() < 0.5 ? -1 : 1) * (GOAL_WIDTH / 2 - 0.7) + gaussian(random) * 1.1;
      launchTo({ x: goalX, z }, 0.35 + random() * 1.5, (13 + random() * 4) * (header.home ? teamAbility : difficulty.shot), 'pass');
      action(header, 'headerBall', true); sound.kick(0.4);
      possessor = -1; awayCarrier = -1; passTarget = -1; awayPassTarget = -1; lastTouchHome = header.home;
      controlLockUntil = elapsed + 0.25; awayKickUntil = elapsed + 0.3;
      people[header.home ? TEAM_SIZE : 0].reactAt = elapsed + 0.18 + random() * 0.1;
      lastShooter = index; lastShotAt = elapsed; count('headers');
      if (!header.home) events.awayShots++;
      show('HEADER!', 0.9); say('shot', { who: who(index), team: hallName(header.home) });
    }
    // At a penalty the keeper must go before he can read the kick: a guess
    // for the computer, your stick for you (no lean: stay in the middle).
    function keeperGuess(index, lean = null) {
      const keeper = people[index];
      const side = lean === null ? (random() < 0.2 ? 0 : random() < 0.5 ? -1 : 1) : lean;
      keeper.reactAt = elapsed + 1.5; // committed: no reading the shot
      if (!side) return;
      keeper.diveDirection = side; keeper.diveFromZ = keeper.motion.z; keeper.saveHeading = keeper.motion.heading;
      action(keeper, 'goalkeeperDive', true); keeper.saveUntil = elapsed + 1.1; count('dives');
    }
    function updateKeeper(person, index, dt, manual = false) {
      const out = person.home ? 1 : -1; // from this keeper's goal line into the pitch
      const goalX = ownGoalX(person.home);
      const ability = (person.home ? teamAbility : difficulty.keeper) * handlingFactor(person.attrs);
      if (keeperHolding === index) {
        // Ball in hands: face upfield, then throw or kick it to the best option.
        person.motion.vx = 0; person.motion.vz = 0;
        person.motion.heading = out > 0 ? 0 : Math.PI;
        person.mesh.rotation.y = meshYawForHeading(person.motion.heading);
        if (elapsed >= keeperReleaseAt) {
          const target = keeperThrowTarget(index);
          const distance = Math.hypot(people[target].motion.x - person.motion.x, people[target].motion.z - person.motion.z);
          keeperDistribute(index, distance < 20 ? 'roll' : distance < 32 ? 'throw' : 'kick', target);
        }
        return;
      }
      const recovering = elapsed < person.saveUntil;
      const diving = person.actionName === 'goalkeeperDive' && elapsed < person.actionUntil;
      const shot = keeperHolding < 0 && !restart ? shotOnGoal(ball.position, ballVelocity, goalX, GOAL_WIDTH, GOAL_HEIGHT) : null;
      // Rush out when an attacker is through on goal with no defender to beat.
      const attackerIndex = person.home ? awayCarrier : possessor;
      const attacker = attackerIndex >= 0 ? people[attackerIndex] : null;
      const oneOnOne = Boolean(attacker) && Math.hypot(attacker.motion.x - goalX, attacker.motion.z) < 14
        && !people.some(p => p.home === person.home && !p.keeper && Math.abs(p.motion.x - goalX) < Math.abs(attacker.motion.x - goalX) - 1
          && Math.abs(p.motion.z - attacker.motion.z) < 4);
      const spot = restart?.type === 'penalty' && restart.home !== person.home ? { x: goalX + out * 0.25, z: 0 }
        : keeperPosition(ball.position, goalX, GOAL_WIDTH, { oneOnOne: oneOnOne || (keeperRushHold && person.home) });
      // Until he has read the strike, the keeper stays set.
      const reading = shot && elapsed < (person.reactAt || 0);
      if (!recovering && !reading) {
        const targetZ = shot ? clamp(shot.z, -GOAL_WIDTH / 2 + 0.2, GOAL_WIDTH / 2 - 0.2) : spot.z;
        const targetX = shot ? person.motion.x : spot.x;
        if (!manual) advancePlayer(person.motion, { x: targetX - person.motion.x, z: targetZ - person.motion.z }, dt,
          { keeper: true, sprint: oneOnOne || Boolean(shot), ability });
        // Always make the attempt: dive for anything wide, jump for anything
        // high, get the body behind anything struck straight at him.
        if (shot && !diving && Math.abs(ballVelocity.x) > 1) {
          const timeToKeeper = (person.motion.x - ball.position.x) / ballVelocity.x;
          const gapNow = Math.abs(shot.z - person.motion.z);
          if (timeToKeeper > 0 && timeToKeeper < 0.42) {
            if (gapNow > 0.45) {
              person.diveDirection = Math.sign(shot.z - person.motion.z); person.diveFromZ = person.motion.z;
              person.saveHeading = person.motion.heading;
              action(person, 'goalkeeperDive', true); person.saveUntil = elapsed + 1.1; count('dives');
            } else if (timeToKeeper < 0.25 && (shot.y > 1.6 || shot.speed > 14)) {
              action(person, 'goalkeeperBlock', true); person.saveUntil = elapsed + 0.6;
            }
          }
        }
      }
      // The dive animation has no travel of its own; move the keeper across.
      if (person.actionName === 'goalkeeperDive' && elapsed < person.actionUntil) {
        // A dive carries the body about a metre and a half; the arms do the rest (keeperReach).
        const from = person.diveFromZ ?? person.motion.z;
        person.motion.z = clamp(person.motion.z + person.diveDirection * 6.5 * dt, from - 1.5, from + 1.5);
        person.motion.z = clamp(person.motion.z, -GOAL_WIDTH / 2 - 0.8, GOAL_WIDTH / 2 + 0.8);
      }
      person.mesh.position.set(person.motion.x, 0, person.motion.z);
      const toBallX = ball.position.x - person.motion.x;
      person.motion.heading = recovering && person.actionName === 'goalkeeperDive' ? person.saveHeading
        : Math.abs(toBallX) > 0.1 ? Math.atan2(ball.position.z - person.motion.z, toBallX) : person.home ? 0 : Math.PI;
      person.mesh.rotation.y = meshYawForHeading(person.motion.heading);
      if (person.visual) {
        const naturalDirection = -Math.sign(Math.sin(person.mesh.rotation.y)) * diveLocalSign;
        const mirror = person.actionName === 'goalkeeperDive' && elapsed < person.actionUntil
          && person.diveDirection && person.diveDirection !== naturalDirection ? -1 : 1;
        person.visual.scale.x = Math.abs(person.visual.scale.x) * mirror;
      }
      if (!recovering) moveAction(person, Math.hypot(person.motion.vx, person.motion.vz));
      if (keeperHolding >= 0 || restart) return;

      // Does the ball reach the keeper this step, or is it loose at his feet?
      const vx = ballVelocity.x, toPlane = person.motion.x - ball.position.x;
      const reaching = Math.abs(vx) > 0.5 && Math.sign(toPlane) === Math.sign(vx) && Math.abs(toPlane) <= Math.abs(vx) * dt * 1.5 + 0.35;
      const bodyGap = Math.hypot(ball.position.x - person.motion.x, ball.position.z - person.motion.z);
      const looseBall = bodyGap < 0.9 && ball.position.y < 1.7 && ballVelocity.length() < 5 && possessor < 0 && awayCarrier < 0;
      // One-on-one: smother the ball at the attacker's feet.
      const smother = attacker && oneOnOne && bodyGap < 1.3 && ball.position.y < 0.5 && random() < 0.012 * ability; // about a 50% chance per second close in
      if (elapsed < (person.nextSaveAt || 0) || (!reaching && !looseBall && !smother)) return;
      const t = reaching ? clamp(toPlane / vx, 0, dt * 1.5) : 0;
      const zAt = ball.position.z + ballVelocity.z * t, yAt = ball.position.y + ballVelocity.y * t;
      let result = looseBall || smother ? 'catch' : saveOutcome({ gap: Math.abs(zAt - person.motion.z), height: yAt,
        speed: ballVelocity.length(), diving, ability, random });
      if (result === 'miss') { person.nextSaveAt = elapsed + 0.4; count('save attempts missed'); return; }
      if (ruleTouch(index, { save: true })) return;
      // Keepers may only handle inside their own box; outside it they block.
      if (result === 'catch' && !insideBox(person.motion.x, person.motion.z, person.home)) result = 'parry';
      person.nextSaveAt = elapsed + 0.7;
      possessor = -1; awayCarrier = -1; passTarget = -1; awayPassTarget = -1; lastTouchHome = person.home;
      controlLockUntil = elapsed + 0.5;
      if (result === 'catch') {
        keeperHolding = index; catchFrom = ball.position.clone(); catchStart = elapsed;
        ballVelocity.set(0, 0, 0); spinBall(); person.saveUntil = elapsed + 0.6;
        if (!diving) action(person, 'goalkeeperCatch', true);
        events.catches++; show(smother ? 'SMOTHERED!' : 'KEEPER CATCH'); sound.kick(0.15);
        say(smother ? 'smother' : 'catch', { team: hallName(person.home) });
        if (person.home) {
          // You take the keeper: aim, then throw, kick long or put it down.
          controlled = index; setSelectedPlayer(index + 1); keeperHoldStart = elapsed; setKeeperBall(true);
        } else keeperReleaseAt = elapsed + 1.5 + random() * 1.2;
      } else {
        // Parries go wide of the goal, punches go high and away, spills drop
        // in front of the keeper for a rebound.
        const side = Math.sign(zAt - person.motion.z || ball.position.z || 1);
        if (result === 'punch') ballVelocity.set(out * 11, 6, side * 4);
        // Half of parries are turned behind for a corner, the rest pushed wide.
        else if (result === 'parry') ballVelocity.set(out * (random() < 0.5 ? -(1 + random() * 2) : 2 + random() * 3), 1.5 + random() * 2, side * (6 + random() * 4));
        else ballVelocity.set(out * (1.5 + random() * 1.5), 1, side * random() * 2);
        spinBall();
        if (result === 'punch') { action(person, 'goalkeeperBlock', true); events.punches++; }
        else { if (!diving) action(person, 'goalkeeperBlock', true); events.parries++; }
        person.saveUntil = Math.max(person.saveUntil, elapsed + 0.65); awayKickUntil = elapsed + 0.35;
        show(result === 'punch' ? 'KEEPER PUNCH' : result === 'spill' ? 'SPILLED!' : 'GREAT SAVE'); sound.kick(0.5);
        say(result === 'punch' ? 'punch' : result === 'spill' ? 'spill' : 'save', { team: hallName(person.home) });
      }
    }
    function updateReceivingGuidance() {
      receivingGuidance = null;
      if (restart || pendingRestart || resetAt || keeperHolding >= 0 || possessor >= 0 || awayCarrier >= 0
        || !lastTouchHome || passTarget < 0 || elapsed > passDeadline) { receivingForecast = null; return; }
      const receiver = people[passTarget];
      if (receiver.sentOff || receiver === sliding || elapsed < (receiver.downUntil || 0)) return;
      if (!receivingForecast || receivingForecast.receiver !== passTarget || elapsed - receivingForecast.at >= 0.1) {
        receivingForecast = { receiver: passTarget, at: elapsed,
          path: receivingPath({ x: ball.position.x, y: ball.position.y, z: ball.position.z },
            { x: ballVelocity.x, y: ballVelocity.y, z: ballVelocity.z }, physics?.spin(), venue.surface) };
      }
      const pace = (touchSprint ? controlledSprint ? RUN_PACE.controlled : RUN_PACE.sprint : RUN_PACE.jog) * teamAbility * (1 - STAMINA.speedLoss * (1 - receiver.stamina));
      let point = receivingPoint(receiver.motion, receivingForecast.path, pace, { length: LENGTH, width: WIDTH }, elapsed - receivingForecast.at);
      // Let the recipient run into the general landing area, then give the
      // user control before contact rather than changing control at the trap.
      const gap = Math.hypot(ball.position.x - receiver.motion.x, ball.position.z - receiver.motion.z);
      const approaching = (ball.position.x - receiver.motion.x) * ballVelocity.x + (ball.position.z - receiver.motion.z) * ballVelocity.z < 0;
      const close = gap < 3.5 && ball.position.y < 1.5 && (approaching || gap < 0.9);
      if (close) point = { x: ball.position.x + ballVelocity.x * 0.12, z: ball.position.z + ballVelocity.z * 0.12, t: 0.12 };
      if (!point) return;
      const correction = Math.hypot(point.x - receiver.motion.x, point.z - receiver.motion.z);
      const ready = close || (point.t <= 1.1 && correction < pace * RECEIVING_ASSIST * point.t + 0.8);
      if (controlled !== passTarget && !playerLock && !(controlled === 0 && manualKeeper)
        && elapsed >= controlLockUntil - 0.12 && ready && gap < 9) {
        controlled = passTarget; setSelectedPlayer(controlled + 1);
      }
      if (controlled === passTarget && !skill
        && elapsed >= (receiver.stumbleUntil || 0)) receivingGuidance = { target: point, pace, amount: RECEIVING_ASSIST };
    }
    function simulate(dt) {
      if (!pausedLocal) {
        if (goalSequence) { updateGoalSequence(dt); return; }
        boundaryFrom.copy(ball.position);
        elapsed += dt; goalCooldown = Math.max(0, goalCooldown - dt);
        if (pendingRestart) {
          if (elapsed >= pendingRestart.at) {
            const queued = pendingRestart; pendingRestart = null;
            startRestart(queued.type, queued.home, queued.spot);
          }
          return;
        }
        if (messageUntil && elapsed > messageUntil) { setMessage(''); messageUntil = 0; }
        if (passHold || throughHold || shootHold || throwHold || lobHold || setPiece?.phase === 'charge') power = Math.min(1, power + dt / 1.2);
        if (pendingShot && elapsed >= pendingShot.at) {
          const { power: strength, style } = pendingShot; pendingShot = null;
          if (style === 'chip') requestKick(0, 'chipShot', 0, { power: strength, style });
          else requestKick(0, style === 'power' ? 'powerShot' : 'kick', 0, { power: strength, style });
        }
        if (pendingKick) {
          const queued = pendingKick;
          if (elapsed > queued.until || controlled !== queued.owner || keeperHolding >= 0 || awayCarrier >= 0 || resetAt || pendingRestart || (restart && !restart.home)) pendingKick = null;
          else if (kick(queued.speed, queued.name, queued.lift, queued.shot, queued.loft)) pendingKick = null;
        }
        if (resetAt && elapsed >= resetAt) reset(nextKickoffHome);
        if (resetAt && physics) {
          // After a goal the ball carries on into the net and drops there.
          const before = ballVelocity.clone();
          const next = physics.step(dt, ball.position, ballVelocity, people.map(person => person.mesh.position), -1);
          ball.position.set(next.position.x, next.position.y, next.position.z);
          ballVelocity.set(next.velocity.x, next.velocity.y, next.velocity.z);
          ball.quaternion.set(next.rotation.x, next.rotation.y, next.rotation.z, next.rotation.w);
          checkGoalContact(before);
        }
        if (!resetAt) {
          updateReceivingGuidance();
          const active = people[controlled];
          const holding = keeperHolding === 0 && controlled === 0;
          const takingRestart = restart?.home && controlled === restart.taker;
          const direction = inputDirection();
          const strength = Math.min(1, direction.length());
          const movement = strength > 0.06 ? direction : new THREE.Vector3();
          const carrierOpponent = awayCarrier >= 0 ? people[awayCarrier] : null;
          if (containHold && carrierOpponent) {
            // ✕ held: shadow the carrier from the goal side, a stride off him.
            const goalX = ownGoalX(true), cx = carrierOpponent.motion.x, cz = carrierOpponent.motion.z;
            const size = Math.hypot(goalX - cx, cz) || 1;
            const tx = cx + (goalX - cx) / size * 1.6 - active.motion.x, tz = cz - cz / size * 1.6 - active.motion.z;
            const gap = Math.hypot(tx, tz);
            movement.set(gap > 0.3 ? tx / gap : 0, 0, gap > 0.3 ? tz / gap : 0);
          }
          if (shieldHold || jockeyHold) movement.multiplyScalar(shieldHold ? 0.75 : sprintJockey ? 0.9 : 0.68);
          const strafing = strafeHold && possessor === controlled;
          if (strafing) movement.multiplyScalar(0.62);
          if (sliding === active) movement.set(0, 0, 0); // mid slide tackle
          if (elapsed < (active.stumbleUntil || 0)) movement.multiplyScalar(0.35);
          if (sliding) {
            const slider = sliding;
            if (slider.sentOff || restart || pendingRestart || keeperHolding >= 0) { sliding = null; if (!slider.sentOff) recoverSlide(slider); }
            else if (elapsed >= slideUntil) {
              // A poke does not put a sliding player straight back on his feet.
              sliding = null; recoverSlide(slider);
            }
          }
          if (elapsed < (active.downUntil || 0)) movement.set(0, 0, 0);
          for (const person of people) if (person.getUpAt && elapsed >= person.getUpAt) {
            person.getUpAt = 0; action(person, 'stand', true);
            if (person.slideRecoveryUntil) { person.slideRecoveryUntil = 0; person.slideStandAt = elapsed; }
          }
          let activeSpeed = 0;
          if (takingRestart && (restart.type === 'corner' || restart.type === 'freeKick' || restart.type === 'indirectFreeKick' || restart.type === 'penalty' || restart.type === 'goalKick' || restart.type === 'throwIn')) {
            if (!setPiece) beginSetPiece();
            const r = setPiece.reticle, spot = restart.spot;
            const aimPoint = setPiece.button === 'j' ? setPiecePlan(setPiece.phase === 'runup' ? setPiece.power : power).target : r;
            const ahead = new THREE.Vector3(aimPoint.x - spot.x, 0, aimPoint.z - spot.z).normalize();
            if (setPiece.phase !== 'runup') {
              // Left stick: up and down are away from and toward the camera, which sits behind the ball.
              const sideways = direction.x, upward = -direction.z;
              if (setPiece.mode === 'shot') {
                r.z = clamp(r.z + sideways * Math.sign(ahead.x || 1) * 3 * dt, -GOAL_WIDTH / 2 - 1.5, GOAL_WIDTH / 2 + 1.5);
                r.y = clamp(r.y + upward * 1.8 * dt, 0.25, GOAL_HEIGHT + 0.8);
              } else {
                r.x = clamp(r.x + (-ahead.z * sideways + ahead.x * upward) * 11 * dt, -LENGTH / 2 + 1, LENGTH / 2 - 0.5);
                r.z = clamp(r.z + (ahead.x * sideways + ahead.z * upward) * 11 * dt, -WIDTH / 2 + 1, WIDTH / 2 - 1);
                if (restart.type === 'throwIn') {
                  const target = throwInPlan(spot, r, power, { length: LENGTH, width: WIDTH }).target;
                  r.set(target.x, 0, target.z);
                }
              }
              active.motion.vx = 0; active.motion.vz = 0;
            } else {
              // The run-up: from a few strides back onto the ball.
              const left = clamp((setPiece.strikeAt - elapsed) / 0.7, 0, 1);
              const from = setPiece.runupFrom, end = restart.type === 'throwIn' ? from : { x: spot.x - ahead.x * 0.55, z: spot.z - ahead.z * 0.55 };
              const detour = ((from.x - spot.x) * ahead.x + (from.z - spot.z) * ahead.z > 0) ? Math.sin((1 - left) * Math.PI) * 0.7 : 0;
              active.motion.x = THREE.MathUtils.lerp(from.x, end.x, 1 - left) - ahead.z * detour;
              active.motion.z = THREE.MathUtils.lerp(from.z, end.z, 1 - left) + ahead.x * detour;
              activeSpeed = left < 1 ? Math.hypot(end.x - from.x, end.z - from.z) / 0.7 : 0;
              active.motion.vx = left < 1 ? (end.x - from.x) / 0.7 : 0; active.motion.vz = left < 1 ? (end.z - from.z) / 0.7 : 0;
              if (elapsed >= setPiece.strikeAt) strikeSetPiece();
            }
            active.motion.heading = Math.atan2(ahead.z, ahead.x);
          } else if (restart?.type === 'penalty' && !restart.home && controlled === 0) {
            // Facing a penalty: on the line; lean the stick left or right to
            // pick your dive (as seen from behind the taker), or leave it to stay central.
            Object.assign(active.motion, { x: ownGoalX(true) + 0.25, z: 0, vx: 0, vz: 0, heading: 0 });
            const across = Math.sign(ownGoalX(true) - restart.spot.x) || -1; // screen right, in pitch z
            penaltyDive = direction.x > 0.4 ? across : direction.x < -0.4 ? -across : 0;
          } else if (takingRestart) {
            // The taker stays behind the ball; the stick only aims.
            active.motion.vx = 0; active.motion.vz = 0;
            if (strength > 0.06) active.motion.heading = Math.atan2(direction.z, direction.x);
          } else if (holding) {
            // Ball in hands: walk anywhere inside the box.
            advancePlayer(active.motion, { x: movement.x * 0.55, z: movement.z * 0.55 }, dt, { keeper: true });
            const goalX = ownGoalX(true);
            active.motion.x = clamp(active.motion.x, goalX + 0.5, goalX + boxDepth - 0.8);
            active.motion.z = clamp(active.motion.z, -boxHalfWidth + 0.8, boxHalfWidth - 0.8);
            if (strength > 0.06) active.motion.heading = Math.atan2(direction.z, direction.x);
            activeSpeed = Math.hypot(active.motion.vx, active.motion.vz);
          } else if (sliding === active) {
            // Root translation is removed from the animation: supply the
            // matching ground lunge here instead of braking a zero-input run.
            const velocity = slideVelocity(active.slideState.initial, active.motion.heading, elapsed - slideStartedAt, SLIDE_TIMING.animation);
            active.motion.vx = velocity.x; active.motion.vz = velocity.z;
            activeSpeed = Math.hypot(velocity.x, velocity.z);
            active.motion.x += active.motion.vx * dt; active.motion.z += active.motion.vz * dt;
          } else {
            const manual = { x: movement.x * (skill ? .35 : 1), z: movement.z * (skill ? .35 : 1) };
            const guided = receivingGuidance ? assistedReceivingInput(manual, active.motion, receivingGuidance.target, receivingGuidance.pace) : manual;
            activeSpeed = run(active, guided, dt,
              { sprint: touchSprint && !strafing && !skill, keeper: controlled === 0 && manualKeeper, dribbling: possessor === controlled,
                controlledSprint, ability: teamAbility });
            // Strafe dribble keeps facing the goal; jockeying keeps facing the carrier.
            if (strafing) active.motion.heading = 0;
            else if (jockeyHold && carrierOpponent) active.motion.heading = Math.atan2(carrierOpponent.motion.z - active.motion.z, carrierOpponent.motion.x - active.motion.x);
          }
          if (skill) {
            if (possessor !== skill.owner || controlled !== skill.owner || elapsed >= skill.at + skill.duration) skill = null;
            else active.motion.heading = skill.heading + skillTurn((elapsed - skill.at) / skill.duration);
          }
          if (!takingRestart) { // a corner taker stands outside the lines; a keeper may stand on his line
            // Let an outfielder reach a ball on the line instead of stopping
            // two metres short. The ball's crossing decides when play stops.
            const lineGap = active.keeper ? 0.2 : -0.4;
            active.motion.x = clamp(active.motion.x, -LENGTH / 2 + lineGap, LENGTH / 2 - lineGap);
            active.motion.z = clamp(active.motion.z, -WIDTH / 2 + lineGap, WIDTH / 2 - lineGap);
          }
          // Keep your distance at the opponents' set pieces.
          if (restart && !restart.home && !active.keeper) keepDistance(active.motion, restart);
          active.mesh.position.set(active.motion.x, 0, active.motion.z);
          active.mesh.rotation.y = meshYawForHeading(active.motion.heading);
          const ballGap = Math.hypot(active.mesh.position.x - ball.position.x, active.mesh.position.z - ball.position.z);
          if (!restart && keeperHolding < 0 && awayCarrier < 0 && elapsed >= (active.downUntil || 0) && elapsed >= controlLockUntil && ballGap < 1.05 && ball.position.y < 0.52 && ballVelocity.length() < 8 && passTarget < 0 && !ruleTouch(controlled, { deliberate: true })) {
            possessor = controlled; awayCarrier = -1; lastTouchHome = true;
          }
          if (possessor === controlled && !restart && (ballGap > 2.1 || ball.position.y > 0.85)) possessor = -1;
          if (!holding) moveAction(active, activeSpeed);
          ring.position.set(active.mesh.position.x, 0.02, active.mesh.position.z);
          marker.position.set(active.mesh.position.x, 2.55, active.mesh.position.z);

          // The keeper's throw target, shown live while he holds the ball.
          if (holding) {
            keeperTarget = keeperThrowTarget();
            const target = people[keeperTarget];
            const marked = target && team(false).some(o => Math.hypot(o.x - target.motion.x, o.z - target.motion.z) < 3.5);
            targetRing.visible = Boolean(target); if (target) targetRing.position.set(target.motion.x, 0.03, target.motion.z);
            targetRing.material.color.set(marked ? 0xff7a1a : 0xffc20e);
            if (elapsed - keeperHoldStart > 6) { show('6 SECONDS', 1); say('sixSeconds'); keeperDistribute(0, 'throw', keeperTarget, 0.3); }
          }
          // After the keeper releases the ball, hand control to an outfielder.
          if (manualKeeper && (lastTouchHome || keeperHolding >= 0)) manualKeeper = false;
          if (controlled === 0 && !manualKeeper && keeperHolding !== 0 && possessor !== 0 && !takingRestart && elapsed > controlLockUntil + 0.2) {
            const next = passTarget >= 0 ? passTarget : nearestOf(true, ball.position.x, ball.position.z);
            if (next >= 0) { controlled = next; setSelectedPlayer(next + 1); }
          }
          if (restart?.home && elapsed > restart.autoAt) {
            if (setPiece?.restart.type === 'throwIn') { setPiece.power = 0.5; setPiece.button = 'j'; strikeSetPiece(); }
            else { setPiece = null; show('QUICK RESTART', 0.8); kick(14, 'pass'); }
          }
          if (setPiece && setPiece.restart !== restart) setPiece = null;
          if (restart && !restart.home && elapsed >= restart.readyAt) cpuTakeRestart();

          // Build-up commentary in quiet spells, and a call when a carrier reaches the box.
          const carrierNow = possessor >= 0 ? possessor : awayCarrier;
          if (carrierNow >= 0 && !restart) {
            const carrierHome = people[carrierNow].home;
            const inBox = insideBox(people[carrierNow].motion.x, people[carrierNow].motion.z, !carrierHome);
            if (inBox && lastBoxCarrier !== carrierNow) { lastBoxCarrier = carrierNow; say('inBox', { who: who(carrierNow), team: hallName(carrierHome) }); }
            else if (!inBox) { if (lastBoxCarrier === carrierNow) lastBoxCarrier = -1; }
            if (elapsed > nextBuildAt) say('build', { who: who(carrierNow), team: hallName(carrierHome) });
          }
          if (kickoffWaiting && !kickoffHome && awayCarrier >= 0 && elapsed >= kickoffTakeAt) {
            const back = team(false).filter(m => m.index !== awayCarrier && !people[m.index].keeper && m.x > 2)
              .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
            if (back) cpuPlay(awayCarrier, 'pass', back.index);
          }
          if (kickoffWaiting && (ballVelocity.length() > 1.5 || Math.hypot(ball.position.x, ball.position.z) > 1.5)) kickoffWaiting = false;
          // Who presses, who marks, who chases a loose ball.
          const loose = possessor < 0 && awayCarrier < 0 && keeperHolding < 0 && !restart;
          const nearestLooseHome = loose ? nearestOf(true, ball.position.x, ball.position.z, controlled) : -1;
          const nearestAway = nearestOf(false, ball.position.x, ball.position.z);
          const pressingAway = team(false).sort((a, b) => Math.hypot(a.x - ball.position.x, a.z - ball.position.z) - Math.hypot(b.x - ball.position.x, b.z - ball.position.z))
            .slice(0, difficulty.pressers ?? 2).map(p => p.index);
          const defending = !lastTouchHome || awayCarrier >= 0;
          // One teammate closes down the carrier when you are not already on him.
          const carrierAway = awayCarrier >= 0 ? people[awayCarrier] : null;
          const helper = carrierAway && Math.hypot(active.motion.x - carrierAway.motion.x, active.motion.z - carrierAway.motion.z) > 4
            ? nearestOf(true, carrierAway.motion.x, carrierAway.motion.z, controlled) : -1;
          if (defending && elapsed >= markingAt) {
            markingAt = elapsed + 0.5;
            marking = markingAssignments(team(true).filter(p => p.index !== controlled && p.index !== helper),
              team(false).filter(p => p.index !== awayCarrier), ownGoalX(true));
          }
          // The CPU defends too: while your side has the ball, every CPU player who is not
          // closing the ball down takes a nearby attacker goal-side, instead of drifting about.
          const cpuDefending = lastTouchHome && awayCarrier < 0 && !restart && keeperHolding < 0;
          if (cpuDefending && elapsed >= markingCpuAt) {
            markingCpuAt = elapsed + 0.5;
            const pressing = new Set(pressingAway);
            const threats = team(true).filter(a => a.index !== possessor
              && (Math.abs(a.x - ownGoalX(false)) < LENGTH * 0.62 || Math.hypot(a.x - ball.position.x, a.z - ball.position.z) < 24));
            markingCpu = markingAssignments(team(false).filter(p => !pressing.has(p.index)), threats, ownGoalX(false));
          } else if (!cpuDefending) markingCpu.clear();
          const shortReceiver = restart && restart.type !== 'penalty'
            && !(restart.type === 'corner' && restart.home && setPiece?.button !== 'j')
            ? nearestOf(restart.home, restart.spot.x, restart.spot.z, restart.taker) : -1;
          const positioningPlayers = rulePlayers();
          const supportLines = [false, true].map(home => offsidePositions({ index: -1, home }, ball.position, positioningPlayers).line);
          for (const [index, person] of people.entries()) {
            if (person.sentOff) { person.motion.x = 0; person.motion.z = WIDTH / 2 + 30; person.mesh.position.set(0, 0, WIDTH / 2 + 30); continue; }
            // Down after a missed slide tackle: out of the game for a moment.
            if (index !== controlled && elapsed < (person.downUntil || 0)) { person.motion.vx = 0; person.motion.vz = 0; continue; }
            if (index === controlled) {
              if (person.keeper && manualKeeper && keeperHolding < 0) updateKeeper(person, index, dt, true);
              continue;
            }
            if (import.meta.env.DEV && elapsed < (person.fixtureFreezeUntil || 0)) { person.motion.vx = 0; person.motion.vz = 0; continue; }
            if (person.actionName === 'fallen' && elapsed >= person.actionUntil) action(person, 'stand', true);
            if (person.keeper) { updateKeeper(person, index, dt); continue; }
            if ((person.actionName === 'fallen' || person.actionName === 'stand') && person.actionUntil > elapsed) continue;
            if ((restart && index === restart.taker) || kickoffWaiting) {
              // Set-piece takers wait behind the ball; at kickoff everyone waits.
              person.motion.vx = 0; person.motion.vz = 0; faceBall(person, dt);
              person.mesh.rotation.y = meshYawForHeading(person.motion.heading); moveAction(person, 0); continue;
            }
            const roleZ = person.spawn[1];
            const settled = keeperHolding < 0 && !restart;
            const pressRank = pressingAway.indexOf(index);
            const press = settled && !person.home && lastTouchHome && awayCarrier < 0 && pressRank >= 0
              && person.mesh.position.distanceTo(ball.position) < difficulty.pressDistance;
            const chase = settled && (person.home
              ? (passTarget === index || index === nearestLooseHome || (teammateContain && defending && index === helper))
              : press || (loose && index === nearestAway && person.mesh.position.distanceTo(ball.position) < 22) || awayPassTarget === index);
            const attacking = person.home ? lastTouchHome : !lastTouchHome;
            const automaticRun = attacking && ((person.role >= (TEAM_SIZE === 7 ? 5 : 7)) || (person.role >= (TEAM_SIZE === 7 ? 3 : 4) && Math.sign(roleZ) !== Math.sign(ball.position.z)));
            const support = supportPosition(person.spawn, ball.position, { length: LENGTH, width: WIDTH },
              { home: person.home, attacking, run: automaticRun || (person.home && elapsed < runUntil), lane: Math.sign(roleZ), role: person.role, forwardRole: TEAM_SIZE === 7 ? 5 : 7,
                offsideLine: supportLines[Number(person.home)] });
            const carryingAway = awayCarrier === index;
            const destination = person.home ? passDestination : awayPassDestination;
            const receiving = (person.home ? passTarget === index : awayPassTarget === index) && destination;
            // Meet a slowing ground pass instead of waiting at an exact spot.
            // Stay in the receiving lane while a cross is still high overhead.
            const intercept = receiving && person.home && receivingForecast?.receiver === index
              ? receivingPoint(person.motion, receivingForecast.path, 8.1 * teamAbility, { length: LENGTH, width: WIDTH }, elapsed - receivingForecast.at) : null;
            const meetPass = receiving && ball.position.y < 0.85 && ball.position.distanceTo(destination) < 6;
            let targetX, targetZ;
            if (restart?.type === 'goalKick') {
              const shape = goalKickPosition(person.role, { length: LENGTH, width: WIDTH }, restart.home, person.home === restart.home, TEAM_SIZE - 1);
              targetX = shape.x; targetZ = shape.z;
            } else if (receiving) { targetX = intercept ? intercept.x : meetPass ? ball.position.x + ballVelocity.x * 0.12 : destination.x; targetZ = intercept ? intercept.z : meetPass ? ball.position.z + ballVelocity.z * 0.12 : destination.z; }
            else if (restart && index === shortReceiver) {
              const sign = restart.home ? 1 : -1;
              targetX = restart.spot.x + sign * (restart.type === 'corner' ? -5 : 7);
              targetZ = restart.spot.z + (restart.type === 'goalKick' ? (restart.spot.z > 0 ? -6 : 6) : -Math.sign(restart.spot.z) * 5);
            } else if (carryingAway) {
              const dir = person.dribbleDir || { x: -1, z: 0 };
              targetX = person.motion.x + dir.x * 5; targetZ = person.motion.z + dir.z * 5;
            } else if (press && possessor >= 0) {
              const approach = defensiveApproach(person.motion, active.motion, ball.position,
                { goalX: ownGoalX(false), primary: pressRank === 0 });
              targetX = approach.x; targetZ = approach.z;
            } else if (person.home && index === helper && settled) {
              const approach = defensiveApproach(person.motion, carrierAway.motion, ball.position,
                { goalX: ownGoalX(true) });
              targetX = approach.x; targetZ = approach.z;
            } else if (chase) { targetX = ball.position.x + ballVelocity.x * 0.16; targetZ = ball.position.z + ballVelocity.z * 0.16; }
            else if (person.home && defending && marking.has(index)) { const mark = marking.get(index); targetX = mark.x; targetZ = mark.z; }
            else if (!person.home && cpuDefending && markingCpu.has(index)) { const mark = markingCpu.get(index); targetX = mark.x; targetZ = mark.z; }
            else if (restart?.type === 'corner' && restart.home === person.home && person.role >= 3) {
              // Attack the corner: runners spread across the box.
              const goalX = -ownGoalX(person.home);
              targetX = goalX - Math.sign(goalX) * (4 + (person.role % 3) * 3); targetZ = (person.role % 3 - 1) * 3.5;
            } else { targetX = support.x; targetZ = support.z; }
            const wallSpot = restart?.wall?.find(spot => spot.index === index);
            if (wallSpot) { targetX = wallSpot.x; targetZ = wallSpot.z; }
            // Give the keeper and set-piece takers room.
            const target = { x: targetX, z: targetZ };
            if (keeperHolding >= 0 && people[keeperHolding].home !== person.home) keepOutOfBox(target, people[keeperHolding].home);
            if (restart && restart.home !== person.home) keepDistance(target, restart);
            if (restart?.type === 'penalty' && restart.home === person.home) keepOutOfBox(target, !restart.home);
            const delta = new THREE.Vector3(target.x - person.mesh.position.x, 0, target.z - person.mesh.position.z);
            // Keep lanes open instead of piling every runner on the ball.
            for (const other of people) {
              if (other === person || other.keeper) continue;
              const dx = person.motion.x - other.motion.x, dz = person.motion.z - other.motion.z;
              const gap = Math.hypot(dx, dz);
              if (gap > 0.01 && gap < 1.4) { delta.x += dx / gap * (1.4 - gap) * 2; delta.z += dz / gap * (1.4 - gap) * 2; }
            }
            // Start moving only when properly out of position and stop once
            // there, so players do not flick between standing and jogging.
            const distance = delta.length(), closingCarrier = press || (settled && index === helper);
            if (!person.moving && distance > (closingCarrier ? .25 : 1.4)) person.moving = true;
            else if (person.moving && distance < (closingCarrier ? .12 : .5)) person.moving = false;
            const receivingPace = (person.stamina > STAMINA.minimumToSprint ? 8.1 : 5.8)
              * (person.home ? teamAbility : difficulty.pace) * (1 - STAMINA.speedLoss * (1 - person.stamina));
            const moveInput = receiving || closingCarrier ? receivingInput(delta, receivingPace)
              : person.moving ? { x: delta.x, z: delta.z } : { x: 0, z: 0 };
            const speed = run(person, moveInput, dt,
              { sprint: chase || automaticRun || index === helper || restart?.type === 'corner' || (person.home && elapsed < runUntil), dribbling: carryingAway, ability: person.home ? teamAbility : difficulty.pace });
            person.mesh.position.set(person.motion.x, 0, person.motion.z);
            if (speed < 0.3) faceBall(person, dt);
            person.mesh.rotation.y = meshYawForHeading(person.motion.heading);
            moveAction(person, speed);
            // CPU standing pokes: approach the exposed ball, otherwise jockey.
            if (settled && press && possessor === controlled && elapsed >= person.nextTackleAt && elapsed >= kickoffGraceUntil
              && person.mesh.position.distanceTo(ball.position) < 1.5 && ball.position.y < 0.65) {
              // Simple CPU pokes must reach the ball without going through
              // the carrier. If shielded, jockey instead of rolling a foul.
              if (assessChallenge(person.motion, active.motion, ball.position).blocked) { person.nextTackleAt = elapsed + 0.25; continue; }
              if (!canWinTackle(person.mesh.position, active.mesh.position, ball.position, shieldHold)) continue;
              person.nextTackleAt = elapsed + difficulty.tackleCooldown;
              action(person, 'pass', true); // upright foot poke, not the sliding clip
              count('cpu standing tackles');
              if (canWinTackle(person.mesh.position, active.mesh.position, ball.position, shieldHold)) {
                // Geometry decides whether a tackle can be made; the players' attributes decide whether it works.
                const winChance = tackleChance({ tackler: person.attrs, carrier: active.attrs, shielding: shieldHold });
                if (random() < winChance) {
                  if (!ruleTouch(index, { deliberate: true })) {
                    possessor = -1; awayCarrier = index; passTarget = -1; lastTouchHome = false;
                    controlLockUntil = elapsed + 0.8; awayKickUntil = elapsed + 0.4;
                    person.motion.heading = Math.PI; events.tackles++;
                    // The ball runs on away from the challenge, not along a fixed line.
                    ballVelocity.set(-3.4 + (random() - 0.5) * 0.8, 0, clamp((ball.position.z - person.motion.z) * 1.2, -1.5, 1.5) + (random() - 0.5) * 1.2);
                    spinBall(); show('TACKLED!');
                    say('tackle', { who: who(index), team: hallName(false) });
                  }
                } else {
                  // A beaten tackler stumbles, and a poor challenge can pop the ball loose.
                  person.stumbleUntil = elapsed + 0.3;
                  if (random() < 0.3) { possessor = -1; ballVelocity.x += (random() - 0.5) * 4; ballVelocity.z += (random() - 0.5) * 4; }
                }
              }
            }
            // Your teammates tackle too, and take control of the ball when they win it.
            if (settled && person.home && index === helper && carryingAwayTarget(person) && elapsed >= person.nextTackleAt) {
              const carrier = people[awayCarrier];
              if (assessChallenge(person.motion, carrier.motion, ball.position).blocked) { person.nextTackleAt = elapsed + 0.25; continue; }
              if (!canWinTackle(person.mesh.position, carrier.mesh.position, ball.position)) continue;
              person.nextTackleAt = elapsed + 1.6;
              action(person, 'pass', true);
              count('teammate standing tackles');
              if (canWinTackle(person.mesh.position, carrier.mesh.position, ball.position)
                && random() < tackleChance({ tackler: person.attrs, carrier: carrier.attrs }) && !ruleTouch(index, { deliberate: true })) {
                awayCarrier = -1; controlled = index; possessor = index; lastTouchHome = true; events.tackles++;
                setSelectedPlayer(index + 1); spinBall(); show('TACKLE!');
                say('tackle', { who: who(index), team: hallName(true) });
              }
            }
            if (settled && awayCarrier < 0 && elapsed >= controlLockUntil && person.home && canReceivePass(person.motion, ball.position, ballVelocity) && (passTarget === index || possessor < 0) && !ruleTouch(index, { deliberate: true })) {
              controlled = index; possessor = index; awayCarrier = -1; passTarget = -1;
              ballVelocity.multiplyScalar(0.16); lastTouchHome = true;
              setSelectedPlayer(index + 1); action(person, 'receive', true); show('PASS RECEIVED');
            }
            const awayReceiving = awayPassTarget === index;
            if (settled && !person.home && possessor < 0 && awayCarrier < 0 && elapsed > awayKickUntil
              && (awayReceiving ? canReceivePass(person.motion, ball.position, ballVelocity)
                : person.mesh.position.distanceTo(ball.position) < 1.15 && ball.position.y < 0.5 && ballVelocity.length() < 7)
              && elapsed > person.actionUntil
              && !(shieldHold && people[controlled].mesh.position.distanceTo(ball.position) < 1.25) && !ruleTouch(index, { deliberate: true })) {
              awayCarrier = index; lastTouchHome = false; possessor = -1; passTarget = -1; awayPassTarget = -1;
              if (awayReceiving) { ballVelocity.multiplyScalar(0.2); action(person, 'receive', true); }
              person.nextDecisionAt = elapsed + difficulty.reaction * 0.6;
            }
            if (awayCarrier === index) {
              const gap = Math.hypot(person.mesh.position.x - ball.position.x, person.mesh.position.z - ball.position.z);
              if (gap > 2 || ball.position.y > 0.8) awayCarrier = -1;
              else if (elapsed > awayKickUntil && elapsed >= (person.nextDecisionAt || 0)) {
                person.nextDecisionAt = elapsed + difficulty.reaction * (0.8 + random() * 0.4);
                const choice = decideCarrier({ carrier: point(index), teammates: team(false).filter(m => m.index !== index && m.x >= supportLines[0] - 0.01),
                  opponents: team(true, true), keeper: people[0].motion, goal: { x: -LENGTH / 2, width: GOAL_WIDTH },
                  field: { length: LENGTH, width: WIDTH }, skill: { range: difficulty.shotRange, accuracy: difficulty.accuracy / finishingAccuracy(person.attrs) }, random });
                if (choice.type === 'dribble') person.dribbleDir = choice.dir;
                else cpuPlay(index, choice.type, choice.type === 'shoot' ? choice.target : choice.index);
              }
            }
          }
          if (!restart && keeperHolding < 0) {
            const phase = offside.snapshot(), defendingKeeper = phase ? people[phase.home ? TEAM_SIZE : 0] : null;
            const shot = defendingKeeper && shotOnGoal(ball.position, ballVelocity, ownGoalX(!phase.home), GOAL_WIDTH, GOAL_HEIGHT);
            const interfering = offsideInterference(phase, ball.position, rulePlayers(), { shot: Boolean(shot) });
            if (interfering !== null) ruleTouch(interfering);
          }
          if (!restart && ball.position.y > 1.25) {
            const header = people.find(person => !person.keeper && !person.sentOff && keeperHolding < 0 && elapsed >= (person.downUntil || 0) && person.mesh.position.distanceTo(ball.position) < 1.3 && elapsed >= person.actionUntil);
            if (header) action(header, ballVelocity.length() > 3 ? 'headerBall' : 'header', true);
            attackingHeader();
          }
          const dribbler = possessor >= 0 ? possessor : awayCarrier;
          if (!restart && keeperHolding < 0 && dribbler >= 0) {
            if (dribbler !== carryOwner) ballControl = createBallControl(elapsed);
            const carrier = people[dribbler];
            const touch = footTouch(ballControl, ball.position, ballVelocity, carrier.motion, feetOf(carrier), elapsed,
              { sprint: dribbler === controlled ? touchSprint && carrier.stamina > STAMINA.minimumToSprint : Math.hypot(carrier.motion.vx, carrier.motion.vz) > 5.5, controlledSprint: dribbler === controlled && controlledSprint,
                looseness: looseTouchChance(carrier.attrs), random });
            if (touch) {
              ballVelocity.set(touch.velocity.x, touch.velocity.y, touch.velocity.z);
              if (touch.spin) physics?.setSpin(touch.spin);
              if (touch.contact) count('dribbleTouches');
            }
          }
          if (physics) {
            const before = ballVelocity.clone();
            const carrierBeforeContact = possessor >= 0 ? possessor : awayCarrier;
            const next = physics.step(dt, ball.position, ballVelocity, people.map(person => person.mesh.position), keeperHolding >= 0 ? keeperHolding : carrierBeforeContact, sliding ? people.indexOf(sliding) : -1);
            ball.position.set(next.position.x, next.position.y, next.position.z);
            ballVelocity.set(next.velocity.x, next.velocity.y, next.velocity.z);
            ball.quaternion.set(next.rotation.x, next.rotation.y, next.rotation.z, next.rotation.w);
            if (next.lastTouch >= 0 && keeperHolding < 0) ruleTouch(next.lastTouch);
            // An opponent's physical touch breaks the dribble. Otherwise the
            // carry code below erases the collision and pulls the ball back.
            if (!restart && keeperHolding < 0 && carrierBeforeContact >= 0 && next.lastTouch >= 0
              && people[next.lastTouch].home !== people[carrierBeforeContact].home) {
              possessor = awayCarrier = passTarget = awayPassTarget = -1;
              passDestination = awayPassDestination = null;
              controlLockUntil = Math.max(controlLockUntil, elapsed + 0.12);
              awayKickUntil = Math.max(awayKickUntil, elapsed + 0.12);
              count('dribbleDeflections');
            }
            if (!restart && next.lastTouch >= 0 && possessor < 0 && awayCarrier < 0 && keeperHolding < 0)
              lastTouchHome = people[next.lastTouch].home;
            checkGoalContact(before);
          } else {
            ball.position.addScaledVector(ballVelocity, dt);
            ballVelocity.y -= 9.81 * dt;
            if (ball.position.y < BALL_RADIUS) { ball.position.y = BALL_RADIUS; ballVelocity.y = Math.max(0, -ballVelocity.y * 0.33); }
            const friction = Math.exp(-0.75 * dt); ballVelocity.x *= friction; ballVelocity.z *= friction;
            ball.rotation.z -= ballVelocity.x * dt / BALL_RADIUS;
          }
          if (restart) {
            // The ball waits on its spot until the set piece is taken.
            ball.position.set(restart.spot.x, BALL_RADIUS, restart.spot.z); ballVelocity.set(0, 0, 0);
          } else if (keeperHolding >= 0) {
            // Draw the ball smoothly into the keeper's hands.
            const keeper = people[keeperHolding];
            const forward = forwardFromHeading(keeper.motion.heading);
            const hands = new THREE.Vector3(keeper.motion.x + forward.x * 0.45, 1.05, keeper.motion.z + forward.z * 0.45);
            const blend = catchFrom ? clamp((elapsed - catchStart) / 0.18, 0, 1) : 1;
            if (blend < 1) ball.position.lerpVectors(catchFrom, hands, blend); else ball.position.copy(hands);
            ballVelocity.set(0, 0, 0);
          }
          carryOwner = !restart && keeperHolding < 0 ? (possessor >= 0 ? possessor : awayCarrier) : -1;
          if (passTarget >= 0 && keeperHolding < 0) {
            if (elapsed > passDeadline || !lastTouchHome) passTarget = -1;
            else if (!restart && awayCarrier < 0 && elapsed >= controlLockUntil
              && !people[passTarget].sentOff && elapsed >= (people[passTarget].downUntil || 0) && canReceivePass(people[passTarget].motion, ball.position, ballVelocity) && !ruleTouch(passTarget, { deliberate: true })) {
              controlled = passTarget;
              possessor = controlled;
              setSelectedPlayer(controlled + 1);
              action(people[controlled], 'receive', true);
              ballVelocity.multiplyScalar(0.22);
              passTarget = -1;
              show('PASS RECEIVED');
            }
          }
          if (awayPassTarget >= 0 && (elapsed > awayPassDeadline || lastTouchHome)) awayPassTarget = -1;
          boundary(boundaryFrom);
          if (defending && !holding && !playerLock && !sliding && controlled !== 0 && elapsed - lastAutoSwitch > 0.5) {
            let best = controlled, distance = people[controlled].mesh.position.distanceToSquared(ball.position);
            people.forEach((person, index) => {
              if (!person.home || person.keeper || person.sentOff || elapsed < (person.downUntil || 0)) return;
              const next = person.mesh.position.distanceToSquared(ball.position);
              if (next < distance * 0.65) { best = index; distance = next; }
            });
            if (best !== controlled) { controlled = best; setSelectedPlayer(best + 1); lastAutoSwitch = elapsed; }
          }
        }
        if (!goalSequence && goalRecorder.wants(elapsed)) goalRecorder.push(elapsed, captureGoalFrame());
        if (!goalSequence && elapsed - lastHUD >= 1) { lastHUD = elapsed; setSeconds(previous => Math.max(0, previous - 1)); }
      }
    }
    // A player standing still turns to watch the ball.
    function faceBall(person, dt) {
      const wanted = Math.atan2(ball.position.z - person.motion.z, ball.position.x - person.motion.x);
      const turn = Math.atan2(Math.sin(wanted - person.motion.heading), Math.cos(wanted - person.motion.heading));
      person.motion.heading += clamp(turn, -4 * dt, 4 * dt);
    }
    // Opponents of a keeper holding the ball wait outside his box.
    function keepOutOfBox(target, keeperHome) {
      if (!insideBox(target.x, target.z, keeperHome)) return;
      target.x = ownGoalX(keeperHome) + (keeperHome ? 1 : -1) * (boxDepth + 1.5);
    }
    // At a set piece the defending side stands 7 m from the ball, or outside
    // the box for a goal kick.
    function keepDistance(target, piece) {
      if (piece.type === 'goalKick') { keepOutOfBox(target, piece.home); return; }
      if (piece.type === 'penalty') { keepOutOfBox(target, !piece.home); return; }
      const dx = target.x - piece.spot.x, dz = target.z - piece.spot.z, gap = Math.hypot(dx, dz);
      if (gap >= 7) return;
      const scale = 7.2 / (gap || 1);
      target.x = piece.spot.x + (gap ? dx : -(piece.home ? 1 : -1)) * scale;
      target.z = piece.spot.z + (gap ? dz : 0) * scale;
    }
    const carryingAwayTarget = person => awayCarrier >= 0 && person.mesh.position.distanceTo(ball.position) < 1.4 && ball.position.y < 0.65;
    // Development-only deterministic scenarios for exercising the actual match
    // loop. Vite removes this branch from the published production bundle.
    if (import.meta.env.DEV) {
      window.__footballDebug = {
        pollGamepad,
        setCameraMode: mode => {
          if (!['Co-op', 'Wide', 'Behind player'].includes(mode)) throw new Error('Unknown camera mode');
          viewMode = mode; resize(); cutCamera = true;
        },
        camera: () => {
          cam.updateMatrixWorld();
          const project = point => point.clone().project(cam).toArray();
          const player = people[controlled].mesh.position;
          return { zoom: cam.zoom, fov: cam.fov, device: config.device, mode: viewMode, renderedFrames: renderer.info.render.frame,
            pixelRatio: renderer.getPixelRatio(), shadowSize: sun.shadow.mapSize.x, qualityTime: renderTime,
            position: cam.position.toArray(), foot: project(player), head: project(player.clone().setY(1.8)), ball: project(ball.position),
            focus: cameraFocus.toArray(), quaternion: cam.quaternion.toArray(),
            restartView: setPieceCam?.piece.type || null,
            target: setPiece ? project(setPiece.reticle) : null,
            goalPosts: [-1, 1].map(side => [-1, 1].map(z => project(new THREE.Vector3(side * LENGTH / 2, 0, z * GOAL_WIDTH / 2)))),
            takerFoot: restart ? project(people[restart.taker].mesh.position) : null,
            takerHead: restart ? project(people[restart.taker].mesh.position.clone().setY(1.8)) : null };
        },
        goalEffects: () => Object.values(goalsBySide).map(g => ({ side: g.side, rippling: Boolean(g.ripple), shaking: Boolean(g.shake), frameOffset: g.frame.position.toArray() })),
        snapshot: () => ({ elapsed, score: [...goals], paused: pausedLocal, periodEnded, sliding: Boolean(sliding),
          goalSequence: goalSequence && { phase: goalSequence.phase, age: goalSequence.age, angle: goalSequence.angle, playTime: goalSequence.playTime,
            scorer: goalSequence.scorer, teammates: goalSequence.teammates, frameCount: goalSequence.frames.length, firstBall: goalSequence.frames[0]?.ball },
          passingAssistance, input: { passHold, throughHold, touchSprint, shieldHold, shootHold, lobHold, jockeyHold, containHold, controlledSprint, strafeHold, sprintJockey, teammateContain, keeperRushHold, power },
          possessor, awayCarrier, keeperHolding, passTarget, receivingGuidance, passDestination: passDestination?.toArray(), offside: offside.snapshot(), restartTouch: restartTouch && { ...restartTouch }, setPiece: setPiece && { phase: setPiece.phase, mode: setPiece.mode, reticle: setPiece.reticle.toArray(), button: setPiece.button, gesture: setPiece.gesture.join('') }, controlled, lastTouchHome, manualKeeper, playerLock, restart: restart && { ...restart }, pendingRestart: pendingRestart && { ...pendingRestart }, skill: skill && { ...skill }, started: ready.started,
          physicsReady: Boolean(physics), clipsLoaded: Object.keys(clips).length, events: { ...events },
          ball: ball.position.toArray(), velocity: ballVelocity.toArray(), spin: physics?.spin(),
          players: people.map(p => ({ x: p.motion.x, z: p.motion.z, heading: p.motion.heading, home: p.home,
            keeper: p.keeper, action: p.actionName, yaw: p.mesh.rotation.y, actionUntil: p.actionUntil,
            vx: p.motion.vx, vz: p.motion.vz, stamina: p.stamina, downUntil: p.downUntil || 0, sentOff: Boolean(p.sentOff) })) }),
        step: (seconds) => { const wasPaused = pausedLocal; pausedLocal = false; for (let i = 0; i < Math.round(seconds * 60); i++) { simulate(1 / 60); if (!pausedLocal) animatePlayers(SIM_DT); } pausedLocal = wasPaused; renderPending = true; },
        aim: direction => { aimOverride = direction; },
        move: (x, z) => state.setAxis(x, z),
        restart: (type, home, spot) => startRestart(type, home, spot),
        foul: (fouledHome, x, z) => { ball.position.set(x, BALL_RADIUS, z); foul(fouledHome, null); },
        shoot: (strength, style = 'normal') => { const wasPaused = pausedLocal; pausedLocal = false; pendingShot = { power: strength, style, at: elapsed }; simulate(1 / 60); pausedLocal = wasPaused; },
        tackle: style => tackle(style === 'slide' ? 'tackleAlternate' : 'tackle', style),
        cpuKick: (index, kind, target) => cpuPlay(index, kind, target),
        animate: seconds => mixers.forEach(mixer => mixer.update(seconds)),
        playerVisual: index => {
          const person = people[index]; person.mesh.updateMatrixWorld(true);
          const bounds = new THREE.Box3().setFromObject(person.mesh, true);
          return { action: person.actionName, visible: person.mesh.visible,
            feet: feetOf(person),
            body: slideBodyOf(person),
            slide: person.slideState && { ballWon: person.slideState.ballWon, foot: person.slideState.foot, contacts: person.slideState.contacts },
            bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
            actionUntil: person.actionUntil, downUntil: person.downUntil || 0, getUpAt: person.getUpAt || 0,
            animationTime: person.currentAction?.time, animationSpeed: person.currentAction?.getEffectiveTimeScale(),
            weight: person.currentAction?.getEffectiveWeight() };
        },
        distributionTarget: index => keeperThrowTarget(index),
        setPiecePreview: () => {
          if (!setPiece) return null;
          const plan = setPiecePlan(previewStrength());
          const origin = plan.origin || { x: ball.position.x, y: ball.position.y, z: ball.position.z };
          const launch = plan.velocity ? { velocity: plan.velocity, spin: plan.spin(), distance: Math.hypot(plan.target.x - origin.x, plan.target.z - origin.z) }
            : plan.ground ? null : solveLaunch(plan.target, plan.height, plan.speed, plan.spin, plan.minLift, origin);
          return { visible: aimDots.visible, target: plan.target, origin, launch,
            points: launch ? flight(origin, launch.velocity, launch.spin, { distance: plan.directed ? Infinity : launch.distance, maxTime: 3.5 }).points : [] };
        },
        press: key => { const wasPaused = pausedLocal; pausedLocal = false; pressAction(key); pausedLocal = wasPaused; },
        release: key => { const wasPaused = pausedLocal; pausedLocal = false; releaseAction(key); pausedLocal = wasPaused; },
        scenario: ({ ball: position, velocity = [0, 0, 0], spin = { x: 0, y: 0, z: 0 }, owner = -1, players = [], seed = 1, touch, controlLockFor = 0 }) => {
          people.forEach(p => { p.sentOff = false; p.yellows = 0; p.mesh.visible = true; }); // each test starts with a full side
          reset(); keeperHolding = -1; random = createRandom(seed); kickoffWaiting = false; possessor = owner >= 0 && people[owner].home ? owner : -1;
          awayCarrier = owner >= 0 && !people[owner].home ? owner : -1;
          lastTouchHome = touch ?? (owner < 0 ? velocity[0] > 0 : people[owner].home);
          for (const { index, x, z, heading, downFor = 0, freezeFor = 0, stamina } of players) {
            const p = people[index]; if (stamina !== undefined) p.stamina = clamp(stamina, 0, 1);
            Object.assign(p.motion, { x, z, vx: 0, vz: 0, heading: heading ?? (p.home ? 0 : Math.PI) });
            p.mesh.position.set(x, 0, z); p.mesh.rotation.y = meshYawForHeading(p.motion.heading); p.actionUntil = 0; p.downUntil = elapsed + downFor;
            p.fixtureFreezeUntil = elapsed + freezeFor;
          }
          controlLockUntil = elapsed + controlLockFor; receivingForecast = receivingGuidance = null;
          ball.position.fromArray(position); ballVelocity.fromArray(velocity); physics?.reset(ball.position, ballVelocity, spin, people.map(person => person.mesh.position));
        },
      };
    }
    // Pitch radar: every player and the ball, in pitch proportions.
    const radarDots = radar.current ? Array.from(radar.current.querySelectorAll('.dot')) : [];
    function updateRadar() {
      if (!radarDots.length) return;
      const place = (dot, x, z) => { dot.style.left = `${50 + x / LENGTH * 100}%`; dot.style.top = `${50 + z / WIDTH * 100}%`; };
      people.forEach((person, index) => {
        place(radarDots[index], person.motion.x, person.motion.z);
        radarDots[index].classList.toggle('controlled', index === controlled);
        radarDots[index].classList.toggle('target', targetRing.visible && index === keeperTarget);
      });
      place(radarDots[people.length], ball.position.x, ball.position.z);
    }

    // When frames run slow (under ~42 fps), step quality down: resolution
    // first, then shadow detail. It only ever steps down during a match, so the
    // picture never flickers between sharp and soft.
    let pixelRatio = Math.min(window.devicePixelRatio, 1.5), frameTimes = 0, frameCount = 0, qualityCheckAt = 4, renderTime = 0;
    function adaptQuality(frameDt) {
      renderTime += frameDt; frameTimes += frameDt; frameCount++;
      if (renderTime < qualityCheckAt) return;
      qualityCheckAt = renderTime + 3;
      const average = frameTimes / frameCount * 1000;
      frameTimes = 0; frameCount = 0;
      if (average < 24) return;
      if (pixelRatio > 0.8) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); resize(); }
      else if (sun.shadow.mapSize.x > 1024) { sun.shadow.mapSize.set(1024, 1024); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    }

    // The match runs at a fixed SIM_DT, so it plays at the same real-time
    // speed on every device. Player animations use simulation time; the camera uses frame time.
    let accumulator = 0, shownPhase = 'attack';
    // The loading screen lifts on the kickoff view: everything is in place and
    // the clock starts from here.
    function startMatch() {
      ready.started = true;
      reset(); clock.getDelta(); accumulator = 0;
      setLoading({ done: true, progress: 1, step: '' });
      show('KICK OFF', 1.5);
      say('kickoff');
    }
    function animate() {
      if (disposed) return;
      requestAnimationFrame(animate);
      if (!ready.started) {
        if (!(ready.venue && ready.physics && ready.model && ready.clips >= clipTotal)) return;
        startMatch();
      }
      const realFrameDt = clock.getDelta();
      const frameDt = Math.min(realFrameDt, 0.25);
      pollGamepad();
      if (isTouch && isTouchAttack() !== shownTouchAttack) {
        shownTouchAttack = isTouchAttack(); setTouchAttacking(shownTouchAttack);
      }
      // The pause menu can reuse the last picture. Keep polling inputs and
      // redraw after a resize or a debug replay, without shading the pitch
      // continuously behind an unchanged overlay.
      if (pausedLocal && !renderPending && !cutCamera) return;
      accumulator += frameDt;
      let steps = 0;
      while (accumulator >= SIM_DT && steps < MAX_SIM_STEPS) {
        simulate(SIM_DT);
        if (!pausedLocal) animatePlayers(SIM_DT);
        accumulator -= SIM_DT; steps++;
      }
      if (steps === MAX_SIM_STEPS) accumulator = 0;
      // Quality reacts to real frame time, even when physics must cap catch-up.
      adaptQuality(realFrameDt);
      updateRadar();
      updateSetPieceView();
      marker.visible = !setPieceCam && !goalSequence; // keep close-ups clear
      ring.visible = !goalSequence;
      const phase = setPiece ? setPiece.restart.type === 'throwIn' ? 'throwIn' : 'setPiece' : restart?.type === 'penalty' && !restart.home ? 'penaltyKeeper' : lastTouchHome ? 'attack' : 'defend';
      if (phase !== shownPhase) { shownPhase = phase; setPadPhase(phase); }
      if (powerMeter.current) {
        const charging = passHold || throughHold || shootHold || throwHold || lobHold || setPiece?.phase === 'charge';
        powerMeter.current.style.opacity = charging ? 1 : 0;
        if (charging) powerMeter.current.firstChild.style.width = `${Math.round(power * 100)}%`;
      }
      if (staminaMeter.current) staminaMeter.current.firstChild.style.width = `${Math.round(people[controlled].stamina * 100)}%`;
      // The crowd rises as the ball nears either goal.
      if (renderTime - lastCrowd > 0.25) {
        lastCrowd = renderTime;
        const danger = THREE.MathUtils.smoothstep(Math.abs(ball.position.x) / (LENGTH / 2), 0.45, 0.95);
        sound.crowd(pausedLocal ? 0 : danger);
      }
      const dt = frameDt;
      // Frame the keeper together with his throw target, and the taker
      // together with the box at a set piece.
      const holdingView = keeperHolding === 0 && controlled === 0 && targetRing.visible;
      const cameraOwner = possessor >= 0 ? possessor : awayCarrier;
      const target = holdingView ? people[0].mesh.position.clone().lerp(targetRing.position, 0.5)
        : pendingRestart ? ball.position : restart ? new THREE.Vector3(restart.spot.x * 0.8, 0, restart.spot.z) : people[cameraOwner >= 0 ? cameraOwner : controlled].mesh.position;
      // Every new restart owns its own framing. Never retain the pose from a
      // different free kick/corner; release into the broadcast view smoothly.
      const pieceInView = restart && !resetAt ? restart : null;
      if (pieceInView && setPieceCam?.piece !== pieceInView) setPieceCam = { piece: pieceInView, until: Infinity };
      if (!pieceInView || resetAt) setPieceCam = null;
      host.parentElement?.classList.toggle('restart-camera', Boolean(setPieceCam));
      const viewZoom = config.device === 'phone' && !setPieceCam && !goalSequence ? 1.25 : 1;
      if (Math.abs(cam.zoom - viewZoom) > 0.001) { cam.zoom = cutCamera ? viewZoom : THREE.MathUtils.lerp(cam.zoom, viewZoom, 1 - Math.exp(-6 * frameDt)); cam.updateProjectionMatrix(); } else if (cam.zoom !== viewZoom) { cam.zoom = viewZoom; cam.updateProjectionMatrix(); }
      const follow = cutCamera ? 1 : 1 - Math.exp(-5 * frameDt);
      cutCamera = false;
      if (goalSequence) {
        const hero = people[goalSequence.scorer].mesh.position;
        const frame = goalSequence.phase === 'replay' && replayPose
          ? replayCamera(goalSequence.angle, replayPose.ball, (goalSequence.home ? 1 : -1) * LENGTH / 2, cam.aspect)
          : { focus: { x: hero.x, y: 1, z: hero.z }, position: { x: hero.x - (goalSequence.home ? 5 : -5), y: 5.5, z: hero.z + 10 } };
        cam.position.lerp(new THREE.Vector3(frame.position.x, frame.position.y, frame.position.z), goalSequence.phase === 'replay' ? 1 : follow);
        cameraFocus.lerp(new THREE.Vector3(frame.focus.x, frame.focus.y, frame.focus.z), goalSequence.phase === 'replay' ? 1 : follow);
        cam.lookAt(cameraFocus);
      } else if (setPieceCam) {
        const { spot, home, type, taker } = setPieceCam.piece, goalX = -ownGoalX(home), sign = home ? 1 : -1;
        const aimAt = setPiece ? setPiece.reticle
          : type === 'corner' ? { x: goalX - sign * 6, z: 0 }
          : type === 'goalKick' ? { x: spot.x + sign * 24, z: spot.z * 0.3 }
          : type === 'throwIn' ? { x: spot.x + sign * 8, z: spot.z * 0.3 } : { x: goalX, z: 0 };
        const frame = restartFraming({ piece: setPieceCam.piece, taker: people[taker].motion,
          aim: aimAt, goalX, goalWidth: GOAL_WIDTH, goalHeight: GOAL_HEIGHT,
          extraPoints: setPiece?.button === 'j' ? [setPiecePlan(setPiece.phase === 'runup' ? setPiece.power : power).target] : [],
          aspect: cam.aspect, fov: THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(cam.fov * Math.PI / 360) / cam.zoom)), phone: config.device === 'phone' });
        cam.position.lerp(frame.position, follow);
        cameraFocus.lerp(frame.focus, follow);
        cam.lookAt(cameraFocus);
      } else if (viewMode === 'Behind player') {
        cam.position.lerp(new THREE.Vector3(target.x - 9, 5.5 + clamp((ball.position.y - 0.5) * 0.4, 0, 3), target.z + 3.2), follow);
        cameraFocus.lerp(new THREE.Vector3(target.x + 9, 1.1 + clamp((ball.position.y - 0.5) * 0.45, 0, 4), target.z), follow);
        cam.lookAt(cameraFocus);
      } else {
        const carrier = cameraOwner >= 0 ? people[cameraOwner].mesh.position : null;
        const frame = gameplayFraming({ ball: ball.position, velocity: ballVelocity,
          carrier, target: holdingView ? target : null, width: WIDTH, length: LENGTH,
          aspect: cam.aspect, wide: viewMode === 'Wide' });
        cameraFocus.lerp(frame.focus, follow);
        cam.position.lerp(frame.position, follow);
        cam.lookAt(cameraFocus);
      }
      updateGoalEffects();
      if (cameraShake) {
        // Felt on every device: a short, fading shake of the view.
        const t = elapsed - cameraShake.at, amount = cameraShake.strength * Math.exp(-t / 0.18);
        if (t > 0.8) cameraShake = null;
        else cam.position.add(new THREE.Vector3(Math.sin(t * 83) * amount, Math.sin(t * 61 + 1) * amount, Math.sin(t * 71 + 2) * amount * 0.6));
      }
      renderer.render(scene, cam);
      renderPending = false;
    }
    cam.position.set(0, WIDTH * 0.47, WIDTH * 0.85); cam.lookAt(0, 0.9, WIDTH * 0.25); animate();

    loadPlayerModel().then(async source => {
      if (disposed) return;
      // The cached source is shared with the landing page and later matches.
      const model = cloneSkeleton(source);
      const size = new THREE.Vector3(); new THREE.Box3().setFromObject(model).getSize(size);
      if (!size.y) { setModelStatus('PLAYER MODEL UNAVAILABLE'); ready.model = true; ready.clips = clipTotal; updateLoading(); return; }
      model.scale.setScalar(1.75 / size.y); model.updateMatrixWorld(true);
      model.position.y -= new THREE.Box3().setFromObject(model).min.y;
      for (const person of people) {
        const skinned = cloneSkeleton(model);
        skinned.traverse((part) => {
          if (!part.isMesh) return;
          // Cached bind-pose bounds can reject an animated player when a
          // restart view turns around them. Fourteen players are cheap to
          // keep in the draw list; scenery retains normal frustum culling.
          if (part.isSkinnedMesh) part.frustumCulled = false;
          part.castShadow = true; part.receiveShadow = true;
          const name = part.name.toLowerCase();
          const kitColor = person.keeper ? (person.home ? '#ffd54f' : '#9c66ed') : person.home ? kits.home : kits.away;
          const cloth = ['shirt', 'socks', 'shorts'].some(piece => name.includes(piece));
          const original = Array.isArray(part.material) ? part.material[0] : part.material;
          const fallback = original.userData.missingExportTextures
            ? name.includes('body') ? '#8c5d3d' : name.includes('shoes') ? '#252525' : '#201d1b' : undefined;
          const color = name.includes('shorts') ? (person.home ? '#184b34' : '#262c38') : cloth ? kitColor : fallback;
          const roughness = cloth ? .92 : name.includes('body') ? .68 : name.includes('shoes') ? .55 : .9;
          const dress = original => playerMaterial(original, { color, cloth, roughness });
          part.material = Array.isArray(part.material) ? part.material.map(dress) : dress(part.material);
        });
        person.mesh.clear(); person.mesh.add(skinned);
        person.visual = skinned;
        const toes = new Map();
        skinned.traverse(node => { if (node.isBone && /(?:Left|Right)ToeBase$/.test(node.name) && !toes.has(node.name)) toes.set(node.name, node); });
        skinned.traverse(node => { if (node.isBone && /Hips$/.test(node.name) && !person.hipBone) person.hipBone = node; });
        person.footBones = [...toes.values()];
        person.mixer = new THREE.AnimationMixer(skinned); mixers.push(person.mixer);
      }
      setModelStatus('');
      ready.model = true; updateLoading();
      const results = await Promise.allSettled(Object.entries(clipsToLoad).map(async ([name, file]) => {
        const motion = await loadAnimation(file);
        const source = [...motion.animations].sort((a, b) => b.duration - a.duration || b.tracks.length - a.tracks.length)[0];
        if (!source) throw new Error(`${file} has no clip`);
        // The slide clip includes an authored get-up. Use just its grounded
        // portion; recovery is a separate, deliberately slower animation.
        const clip = name === 'tackleAlternate' ? groundedSlideClip(source)
          : source.clone(); // never edit the shared source
        for (const track of clip.tracks) {
          if (name === 'spin' && track.name.toLowerCase().includes('hips.quaternion')) {
            const base = new THREE.Quaternion().fromArray(track.values), inverse = base.clone().invert();
            for (let i = 0; i < track.values.length; i += 4) {
              const relative = new THREE.Quaternion().fromArray(track.values, i).premultiply(inverse);
              const twist = new THREE.Quaternion(0, relative.y, 0, relative.w).normalize();
              base.clone().multiply(relative.multiply(twist.invert())).toArray(track.values, i);
            }
          }
          if (!track.name.toLowerCase().includes('hips.position')) continue;
          if (name === 'goalkeeperDive') {
            let excursion = 0;
            for (let i = 0; i < track.values.length; i += 3) {
              const travel = track.values[i] - track.values[0];
              if (Math.abs(travel) > Math.abs(excursion)) excursion = travel;
            }
            diveLocalSign = Math.sign(excursion) || 1;
          }
          const x = 0, z = 0;
          for (let i = 0; i < track.values.length; i += 3) { track.values[i] = x; track.values[i + 2] = z; }
        }
        clips[name] = clip;
        ready.clips++; updateLoading();
        return name;
      }).map(promise => promise.catch(error => { ready.clips++; updateLoading(); throw error; })));
      if (disposed) return;
      people.forEach(idle);
      const loaded = results.filter(result => result.status === 'fulfilled').length;
      setModelStatus(loaded === results.length ? '' : `${loaded}/${results.length} SOCCER MOVES READY`);
    }).catch(() => { if (!disposed) { setModelStatus('PLAYER MODEL UNAVAILABLE'); ready.model = true; ready.clips = clipTotal; updateLoading(); } });

    return () => {
      disposed = true; observer.disconnect();
      if (import.meta.env.DEV) delete window.__footballDebug;
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur);
      physics?.free(); sound.dispose(); commentary.dispose(); clearTimeout(captionTimer);
      disposeStadiumGrass();
      if (stadiumGrass) { stadiumGrass.map.dispose(); stadiumGrass.bumpMap.dispose(); stadiumGrass.dispose(); }
      speechGestures.forEach(type => window.removeEventListener(type, unlockSpeech));
      host.removeChild(renderer.domElement); renderer.dispose(); engine.current = null;
    };
  }, [config.home, config.away, config.formation, config.venueId, config.difficulty, config.device, cameraMode, kits.home, kits.away, isTouch, passingAssistance, preferences.keyboard, preferences.gamepad]);

  useEffect(() => {
    if (seconds > 0) return;
    engine.current?.setPeriodEnded(true);
    engine.current?.setPause(true);
    engine.current?.whistle(half === 1 ? 'double' : 'long');
    engine.current?.endOfHalf(half === 2);
    setMessage(half === 1 ? 'HALF TIME' : 'FULL TIME');
    if (half === 2 && !resultRecorded.current) {
      resultRecorded.current = true;
      if (score[0] > score[1]) {
        try {
          const next = recordTeamWin(config.home, matchId.current);
          setProgress(next);
          setProgressNotice(`Win saved · ${next.wins} team wins · squad and keeper skill +${Math.round((abilityForWins(next.wins) - 1) * 100)}% for your next match.`);
        } catch { setProgressNotice('You won! Progress could not be saved on this device.'); }
      }
    }
  }, [seconds, half, score, config.home]);

  useEffect(() => {
    if (orientationBlocked) engine.current?.setPause(true);
  }, [orientationBlocked]);

  // Button names in the controller's own language.
  const pad = /PlayStation/.test(gamepadStatus)
    ? { cross: '✕', circle: '◯', square: '▢', triangle: '△', l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2' }
    : { cross: 'A', circle: 'B', square: 'X', triangle: 'Y', l1: 'LB', r1: 'RB', l2: 'LT', r2: 'RT' };
  const keeperHint = isTouch ? '' : `KEEPER'S BALL · AIM: ${preferences.keyboardPreset === 'classic' ? 'ARROWS' : 'WASD'} · THROW: ${keyLabel(preferences.keyboard.pass)} (HOLD = LONGER) · LONG KICK: ${keyLabel(preferences.keyboard.through)} · PUT DOWN: ${keyLabel(preferences.keyboard.lob)}`;
  const keyboardHint = `MOVE: ${preferences.keyboardPreset === 'classic' ? 'ARROWS' : 'WASD'} · PASS: ${keyLabel(preferences.keyboard.pass)} · SHOOT: ${keyLabel(preferences.keyboard.shoot)} · SWITCH: ${keyLabel(preferences.keyboard.switch)} · SPRINT: ${keyLabel(preferences.keyboard.sprint)} · PAUSE: ESC`;
  return <div className={`game-shell ${isTouch ? 'touch-mode' : 'keyboard-mode'}${goalMoment ? ' goal-presentation' : ''}`}>
    <div className="game-view" ref={mount}/>
    <div className="game-hud">
      {preferences.hud.player && <div className="player-indicator">CONTROLLED PLAYER #{selectedPlayer}<small>{venue.shortName} · {isTouch ? 'Drag joystick · landscape' : gamepadStatus || `${preferences.keyboardPreset === 'classic' ? 'Arrows' : 'WASD'} · gamepad ready`}</small></div>}
      {preferences.hud.score && <div className="scoreboard"><span style={{ background: kits.home, color: textOn(kits.home) }}>{homeName}</span><b>{score[0]}</b><div>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}<small>{half === 1 ? '1ST' : '2ND'} HALF</small></div><b>{score[1]}</b><span style={{ background: kits.away, color: textOn(kits.away) }}>{awayName}</span></div>}
      {preferences.hud.messages && message && <div className="game-message">{message}</div>}
      {preferences.hud.messages && modelStatus && <div className="model-status">{modelStatus}</div>}
      {preferences.hud.radar && <div className="radar" ref={radar}><div className="radar-mid"/>{Array.from({ length: TEAM_SIZE * 2 }, (_, index) => <i key={index} className={`dot ${index < TEAM_SIZE ? 'home' : 'away'}`}/>)}<i className="dot ball"/></div>}
      {preferences.hud.score && <div className="hud-bottom"><span>{homeName} <i/></span><span>{awayName} <i/></span></div>}
      {!isTouch && preferences.hud.hints && <div className="controls-hint">{keeperBall ? (gamepadStatus ? `KEEPER'S BALL · AIM: L · THROW: ${pad.cross} (HOLD = LONGER) · LONG KICK: ${pad.triangle} · PUT DOWN: ${pad.circle}` : keeperHint)
        : padPhase === 'penaltyKeeper' ? `PENALTY AGAINST YOU · HOLD ${gamepadStatus ? 'L' : preferences.keyboardPreset === 'classic' ? '← OR →' : 'A OR D'} LEFT OR RIGHT TO DIVE AT THE KICK · LET GO TO STAY CENTRAL`
        : padPhase === 'throwIn' ? `THROW IN · ${gamepadStatus ? 'L' : preferences.keyboardPreset === 'classic' ? 'ARROWS' : 'WASD'} AIM · HOLD ${gamepadStatus ? pad.cross : keyLabel(preferences.keyboard.pass)} FOR POWER · RELEASE TO THROW`
        : padPhase === 'setPiece' ? (gamepadStatus
          ? `SET PIECE · L AIM · HOLD ${pad.square} SHOOT · ${pad.circle} CROSS · ${pad.cross} PASS · RUN-UP: R ↓↑ DIP · R HALF-CIRCLE CURL · R ↓↑↓ KNUCKLE · ${pad.square} AGAIN AT THE STRIKE = TIMED`
          : `SET PIECE · ${preferences.keyboardPreset === 'classic' ? 'ARROWS' : 'WASD'} AIM · HOLD ${keyLabel(preferences.keyboard.shoot)} SHOOT · ${keyLabel(preferences.keyboard.lob)} CROSS · ${keyLabel(preferences.keyboard.pass)} PASS · ${keyLabel(preferences.keyboard.shoot)} AGAIN AT THE STRIKE = TIMED`)
        : gamepadStatus ? (padPhase === 'attack'
          ? `${pad.cross} PASS · ${pad.triangle} THROUGH · ${pad.square} SHOOT · ${pad.circle} LOB · ${pad.r1} SPRINT · ${pad.l2} SHIELD · ${pad.r2}+${pad.square} FINESSE · ${pad.l1}+${pad.square} CHIP`
          : `${pad.square} TACKLE · ${pad.circle} SLIDE · ${pad.r1}+${pad.square} HARD TACKLE · ${pad.cross} CONTAIN · ${pad.l1} SWITCH · ${pad.l2} JOCKEY · ${pad.triangle} KEEPER RUSH`)
        : keyboardHint}</div>}
      {isTouch && keeperBall && <div className="controls-hint keeper-touch">KEEPER'S BALL · PASS: THROW (HOLD = LONGER) · SHOOT: LONG KICK · PUT DOWN: RELEASE TO FEET</div>}
      {isTouch && padPhase === 'throwIn' && <div className="controls-hint keeper-touch">THROW IN · JOYSTICK: AIM · HOLD PASS FOR POWER · RELEASE TO THROW</div>}
      <div className="power-meter" ref={powerMeter}><i/><span>POWER</span></div>
      {caption && <div className="commentary-caption" aria-live="polite">{caption}</div>}
      {preferences.hud.player && <div className="stamina-meter" ref={staminaMeter}><i/></div>}
    </div>
    {goalMoment && !paused && <div className="goal-sequence" role="region" aria-label={goalMoment.phase === 'replay' ? 'Goal replay' : 'Goal celebration'}>
      <div className="goal-sequence-title" aria-live="polite"><small>{goalMoment.phase === 'replay' ? `GOAL REPLAY · ANGLE ${goalMoment.angle + 1} / ${GOAL_ANGLES}` : `${goalMoment.team} · GOAL!`}</small><strong>{goalMoment.scorer}</strong></div>
      <button type="button" className="goal-pause" aria-label="Pause highlight" onClick={() => engine.current?.setPause(true)}>PAUSE</button>
      <button type="button" className="btn primary goal-skip" onClick={() => engine.current?.skipGoal()}>{goalMoment.phase === 'replay' ? 'SKIP REPLAY' : 'SKIP CELEBRATION'} <span>▶</span><small>{gamepadStatus ? `${pad.cross} CONTINUE` : isTouch ? 'TAP TO CONTINUE' : 'ENTER TO CONTINUE'}</small></button>
    </div>}
    {isTouch && <TouchControls engine={engine} settings={preferences.touch} attacking={touchAttacking} keeperHolding={keeperBall} disabled={Boolean(goalMoment) || paused || !loading.done || orientationBlocked}/>}
    {!loading.done && <div className="match-loading" role="status" aria-live="polite"><div className="match-loading-card">
      <p className="eyebrow">{venue.name.toUpperCase()}</p>
      <h2>{homeName} <small>VS</small> {awayName}</h2>
      <div className="match-loading-bar"><i style={{ width: `${Math.round(loading.progress * 100)}%` }}/></div>
      <p>{loading.step}…</p>
    </div></div>}
    {isTouch && <div className="rotate-prompt"><div><strong>ROTATE TO LANDSCAPE</strong><span>Turn your phone sideways for the touch camera and controls.</span></div></div>}
    {paused && <div className="pause-scrim"><div className="pause-card"><p className="eyebrow">STADIUM MATCH</p><h2>{seconds === 0 ? (half === 1 ? 'HALF TIME' : 'FULL TIME') : 'PAUSED'}</h2><p>{config.home} {score[0]} — {score[1]} {config.away}</p>{progressNotice && <p role="status">{progressNotice}</p>}<button className="btn primary" onClick={() => { if (seconds === 0) { if (half === 2) { exit(); return; } engine.current?.setPeriodEnded(false); engine.current?.kickoff(); setHalf(2); setSeconds(Math.ceil(config.matchMinutes * 30)); setMessage('SECOND HALF'); } engine.current?.setPause(false); }}>{seconds === 0 ? (half === 1 ? 'SECOND HALF ▶' : 'MAIN MENU') : 'RESUME ▶'}</button><button className="btn" onClick={exit}>LEAVE MATCH</button></div></div>}
  </div>;
}
