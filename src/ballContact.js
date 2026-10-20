import { BALL } from './physicsConfig.js';

// Friction opposes slip at the bottom of the ball, transferring momentum
// between travel and spin. Backspin checks on landing; overspin kicks on.
// Mutate the supplied vectors so rolling contact allocates nothing each step.
export function applySurfaceGrip(velocity, spin, normalChange, friction, radius = BALL.radius) {
  const slipX = velocity.x + spin.z * radius;
  const slipZ = velocity.z - spin.x * radius;
  const slip = Math.hypot(slipX, slipZ);
  if (slip < 1e-8) return;
  // Stop at rolling contact, never reverse the slip or add energy.
  const change = Math.min(slip / (1 + 1 / BALL.inertia), Math.max(0, friction * normalChange));
  const dx = -slipX / slip * change, dz = -slipZ / slip * change;
  velocity.x += dx; velocity.z += dz;
  spin.x -= dz / (BALL.inertia * radius);
  spin.z += dx / (BALL.inertia * radius);
}
