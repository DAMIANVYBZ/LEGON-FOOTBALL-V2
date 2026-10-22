import { BALL } from './physicsConfig.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A small correction towards an interception, never a turn away from the
// requested direction. Commit the bearing at launch; no homing while prone.
export function slideAim(input, player, ball, velocity) {
  const gap = Math.hypot(ball.x - player.x, ball.z - player.z);
  const explicit = Math.hypot(input.x, input.z) > .2;
  const base = explicit ? Math.atan2(input.z, input.x) : gap < 5 && gap > .05
    ? Math.atan2(ball.z - player.z, ball.x - player.x) : player.heading;
  if (gap > 5 || ball.y > .55) return base;
  // The extended boot arrives before the body. Leading by body arrival time
  // overshoots a crossing ball, especially from a standing lunge.
  const time = clamp((gap - .75) / (Math.hypot(player.vx, player.vz) + 4.5), .06, .28);
  const px = ball.x + velocity.x * time, pz = ball.z + velocity.z * time;
  const side = (px - player.x) * -Math.sin(base) + (pz - player.z) * Math.cos(base);
  const footSide = Math.abs(side) > .01 ? Math.sign(side) : -1;
  // Aim the extended boot, which sits beside the body centre line. Aiming the
  // hips at the ball puts the foot across its far side on a close challenge.
  const target = Math.atan2(pz - Math.cos(base) * footSide * .12 - player.z,
    px + Math.sin(base) * footSide * .12 - player.x);
  const turn = Math.atan2(Math.sin(target - base), Math.cos(target - base));
  return Math.abs(turn) < .5 ? base + clamp(turn, -.22, .22) : base;
}

// Carry running momentum into the entry, add a short push, then lose speed to
// the ground. Ball contact does not change this trajectory.
export function slideVelocity(initial, heading, time, duration = 1.1) {
  const fx = Math.cos(heading), fz = Math.sin(heading);
  const along = Math.max(0, initial.x * fx + initial.z * fz);
  const entry = Math.exp(-time * 10);
  const push = 4.8 * (1 - Math.exp(-time * 18));
  const brake = Math.pow(Math.max(0, 1 - time / duration), 1.4);
  const speed = (along + push) * brake;
  return { x: fx * speed + (initial.x - fx * along) * entry * brake,
    z: fz * speed + (initial.z - fz * along) * entry * brake };
}

// First intersection of two moving spheres. Relative motion catches contacts
// between ticks without extending a boot's reach or ignoring ball height.
export function sweepContact(from, to, targetFrom, targetTo, radius) {
  const x = from.x - targetFrom.x, y = (from.y || 0) - (targetFrom.y || 0), z = from.z - targetFrom.z;
  const dx = to.x - targetTo.x - x, dy = (to.y || 0) - (targetTo.y || 0) - y, dz = to.z - targetTo.z - z;
  const c = x * x + y * y + z * z - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy + dz * dz, b = 2 * (x * dx + y * dy + z * dz);
  const discriminant = b * b - 4 * a * c;
  if (a < 1e-10 || discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

export function slideBallContact(previousFeet, feet, before, ball) {
  let hit = null;
  for (let index = 0; index < feet.length; index++) {
    const from = previousFeet[index] || feet[index], to = feet[index];
    const time = sweepContact(from, to, before, ball, BALL.radius + .12);
    if (time !== null && (!hit || time < hit.time)) hit = { time, index,
      point: { x: from.x + (to.x - from.x) * time, y: from.y + (to.y - from.y) * time, z: from.z + (to.z - from.z) * time } };
  }
  return hit;
}

// Strike along the foot-to-ball normal, retaining tangential incoming motion.
// Cap animation-derived foot speed so the leg's extension cannot fire a shot.
export function slideDeflection(velocity, footVelocity, foot, ball, heading) {
  const dx = ball.x - foot.x, dz = ball.z - foot.z, distance = Math.hypot(dx, dz);
  const nx = distance > .025 ? dx / distance : Math.cos(heading), nz = distance > .025 ? dz / distance : Math.sin(heading);
  const size = Math.hypot(footVelocity.x, footVelocity.z), scale = Math.min(1, 9 / (size || 1));
  const closing = (footVelocity.x * scale - velocity.x) * nx + (footVelocity.z * scale - velocity.z) * nz;
  const impulse = Math.max(0, closing) * 1.1;
  const next = { x: velocity.x + nx * impulse, y: Math.min(.35, Math.max(0, velocity.y)), z: velocity.z + nz * impulse };
  return { velocity: next, spin: { x: next.z / BALL.radius, y: 0, z: -next.x / BALL.radius } };
}

export function slideVerdict(ballTime, bodyTime, alreadyTouchedBall, approachSpeed) {
  const ballFirst = alreadyTouchedBall || (ballTime !== null && (bodyTime === null || ballTime < bodyTime));
  const foul = bodyTime !== null && !ballFirst && approachSpeed > 1.8;
  return { ballFirst, foul, card: foul ? approachSpeed > 5 ? 'red' : 'yellow' : null };
}

export function slideApproachSpeed(player, opponent) {
  const dx = opponent.x - player.x, dz = opponent.z - player.z, gap = Math.hypot(dx, dz) || 1;
  const toward = (player.vx * dx + player.vz * dz) / gap;
  const relative = ((player.vx - opponent.vx) * dx + (player.vz - opponent.vz) * dz) / gap;
  return Math.max(0, Math.min(toward, relative));
}
