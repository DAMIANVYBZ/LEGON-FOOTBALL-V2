import { BALL } from './physicsConfig.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const BOOT_REACH = 0.26;
export const INPUT_BUFFER_SECONDS = 0.35;

export function createBallControl(time = 0) {
  return { receiveUntil: time + 0.6, lastTouch: -Infinity, touches: 0, lastMotion: null, trapUntil: 0 };
}

// Change velocity at a grounded boot contact. Rapier integrates travel,
// friction, rotation and collisions between touches; possession is not a weld.
export function needsControlTrap(ball, velocity, player) {
  const dx = ball.x - player.x, dz = ball.z - player.z;
  const gap = Math.hypot(dx, dz);
  if (gap > 0.9 || ball.y > BALL.radius + 0.15) return false;
  const rx = velocity.x - player.vx, rz = velocity.z - player.vz;
  return Math.hypot(rx, rz) > 0.8 && rx * dx + rz * dz > 0.08;
}

export function footTouch(state, ball, velocity, player, feet, time, { sprint = false } = {}) {
  if (state.lastMotion) {
    const dvx = player.vx - state.lastMotion.vx, dvz = player.vz - state.lastMotion.vz;
    const braking = dvx * state.lastMotion.vx + dvz * state.lastMotion.vz < -0.05;
    const turnAngle = Math.atan2(Math.sin(player.heading - state.lastMotion.heading), Math.cos(player.heading - state.lastMotion.heading));
    const turning = Math.abs(dvx * state.lastMotion.vz - dvz * state.lastMotion.vx) > 0.15 || Math.abs(turnAngle) > 0.04;
    if (braking || turning) state.trapUntil = time + 0.15;
  }
  state.lastMotion = { vx: player.vx, vz: player.vz, heading: player.heading };
  const speed = Math.hypot(player.vx, player.vz);
  const fx = Math.cos(player.heading), fz = Math.sin(player.heading);
  const candidates = feet.filter(foot => foot.y < 0.24 && foot.y > -0.12)
    .map(foot => ({ ...foot, gap: Math.hypot(foot.x - ball.x, foot.z - ball.z) }))
    .sort((a, b) => a.gap - b.gap);
  const foot = candidates[0];
  if (!foot || ball.y > BALL.radius + 0.15 || velocity.y > 1) return null;
  const trapping = time < state.trapUntil && needsControlTrap(ball, velocity, player);
  const interval = trapping ? 0.04 : speed < 0.3 ? 0.1 : sprint ? 0.3 : 0.23;
  if (foot.gap <= BOOT_REACH && time - state.lastTouch >= interval) {
    const lead = (ball.x - player.x) * fx + (ball.z - player.z) * fz;
    const side = (ball.x - player.x) * -fz + (ball.z - player.z) * fx;
    const push = speed < 0.3 || trapping ? 0 : clamp(0.4 + ((sprint ? 0.5 : 0.32) - lead) * 5, -1.2, 1.5);
    const lateral = speed < 0.3 ? 0 : clamp(-side * 3, -1, 1);
    const next = { x: speed < 0.3 ? 0 : player.vx + fx * push - fz * lateral,
      y: Math.max(-0.6, Math.min(0, velocity.y)), z: speed < 0.3 ? 0 : player.vz + fz * push + fx * lateral };
    if (trapping && speed >= 0.3) {
      // Draw the ball onto the new stride at this boot contact, rather than
      // leaving it behind the body as the player turns through 180 degrees.
      const tx = player.x + player.vx / speed * 0.28 - ball.x;
      const tz = player.z + player.vz / speed * 0.28 - ball.z;
      const scale = Math.min(5, 3 / (Math.hypot(tx, tz) || 1));
      next.x = player.vx + tx * scale; next.z = player.vz + tz * scale;
    }
    state.lastTouch = time; state.receiveUntil = 0; state.touches++;
    return { velocity: next, contact: true, foot, spin: { x: next.z / BALL.radius, y: 0, z: -next.x / BALL.radius } };
  }
  // A brief first-touch trap approaches a reachable boot through velocity,
  // never by teleporting the ball or holding its height above the turf.
  if (time < state.receiveUntil && Math.hypot(ball.x - player.x, ball.z - player.z) < 1.15) {
    const dx = foot.x + fx * 0.12 - ball.x, dz = foot.z + fz * 0.12 - ball.z;
    const size = Math.hypot(dx, dz), scale = size > 0 ? Math.min(10, 2.5 / size) : 0;
    return { velocity: { x: player.vx + dx * scale, y: Math.min(0, velocity.y), z: player.vz + dz * scale }, contact: false };
  }
  return null;
}

export function withinKickReach(player, ball) {
  return Math.hypot(player.x - ball.x, player.z - ball.z) <= 1.25 && ball.y <= 0.55;
}
