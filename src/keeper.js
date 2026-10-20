// Goalkeeping decisions in pitch coordinates (metres, seconds). The pitch runs
// along x; goalX is the keeper's own goal line.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Repeatable random numbers, so a match (and a test) can be replayed.
export function createRandom(seed = 1) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stand on the line between the ball and the middle of the goal, further off
// the line the further away the ball is, and rush out to close down a carrier
// who is through on goal.
export function keeperPosition(ball, goalX, goalWidth, { oneOnOne = false } = {}) {
  const out = -Math.sign(goalX) || 1; // direction from the goal line into the pitch
  const dx = ball.x - goalX, dz = ball.z;
  const distance = Math.hypot(dx, dz) || 1;
  const depth = oneOnOne ? clamp(distance * 0.45, 1, 7) : clamp(distance * 0.1, 0.8, 3.2);
  return {
    x: goalX + out * Math.max(0.6, Math.abs(dx / distance) * depth),
    // The tighter the angle, the closer to the near post.
    z: clamp((goalWidth / 2 - 0.5) * dz / (Math.abs(dx) + 4), -goalWidth / 2 + 0.4, goalWidth / 2 - 0.4),
  };
}

// Where a moving ball will cross the goal line, if it is heading at the goal
// frame: time in seconds, height and sideways position at the line.
export function shotOnGoal(ball, velocity, goalX, goalWidth, goalHeight) {
  if (Math.abs(velocity.x) < 1 || Math.sign(velocity.x) !== Math.sign(goalX - ball.x)) return null;
  const time = (goalX - ball.x) / velocity.x;
  if (time < 0 || time > 1.4) return null;
  const z = ball.z + velocity.z * time;
  const y = Math.max(0.11, ball.y + velocity.y * time - 4.905 * time * time);
  if (Math.abs(z) > goalWidth / 2 + 0.4 || y > goalHeight + 0.35) return null;
  return { time, z, y, speed: Math.hypot(velocity.x, velocity.y, velocity.z) };
}

// Reach from the keeper's centre line, by how high the ball is. A diving
// keeper covers far more of the goal than a standing one, least at full height.
export function keeperReach(height, diving) {
  if (!diving) return height > 1.9 ? 0.85 : 1.1; // a step and a sway of the body
  return height > 1.9 ? 1.3 : height < 0.45 ? 1.45 : 1.75; // getting down low is slowest
}

// The result of a ball reaching the keeper: 'catch', 'parry', 'spill',
// 'punch' or 'miss'. Shots struck near the keeper are always stopped; stretching
// saves succeed less often the further and faster the ball is.
export function saveOutcome({ gap, height, speed, diving, ability = 1, random = Math.random }) {
  // A ball above the keeper's hands must pass overhead, even when its path
  // lines up perfectly with his body on the ground.
  if (height > 2.65 * ability) return 'miss';
  const reach = keeperReach(height, diving) * ability;
  if (gap > reach) return 'miss';
  const stretch = gap / reach;
  if (stretch > 0.35) {
    const chance = clamp(1.1 - 0.5 * stretch - 0.25 * clamp((speed - 12) / 16, 0, 1), 0.2, 0.95) * clamp(ability, 0.8, 1.2);
    if (random() > chance) return 'miss';
  }
  // Hard and high: tipped over or punched away rather than held.
  if (height > 2 && speed > 27 && stretch < 0.8) return 'punch';
  // Held when it comes at a comfortable height: firm shots near the body,
  // softer ones at a stretch. Anything else is pushed away or spilled.
  const catchable = height > 0.15 && height < 2.35 && (stretch < 0.45 ? speed < 31 * ability : stretch < 0.75 && speed < 18 * ability);
  if (catchable) return 'catch';
  return random() < 0.75 ? 'parry' : 'spill';
}
