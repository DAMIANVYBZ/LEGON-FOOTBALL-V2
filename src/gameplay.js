import { RUN_PACE, MOVEMENT } from './movementConfig.js';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// The Mixamo player faces local +Z; heading is the world-space travel angle.
export const meshYawForHeading = heading => Math.PI / 2 - heading;
export const forwardFromHeading = heading => ({ x: Math.cos(heading), z: Math.sin(heading) });

// The whole ball must cross a line. If a fast diagonal ball crosses two
// boundaries in one step, the first crossing determines the restart.
export function pitchExit(from, to, field, radius = 0.11) {
  let first = null;
  for (const [axis, line, half] of [['x', 'goalLine', field.length / 2], ['z', 'touchline', field.width / 2]]) {
    const limit = half + radius;
    if (Math.abs(to[axis]) <= limit) continue;
    const side = Math.sign(to[axis]);
    const change = to[axis] - from[axis];
    const time = Math.abs(from[axis]) > limit ? 0 : clamp((side * limit - from[axis]) / change, 0, 1);
    if (first && first.time <= time) continue;
    first = { line, side, time, point: {
      x: from.x + (to.x - from.x) * time,
      y: from.y + (to.y - from.y) * time,
      z: from.z + (to.z - from.z) * time,
    } };
  }
  return first;
}

// Positions are metres and speeds are metres per second. The same movement
// model drives the human player and CPU players, so possession switches do not
// change how a footballer accelerates or turns.
//
// Speed changes along the line of travel (acceleration that fades towards top
// speed, firm braking) are separate from changes of direction, which are
// limited by a sideways-acceleration budget. Together they give a visible
// build-up of speed and a real turning circle at pace, where the old model
// reached top speed in a third of a second and turned on the spot.
// accelFactor and agilityFactor come from the player's attributes.
export function advancePlayer(state, input, dt, { sprint = false, dribbling = false, keeper = false, controlledSprint = false, ability = 1, speedLimit = Infinity, accelFactor = 1, agilityFactor = 1 } = {}) {
  const length = Math.hypot(input.x, input.z);
  const directionX = length > 0.001 ? input.x / length : 0;
  const directionZ = length > 0.001 ? input.z / length : 0;
  const pace = (keeper ? 4.8 : dribbling ? (sprint ? controlledSprint ? RUN_PACE.dribbleControlled : RUN_PACE.dribbleSprint : RUN_PACE.dribble) : sprint ? controlledSprint ? RUN_PACE.controlled : RUN_PACE.sprint : RUN_PACE.jog) * ability;
  const wantedSpeed = Math.min(pace * Math.min(1, length), Math.max(0, speedLimit));
  const wantedX = directionX * wantedSpeed;
  const wantedZ = directionZ * wantedSpeed;
  const speedNow = Math.hypot(state.vx, state.vz);
  const mode = keeper ? 'keeper' : sprint ? (controlledSprint ? 'controlled' : 'sprint') : 'jog';
  const agile = controlledSprint ? 'controlled' : sprint ? 'sprint' : 'normal';
  const braking = controlledSprint ? MOVEMENT.brake.controlled : MOVEMENT.brake.normal;
  const reverseBrake = controlledSprint ? MOVEMENT.reverse.controlled : MOVEMENT.reverse.normal;
  const standstillAccel = MOVEMENT.accel[mode] * accelFactor;
  const accelNow = standstillAccel * Math.max(MOVEMENT.accelFloor, 1 - speedNow / MOVEMENT.accelZeroAt);
  if (length < 0.05) {
    // No input: roll to a stop in a straight line.
    const slowed = Math.max(0, speedNow - MOVEMENT.idleBrake * dt);
    const scale = speedNow > 1e-9 ? slowed / speedNow : 0;
    state.vx *= scale; state.vz *= scale;
  } else if (speedNow <= 0.2) {
    // From (almost) rest: accelerate straight towards the wanted velocity.
    const differenceX = wantedX - state.vx, differenceZ = wantedZ - state.vz;
    const differenceLength = Math.hypot(differenceX, differenceZ);
    const change = standstillAccel * dt;
    const scale = differenceLength > change ? change / differenceLength : 1;
    state.vx += differenceX * scale; state.vz += differenceZ * scale;
  } else {
    const ux = state.vx / speedNow, uz = state.vz / speedNow;
    const differenceX = wantedX - state.vx, differenceZ = wantedZ - state.vz;
    const along = differenceX * ux + differenceZ * uz;
    const sideX = differenceX - along * ux, sideZ = differenceZ - along * uz;
    const reversing = state.vx * wantedX + state.vz * wantedZ < -0.1;
    const alongStep = along >= 0 ? Math.min(along, accelNow * dt) : Math.max(along, -(reversing ? reverseBrake : braking) * dt);
    const sideLength = Math.hypot(sideX, sideZ);
    const sideStep = Math.min(sideLength, MOVEMENT.lateral[agile] * agilityFactor * dt);
    state.vx += ux * alongStep + (sideLength > 1e-9 ? sideX / sideLength * sideStep : 0);
    state.vz += uz * alongStep + (sideLength > 1e-9 ? sideZ / sideLength * sideStep : 0);
  }
  state.x += state.vx * dt;
  state.z += state.vz * dt;
  const speed = Math.hypot(state.vx, state.vz);
  if (speed > 0.12) {
    const wantedHeading = Math.atan2(state.vz, state.vx);
    const difference = Math.atan2(Math.sin(wantedHeading - state.heading), Math.cos(wantedHeading - state.heading));
    const base = controlledSprint ? MOVEMENT.turn.controlled : MOVEMENT.turn.normal;
    const turnRate = base * agilityFactor * (1 - MOVEMENT.turn.speedLoss * clamp(speed / Math.max(pace, 1), 0, 1));
    state.heading += clamp(difference, -turnRate * dt, turnRate * dt);
  }
  return speed;
}

