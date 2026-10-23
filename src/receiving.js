import { airAcceleration } from './ballistics.js';
import { applySurfaceGrip } from './ballContact.js';
import { BALL, surfaceFor } from './physicsConfig.js';
import { receivingInput } from './gameplay.js';

export const RECEIVING_ASSIST = 1;

// A short forecast of the loose ball, including landing and rolling. This is
// guidance for feet, never a force or position correction on the actual ball.
export function receivingPath(position, velocity, spin, surfaceName, duration = 4) {
  const p = { ...position }, v = { ...velocity }, w = { x: 0, y: 0, z: 0, ...spin };
  const surface = surfaceFor(surfaceName), points = [{ ...p, t: 0, speed: Math.hypot(v.x, v.y, v.z) }];
  const dt = 1 / 60, a = { x: 0, y: 0, z: 0 };
  for (let step = 1; step <= Math.round(duration / dt); step++) {
    const grounded = p.y <= BALL.radius + 0.025 && Math.abs(v.y) < 0.4;
    airAcceleration(v, w, BALL.radius, !grounded, a);
    v.x += a.x * dt; v.z += a.z * dt;
    if (grounded) {
      p.y = BALL.radius; v.y = 0;
      applySurfaceGrip(v, w, 9.81 * dt, surface.sliding);
      const speed = Math.hypot(v.x, v.z), keep = speed ? Math.max(0, 1 - surface.rolling * dt / speed) : 0;
      v.x *= keep; v.z *= keep; w.x *= keep; w.z *= keep;
    } else {
      v.y += (a.y - 9.81) * dt;
      p.y += v.y * dt;
      const decay = Math.exp(-BALL.airSpinDecay * dt);
      w.x *= decay; w.y *= decay; w.z *= decay;
      if (p.y < BALL.radius && v.y < 0) {
        p.y = BALL.radius;
        const before = v.y;
        v.y = Math.max(0, -v.y * surface.restitution - BALL.bounceLoss);
        v.x *= surface.bounceGrip; v.z *= surface.bounceGrip;
        applySurfaceGrip(v, w, v.y - before, surface.sliding);
      }
    }
    p.x += v.x * dt; p.z += v.z * dt;
    if (step % 3 === 0) points.push({ ...p, t: step * dt, speed: Math.hypot(v.x, v.y, v.z) });
  }
  return points;
}

export function receivingPoint(player, path, pace, field, age = 0) {
  let best = null, bestMiss = Infinity;
  for (const point of path) {
    const t = point.t - age;
    if (t < 0 || point.y > 0.8 || point.speed >= 24
      || Math.abs(point.x) > field.length / 2 || Math.abs(point.z) > field.width / 2) continue;
    const gap = Math.hypot(point.x - player.x, point.z - player.z);
    // Include acceleration time; don't promise an instant sprint from rest.
    const reach = Math.max(0, pace * t - pace * pace / 38) + 0.7;
    const miss = gap - reach;
    if (miss <= 0) return { ...point, t };
    if (miss < bestMiss) { best = { ...point, t }; bestMiss = miss; }
  }
  return best;
}

export function assistedReceivingInput(manual, player, target, pace) {
  const size = Math.max(1, Math.hypot(manual.x, manual.z));
  if (!target) return { x: manual.x / size, z: manual.z / size };
  // Own the approach until the physical trap succeeds. The passer's held
  // stick must not steer the newly selected recipient out of the ball's path.
  return receivingInput({ x: target.x - player.x, z: target.z - player.z }, pace);
}
