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
export function advancePlayer(state, input, dt, { sprint = false, dribbling = false, keeper = false, controlledSprint = false, ability = 1 } = {}) {
  const length = Math.hypot(input.x, input.z);
  const directionX = length > 0.001 ? input.x / length : 0;
  const directionZ = length > 0.001 ? input.z / length : 0;
  const pace = (keeper ? 4.8 : dribbling ? (sprint ? controlledSprint ? 6 : 7.2 : 4.7) : sprint ? controlledSprint ? 6.8 : 8.1 : 5.8) * ability;
  const wantedSpeed = pace * Math.min(1, length);
  const wantedX = directionX * wantedSpeed;
  const wantedZ = directionZ * wantedSpeed;
  const reversing = state.vx * wantedX + state.vz * wantedZ < -0.1;
  const acceleration = length < 0.05 ? 16 : reversing ? 13 : sprint ? 15 : 19;
  const change = acceleration * dt;
  const differenceX = wantedX - state.vx;
  const differenceZ = wantedZ - state.vz;
  const differenceLength = Math.hypot(differenceX, differenceZ);
  const scale = differenceLength > change ? change / differenceLength : 1;
  state.vx += differenceX * scale;
  state.vz += differenceZ * scale;
  state.x += state.vx * dt;
  state.z += state.vz * dt;
  const speed = Math.hypot(state.vx, state.vz);
  if (speed > 0.12) {
    const wantedHeading = Math.atan2(state.vz, state.vx);
    const difference = Math.atan2(Math.sin(wantedHeading - state.heading), Math.cos(wantedHeading - state.heading));
    state.heading += clamp(difference, -9 * dt, 9 * dt);
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
    && ball.y < 0.85 && Math.hypot(velocity.x, velocity.y, velocity.z) < 15;
}

export function supportPosition(spawn, ball, field, { home, attacking, run = false, lane = 0, role = 0, offsideLine } = {}) {
  const attackSign = home ? 1 : -1;
  const forward = attacking ? (run ? 11 : 5) : -3;
  const crossing = attacking && Math.abs(ball.z) > field.width * 0.27 && attackSign * ball.x > field.length * 0.08;
  const attackingRole = role >= 5;
  const boxRunX = attackSign * (field.length / 2 - (role % 2 ? 8 : 13));
  const boxRunZ = role % 2 ? 0 : Math.sign(ball.z) * Math.min(7, field.width * 0.13);
  const target = {
    x: clamp(crossing && attackingRole ? boxRunX : attacking && run
      ? ball.x + attackSign * (attackingRole ? 13 : 7)
      : spawn[0] + ball.x * (attacking ? 0.48 : 0.3) + attackSign * forward,
      -field.length / 2 + 2.5, field.length / 2 - 2.5),
    z: clamp(crossing && attackingRole ? boxRunZ : spawn[1] + ball.z * (attacking ? 0.2 : 0.14) + lane * (attacking ? 2 : 1),
      -field.width / 2 + 2, field.width / 2 - 2),
  };
  if (attacking && Number.isFinite(offsideLine)) target.x = attackSign * Math.min(target.x * attackSign, offsideLine * attackSign - 0.35);
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