// Arrive at a receiving point instead of sprinting through it and turning
// back. Leave a margin below the movement model's braking acceleration.
export function receivingInput(delta, maxSpeed) {
  const distance = Math.hypot(delta.x, delta.z);
  if (distance < 0.08 || maxSpeed <= 0) return { x: 0, z: 0 };
  const speed = Math.min(maxSpeed, Math.sqrt(2 * 10 * distance), distance * 4);
  const scale = speed / (maxSpeed * distance);
  return { x: delta.x * scale, z: delta.z * scale };
}

export function canReceivePass(player, ball, velocity) {
  return Math.hypot(player.x - ball.x, player.z - ball.z) < 1.1
    && ball.y < 0.85 && Math.hypot(velocity.x, velocity.y, velocity.z) < 24;
}

export function supportPosition(spawn, ball, field, { home, attacking, run = false, lane = 0, role = 0, forwardRole = 5, offsideLine, line = -1 } = {}) {
  const attackSign = home ? 1 : -1;
  const forward = attacking ? (run ? 11 : 5) : -3;
  const crossing = attacking && Math.abs(ball.z) > field.width * 0.27 && attackSign * ball.x > field.length * 0.08;
  const attackingRole = role >= forwardRole;
  const boxRunX = attackSign * (field.length / 2 - (role % 2 ? 8 : 13));
  const boxRunZ = role % 2 ? 0 : Math.sign(ball.z) * Math.min(7, field.width * 0.13);
  const target = {
    x: clamp(crossing && attackingRole ? boxRunX : attacking && run
      ? ball.x + attackSign * (attackingRole ? 13 : 7)
      : spawn[0] + ball.x * (attacking ? 0.48 : 0.3) + attackSign * forward,
      -field.length / 2 + 2.5, field.length / 2 - 2.5),
    // Out of possession the whole block slides across towards the ball's side.
    z: clamp(crossing && attackingRole ? boxRunZ : spawn[1] + ball.z * (attacking ? 0.2 : 0.38) + lane * (attacking ? 2 : 1),
      -field.width / 2 + 2, field.width / 2 - 2),
  };
  if (!attacking && line >= 0) {
    // Defending lines stay goal-side of the ball: the back line well behind it, the midfield
    // screening just behind it; forwards may stay level to press the next pass. Near our own
    // goal the lines compress but keep at least 5 m between them instead of merging.
    const behind = line === 0 ? 9 : line === 1 ? 5 : -1;
    const floor = -field.length / 2 + 3 + line * 5;                 // depth, in our attacking direction
    const depth = Math.max(floor, Math.min(target.x * attackSign, ball.x * attackSign - behind));
    target.x = clamp(attackSign * depth, -field.length / 2 + 2.5, field.length / 2 - 2.5);
  }
  if (attacking && Number.isFinite(offsideLine)) {
    // Strikers hold the last line; supporting midfield runs arrive a few metres behind them.
    const margin = attackingRole || crossing ? 0.35 : 4;
    target.x = attackSign * Math.min(target.x * attackSign, offsideLine * attackSign - margin);
  }
  return target;
}

