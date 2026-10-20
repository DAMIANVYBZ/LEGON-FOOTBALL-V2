import { BALL, KICK_SPIN, SIM_DT, surfaceFor } from './physicsConfig.js';
import { applySurfaceGrip } from './ballContact.js';

// The ball's flight through the air: drag (with the drag crisis) and Magnus
// curve from spin. The match physics uses the same forces, so a flight
// predicted here is the flight the ball really takes, which lets kicks be
// aimed at a point and height and lets set pieces draw their path.
const AERO = 0.5 * BALL.airDensity * Math.PI * BALL.radius * BALL.radius / BALL.mass;
const GRAVITY = 9.81;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Acceleration from the air (no gravity) for velocity v and spin w (rad/s).
export function airAcceleration(v, w, radius = BALL.radius, magnus = true, result = { x: 0, y: 0, z: 0 }) {
  const a = result;
  a.x = 0; a.y = 0; a.z = 0;
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed < 1e-6) return a;
  const crisis = clamp((speed - BALL.dragCrisisStart) / (BALL.dragCrisisEnd - BALL.dragCrisisStart), 0, 1);
  const drag = AERO * (BALL.dragLowSpeed + (BALL.dragHighSpeed - BALL.dragLowSpeed) * crisis) * speed;
  a.x = -drag * v.x; a.y = -drag * v.y; a.z = -drag * v.z;
  if (!magnus) return a;
  const cx = w.y * v.z - w.z * v.y, cy = w.z * v.x - w.x * v.z, cz = w.x * v.y - w.y * v.x;
  const cross = Math.hypot(cx, cy, cz);
  if (cross > 1e-6) {
    const lift = Math.min(BALL.maxLift, BALL.liftPerSpin * radius * Math.hypot(w.x, w.y, w.z) / speed);
    const magnusScale = AERO * lift * speed * speed / cross;
    a.x += cx * magnusScale; a.y += cy * magnusScale; a.z += cz * magnusScale;
  }
  return a;
}

// Flies the ball until it lands, travels `distance` horizontally or `maxTime`
// passes. Returns sampled points ({ x, y, z, t }) and the final state.
export function flight(from, velocity, spin = { x: 0, y: 0, z: 0 }, { distance = Infinity, maxTime = 4, dt = 1 / 60, every = 1, sample = true } = {}) {
  const p = { ...from }, v = { ...velocity }, w = { ...spin };
  const points = sample ? [{ ...p, t: 0 }] : [];
  const acceleration = { x: 0, y: 0, z: 0 };
  const decay = Math.exp(-BALL.airSpinDecay * dt);
  let t = 0, step = 0;
  while (t < maxTime) {
    const a = airAcceleration(v, w, BALL.radius, true, acceleration);
    v.x += a.x * dt; v.y += (a.y - GRAVITY) * dt; v.z += a.z * dt;
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
    w.x *= decay; w.y *= decay; w.z *= decay;
    t += dt; step++;
    if (sample && step % every === 0) points.push({ ...p, t });
    if (p.y <= BALL.radius && v.y < 0) { p.y = BALL.radius; break; }
    if (Math.hypot(p.x - from.x, p.z - from.z) >= distance) break;
  }
  if (sample && points[points.length - 1].t !== t) points.push({ ...p, t });
  return { points, position: p, velocity: v, time: t, landed: p.y <= BALL.radius };
}

// The upward launch speed that brings a ball struck along `ground` (horizontal
// velocity) to `height` after travelling `distance`. Bisection over the real
// flight, so drag and spin are accounted for. Clamped to [minLift, maxLift].
export function liftFor({ from, ground, spin, distance, height, minLift = 0, maxLift = 22 }) {
  const heightAt = lift => {
    const result = flight(from, { x: ground.x, y: lift, z: ground.z }, spin, { distance, maxTime: 5, sample: false });
    // Short of the distance means it landed first: count that as too low.
    const travelled = Math.hypot(result.position.x - from.x, result.position.z - from.z);
    return travelled < distance - 0.05 ? -1 - (distance - travelled) : result.position.y;
  };
  let low = minLift, high = maxLift;
  if (heightAt(low) >= height) return low;
  if (heightAt(high) <= height) return high;
  for (let i = 0; i < 22; i++) {
    const mid = (low + high) / 2;
    if (heightAt(mid) < height) low = mid; else high = mid;
  }
  return (low + high) / 2;
}

// Weight a ground pass for its surface, including the initial skid before it
// rolls. Solve only when kicking, using the same forces as matchPhysics.
export function groundPassSpeed(distance, surfaceName, arrival = 4.5, maxSpeed = 30) {
  const surface = surfaceFor(surfaceName);
  const v = { x: 0, y: 0, z: 0 }, w = { x: 0, y: 0, z: 0 }, a = { x: 0, y: 0, z: 0 };
  const arrivalAt = speed => {
    v.x = speed; w.z = -KICK_SPIN.pass.top;
    let x = 0;
    for (let t = 0; t < 8 && x < distance && v.x > 0.05; t += SIM_DT) {
      airAcceleration(v, w, BALL.radius, false, a);
      v.x += a.x * SIM_DT;
      applySurfaceGrip(v, w, 9.81 * SIM_DT, surface.sliding);
      const keep = Math.max(0, 1 - surface.rolling * SIM_DT / v.x);
      v.x *= keep; w.z *= keep;
      x += v.x * SIM_DT;
    }
    return x >= distance ? v.x : 0;
  };
  let low = Math.min(arrival, maxSpeed), high = maxSpeed;
  for (let i = 0; i < 12; i++) {
    const mid = (low + high) / 2;
    if (arrivalAt(mid) < arrival) low = mid; else high = mid;
  }
  return (low + high) / 2;
}
