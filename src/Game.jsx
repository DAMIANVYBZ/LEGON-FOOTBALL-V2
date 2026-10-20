import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import TouchControls from './TouchControls.jsx';
import { getVenue } from './venues.js';
import { buildVenueScene } from './VenueScene.js';
import { activeGamepad, readGamepad } from './gamepad.js';
import { keyLabel } from './preferences.js';
import { abilityForWins, readTeamProgress, recordTeamWin } from './progression.js';
import { loadAnimation, loadGLTF, loadPlayerModel, loadVenueManifest } from './assets.js';
import { GOAL, KICK_SPIN, MAX_SIM_STEPS, SIM_DT, STAMINA, difficultyFor } from './physicsConfig.js';
import { createRandom, keeperPosition, saveOutcome, shotOnGoal } from './keeper.js';
import { bestPassOption, decideCarrier, markingAssignments } from './cpuBrain.js';
import { createMatchAudio } from './audio.js';
import { matchKits, teamShort } from './teams.js';
import { createCommentary, resultLine, scoreLine } from './commentary.js';
import { playerName } from './players.js';
import { vibrate } from './haptics.js';
import { flight, liftFor } from './ballistics.js';
import { aimShot, gaussian, SHOT_STYLES, spinStyle, stickZone } from './shooting.js';
import { advancePlayer, carryBall, canWinTackle, forwardFromHeading, meshYawForHeading, pickPassTarget, supportPosition } from './gameplay.js';

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

function fieldPositions(formation, side, length, width) {
  const rows = formation === '3–2–1' ? [3, 2, 1] : formation === '2–3–1' ? [2, 3, 1] : [2, 2, 2];
  // Kickoff shape: every row inside its own half, forwards just behind halfway.
  const xRows = [-length * .34, -length * .19, -length * .055];
  const positions = [[side * -length * .46, 0]];
  rows.forEach((count, row) => {
    for (let i = 0; i < count; i++) positions.push([side * xRows[row], (i - (count - 1) / 2) * (Math.min(38, width * .66) / Math.max(count - 1, 1))]);
  });
  return positions;
}

// Dark text on light kits, white text on dark ones.
const textOn = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return r * 0.3 + g * 0.59 + b * 0.11 > 150 ? '#161513' : '#ffffff'; };

