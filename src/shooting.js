// Shot aiming, in pitch coordinates (metres): goalX is the goal line being
// shot at, z runs across the goal mouth.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Normal-distributed number (mean 0, deviation 1) from a uniform generator.
export function gaussian(random = Math.random) {
  const u = Math.max(1e-9, random()), v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Speed off the boot (m/s) and the height the ball should cross the line at,
// by shot type and power (0-1 from the power bar). A normal shot is struck
// through the ball: past the first tenth of the bar it rises, more with more
// power. A low driven shot (double tap) stays near the grass.
export const SHOT_STYLES = {
  normal: { speed: [21, 13], height: power => power <= 0.1 ? 0.25 : 0.55 + (power - 0.1) * 1.95, spin: 'shot' },
  low: { speed: [23, 11], height: () => 0.28, spin: 'shot' },
  finesse: { speed: [20, 10], height: power => 0.75 + power * 1.25, spin: 'finesse' },
  power: { speed: [26, 9], height: power => 0.85 + power * 1.55, spin: 'powerShot' },
};

// Aim assistance, as in EA FC: while the player shoots roughly toward goal,
// the stick picks a spot inside the goal mouth rather than an exact line.
// Turn the stick well away from goal and there is no assistance, so the shot
// goes where it was pointed. Then the strike's error is added: more with
// power past three quarters of the bar, distance, a nearby defender
// (pressure, 0-1) and a weaker finisher (accuracy, see attributes.js). The
// assist only reaches a couple of metres past the posts and the error is
// large enough at range that shots are genuinely missed, wide and over.
export function aimShot({ ball, direction, goalX, goalWidth, goalHeight, power = 0.5, style = 'normal', accuracy = 1, pressure = 0, random = Math.random }) {
  const spec = SHOT_STYLES[style] || SHOT_STYLES.normal;
  const toLine = goalX - ball.x;
  const distance = Math.hypot(toLine, ball.z);
  const towardGoal = Math.sign(direction.x) === Math.sign(toLine) && Math.abs(direction.x) > 0.12;
  const lineZ = towardGoal ? ball.z + direction.z / direction.x * toLine : Infinity;
  // Assisted while the stick's line passes within a few metres of the posts.
  const margin = 2.2 + distance * 0.06;
  const assisted = towardGoal && Math.abs(lineZ) < goalWidth / 2 + margin;
  const inside = goalWidth / 2 - 0.35;
  let z = assisted ? clamp(lineZ, -inside, inside) : lineZ;
  if (!Number.isFinite(z)) z = ball.z + Math.sign(direction.z || 1) * 30;
  const over = Math.max(0, power - 0.75);
  // Finesse trades pace for placement.
  const stress = 1 + clamp(pressure, 0, 1) * 0.7;
  const spread = (0.4 + distance * 0.028 + over * 1.8) * stress / clamp(accuracy, 0.6, 1.5) * (style === 'finesse' ? 0.75 : style === 'power' ? 1.35 : 1);
  z += gaussian(random) * spread;
  let height = spec.height(power) + gaussian(random) * ((style === 'low' ? 0.08 : 0.18 + over * 0.9) * stress + (style === 'low' ? 0 : distance * 0.006));
  height = clamp(height, 0.15, goalHeight + 2.5);
  const speed = spec.speed[0] + spec.speed[1] * power;
  // Outside the assist cone, preserve the chosen bearing, including sideways
  // and backward shots. A goal-plane target would turn these back towards goal.
  let x = goalX;
  if (!assisted) {
    const length = Math.hypot(direction.x, direction.z) || 1;
    const reach = Math.max(8, distance);
    // An unassisted strike keeps its bearing; its error is angular.
    const error = gaussian(random) * reach * 0.03 * stress / clamp(accuracy, 0.6, 1.5);
    x = ball.x + direction.x / length * reach - direction.z / length * error;
    z = ball.z + direction.z / length * reach + direction.x / length * error;
  }
  return { x, z, height, speed, assisted, distance };
}

// Use the same assist cone as other shots: a chip aimed away from goal must
// keep that bearing rather than being forced back between the posts.
export function aimChip(options) {
  const aimed = aimShot({ ...options, style: 'low' });
  const power = clamp(options.power ?? 0.5, 0, 1);
  return { ...aimed, height: 1.5 + power * 0.35,
    speed: clamp(Math.hypot(aimed.x - options.ball.x, aimed.z - options.ball.z) * (0.5 + power * 0.15), 9, 21) };
}

// Set-piece spin from the right stick, drawn during the run-up. The stick's
// path is kept as a list of zones it passed through: U, D, L, R.
export function stickZone(x, z) {
  if (Math.hypot(x, z) < 0.6) return null;
  return Math.abs(x) > Math.abs(z) ? (x > 0 ? 'R' : 'L') : z > 0 ? 'D' : 'U';
}
// Down-up is topspin (dip), down-up-down a knuckleball, a half circle from
// one side to the other curls the ball toward the side it ends on.
export function spinStyle(gesture) {
  const path = gesture.join('');
  if (/D.*U.*D/.test(path)) return 'knuckle';
  if (/L.*[UD].*R/.test(path)) return 'curlRight';
  if (/R.*[UD].*L/.test(path)) return 'curlLeft';
  if (/D.*U/.test(path)) return 'dip';
  return 'none';
}