// Keep a stopped ball by the boots; allow a slightly longer touch at pace.
// Corrections are bounded in the moving player's frame, including sharp turns.
export function dribbleLead(player, sprint = false) {
  const speed = Math.hypot(player.vx || 0, player.vz || 0);
  return 0.38 + Math.min(1, speed / 7.2) * (sprint ? 0.24 : 0.12);
}

export function settleFirstTouch(ball, player, dt, sprint = false) {
  const forward = forwardFromHeading(player.heading), lead = dribbleLead(player, sprint);
  const targetX = player.x + forward.x * lead, targetZ = player.z + forward.z * lead;
  const dx = targetX - ball.x, dz = targetZ - ball.z, distance = Math.hypot(dx, dz);
  const correction = Math.min(distance * (1 - Math.exp(-24 * dt)), 6 * dt);
  const scale = distance > 0 ? correction / distance : 0;
  const x = ball.x + dx * scale, z = ball.z + dz * scale;
  const y = ball.y + clamp(0.11 - ball.y, -3 * dt, 3 * dt);
  return { x, y, z, settled: Math.hypot(targetX - x, targetZ - z) < 0.08 && Math.abs(y - 0.11) < 0.01 };
}

export function carryBall(ball, player, dt, sprint = false) {
  // Physics already advances the ball with its carrier's velocity. Only steer
  // the relative position here; never snap a turning ball across the player.
  return settleFirstTouch(ball, player, dt, sprint);
}

export function canWinTackle(defender, carrier, ball, shield = false) {
  const bodyGap = Math.hypot(defender.x - carrier.x, defender.z - carrier.z);
  const ballGap = Math.hypot(defender.x - ball.x, defender.z - ball.z);
  return ball.y < 0.65 && ballGap < 1.35 && bodyGap < 1.85 && (!shield || ballGap < 0.65);
}

// Predict the shot at the keeper's plane, rather than waiting for a ball to
// touch a capsule at ground level. Negative times mean the shot passed them.
export function keeperThreat(ball, velocity, keeper, home, ability = 1) {
  const sign = home ? -1 : 1;
  if (velocity.x * sign < 0.5) return null;
  const time = (keeper.x - ball.x) / velocity.x;
  if (time < -0.06 || time > 0.65) return null;
  const t = Math.max(0, time);
  const z = ball.z + velocity.z * t;
  const y = Math.max(0.11, ball.y + velocity.y * t - 4.905 * t * t);
  const lateral = Math.abs(z - keeper.z);
  if (y > 2.65 * ability || lateral > 0.85 + 6.5 * t * ability) return null;
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  return { time, z, y, dive: lateral > 0.65 || y > 1.9,
    result: speed < 14 * ability && lateral < 0.8 && y < 1.95 ? 'catch' : y > 1.7 ? 'punch' : 'parry' };
}

