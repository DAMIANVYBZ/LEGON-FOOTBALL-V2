// Decisions for a computer-controlled player on the ball. Positions are
// {x, z} in metres; goal is the goal being attacked: { x, width }.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// How far a point lies from the segment a-b.
function segmentGap(point, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz || 1;
  const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / length, 0, 1);
  return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
}

// The most useful teammate to pass to: forward progress, space around them and
// a clear passing lane all count. Returns { index, score } or null.
export function bestPassOption(carrier, teammates, opponents, goal, { minDistance = 4, maxDistance = 32 } = {}) {
  const attack = Math.sign(goal.x - carrier.x) || 1;
  let best = null;
  for (const mate of teammates) {
    const d = distance(carrier, mate);
    if (d < minDistance || d > maxDistance) continue;
    const space = Math.min(8, ...opponents.map(o => distance(o, mate)));
    const lane = Math.min(4, ...opponents.map(o => segmentGap(o, carrier, mate)));
    if (lane < 1.2) continue;
    const progress = (mate.x - carrier.x) * attack;
    const score = progress * 0.12 + space * 0.35 + lane * 0.25 - Math.abs(d - 15) * 0.03;
    if (!best || score > best.score) best = { index: mate.index, score, space };
  }
  return best;
}

// Normal-distributed number (mean 0, deviation 1) from a uniform generator.
function gaussian(random) {
  const u = Math.max(1e-9, random()), v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Pick where to put a shot. Mostly the far corner from the keeper, but also
// the near corner, or a placed central finish, and the aim carries an error
// that grows with distance, a nearby defender (pressure, 0-1) and the shooter's
// weakness (accuracy: metres of error, larger is worse), so the CPU
// really does miss the target sometimes.
export function shotTarget(goal, keeper, random, accuracy, { pressure = 0, distance = 15 } = {}) {
  const keeperSide = keeper.z > 0.3 ? 1 : keeper.z < -0.3 ? -1 : 0;
  const far = keeperSide === 0 ? (random() < 0.5 ? -1 : 1) : -keeperSide;
  const style = random();
  const corner = goal.width / 2 - 0.55;
  const side = style < 0.78 ? (style < 0.58 ? far : -far) : far;
  const depth = style < 0.78 ? corner : goal.width * 0.18;
  const spread = accuracy * (0.55 + distance * 0.025) * (1 + clamp(pressure, 0, 1) * 0.5);
  const z = side * depth + (spread > 0 ? gaussian(random) * spread : 0);
  const high = random() < 0.4;
  return { x: goal.x, z, high };
}

// One decision for the ball carrier: shoot, cross, pass or dribble.
// skill: { shot (speed multiplier), accuracy (metres of aiming error), range (shooting distance) }
export function decideCarrier({ carrier, teammates, opponents, keeper, goal, field, skill, random }) {
  const attack = Math.sign(goal.x - carrier.x) || 1;
  const toGoal = Math.hypot(goal.x - carrier.x, carrier.z);
  const ahead = opponents.filter(o => (o.x - carrier.x) * attack > -0.5);
  const nearest = ahead.reduce((min, o) => Math.min(min, distance(o, carrier)), Infinity);
  const openAngle = Math.abs(carrier.z) < toGoal * 0.95;

  const pressure = clamp(1 - nearest / 4, 0, 1);
  if (toGoal < skill.range && openAngle) {
    const keen = clamp(1.25 - toGoal / skill.range, 0.15, 0.95) + (nearest < 3 ? 0.2 : 0);
    if (random() < keen) return { type: 'shoot', target: shotTarget(goal, keeper, random, skill.accuracy, { pressure, distance: toGoal }) };
  } else if (toGoal < skill.range * 1.4 && openAngle && nearest > 5 && random() < 0.05) {
    // The occasional speculative effort from distance, struck with more error.
    return { type: 'shoot', target: shotTarget(goal, keeper, random, skill.accuracy * 1.2, { pressure, distance: toGoal }) };
  }

  const wide = Math.abs(carrier.z) > field.width * 0.27;
  const deep = Math.abs(goal.x - carrier.x) < field.length * 0.24;
  if (wide && deep) {
    const inBox = teammates.filter(m => Math.abs(goal.x - m.x) < field.length * 0.2 && Math.abs(m.z) < field.width * 0.22);
    if (inBox.length) {
      const target = inBox.reduce((a, b) => Math.min(...opponents.map(o => distance(o, a))) >= Math.min(...opponents.map(o => distance(o, b))) ? a : b);
      return { type: 'cross', index: target.index };
    }
  }

  const pressed = nearest < 2.6;
  // When free to advance, do not recycle sideways/backward solely because a
  // teammate is unmarked. Under pressure the safe outlet remains available.
  const options = pressed ? teammates : teammates.filter(m => (m.x - carrier.x) * attack > 2);
  const option = bestPassOption(carrier, options, opponents, goal);
  // A defender closing in but not yet on the carrier: keep the ball moving to a
  // free teammate level with or just behind him instead of running into trouble.
  const closing = !pressed && nearest < 4.5;
  const recycle = closing && !(option && option.score > 2.2) ? bestPassOption(carrier, teammates.filter(m => (m.x - carrier.x) * attack > -3), opponents, goal) : null;
  if (recycle && recycle.score > 0.9 && random() < 0.5) {
    return { type: 'pass', index: recycle.index };
  }
  if (option && (pressed ? option.score > 0.6 : option.score > 2.2 && random() < 0.35)) {
    const mate = teammates.find(m => m.index === option.index);
    // Play it into the runner's path when they are moving towards goal.
    const running = mate.vx * attack > 2.5;
    return { type: running ? 'through' : 'pass', index: option.index };
  }

  // Dribble towards goal, stepping away from the nearest defender in front.
  let dirX = goal.x - carrier.x, dirZ = clamp(-carrier.z, -field.width / 4, field.width / 4) * 0.6;
  const length = Math.hypot(dirX, dirZ) || 1;
  dirX /= length; dirZ /= length;
  const threat = ahead.find(o => distance(o, carrier) < 5);
  if (threat) {
    // Positive when the defender stands to the carrier's left; step the other way.
    const left = (threat.z - carrier.z) * dirX - (threat.x - carrier.x) * dirZ;
    const side = -Math.sign(left) || (random() < 0.5 ? 1 : -1);
    const perpX = -dirZ * side, perpZ = dirX * side;
    dirX += perpX * 0.9; dirZ += perpZ * 0.9;
    const size = Math.hypot(dirX, dirZ) || 1;
    dirX /= size; dirZ /= size;
  }
  return { type: 'dribble', dir: { x: dirX, z: dirZ } };
}

// Goal-side marking positions: each defender takes the nearest unmarked
// attacker, closest-to-goal attackers first.
export function markingAssignments(defenders, attackers, ownGoalX) {
  const order = [...attackers].sort((a, b) => Math.abs(a.x - ownGoalX) - Math.abs(b.x - ownGoalX));
  const free = new Set(defenders.map(d => d.index));
  const result = new Map();
  for (const attacker of order) {
    let best = null, bestGap = Infinity;
    for (const defender of defenders) {
      if (!free.has(defender.index)) continue;
      const gap = distance(defender, attacker);
      if (gap < bestGap) { best = defender; bestGap = gap; }
    }
    if (!best) break;
    free.delete(best.index);
    const toGoalX = ownGoalX - attacker.x, toGoalZ = -attacker.z, size = Math.hypot(toGoalX, toGoalZ) || 1;
    result.set(best.index, { x: attacker.x + toGoalX / size * 1.8, z: attacker.z + toGoalZ / size * 1.8, attacker: attacker.index });
  }
  return result;
}