export default function Game({ config, cameraMode, exit, preferences, orientationBlocked = false }) {
  const venue = getVenue(config.venueId);
  const LENGTH = venue.length, WIDTH = venue.width;
  const GOAL_WIDTH = venue.kind === 'astro' ? 5.5 : 7.32;
  const GOAL_HEIGHT = venue.kind === 'astro' ? 2.2 : 2.44;
  const isTouch = config.inputMode === 'touch';
  const mount = useRef(null);
  const engine = useRef(null);
  const [score, setScore] = useState([0, 0]);
  const [seconds, setSeconds] = useState(Math.ceil(config.matchMinutes * 30));
  const [half, setHalf] = useState(1);
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState('KICK OFF');
  const [modelStatus, setModelStatus] = useState('LOADING PLAYERS');
  const [selectedPlayer, setSelectedPlayer] = useState(6);
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
    const cameraFocus = new THREE.Vector3();
    const clock = new THREE.Clock();
    scene.add(new THREE.HemisphereLight(0xf8fcff, 0x466235, 2.2));
    const sun = new THREE.DirectionalLight(0xffe7ba, 2.6);
    sun.position.set(-50, 95, 48);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
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
    buildVenueScene({ scene: fallbackEnvironment, venue, box: venueBox, material });
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
          fieldGroup.position.y = 0.04; // the model's grass sits 3 cm up
        }
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
      fieldPositions(config.formation, side, LENGTH, WIDTH).forEach((spawn, index) => {
        const mesh = placeholder(home ? kits.home : kits.away);
        mesh.position.set(spawn[0], 0, spawn[1]); playerRoot.add(mesh);
        const heading = home ? 0 : Math.PI;
        mesh.rotation.y = meshYawForHeading(heading);
        people.push({ mesh, home, keeper: index === 0, role: index, spawn, actionName: '', actionUntil: 0, stamina: 1,
          nextTackleAt: 0, saveUntil: 0, diveDirection: 0, motion: { x: spawn[0], z: spawn[1], vx: 0, vz: 0, heading } });
      });
    }
    let controlled = 5, possessor = 5, awayCarrier = -1, awayKickUntil = 0, lastAutoSwitch = 0;
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
    let physics = null;
    import('./matchPhysics.js').then(({ createMatchPhysics }) => createMatchPhysics({
      length: LENGTH, width: WIDTH, goalWidth: GOAL_WIDTH, goalHeight: GOAL_HEIGHT, ballRadius: BALL_RADIUS,
      surface: venue.surface, goalDepth: GOAL.depth,
      playerPositions: people.map(person => person.mesh.position),
    }))
      .then(simulation => { if (disposed) simulation.free(); else { physics = simulation; physics.reset(ball.position, ballVelocity); ready.physics = true; updateLoading(); } })
      .catch(error => { console.error('Match physics unavailable', error); ready.physics = true; updateLoading(); });
    let elapsed = 0, lastHUD = 0, goalCooldown = 0, messageUntil = 2, resetAt = 0, controlLockUntil = 0;
    let kickoffGraceUntil = difficulty.kickoffGrace, cutCamera = true;
    let kickoffWaiting = true; // everyone holds position until the kickoff is taken
    let shootHold = false, power = 0, pausedLocal = false, periodEnded = false, lastTouchHome = true, touchSprint = false, shieldHold = false;
    let finesseHold = false, teammateContain = false, jockeyHold = false, keeperRushHold = false, runUntil = 0;
    // Controller-only holds and modes (EA FC classic layout).
    let controlledSprint = false, strafeHold = false, containHold = false, sprintJockey = false;
    let playerLock = false, manualKeeper = false, shotStyle = 'normal', slideUntil = 0, sliding = null, padWant = {}; // sliding: the player mid slide tackle
    let penaltyDive = 0; // facing a penalty: the side you lean to dive (-1, 0, 1 across the goal)
    let setPiece = null, setPieceCam = null; // the set piece you are aiming, and the camera framing it
    let lobHold = false, pendingShot = null, aimOverride = null; // a released shot waits a moment for a second ▢ tap (low driven)
    let passTarget = -1, passDeadline = 0, passDestination = null;
    let keeperHolding = -1, keeperReleaseAt = 0;
    let keeperHoldStart = 0, throwHold = false, catchFrom = null, catchStart = 0, keeperTarget = -1;
    let awayPassTarget = -1, awayPassDestination = null, awayPassDeadline = 0;
    let restart = null; // a corner, goal kick or free kick waiting to be taken
    let marking = new Map(), markingAt = 0, lastCrowd = 0;
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
    const who = index => playerName(index, controlled);
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
    // Outfield movement with stamina: sprinting drains it, a tired player is slower.
    function run(person, input, dt, options) {
      const sprint = options.sprint && person.stamina > STAMINA.minimumToSprint;
      const speed = advancePlayer(person.motion, input, dt, { ...options, sprint,
        ability: (options.ability ?? 1) * (1 - STAMINA.speedLoss * (1 - person.stamina)) });
      person.stamina = sprint && speed > 4.5 ? Math.max(0, person.stamina - STAMINA.sprintDrain * dt)
        : Math.min(1, person.stamina + (speed < 2 ? STAMINA.restRecover : STAMINA.jogRecover) * dt);
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
    const state = {
      setPeriodEnded(value) { periodEnded = value; },
      setPause(value) { if (periodEnded && !value) return; pausedLocal = value; setPaused(value); },
      togglePause() { state.setPause(!pausedLocal); },
      setAxis(x, z) { touchAxis.x = x; touchAxis.z = z; },
      press(key) { pressAction(key); },
      release(key) { releaseAction(key); },
      whistle(kind) { sound.whistle(kind); },
      kickoff() { people.forEach(person => { person.stamina = Math.min(1, person.stamina + 0.5); }); reset(false); say('secondHalf'); },
      endOfHalf(final) {
        const score = scoreLine(hallName(true), hallName(false), goals), result = resultLine(hallName(true), hallName(false), goals);
        say(final ? 'fullTime' : 'halfTime', { score, result });
      },
      setSound(on) { sound.setEnabled(on); },
    };
    engine.current = state;
    const resize = () => { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h); cam.aspect = w / h; cam.fov = cam.aspect < 0.8 ? 46 : cameraMode === 'Co-op' ? 42 : 48; cam.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    function show(text, duration = 1.1) { setMessage(text); messageUntil = elapsed + duration; }
    function action(person, name, once = false) {
      const clip = clips[name];
      if (!clip || !person.mixer || (person.actionName === name && !once)) return;
      // A celebration plays at its natural speed for as long as the goal lasts;
      // other one-off moves are fitted to a short window.
      const natural = name === 'celebration';
      const duration = natural ? Math.min(clip.duration, 2.2) : Math.min(clip.duration, name === 'goalkeeperDive' ? 1.1
        : name === 'fallen' || name === 'stand' ? 1.1 : name.startsWith('goalkeeper') ? 0.8 : 0.55);
      const next = person.mixer.clipAction(clip);
      if (person.currentAction && person.currentAction !== next) person.currentAction.fadeOut(0.17);
      next.reset().setEffectiveTimeScale(once && !natural ? clip.duration / duration : 1).setEffectiveWeight(1).setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
      next.clampWhenFinished = once; next.fadeIn(0.17).play();
      person.currentAction = next; person.actionName = name;
      person.actionUntil = once ? elapsed + duration : 0;
    }
    function idle(person) {
      action(person, person.keeper ? 'goalkeeperIdle' : 'idle');
      if (!person.keeper && person.actionName === 'idle' && person.currentAction) person.currentAction.timeScale = 0.8;
    }
    function moveAction(person, speed) {
      if (elapsed < person.actionUntil) return;
      if (speed < 0.25) { idle(person); return; }
      const carrying = people.indexOf(person) === possessor || people.indexOf(person) === awayCarrier;
      action(person, person.keeper ? 'goalkeeperSidestep' : carrying ? 'dribble' : 'jog');
      if (person.currentAction) person.currentAction.timeScale = THREE.MathUtils.clamp(speed / 4.5, 0.7, 1.45);
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
    function solveLaunch(target, height, speed, spinOf, minLift = 0) {
      const from = { x: ball.position.x, y: ball.position.y, z: ball.position.z };
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
        const end = flight(from, { ...ground, y: lift }, spin, { distance }).position;
        angle -= Math.atan2(end.z - from.z, end.x - from.x) - wanted;
      }
      return { velocity: { x: Math.cos(angle) * speed, y: lift, z: Math.sin(angle) * speed }, spin, distance };
    }

    // ---- Set pieces you take: corners and free kicks ----
    // The left stick moves the reticle, a held button sets the power (▢ shot,
    // ◯ cross or lofted, ✕ pass), then during the run-up the right stick adds
    // spin and a second ▢ tap at the strike is timed finishing.
    function beginSetPiece() {
      const spot = restart.spot, goalX = LENGTH / 2, side = Math.sign(spot.z) || 1;
      const distance = Math.hypot(goalX - spot.x, spot.z);
      const shot = restart.type === 'penalty' || (restart.type === 'freeKick' && distance < 30);
      const reticle = shot ? new THREE.Vector3(goalX, 1.6, -side * (GOAL_WIDTH / 2 - 1))
        : restart.type === 'corner' ? new THREE.Vector3(goalX - 6, 0, 0)
        : new THREE.Vector3(Math.min(goalX - 8, spot.x + 26), 0, spot.z * 0.4);
      setPiece = { restart, mode: shot ? 'shot' : 'cross', reticle, button: null, phase: 'aim', power: 0, strikeAt: 0, gesture: [], timing: null, previewAt: 0 };
      restart.autoAt = elapsed + 30;
      // Stand back from the ball for the run-up.
      const taker = people[restart.taker], facing = Math.atan2(reticle.z - spot.z, reticle.x - spot.x);
      const forward = forwardFromHeading(facing);
      Object.assign(taker.motion, { x: spot.x - forward.x * 2.3, z: spot.z - forward.z * 2.3, heading: facing, vx: 0, vz: 0 });
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
      const button = piece.button || (piece.mode === 'shot' ? 'k' : 'l');
      const distance = Math.hypot(r.x - ball.position.x, r.z - ball.position.z);
      const style = spinStyle(piece.gesture);
      const target = { x: r.x, z: r.z };
      if (button === 'j') return { target, height: 0.15, speed: 8 + strength * 16, spin: d => spinFor('pass', d), style: 'none', ground: true };
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
      const { velocity, spin, distance } = solveLaunch(plan.target, plan.height, plan.speed, plan.spin, plan.minLift);
      const path = flight({ x: ball.position.x, y: ball.position.y, z: ball.position.z }, velocity, spin, { distance: distance + (setPiece.mode === 'shot' ? 0.5 : 0), maxTime: 3.5 }).points;
      for (let i = 0; i < AIM_DOTS; i++) {
        const point = path[Math.min(path.length - 1, Math.round((i + 1) / AIM_DOTS * (path.length - 1)))];
        dotMatrix.makeTranslation(point.x, Math.max(0.06, point.y), point.z);
        aimDots.setMatrixAt(i, dotMatrix);
      }
      aimDots.instanceMatrix.needsUpdate = true;
    }
    function strikeSetPiece() {
      const piece = setPiece, taker = people[controlled];
      const strength = piece.power, plan = setPiecePlan(strength);
      // Timed finishing: a second ▢ right at the strike sharpens it.
      let accuracy = 1, verdict = '';
      if (piece.button === 'k' && piece.timing !== null) {
        const off = Math.abs(piece.timing);
        accuracy = off < 0.07 ? 0.35 : off < 0.18 ? 0.8 : 1.6;
        verdict = off < 0.07 ? 'GREEN TIMING · ' : off < 0.18 ? '' : piece.timing < 0 ? 'EARLY · ' : 'LATE · ';
      }
      const distance = Math.hypot(plan.target.x - ball.position.x, plan.target.z - ball.position.z);
      const spread = (0.3 + distance * 0.014) * accuracy / teamAbility;
      const target = { x: plan.target.x, z: plan.target.z + gaussian(random) * spread };
      if (piece.mode === 'cross' && !plan.ground) target.x += gaussian(random) * spread;
      let height = plan.height + (plan.ground ? 0 : gaussian(random) * spread * 0.6);
      if (plan.style === 'knuckle') { target.z += (random() - 0.5) * 1.2; height -= random() * 0.4; } // it moves late
      const launch = solveLaunch(target, Math.max(0.15, height), plan.speed * teamAbility, plan.spin, plan.minLift);
      ballVelocity.set(launch.velocity.x, launch.velocity.y, launch.velocity.z); spinBall(launch.spin);
      const shot = piece.mode === 'shot' && piece.button !== 'j';
      if (restart?.type === 'penalty') keeperGuess(7);
      possessor = -1; awayCarrier = -1; passDestination = null; restart = null; setPiece = null;
      controlLockUntil = elapsed + 0.35; lastTouchHome = true;
      if (shot) { lastShooter = controlled; lastShotAt = elapsed; if (people[7].reactAt < elapsed) people[7].reactAt = elapsed + (0.24 + random() * 0.12) / difficulty.keeper; /* partly screened by the wall */ passTarget = -1; say('shot', { who: who(controlled), team: hallName(true) }); }
      else {
        // The teammate nearest the target attacks the ball.
        const near = nearestOf(true, target.x, target.z, controlled);
        passTarget = near; passDestination = new THREE.Vector3(target.x, 0, target.z); passDeadline = elapsed + 4; events.passes++;
        if (piece.button === 'l') say('cross', { team: hallName(true) });
      }
      action(taker, piece.button === 'j' ? 'pass' : 'kick', true); sound.kick(Math.min(1, plan.speed / 30));
      const spinName = { dip: 'DIP', curlLeft: 'CURL', curlRight: 'CURL', knuckle: 'KNUCKLEBALL' }[plan.style];
      show(`${verdict}${spinName ? spinName + ' · ' : ''}${shot ? (piece.restart.type === 'penalty' ? 'PENALTY KICK!' : 'FREE KICK!') : piece.button === 'j' ? 'SHORT PASS' : 'CROSS!'}`, 1.2);
      setPieceCam && (setPieceCam.until = elapsed + 1.2);
    }
    function kick(speed, name = 'kick', lift = 0.15, shot = null, loft = null) {
      const person = people[controlled];
      if (keeperHolding >= 0 || elapsed < controlLockUntil || person.mesh.position.distanceTo(ball.position) > 1.65) return;
      const direction = aim();
      possessor = -1; awayCarrier = -1; passTarget = -1; passDestination = null; restart = null;
      controlLockUntil = elapsed + 0.35;
      let crossing = false;
      if (name === 'pass' || name === 'goalkeeperPass' || name === 'chip') {
        crossing = name === 'chip' && Math.abs(ball.position.z) > WIDTH * 0.27 && ball.position.x > LENGTH * 0.08;
        // A cross goes to the zone the stick points at: near post, penalty spot
        // or far post. The teammate nearest that zone attacks it.
        const side = Math.sign(ball.position.z) || 1;
        const zones = [{ x: LENGTH / 2 - 4.5, z: side * 2.2 }, { x: LENGTH / 2 - 8, z: 0 }, { x: LENGTH / 2 - 5.5, z: -side * 3.2 }];
        const crossZone = crossing ? zones.reduce((best, zone) => {
          const bearing = (zone.x - ball.position.x) * direction.x + (zone.z - ball.position.z) * direction.z;
          const score = bearing / Math.hypot(zone.x - ball.position.x, zone.z - ball.position.z);
          return !best || score > best.score ? { ...zone, score } : best;
        }, null) : null;
        passTarget = crossing ? nearestOf(true, crossZone.x, crossZone.z, controlled)
          : pickPassTarget(people.map((teammate, index) => ({ index, home: teammate.home && !teammate.sentOff, keeper: teammate.keeper,
            x: teammate.mesh.position.x, z: teammate.mesh.position.z })), person.mesh.position, direction, controlled);
        // A goal kick, or a lofted ball toward nobody: the power bar sets the distance.
        const byPower = name === 'chip' && loft && loft.power > 0.08 && (loft.goalKick || passTarget < 0);
        if (byPower) {
          const reach = loft.goalKick ? 22 + loft.power * 30 : 14 + loft.power * 30;
          passDestination = ball.position.clone().setY(0).addScaledVector(direction, reach);
          passDestination.x = clamp(passDestination.x, -LENGTH / 2 + 2, LENGTH / 2 - 2); passDestination.z = clamp(passDestination.z, -WIDTH / 2 + 2, WIDTH / 2 - 2);
          // Whoever is nearest the landing spot goes for it.
          const near = nearestOf(true, passDestination.x, passDestination.z, controlled);
          passTarget = near >= 0 && people[near].mesh.position.distanceTo(passDestination) < 9 ? near : -1;
          crossing = false;
        } else if (passTarget >= 0) {
          const target = people[passTarget].mesh.position.clone();
          if (crossing) target.set(crossZone.x, 0, crossZone.z);
          else {
            target.x += people[passTarget].motion.vx * Math.min(0.7, target.distanceTo(ball.position) / speed);
            target.z += people[passTarget].motion.vz * Math.min(0.7, target.distanceTo(ball.position) / speed);
          }
          if (name === 'goalkeeperPass') target.x += 2.5;
          passDestination = target.clone();
          direction.copy(target).sub(ball.position).setY(0).normalize();
          speed = crossing ? Math.min(27, Math.max(18, target.distanceTo(ball.position) * 0.64))
            : Math.min(21, Math.max(speed, 8 + target.distanceTo(ball.position) * 0.36));
          if (crossing) lift = Math.min(7, Math.max(4, target.distanceTo(ball.position) * 0.16));
        }
        passDeadline = elapsed + 4; events.passes++;
      }
      // Finesse shots curl back toward the middle of the goal; crosses curl in
      // toward the box; chips carry backspin; driven shots dip with topspin.
      const kind = crossing ? 'cross' : name === 'chip' ? 'chip' : name === 'pass' || name === 'goalkeeperPass' ? 'pass'
        : name === 'scissor' || name === 'powerShot' ? 'powerShot' : name === 'chipShot' ? 'chip' : finesseHold ? 'finesse' : 'shot';
      const towardMiddle = -(Math.abs(goalLineZ(direction, LENGTH / 2)) > 0.3 ? goalLineZ(direction, LENGTH / 2) : ball.position.z || 1);
      spinBall(spinFor(kind, direction, kind === 'cross' ? -(ball.position.z || 1) : towardMiddle));
      if (name === 'chip' && passDestination) {
        // ◯ is always in the air: a cross arrives at head height, a lofted pass
        // drops at the receiver's feet. More power flies flatter and quicker;
        // a goal kick rises higher the harder it is struck.
        const distance = Math.max(4, Math.hypot(passDestination.x - ball.position.x, passDestination.z - ball.position.z));
        const strength = loft?.power > 0.08 ? loft.power : 0.45;
        const hang = loft?.goalKick ? 1.2 + distance * 0.03 : crossing ? clamp(1.1 + distance * 0.025, 1.3, 1.9) : clamp(0.9 + distance * 0.035, 1.1, 2.6);
        const flightTime = hang * (loft?.goalKick ? 1 : 1.15 - strength * 0.3);
        launchTo(passDestination, crossing ? 1.5 : 0.35, clamp(distance / flightTime * (1.05 + distance * 0.005), 8, 32) * teamAbility, crossing ? 'cross' : 'chip', crossing ? -(ball.position.z || 1) : 0);
        if (ballVelocity.y < 3) ballVelocity.y = 3; // never along the ground
      } else       if (shot) {
        // Shots are aimed at the goal mouth (src/shooting.js), chips dropped under the bar.
        const goalX = LENGTH / 2;
        if (name === 'chipShot') {
          const z = THREE.MathUtils.clamp(goalLineZ(direction, goalX), -GOAL_WIDTH / 2 + 0.5, GOAL_WIDTH / 2 - 0.5);
          const distance = Math.hypot(goalX - ball.position.x, z - ball.position.z);
          speed = clamp(distance * (0.5 + shot.power * 0.15), 9, 21);
          launchTo({ x: goalX, z: z + (random() - 0.5) * (0.6 + distance * 0.03) }, 1.5 + (random() - 0.3) * 0.8, speed * teamAbility, 'chip');
        } else {
          const aimed = aimShot({ ball: ball.position, direction, goalX, goalWidth: GOAL_WIDTH, goalHeight: GOAL_HEIGHT,
            power: shot.power, style: shot.style, accuracy: teamAbility * (controlledSprint ? 1.05 : 1), random });
          speed = aimed.speed;
          launchTo({ x: goalX, z: aimed.z }, aimed.height, speed * teamAbility, SHOT_STYLES[shot.style]?.spin || 'shot', -aimed.z || -ball.position.z || 1);
        }
        // The keeper needs a moment to read the strike.
        people[7].reactAt = elapsed + (0.2 + random() * 0.12) / difficulty.keeper;
      } else { ballVelocity.copy(direction.multiplyScalar(speed * teamAbility)); ballVelocity.y = lift; }
      sound.kick(Math.min(1, speed / 30));
      if (shot || kind === 'shot' || kind === 'powerShot' || kind === 'finesse' || name === 'chipShot') { lastShooter = controlled; lastShotAt = elapsed; say('shot', { who: who(controlled), team: hallName(true) }); }
      else if (kind === 'cross') say('cross', { team: hallName(true) });
      else if (name === 'goalkeeperPass' && passTarget >= 0) say('through', { who: who(passTarget), team: hallName(true) });
      const animation = { goalkeeperPass: 'pass', chipShot: 'chip', powerShot: 'kick' }[name] || name;
      lastTouchHome = true; action(person, animation, true);
      show(name === 'pass' ? 'PASS!' : name === 'goalkeeperPass' ? 'THROUGH BALL!' : name === 'chip' ? (crossing ? 'CROSS!' : 'LOFTED PASS!')
        : name === 'chipShot' ? 'CHIP SHOT!' : name === 'powerShot' ? 'POWER SHOT!' : shot?.style === 'finesse' || finesseHold ? 'FINESSE SHOT!'
        : shot?.style === 'low' ? 'LOW DRIVEN SHOT!' : 'SHOT!');
    }
    // The teammate a held ball would be thrown to: the one the player aims at,
    // otherwise the best-placed free teammate.
    function keeperThrowTarget(index = 0) {
      const keeper = people[index], direction = inputDirection();
      if (direction.lengthSq() > 0.01) {
        const aimed = pickPassTarget(people.map((p, i) => ({ index: i, home: p.home && !p.sentOff, keeper: p.keeper, x: p.motion.x, z: p.motion.z })),
          keeper.motion, direction.normalize(), index);
        if (aimed >= 0) return aimed;
      }
      const option = bestPassOption(point(index), team(keeper.home), team(!keeper.home, true), { x: -ownGoalX(keeper.home), width: GOAL_WIDTH },
        { minDistance: 5, maxDistance: 45 });
      return option ? option.index : nearestOf(keeper.home, keeper.motion.x, keeper.motion.z);
    }
    // mode: 'roll' (along the ground), 'throw' (overarm) or 'kick' (long punt).
    function keeperDistribute(index, mode, targetIndex, strength = 0.4) {
      const keeper = people[index], from = new THREE.Vector3(keeper.motion.x, 0, keeper.motion.z);
      const receiver = targetIndex >= 0 ? people[targetIndex] : null;
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
      const speed = mode === 'roll' ? clamp(6 + distance * 0.42, 8, 16) : mode === 'throw' ? clamp(9 + distance * 0.42 + strength * 3, 11, 21) : clamp(13 + distance * 0.3, 20, 27);
      const lift = mode === 'roll' ? 0.3 : mode === 'throw' ? clamp(1.8 + distance * 0.07, 2, 4.5) : clamp(4 + distance * 0.11, 6, 10);
      ball.position.set(from.x + direction.x * 0.7, mode === 'throw' ? 1.6 : 0.35, from.z + direction.z * 0.7);
      ballVelocity.copy(direction).multiplyScalar(speed); ballVelocity.y = lift;
      spinBall(mode === 'kick' ? spinFor('chip', direction) : undefined);
      keeperHolding = -1; throwHold = false; power = 0; targetRing.visible = false; setKeeperBall(false);
      controlLockUntil = elapsed + 0.3; awayKickUntil = elapsed + 0.3; lastTouchHome = keeper.home;
      if (keeper.home) { passTarget = receiver ? targetIndex : -1; passDestination = receiver ? destination.clone() : null; passDeadline = elapsed + 4; }
      else { awayPassTarget = receiver ? targetIndex : -1; awayPassDestination = receiver ? destination.clone() : null; awayPassDeadline = elapsed + 4; }
      action(keeper, mode === 'kick' ? 'kick' : 'goalkeeperPass', true);
      sound.kick(mode === 'kick' ? 0.8 : 0.2);
      if (keeper.home) show(mode === 'kick' ? 'LONG KICK' : 'THROW', 0.8);
    }
    function keeperPutDown() {
      const keeper = people[0], forward = forwardFromHeading(keeper.motion.heading);
      keeperHolding = -1; throwHold = false; power = 0; targetRing.visible = false; setKeeperBall(false);
      ball.position.set(keeper.motion.x + forward.x * 0.6, BALL_RADIUS, keeper.motion.z + forward.z * 0.6);
      ballVelocity.set(0, 0, 0); spinBall(); possessor = 0; controlLockUntil = elapsed; show('BALL DOWN', 0.8);
    }
    // A computer player plays the ball: 'pass', 'through', 'cross' or 'shoot'.
    function cpuPlay(index, kind, target) {
      const person = people[index], attack = person.home ? 1 : -1;
      const from = ball.position.clone().setY(0);
      let destination, speed, lift, spin;
      if (kind === 'shoot') {
        destination = new THREE.Vector3(target.x, 0, target.z);
        const distance = destination.distanceTo(from);
        speed = (19 + random() * 6) * difficulty.shot;
        const flight = distance / speed * 1.12; // drag stretches the flight a little
        const height = target.high ? 1.6 + random() * 0.6 : 0.25 + random() * 0.4;
        lift = clamp((height + 4.905 * flight * flight) / flight, 0.2, 9);
      } else {
        const mate = people[target];
        destination = new THREE.Vector3(mate.motion.x, 0, mate.motion.z);
        if (kind === 'through') destination.add(new THREE.Vector3(mate.motion.vx * 0.9 + attack * 2.5, 0, mate.motion.vz * 0.9));
        // Keep the ball inside the pitch: a through ball must not run out of play.
        destination.x = clamp(destination.x, -LENGTH / 2 + 4, LENGTH / 2 - 4);
        destination.z = clamp(destination.z, -WIDTH / 2 + 3, WIDTH / 2 - 3);
        const distance = destination.distanceTo(from);
        if (kind === 'cross') { speed = clamp(distance * 0.62, 15, 25); lift = clamp(distance * 0.16, 4, 7); }
        else {
          // Weighted to arrive at a controllable pace: v0^2 = arrival^2 + 2 x deceleration x distance.
          const arrival = kind === 'through' ? 3 : 5;
          speed = clamp(Math.sqrt(arrival * arrival + 2 * 1.9 * distance), 7, 20); lift = 0.2;
        }
      }
      const direction = destination.clone().sub(from).normalize();
      spin = spinFor(kind === 'shoot' ? 'cpuShot' : kind === 'cross' ? 'cross' : 'pass', direction, -(ball.position.z || 1));
      spinBall(spin);
      ballVelocity.copy(direction).multiplyScalar(speed); ballVelocity.y = lift;
      if (person.home) { possessor = -1; passTarget = kind === 'shoot' ? -1 : target; passDestination = kind === 'shoot' ? null : destination; passDeadline = elapsed + 4; }
      else { awayCarrier = -1; awayPassTarget = kind === 'shoot' ? -1 : target; awayPassDestination = kind === 'shoot' ? null : destination; awayPassDeadline = elapsed + 4; }
      lastTouchHome = person.home; awayKickUntil = elapsed + (kind === 'shoot' ? 0.8 : 0.3); controlLockUntil = elapsed + 0.25;
      if (kind === 'shoot') people[person.home ? 7 : 0].reactAt = elapsed + 0.2 + random() * 0.12;
      if (kind === 'shoot') { events.awayShots++; lastShooter = index; lastShotAt = elapsed; say('shot', { who: who(index), team: hallName(person.home) }); }
      else if (kind === 'cross') say('cross', { team: hallName(person.home) });
      else if (kind === 'through') say('through', { who: who(target), team: hallName(person.home) });
      count(`cpu ${kind}`);
      action(person, kind === 'shoot' ? 'kick' : kind === 'cross' ? 'chip' : 'pass', true);
      sound.kick(kind === 'shoot' ? 0.85 : kind === 'cross' ? 0.6 : 0.35);
      restart = null;
    }
    // Corners, goal kicks and free kicks: the ball waits on its spot, the taker
    // stands behind it and the other side keeps its distance.
    function startRestart(type, home, spot) {
      possessor = -1; awayCarrier = -1; passTarget = -1; awayPassTarget = -1; keeperHolding = -1; setKeeperBall(false); targetRing.visible = false;
      if (type === 'freeKick' && insideBox(spot.x, spot.z, !home)) spot = { x: ownGoalX(!home) + (home ? -1 : 1) * (boxDepth + 0.8), z: spot.z };
      ball.position.set(spot.x, BALL_RADIUS, spot.z); ballVelocity.set(0, 0, 0); physics?.reset(ball.position, ballVelocity);
      const taker = type === 'goalKick' ? (home ? 0 : 7) : nearestOf(home, spot.x, spot.z);
      const goalAhead = -ownGoalX(home);
      const facing = type === 'corner' ? Math.atan2(-spot.z, goalAhead * 0.85 - spot.x) : type === 'freeKick' || type === 'penalty'
        ? Math.atan2(-spot.z * 0.5, goalAhead - spot.x) : (home ? 0 : Math.PI);
      const forward = forwardFromHeading(facing), p = people[taker];
      Object.assign(p.motion, { x: spot.x - forward.x * 0.7, z: spot.z - forward.z * 0.7, vx: 0, vz: 0, heading: facing });
      p.mesh.position.set(p.motion.x, 0, p.motion.z); p.mesh.rotation.y = meshYawForHeading(facing); idle(p);
      restart = { type, home, spot: { ...spot }, taker, readyAt: elapsed + (type === 'penalty' ? 3 : 1.4), autoAt: elapsed + 10 };
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
      if (type === 'corner') say('corner', { team: hallName(home) });
      else if (type === 'goalKick') say(elapsed - lastShotAt < 3 ? 'wide' : 'goalKick', { team: hallName(home) });
      else if (type === 'freeKick' && goalDistance < 26) say('freeKickNear', { team: hallName(home) });
      else if (type === 'penalty') say('penalty', { team: hallName(home) });
      count(type);
      lastTouchHome = home; controlLockUntil = elapsed + 0.4;
      if (home) { controlled = taker; setSelectedPlayer(taker + 1); possessor = taker; }
      // Facing a penalty you are the keeper: the stick picks your dive.
      else if (type === 'penalty') { controlled = 0; setSelectedPlayer(1); manualKeeper = true; penaltyDive = 0; }
      if (type === 'penalty') { sound.whistle('long'); count('penalties'); }
      show(type === 'corner' ? 'CORNER' : type === 'goalKick' ? 'GOAL KICK' : type === 'penalty' ? 'PENALTY!' : 'FREE KICK', 1.6);
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
        keeperGuess(home ? 7 : 0, home ? null : penaltyDive);
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
    // A tackle from behind is usually a foul: free kick to the fouled side.
    const fromBehind = (tackler, carrier) => {
      const forward = forwardFromHeading(carrier.motion.heading);
      const dx = tackler.motion.x - carrier.motion.x, dz = tackler.motion.z - carrier.motion.z;
      return (forward.x * dx + forward.z * dz) / (Math.hypot(dx, dz) || 1) < -0.35;
    };
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
    // the player on the ground for seconds; from behind it is usually a red).
    function tackle(move = 'tackle', style = 'standing') {
      if (keeperHolding >= 0) return;
      const player = people[controlled];
      if (elapsed < player.nextTackleAt || sliding || elapsed < (player.downUntil || 0)) return;
      const slide = style === 'slide';
      player.nextTackleAt = elapsed + (slide ? 1.5 : style === 'hard' ? 1.1 : 0.85);
      if (slide) {
        action(player, 'tackleAlternate', true); player.actionUntil = elapsed + 0.9;
        const forward = forwardFromHeading(player.motion.heading);
        player.motion.vx = forward.x * 7.5; player.motion.vz = forward.z * 7.5;
        slideUntil = elapsed + 0.75; sliding = player;
        challenge(player, style);
        return;
      }
      action(player, 'pass', true); // the short swing of a foot poked at the ball
      if (!challenge(player, style)) { player.stumbleUntil = elapsed + 0.45; } // missed: a stumble, then on again
    }
    // One attempt to win the ball. A slide keeps trying while the lunge
    // travels (see simulate), so it reaches a carrier a few metres away.
    // Returns true once the challenge is decided.
    function challenge(player, style) {
      const slide = style === 'slide', hard = style === 'hard';
      let reach = player.mesh.position;
      if (slide) {
        const forward = forwardFromHeading(player.motion.heading);
        reach = player.mesh.position.clone().add(new THREE.Vector3(forward.x * 0.9, 0, forward.z * 0.9));
      }
      const carrier = awayCarrier >= 0 ? people[awayCarrier] : null;
      if (!slide && carrier && shoulderToShoulder(player, carrier)) {
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
      const foulChance = slide ? 0.9 : hard ? 0.65 : 0.45;
      const onBall = awayCarrier === people.indexOf(opponent) || opponent.mesh.position.distanceTo(ball.position) < 1.25;
      if (onBall && fromBehind(player, opponent) && random() < foulChance) {
        // From behind: a slide is almost always a red card; a hard tackle often a booking.
        const card = slide ? (random() < 0.85 ? 'red' : 'yellow') : hard ? (random() < 0.3 ? 'yellow' : null) : random() < 0.08 ? 'yellow' : null;
        foul(false, opponent, player, card); return true;
      }
      if (hard && random() < 0.12) { foul(false, opponent, player); return true; } // even from the front, a hard tackle can be late
      if (onBall) { winBall(opponent, true); return true; }
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
      if (knockedDown) { action(opponent, 'fallen', true); opponent.actionUntil = elapsed + 1.1; }
      else { opponent.actionUntil = elapsed + 0.4; }
      ballVelocity.set(3, 0.15, (Math.random() - 0.5) * 2); spinBall();
      awayCarrier = -1; possessor = controlled; passTarget = -1; lastTouchHome = true; events.tackles++;
      if (knockedDown) show('TACKLE!');
      say('tackle', { who: who(controlled), team: hallName(true) });
    }
    function pressAction(key) {
      if (key === 'shift') { touchSprint = true; return; }
      if (pausedLocal) return;
      if (setPiece && (key === 'k' || key === 'l' || key === 'j')) {
        if (setPiece.phase === 'aim') { setPiece.phase = 'charge'; setPiece.button = key; power = 0; }
        else if (setPiece.phase === 'runup' && key === 'k' && setPiece.button === 'k' && setPiece.timing === null) setPiece.timing = elapsed - setPiece.strikeAt;
        return;
      }
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
      if (key === 'j') { if (people[controlled].mesh.position.distanceTo(ball.position) < 1.65) kick(13, 'pass'); else tackle(); }
      if (key === 'i') kick(17, 'goalkeeperPass', 0.15);
      if (key === 'k') {
        if (pendingShot) { if (pendingShot.style === 'normal') pendingShot.style = 'low'; return; } // second tap: low driven
        if (!lastTouchHome || people[controlled].mesh.position.distanceTo(ball.position) > 1.65) tackle(); else { shootHold = true; power = 0; }
      }
      if (key === 'l') { lobHold = true; power = 0; } // ◯ is power-sensitive: released in releaseAction
      if (key === 'p') kick(24, 'penaltyKick', 1.5);
      if (key === 'o') action(people[controlled], 'spin', true);
      if (key === 'u') tackle('tackleAlternate', 'slide');
    }
    function releaseAction(key) {
      if (key === 'shift') { touchSprint = false; return; }
      if (setPiece) {
        if (setPiece.phase === 'charge' && key === setPiece.button) {
          setPiece.phase = 'runup'; setPiece.power = power; setPiece.strikeAt = elapsed + 0.7; power = 0;
          action(people[controlled], 'jog', false);
        }
        if (key === 'k' || key === 'l' || key === 'j') return;
      }
      if (key === 'j' && throwHold) {
        throwHold = false;
        if (keeperHolding === 0 && !pausedLocal) keeperDistribute(0, power < 0.25 ? 'roll' : 'throw', keeperTarget >= 0 ? keeperTarget : keeperThrowTarget(), power);
        power = 0; return;
      }
      if (key === 'h') { shieldHold = false; return; }
      if (key === 'f') { finesseHold = false; return; }
      if (key === 't') { teammateContain = false; return; }
      if (key === 'v') { jockeyHold = false; return; }
      if (key === 'g') { keeperRushHold = false; return; }
      if (key === 'l' && lobHold) {
        lobHold = false;
        if (!pausedLocal) kick(18, 'chip', 3.5, null, { power, goalKick: restart?.type === 'goalKick' });
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
      if (key === 'escape' || key === ' ') { if (!event.repeat) state.togglePause(); return; }
      keys.add(key);
      if (!event.repeat) { const actionKey = keyboardAction(key); if (actionKey) { heldKeys.set(key, actionKey); pressAction(actionKey); } }
    }
    function keyup(event) {
      const key = event.key.toLowerCase(); keys.delete(key);
      const actionKey = heldKeys.get(key); heldKeys.delete(key); if (actionKey) releaseAction(actionKey);
    }
    function blur() { keys.clear(); heldKeys.clear(); touchAxis.x = 0; touchAxis.z = 0; touchSprint = false; shieldHold = false; shootHold = false; lobHold = false; finesseHold = false; teammateContain = false; jockeyHold = false; keeperRushHold = false; }
    const unlockSpeech = () => commentary.unlock();
    window.addEventListener('pointerdown', unlockSpeech, { once: true }); window.addEventListener('keydown', unlockSpeech, { once: true });
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
      const attacking = lastTouchHome;
      // Held controls: applied when they start or stop, so the keyboard keeps working too.
      const want = !snapshot ? {} : attacking ? {
        sprint: b.r1 || b.r2, controlledSprint: b.r2 && !b.r1, shield: b.l2, strafe: b.l1,
      } : {
        sprint: b.r2, jockey: b.l2, sprintJockey: b.l2 && b.r2, contain: b.cross, teammate: b.r1, rush: b.triangle,
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
      kickoffHome = home; nextKickoffHome = true; slideUntil = 0; sliding = null; pendingShot = null; setPiece = null;
      people.forEach(person => {
        person.downUntil = 0; person.getUpAt = 0;
        if (person.sentOff) return;
        person.mesh.position.set(person.spawn[0], 0, person.spawn[1]);
        Object.assign(person.motion, { x: person.spawn[0], z: person.spawn[1], vx: 0, vz: 0,
          heading: person.home ? 0 : Math.PI });
        person.mesh.rotation.y = meshYawForHeading(person.motion.heading);
        person.nextTackleAt = 0; person.nextSaveAt = 0; person.saveUntil = 0; person.actionUntil = 0; person.mesh.rotation.x = 0;
        idle(person);
      });
      ball.position.set(0, BALL_RADIUS, 0); ballVelocity.set(0, 0, 0);
      controlled = [5, 6, 4, 3, 2, 1].find(i => !people[i].sentOff) ?? 0; awayCarrier = -1; awayKickUntil = 0; controlLockUntil = 0; keeperHolding = -1;
      // The kicking-off forward stands at the centre spot, behind the ball.
      const takerIndex = [5, 6, 4, 3, 2, 1].map(i => home ? i : i + 7).find(i => !people[i].sentOff), taker = people[takerIndex];
      Object.assign(taker.motion, { x: home ? -0.8 : 0.8, z: 0 });
      taker.mesh.position.set(taker.motion.x, 0, 0);
      possessor = home ? takerIndex : -1; awayCarrier = home ? -1 : takerIndex; kickoffTakeAt = elapsed + 1.4;
      ball.position.set(home ? -0.25 : 0.25, BALL_RADIUS, 0); setSelectedPlayer(controlled + 1); resetAt = 0; passTarget = -1;
      kickoffGraceUntil = elapsed + (home ? difficulty.kickoffGrace : 0); cutCamera = true;
      restart = null; awayPassTarget = -1; throwHold = false; targetRing.visible = false; setKeeperBall(false);
      kickoffWaiting = true;
      people.forEach(person => { person.nextDecisionAt = 0; person.dribbleDir = null; });
      physics?.reset(ball.position, ballVelocity);
      sound.whistle('short');
    }
    function goal(homeScored) {
      setScore(previous => homeScored ? [previous[0] + 1, previous[1]] : [previous[0], previous[1] + 1]);
      show('GOAL!', 2.2); goalCooldown = 2.5; resetAt = elapsed + 2.2; sound.goal(); feel('goal', 0.08); count(homeScored ? 'goals home' : 'goals away');
      nextKickoffHome = !homeScored; // the side that conceded kicks off
      goals[homeScored ? 0 : 1]++;
      const scorer = lastShooter >= 0 && people[lastShooter].home === homeScored ? who(lastShooter) : '';
      say('goal', { team: hallName(homeScored), who: scorer, score: scoreLine(hallName(true), hallName(false), goals) });
      // The scorer and the nearest teammate celebrate; everyone else waits.
      const scorers = people.filter(p => p.home === homeScored && !p.keeper)
        .sort((a, b) => a.mesh.position.distanceToSquared(ball.position) - b.mesh.position.distanceToSquared(ball.position)).slice(0, 2);
      for (const person of scorers) action(person, 'celebration', true);
    }
    function boundary() {
      if (keeperHolding >= 0 || resetAt || restart) return;
      if (Math.abs(ball.position.z) > WIDTH / 2) {
        possessor = -1; awayCarrier = -1; passTarget = -1;
        const z = Math.sign(ball.position.z) * (WIDTH / 2 - 0.2);
        ball.position.z = z; ballVelocity.set(lastTouchHome ? -7 : 7, 1.6, -Math.sign(z) * 6); spinBall();
        const thrower = people.find(person => person.home !== lastTouchHome && !person.keeper && !person.sentOff);
        if (thrower) action(thrower, 'throwIn', true);
        show('THROW IN'); lastTouchHome = !lastTouchHome;
        say('throwIn', { team: hallName(lastTouchHome) });
      }
      if (Math.abs(ball.position.x) <= LENGTH / 2) return;
      possessor = -1; awayCarrier = -1; passTarget = -1;
      const side = Math.sign(ball.position.x);
      if (Math.abs(ball.position.x) < LENGTH / 2 + BALL_RADIUS && Math.abs(ball.position.z) < GOAL_WIDTH / 2) return; // not wholly over the line yet
      if (Math.abs(ball.position.z) < GOAL_WIDTH / 2 && ball.position.y < GOAL_HEIGHT && goalCooldown <= 0) { goal(side > 0); return; }
      // Over the goal line: a corner if the defending side touched it last,
      // otherwise a goal kick to them.
      const defendingHome = side < 0, cornerSide = Math.sign(ball.position.z) || 1;
      if (lastTouchHome === defendingHome) startRestart('corner', !defendingHome, { x: side * (LENGTH / 2 - 0.4), z: cornerSide * (WIDTH / 2 - 0.4) });
      else startRestart('goalKick', defendingHome, { x: side * (LENGTH / 2 - sixDepth), z: cornerSide * sixHalfWidth * 0.6 });
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
      const header = people.find(person => !person.keeper && !person.sentOff && elapsed >= (person.nextHeaderAt || 0)
        && Math.hypot(person.motion.x - ball.position.x, person.motion.z - ball.position.z) < 0.85
        && insideBox(person.motion.x, person.motion.z, !person.home));
      if (!header) return;
      const index = people.indexOf(header), goalX = header.home ? LENGTH / 2 : -LENGTH / 2;
      header.nextHeaderAt = elapsed + 1;
      const z = (random() < 0.5 ? -1 : 1) * (GOAL_WIDTH / 2 - 0.7) + gaussian(random) * 1.1;
      launchTo({ x: goalX, z }, 0.35 + random() * 1.5, (13 + random() * 4) * (header.home ? teamAbility : difficulty.shot), 'pass');
      action(header, 'headerBall', true); sound.kick(0.4);
      possessor = -1; awayCarrier = -1; passTarget = -1; awayPassTarget = -1; lastTouchHome = header.home;
      controlLockUntil = elapsed + 0.25; awayKickUntil = elapsed + 0.3;
      people[header.home ? 7 : 0].reactAt = elapsed + 0.18 + random() * 0.1;
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
      const ability = person.home ? teamAbility : difficulty.keeper;
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
    function simulate(dt) {
      if (!pausedLocal) {
        elapsed += dt; goalCooldown = Math.max(0, goalCooldown - dt);
        if (messageUntil && elapsed > messageUntil) { setMessage(''); messageUntil = 0; }
        if (shootHold || throwHold || lobHold || setPiece?.phase === 'charge') power = Math.min(1, power + dt / 1.2);
        if (pendingShot && elapsed >= pendingShot.at) {
          const { power: strength, style } = pendingShot; pendingShot = null;
          if (style === 'chip') kick(0, 'chipShot', 0, { power: strength, style });
          else kick(0, style === 'power' ? 'powerShot' : strength > 0.8 ? 'scissor' : 'kick', 0, { power: strength, style });
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
            if (challenge(slider, 'slide')) { sliding = null; slider.downUntil = elapsed + 0.5; }
            else if (elapsed >= slideUntil - 0.3) {
              // Missed: left lying on the grass, out of the play for seconds.
              sliding = null; slider.downUntil = elapsed + 2.4;
              action(slider, 'fallen', true); slider.actionUntil = elapsed + 1.8; slider.getUpAt = elapsed + 1.8;
            }
          }
          if (elapsed < (active.downUntil || 0)) movement.set(0, 0, 0);
          for (const person of people) if (person.getUpAt && elapsed >= person.getUpAt) { person.getUpAt = 0; action(person, 'stand', true); }
          let activeSpeed = 0;
          if (takingRestart && (restart.type === 'corner' || restart.type === 'freeKick' || restart.type === 'penalty')) {
            if (!setPiece) beginSetPiece();
            const r = setPiece.reticle, spot = restart.spot;
            const ahead = new THREE.Vector3(r.x - spot.x, 0, r.z - spot.z).normalize();
            if (setPiece.phase !== 'runup') {
              // Left stick: up and down are away from and toward the camera, which sits behind the ball.
              const sideways = direction.x, upward = -direction.z;
              if (setPiece.mode === 'shot') {
                r.z = clamp(r.z + sideways * Math.sign(ahead.x || 1) * 3 * dt, -GOAL_WIDTH / 2 - 1.5, GOAL_WIDTH / 2 + 1.5);
                r.y = clamp(r.y + upward * 1.8 * dt, 0.25, GOAL_HEIGHT + 0.8);
              } else {
                r.x = clamp(r.x + (-ahead.z * sideways + ahead.x * upward) * 11 * dt, -LENGTH / 2 + 1, LENGTH / 2 - 0.5);
                r.z = clamp(r.z + (ahead.x * sideways + ahead.z * upward) * 11 * dt, -WIDTH / 2 + 1, WIDTH / 2 - 1);
              }
              active.motion.vx = 0; active.motion.vz = 0;
            } else {
              // The run-up: from a few strides back onto the ball.
              const left = Math.max(0, setPiece.strikeAt - elapsed) / 0.7;
              active.motion.x = spot.x - ahead.x * (0.55 + 1.75 * left); active.motion.z = spot.z - ahead.z * (0.55 + 1.75 * left);
              active.motion.vx = ahead.x * 2.5; active.motion.vz = ahead.z * 2.5;
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
          } else {
            activeSpeed = run(active, { x: movement.x, z: movement.z }, dt,
              { sprint: touchSprint && !strafing, keeper: controlled === 0 && manualKeeper, dribbling: possessor === controlled,
                ability: teamAbility * (controlledSprint && possessor === controlled ? 0.93 : 1) });
            // Strafe dribble keeps facing the goal; jockeying keeps facing the carrier.
            if (strafing) active.motion.heading = 0;
            else if (jockeyHold && carrierOpponent) active.motion.heading = Math.atan2(carrierOpponent.motion.z - active.motion.z, carrierOpponent.motion.x - active.motion.x);
          }
          if (!takingRestart) { // a corner taker stands outside the lines; a keeper may stand on his line
            const lineGap = active.keeper ? 0.2 : 1.5;
            active.motion.x = clamp(active.motion.x, -LENGTH / 2 + lineGap, LENGTH / 2 - lineGap);
            active.motion.z = clamp(active.motion.z, -WIDTH / 2 + 2, WIDTH / 2 - 2);
          }
          // Keep your distance at the opponents' set pieces.
          if (restart && !restart.home && !active.keeper) keepDistance(active.motion, restart);
          active.mesh.position.set(active.motion.x, 0, active.motion.z);
          active.mesh.rotation.y = meshYawForHeading(active.motion.heading);
          const ballGap = Math.hypot(active.mesh.position.x - ball.position.x, active.mesh.position.z - ball.position.z);
          if (!restart && keeperHolding < 0 && awayCarrier < 0 && elapsed >= controlLockUntil && ballGap < 1.05 && ball.position.y < 0.52 && ballVelocity.length() < 8 && passTarget < 0) {
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
            const marked = team(false).some(o => Math.hypot(o.x - target.motion.x, o.z - target.motion.z) < 3.5);
            targetRing.visible = true; targetRing.position.set(target.motion.x, 0.03, target.motion.z);
            targetRing.material.color.set(marked ? 0xff7a1a : 0xffc20e);
            if (elapsed - keeperHoldStart > 6) { show('6 SECONDS', 1); say('sixSeconds'); keeperDistribute(0, 'throw', keeperTarget, 0.3); }
          }
          // After the keeper releases the ball, hand control to an outfielder.
          if (manualKeeper && (lastTouchHome || keeperHolding >= 0)) manualKeeper = false;
          if (controlled === 0 && !manualKeeper && keeperHolding !== 0 && possessor !== 0 && !takingRestart && elapsed > controlLockUntil + 0.2) {
            const next = passTarget >= 0 ? passTarget : nearestOf(true, ball.position.x, ball.position.z);
            if (next >= 0) { controlled = next; setSelectedPlayer(next + 1); }
          }
          if (restart?.home && elapsed > restart.autoAt) { setPiece = null; show('QUICK RESTART', 0.8); kick(14, 'pass'); }
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
            .slice(0, 2).map(p => p.index);
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
          for (const [index, person] of people.entries()) {
            if (person.sentOff) { person.motion.x = 0; person.motion.z = WIDTH / 2 + 30; person.mesh.position.set(0, 0, WIDTH / 2 + 30); continue; }
            // Down after a missed slide tackle: out of the game for a moment.
            if (index !== controlled && elapsed < (person.downUntil || 0)) { person.motion.vx = 0; person.motion.vz = 0; continue; }
            if (index === controlled) {
              if (person.keeper && manualKeeper && keeperHolding < 0) updateKeeper(person, index, dt, true);
              continue;
            }
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
            const automaticRun = attacking && (person.role >= 5 || (person.role >= 3 && Math.sign(roleZ) !== Math.sign(ball.position.z)));
            const support = supportPosition(person.spawn, ball.position, { length: LENGTH, width: WIDTH },
              { home: person.home, attacking, run: automaticRun || (person.home && elapsed < runUntil), lane: Math.sign(roleZ), role: person.role });
            const carryingAway = awayCarrier === index;
            const destination = person.home ? passDestination : awayPassDestination;
            const receiving = (person.home ? passTarget === index : awayPassTarget === index) && destination;
            // Meet a slowing ground pass instead of waiting at an exact spot.
            // Stay in the receiving lane while a cross is still high overhead.
            const meetPass = receiving && ball.position.y < 0.85 && ball.position.distanceTo(destination) < 6;
            let targetX, targetZ;
            if (receiving) { targetX = meetPass ? ball.position.x + ballVelocity.x * 0.12 : destination.x; targetZ = meetPass ? ball.position.z + ballVelocity.z * 0.12 : destination.z; }
            else if (carryingAway) {
              const dir = person.dribbleDir || { x: -1, z: 0 };
              targetX = person.motion.x + dir.x * 5; targetZ = person.motion.z + dir.z * 5;
            } else if (press && possessor >= 0) {
              targetX = ball.position.x + active.motion.vx * 0.12 + (pressRank === 0 ? 0 : 1.4);
              targetZ = ball.position.z + active.motion.vz * 0.12 + (pressRank === 0 ? 0 : Math.sign(roleZ || 1) * 1.8);
            } else if (person.home && index === helper && settled) {
              // Contain: stand goal-side of the carrier, a stride off him.
              targetX = carrierAway.motion.x - 1.4; targetZ = carrierAway.motion.z * 0.92;
            } else if (chase) { targetX = ball.position.x + ballVelocity.x * 0.16; targetZ = ball.position.z + ballVelocity.z * 0.16; }
            else if (person.home && defending && marking.has(index)) { const mark = marking.get(index); targetX = mark.x; targetZ = mark.z; }
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
            const distance = delta.length();
            if (!person.moving && distance > 1.4) person.moving = true;
            else if (person.moving && distance < 0.5) person.moving = false;
            const speed = run(person, person.moving ? { x: delta.x, z: delta.z } : { x: 0, z: 0 }, dt,
              { sprint: chase || automaticRun || index === helper || restart?.type === 'corner' || (person.home && elapsed < runUntil), dribbling: carryingAway, ability: person.home ? teamAbility : difficulty.pace });
            person.mesh.position.set(person.motion.x, 0, person.motion.z);
            if (speed < 0.3) faceBall(person, dt);
            person.mesh.rotation.y = meshYawForHeading(person.motion.heading);
            moveAction(person, speed);
            // CPU tackles on your ball carrier; from behind they are often fouls.
            if (settled && press && possessor === controlled && elapsed >= person.nextTackleAt && elapsed >= kickoffGraceUntil
              && person.mesh.position.distanceTo(ball.position) < 1.5 && ball.position.y < 0.65) {
              person.nextTackleAt = elapsed + difficulty.tackleCooldown;
              action(person, 'tackle', true);
              if (fromBehind(person, active) && random() < difficulty.foul) { foul(true, active, person, random() < 0.15 ? 'yellow' : null); continue; }
              if (canWinTackle(person.mesh.position, active.mesh.position, ball.position, shieldHold)) {
                possessor = -1; awayCarrier = index; passTarget = -1; lastTouchHome = false;
                controlLockUntil = elapsed + 0.8; awayKickUntil = elapsed + 0.4;
                person.motion.heading = Math.PI; events.tackles++;
                ballVelocity.set(-3.8, 0, 0); spinBall(); show('TACKLED!');
                say('tackle', { who: who(index), team: hallName(false) });
              }
            }
            // Your teammates tackle too, and take control of the ball when they win it.
            if (settled && person.home && index === helper && carryingAwayTarget(person) && elapsed >= person.nextTackleAt) {
              person.nextTackleAt = elapsed + 1.6;
              action(person, 'tackle', true);
              const carrier = people[awayCarrier];
              if (fromBehind(person, carrier) && random() < 0.3) { foul(false, carrier); continue; }
              if (canWinTackle(person.mesh.position, carrier.mesh.position, ball.position) && random() < difficulty.teammateTackle) {
                action(carrier, 'fallen', true); carrier.actionUntil = elapsed + 1.1;
                awayCarrier = -1; controlled = index; possessor = index; lastTouchHome = true; events.tackles++;
                setSelectedPlayer(index + 1); spinBall(); show('TACKLE!');
                say('tackle', { who: who(index), team: hallName(true) });
              }
            }
            if (settled && awayCarrier < 0 && elapsed >= controlLockUntil && person.home && person.mesh.position.distanceTo(ball.position) < 1.1 && ball.position.y < 0.9 && ballVelocity.length() < 15 && (passTarget === index || possessor < 0)) {
              controlled = index; possessor = index; awayCarrier = -1; passTarget = -1;
              ballVelocity.multiplyScalar(0.16); lastTouchHome = true;
              setSelectedPlayer(index + 1); action(person, 'receive', true); show('PASS RECEIVED');
            }
            const awayReceiving = awayPassTarget === index;
            if (settled && !person.home && possessor < 0 && awayCarrier < 0 && elapsed > awayKickUntil && person.mesh.position.distanceTo(ball.position) < (awayReceiving ? 1.2 : 1.15)
              && ball.position.y < (awayReceiving ? 0.9 : 0.5) && ballVelocity.length() < (awayReceiving ? 16 : 7) && elapsed > person.actionUntil
              && !(shieldHold && people[controlled].mesh.position.distanceTo(ball.position) < 1.25)) {
              awayCarrier = index; lastTouchHome = false; possessor = -1; passTarget = -1; awayPassTarget = -1;
              if (awayReceiving) { ballVelocity.multiplyScalar(0.2); action(person, 'receive', true); }
              person.nextDecisionAt = elapsed + difficulty.reaction * 0.6;
            }
            if (awayCarrier === index) {
              const gap = Math.hypot(person.mesh.position.x - ball.position.x, person.mesh.position.z - ball.position.z);
              if (gap > 2 || ball.position.y > 0.8) awayCarrier = -1;
              else if (elapsed > awayKickUntil && elapsed >= (person.nextDecisionAt || 0)) {
                person.nextDecisionAt = elapsed + difficulty.reaction * (0.8 + random() * 0.4);
                const choice = decideCarrier({ carrier: point(index), teammates: team(false).filter(m => m.index !== index),
                  opponents: team(true, true), keeper: people[0].motion, goal: { x: -LENGTH / 2, width: GOAL_WIDTH },
                  field: { length: LENGTH, width: WIDTH }, skill: { range: difficulty.shotRange, accuracy: difficulty.accuracy }, random });
                if (choice.type === 'dribble') person.dribbleDir = choice.dir;
                else cpuPlay(index, choice.type, choice.type === 'shoot' ? choice.target : choice.index);
              }
            }
          }
          if (ball.position.y > 1.25) {
            const header = people.find(person => !person.keeper && keeperHolding < 0 && person.mesh.position.distanceTo(ball.position) < 1.3 && elapsed >= person.actionUntil);
            if (header) action(header, ballVelocity.length() > 3 ? 'headerBall' : 'header', true);
            attackingHeader();
          }
          if (physics) {
            const before = ballVelocity.clone();
            const next = physics.step(dt, ball.position, ballVelocity, people.map(person => person.mesh.position), keeperHolding >= 0 ? keeperHolding : possessor >= 0 ? possessor : awayCarrier);
            ball.position.set(next.position.x, next.position.y, next.position.z);
            ballVelocity.set(next.velocity.x, next.velocity.y, next.velocity.z);
            ball.quaternion.set(next.rotation.x, next.rotation.y, next.rotation.z, next.rotation.w);
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
          } else {
            const owner = possessor >= 0 ? possessor : awayCarrier;
            if (owner >= 0) {
              const carrier = people[owner];
              const carried = carryBall(ball.position, carrier.motion, dt, owner === controlled && touchSprint && !controlledSprint);
              ball.position.set(carried.x, carried.y, carried.z);
              ballVelocity.set(carrier.motion.vx, 0, carrier.motion.vz);
            }
          }
          if (passTarget >= 0 && keeperHolding < 0) {
            if (elapsed > passDeadline || !lastTouchHome) passTarget = -1;
            else if (ball.position.y < 0.85 && people[passTarget].mesh.position.distanceTo(ball.position) < 1.15) {
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
          boundary();
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
        if (elapsed - lastHUD >= 1) { lastHUD = elapsed; setSeconds(previous => Math.max(0, previous - 1)); }
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
        goalEffects: () => Object.values(goalsBySide).map(g => ({ side: g.side, rippling: Boolean(g.ripple), shaking: Boolean(g.shake), frameOffset: g.frame.position.toArray() })),
        snapshot: () => ({ elapsed, possessor, awayCarrier, keeperHolding, passTarget, passDestination: passDestination?.toArray(), setPiece: setPiece && { phase: setPiece.phase, mode: setPiece.mode, reticle: setPiece.reticle.toArray(), button: setPiece.button, gesture: setPiece.gesture.join('') }, controlled, lastTouchHome, manualKeeper, playerLock, restart: restart && { ...restart }, started: ready.started,
          physicsReady: Boolean(physics), clipsLoaded: Object.keys(clips).length, events: { ...events },
          ball: ball.position.toArray(), velocity: ballVelocity.toArray(),
          players: people.map(p => ({ x: p.motion.x, z: p.motion.z, heading: p.motion.heading, home: p.home,
            keeper: p.keeper, action: p.actionName, yaw: p.mesh.rotation.y, actionUntil: p.actionUntil })) }),
        step: (seconds) => { const wasPaused = pausedLocal; pausedLocal = false; for (let i = 0; i < Math.round(seconds * 60); i++) simulate(1 / 60); pausedLocal = wasPaused; },
        aim: direction => { aimOverride = direction; },
        restart: (type, home, spot) => startRestart(type, home, spot),
        foul: (fouledHome, x, z) => { ball.position.set(x, BALL_RADIUS, z); foul(fouledHome, null); },
        shoot: (strength, style = 'normal') => { const wasPaused = pausedLocal; pausedLocal = false; pendingShot = { power: strength, style, at: elapsed }; simulate(1 / 60); pausedLocal = wasPaused; },
        tackle: style => tackle(style === 'slide' ? 'tackleAlternate' : 'tackle', style),
        press: key => { const wasPaused = pausedLocal; pausedLocal = false; pressAction(key); pausedLocal = wasPaused; },
        release: key => { const wasPaused = pausedLocal; pausedLocal = false; releaseAction(key); pausedLocal = wasPaused; },
        scenario: ({ ball: position, velocity = [0, 0, 0], owner = -1, players = [], seed = 1, touch }) => {
          people.forEach(p => { p.sentOff = false; p.yellows = 0; p.mesh.visible = true; }); // each test starts with a full side
          reset(); keeperHolding = -1; random = createRandom(seed); kickoffWaiting = false; possessor = owner >= 0 && people[owner].home ? owner : -1;
          awayCarrier = owner >= 0 && !people[owner].home ? owner : -1;
          lastTouchHome = touch ?? (owner < 0 ? velocity[0] > 0 : people[owner].home);
          for (const { index, x, z, heading } of players) {
            const p = people[index]; Object.assign(p.motion, { x, z, vx: 0, vz: 0, heading: heading ?? (p.home ? 0 : Math.PI) });
            p.mesh.position.set(x, 0, z); p.actionUntil = 0;
          }
          ball.position.fromArray(position); ballVelocity.fromArray(velocity); physics?.reset(ball.position, ballVelocity);
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
    // speed on every device. Animation and the camera use the frame time.
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
      const frameDt = Math.min(clock.getDelta(), 0.25);
      pollGamepad();
      accumulator += frameDt;
      let steps = 0;
      while (accumulator >= SIM_DT && steps < MAX_SIM_STEPS) { simulate(SIM_DT); accumulator -= SIM_DT; steps++; }
      if (steps === MAX_SIM_STEPS) accumulator = 0;
      if (!pausedLocal) for (const mixer of mixers) mixer.update(frameDt);
      adaptQuality(frameDt);
      updateRadar();
      updateSetPieceView();
      marker.visible = !setPieceCam; // the over-the-head marker would fill a set-piece close-up
      const phase = setPiece ? 'setPiece' : restart?.type === 'penalty' && !restart.home ? 'penaltyKeeper' : lastTouchHome ? 'attack' : 'defend';
      if (phase !== shownPhase) { shownPhase = phase; setPadPhase(phase); }
      if (powerMeter.current) {
        const charging = shootHold || throwHold || lobHold || setPiece?.phase === 'charge';
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
      const target = holdingView ? people[0].mesh.position.clone().lerp(targetRing.position, 0.5)
        : restart ? new THREE.Vector3(restart.spot.x * 0.8, 0, restart.spot.z) : people[controlled].mesh.position;
      // Set pieces get their own camera, as in EA FC: low behind the taker for
      // a free kick in range, low beside the taker for a corner. Goal kicks and
      // long free kicks stay in the match camera. After the kick it watches
      // the ball for a moment, then cuts back.
      const pieceInView = restart && !resetAt && (restart.type === 'corner'
        || restart.type === 'penalty' || (restart.type === 'freeKick' && Math.hypot(-ownGoalX(restart.home) - restart.spot.x, restart.spot.z) < 32)) ? restart : null;
      if (pieceInView && (!setPieceCam || setPieceCam.until !== Infinity)) { setPieceCam = { piece: pieceInView, until: Infinity }; cutCamera = true; }
      if (!pieceInView && setPieceCam?.until === Infinity) setPieceCam.until = elapsed + 1.2;
      if (setPieceCam && (elapsed >= setPieceCam.until || resetAt)) { setPieceCam = null; cutCamera = true; }
      // Cut straight to the new shot after kickoff resets instead of panning.
      const follow = cutCamera ? 1 : 1 - Math.exp(-3.1 * dt);
      cutCamera = false;
      if (setPieceCam) {
        const { spot, home, type } = setPieceCam.piece, goalX = -ownGoalX(home);
        const aimAt = setPiece ? setPiece.reticle : type === 'corner' ? { x: goalX - Math.sign(goalX) * 6, z: 0 } : { x: goalX, z: 0 };
        const ahead = new THREE.Vector3(aimAt.x - spot.x, 0, aimAt.z - spot.z).normalize();
        const position = type === 'corner'
          ? new THREE.Vector3(spot.x - ahead.x * 5 + Math.sign(goalX) * 1.2, 3.3, spot.z - ahead.z * 5 + Math.sign(spot.z) * 1.2)
          : new THREE.Vector3(spot.x - ahead.x * 5.2 - ahead.z * 1.1, 2.5, spot.z - ahead.z * 5.2 + ahead.x * 1.1); // over the shoulder
        cam.position.lerp(position, follow > 0.99 ? 1 : 1 - Math.exp(-5 * dt));
        if (setPieceCam.until === Infinity) {
          const look = type === 'corner' ? new THREE.Vector3(aimAt.x, 0.6, aimAt.z) : new THREE.Vector3(spot.x + ahead.x * 12, 1.1, spot.z + ahead.z * 12);
          cameraFocus.copy(look);
        } else cameraFocus.lerp(ball.position, 1 - Math.exp(-6 * dt));
        cam.lookAt(cameraFocus);
      } else if (cameraMode === 'Behind player') {
        cam.position.lerp(new THREE.Vector3(target.x - 9, 5.5, target.z + 3.2), follow);
        cam.lookAt(target.x + 9, 1.1, target.z);
      } else if (cameraMode === 'Wide') {
        const focusX = THREE.MathUtils.clamp(ball.position.x + ballVelocity.x * 0.2, -LENGTH * 0.35, LENGTH * 0.35);
        cameraFocus.lerp(new THREE.Vector3(focusX, 0, WIDTH * 0.2 + ball.position.z * 0.15), follow);
        cam.position.lerp(new THREE.Vector3(cameraFocus.x, WIDTH * 0.62, cameraFocus.z + WIDTH * 0.72), follow);
        cam.lookAt(cameraFocus.x, 0.8, cameraFocus.z);
      } else {
        // Broadcast camera on a gantry beyond the near touchline, high enough
        // that both touchlines stay in view: nobody is ever behind the camera.
        // It follows play along the pitch and leans a little toward the ball.
        const attackingThird = Math.abs(ball.position.x) / (LENGTH / 2);
        const zoom = THREE.MathUtils.lerp(1, 0.92, THREE.MathUtils.smoothstep(attackingThird, 0.55, 0.95));
        const lead = THREE.MathUtils.clamp(ballVelocity.x * 0.24, -4, 4);
        const framing = holdingView || restart;
        const focusX = THREE.MathUtils.clamp(framing ? target.x : ball.position.x * 0.8 + target.x * 0.2 + lead, -LENGTH / 2 + 8, LENGTH / 2 - 8);
        const focusZ = WIDTH * 0.25 + THREE.MathUtils.clamp((framing ? target.z : ball.position.z) * 0.3, -WIDTH * 0.15, WIDTH * 0.15);
        cameraFocus.lerp(new THREE.Vector3(focusX, 0, focusZ), follow);
        const narrow = cam.aspect < 1.2 ? 1.3 : 1; // portrait screens step further back
        cam.position.lerp(new THREE.Vector3(cameraFocus.x, WIDTH * 0.47 * zoom * narrow, cameraFocus.z + WIDTH * 0.6 * zoom * narrow), follow);
        cam.lookAt(cameraFocus.x, 0.9, cameraFocus.z);
      }
      updateGoalEffects();
      if (cameraShake) {
        // Felt on every device: a short, fading shake of the view.
        const t = elapsed - cameraShake.at, amount = cameraShake.strength * Math.exp(-t / 0.18);
        if (t > 0.8) cameraShake = null;
        else cam.position.add(new THREE.Vector3(Math.sin(t * 83) * amount, Math.sin(t * 61 + 1) * amount, Math.sin(t * 71 + 2) * amount * 0.6));
      }
      renderer.render(scene, cam);
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
          part.castShadow = true; part.receiveShadow = true;
          const name = part.name.toLowerCase();
          if (name.includes('shirt') || name.includes('socks')) part.material = material(person.keeper ? (person.home ? '#ffd54f' : '#9c66ed') : person.home ? kits.home : kits.away);
          else if (name.includes('shorts')) part.material = material(person.home ? '#184b34' : '#262c38');
          else if (name.includes('body')) part.material = material('#8c5d3d');
          else if (name.includes('hair')) part.material = material('#201d1b');
          else if (name.includes('shoes')) part.material = material('#252525');
        });
        person.mesh.clear(); person.mesh.add(skinned);
        person.visual = skinned;
        person.mixer = new THREE.AnimationMixer(skinned); mixers.push(person.mixer);
      }
      setModelStatus('');
      ready.model = true; updateLoading();
      const results = await Promise.allSettled(Object.entries(clipsToLoad).map(async ([name, file]) => {
        const motion = await loadAnimation(file);
        const source = [...motion.animations].sort((a, b) => b.duration - a.duration || b.tracks.length - a.tracks.length)[0];
        if (!source) throw new Error(`${file} has no clip`);
        const clip = source.clone(); // the root-motion edit below must not touch the shared clip
        for (const track of clip.tracks) {
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
      physics?.free(); sound.dispose(); commentary.stop(); clearTimeout(captionTimer);
      window.removeEventListener('pointerdown', unlockSpeech); window.removeEventListener('keydown', unlockSpeech);
      host.removeChild(renderer.domElement); renderer.dispose(); engine.current = null;
    };
  }, [config.home, config.away, config.formation, config.venueId, config.difficulty, cameraMode, kits.home, kits.away, isTouch, preferences.keyboard, preferences.gamepad]);

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
  return <div className={`game-shell ${isTouch ? 'touch-mode' : 'keyboard-mode'}`}>
    <div className="game-view" ref={mount}/>
    <div className="game-hud">
      {preferences.hud.player && <div className="player-indicator">CONTROLLED PLAYER #{selectedPlayer}<small>{venue.shortName} · {isTouch ? 'Drag joystick · landscape' : gamepadStatus || `${preferences.keyboardPreset === 'classic' ? 'Arrows' : 'WASD'} · gamepad ready`}</small></div>}
      {preferences.hud.score && <div className="scoreboard"><span style={{ background: kits.home, color: textOn(kits.home) }}>{homeName}</span><b>{score[0]}</b><div>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}<small>{half === 1 ? '1ST' : '2ND'} HALF</small></div><b>{score[1]}</b><span style={{ background: kits.away, color: textOn(kits.away) }}>{awayName}</span></div>}
      {preferences.hud.messages && message && <div className="game-message">{message}</div>}
      {preferences.hud.messages && modelStatus && <div className="model-status">{modelStatus}</div>}
      {preferences.hud.radar && <div className="radar" ref={radar}><div className="radar-mid"/>{Array.from({ length: 14 }, (_, index) => <i key={index} className={`dot ${index < 7 ? 'home' : 'away'}`}/>)}<i className="dot ball"/></div>}
      {preferences.hud.score && <div className="hud-bottom"><span>{homeName} <i/></span><span>{awayName} <i/></span></div>}
      {!isTouch && preferences.hud.hints && <div className="controls-hint">{keeperBall ? (gamepadStatus ? `KEEPER'S BALL · AIM: L · THROW: ${pad.cross} (HOLD = LONGER) · LONG KICK: ${pad.triangle} · PUT DOWN: ${pad.circle}` : keeperHint)
        : padPhase === 'penaltyKeeper' ? `PENALTY AGAINST YOU · HOLD ${gamepadStatus ? 'L' : preferences.keyboardPreset === 'classic' ? '← OR →' : 'A OR D'} LEFT OR RIGHT TO DIVE AT THE KICK · LET GO TO STAY CENTRAL`
        : padPhase === 'setPiece' ? (gamepadStatus
          ? `SET PIECE · L AIM · HOLD ${pad.square} SHOOT · ${pad.circle} CROSS · ${pad.cross} PASS · RUN-UP: R ↓↑ DIP · R HALF-CIRCLE CURL · R ↓↑↓ KNUCKLE · ${pad.square} AGAIN AT THE STRIKE = TIMED`
          : `SET PIECE · ${preferences.keyboardPreset === 'classic' ? 'ARROWS' : 'WASD'} AIM · HOLD ${keyLabel(preferences.keyboard.shoot)} SHOOT · ${keyLabel(preferences.keyboard.lob)} CROSS · ${keyLabel(preferences.keyboard.pass)} PASS · ${keyLabel(preferences.keyboard.shoot)} AGAIN AT THE STRIKE = TIMED`)
        : gamepadStatus ? (padPhase === 'attack'
          ? `${pad.cross} PASS · ${pad.triangle} THROUGH · ${pad.square} SHOOT · ${pad.circle} LOB · ${pad.r1} SPRINT · ${pad.l2} SHIELD · ${pad.r2}+${pad.square} FINESSE · ${pad.l1}+${pad.square} CHIP`
          : `${pad.square} TACKLE · ${pad.circle} SLIDE · ${pad.r1}+${pad.square} HARD TACKLE · ${pad.cross} CONTAIN · ${pad.l1} SWITCH · ${pad.l2} JOCKEY · ${pad.triangle} KEEPER RUSH`)
        : keyboardHint}</div>}
      {isTouch && keeperBall && <div className="controls-hint keeper-touch">KEEPER'S BALL · PASS: THROW (HOLD = LONGER) · SHOOT: LONG KICK · SWITCH: PUT DOWN</div>}
      <div className="power-meter" ref={powerMeter}><i/><span>POWER</span></div>
      {caption && <div className="commentary-caption" aria-live="polite">{caption}</div>}
      {preferences.hud.player && <div className="stamina-meter" ref={staminaMeter}><i/></div>}
    </div>
    {isTouch && <TouchControls engine={engine} settings={preferences.touch}/>}
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