export function pickPassTarget(teammates, origin, aim, controlled, opponents = [], { maxDistance = 45, preferredDistance = 17 } = {}) {
  let best = -1, bestScore = -Infinity;
  for (const player of teammates) {
    if (!player.home || player.keeper || player.index === controlled) continue;
    const dx = player.x - origin.x, dz = player.z - origin.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 2 || distance > maxDistance) continue;
    const alignment = (dx * aim.x + dz * aim.z) / distance;
    if (alignment < 0.18) continue;
    // Among similarly aimed teammates prefer a free lane and an unmarked
    // receiver. Keep the penalty bounded so the stick still chooses the pass.
    let pressure = 0;
    for (const opponent of opponents) {
      const ox = opponent.x - origin.x, oz = opponent.z - origin.z;
      const along = (ox * dx + oz * dz) / (distance * distance);
      if (along > 0.05 && along < 0.95) {
        const gap = Math.hypot(ox - dx * along, oz - dz * along);
        pressure = Math.max(pressure, clamp((1.8 - gap) / 1.8, 0, 1));
      }
      const marked = Math.hypot(opponent.x - player.x, opponent.z - player.z);
      pressure = Math.max(pressure, clamp((2.4 - marked) / 2.4, 0, 1));
    }
    const score = alignment * 4 - Math.abs(distance - preferredDistance) * 0.08 - pressure * 1.2;
    if (score > bestScore) { best = player.index; bestScore = score; }
  }
  return best;
}

export function groundPassProfile(power = 0) {
  const charge = clamp(power, 0, 1);
  return { speed: 8 + 18 * charge, range: 7 + 35 * charge };
}

export function slideHeading(input, player, ball) {
  if (Math.hypot(input.x, input.z) > .2) return Math.atan2(input.z, input.x);
  const distance = Math.hypot(ball.x - player.x, ball.z - player.z);
  return distance > .05 && distance < 5 ? Math.atan2(ball.z - player.z, ball.x - player.x) : player.heading;
}

export function skillTurn(progress) {
  const t = clamp(progress, 0, 1);
  return 2 * Math.PI * t * t * (3 - 2 * t);
}


// A pass is a strike relative to a moving foot. Preserve forward momentum so
// a light pass still leaves a running passer, instead of becoming a dribble.
export function groundPassVelocity(speed, direction, player, ability = 1) {
  const momentum = Math.max(0, (player.vx || 0) * direction.x + (player.vz || 0) * direction.z);
  const launchSpeed = speed * ability + momentum;
  return { x: direction.x * launchSpeed, y: 0, z: direction.z * launchSpeed };
}


// Seven-a-side goal-kick shape, measured from the kicking team's goal line.
// Stagger short outlets, a central pivot and higher support instead of putting
// every formation row in the same two wide lanes. Opponents protect the centre.
export function goalKickPosition(role, field, kickingHome, teammate, outfieldCount = 6) {
  const own = [[.14,-.18],[.18,.18],[.30,0],[.40,-.14],[.48,.24],[.59,.04]];
  const opposition = [[.72,.14],[.65,-.16],[.51,-.06],[.43,.15],[.29,-.16],[.23,.05]];
  const largeOwn = [[.14,-.18],[.18,.18],[.30,0],[.32,-.25],[.36,.25],[.43,-.10],[.48,.14],[.57,-.25],[.59,.04]];
  const largeOpposition = [[.74,-.20],[.72,.20],[.65,0],[.57,-.24],[.53,.24],[.46,-.09],[.40,.12],[.29,-.18],[.23,.05]];
  const shape = outfieldCount === 9 ? (teammate ? largeOwn : largeOpposition) : (teammate ? own : opposition);
  const [depth, lane] = shape[clamp(role - 1, 0, shape.length - 1)];
  const sign = kickingHome ? 1 : -1;
  return { x: sign * field.length * (depth - .5), z: sign * field.width * lane };
}
