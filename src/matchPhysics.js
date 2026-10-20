import RAPIER from '@dimforge/rapier3d-compat';
import { BALL, GOAL, SIM_DT, surfaceFor } from './physicsConfig.js';
import { airAcceleration } from './ballistics.js';
import { applySurfaceGrip } from './ballContact.js';

let initialization;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Small deterministic generator so bounce scatter is repeatable in tests.
function random(seed = 1) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export async function createMatchPhysics({ length, width, goalWidth, goalHeight, ballRadius = BALL.radius,
  playerPositions = [], surface: surfaceName = 'grass', goalDepth = GOAL.depth }) {
  await (initialization ||= RAPIER.init());
  const surface = surfaceFor(surfaceName);
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = SIM_DT;
  // Contact friction is off for the ball (see applyForces), so the ground only
  // sets how lively bounces are.
  const ground = RAPIER.ColliderDesc.cuboid(length, 0.12, width)
    .setTranslation(0, -0.12, 0).setRestitution(surface.restitution);
  world.createCollider(ground);

  // Round posts and crossbar, so rebounds leave at the angle of contact.
  const crossbarRotation = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
  for (const side of [-1, 1]) {
    const x = side * length / 2;
    for (const z of [-goalWidth / 2, goalWidth / 2]) {
      world.createCollider(RAPIER.ColliderDesc.cylinder(goalHeight / 2, GOAL.postRadius)
        .setTranslation(x, goalHeight / 2, z).setRestitution(GOAL.postRestitution));
    }
    world.createCollider(RAPIER.ColliderDesc.cylinder(goalWidth / 2, GOAL.postRadius)
      .setTranslation(x, goalHeight, 0).setRotation(crossbarRotation).setRestitution(GOAL.postRestitution));
    // The net: a dead, high-friction box behind the line that stops the ball.
    const back = side * (length / 2 + goalDepth), mid = side * (length / 2 + goalDepth / 2);
    const net = desc => world.createCollider(desc.setRestitution(0).setFriction(1)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min));
    net(RAPIER.ColliderDesc.cuboid(0.03, goalHeight / 2, goalWidth / 2).setTranslation(back, goalHeight / 2, 0));
    net(RAPIER.ColliderDesc.cuboid(goalDepth / 2, 0.03, goalWidth / 2).setTranslation(mid, goalHeight + 0.03, 0));
    for (const z of [-goalWidth / 2 - 0.03, goalWidth / 2 + 0.03])
      net(RAPIER.ColliderDesc.cuboid(goalDepth / 2, goalHeight / 2, 0.03).setTranslation(mid, goalHeight / 2, z));
  }

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(-0.25, ballRadius, 0)
    .setCcdEnabled(true)
    .setLinearDamping(0)
    .setAngularDamping(0));
  // Rapier limits a body to about 47 rad/s at this timestep, but a ball rolling
  // at 12 m/s spins at 109 rad/s. Spin, rolling and grip are therefore modelled
  // here and Rapier only resolves contacts, with friction disabled.
  const ballCollider = world.createCollider(RAPIER.ColliderDesc.ball(ballRadius).setMass(BALL.mass)
    .setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    .setRestitution(surface.restitution), body);
  const players = playerPositions.map(position => {
    const player = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(position.x, 0.85, position.z));
    const collider = world.createCollider(RAPIER.ColliderDesc.capsule(0.54, 0.32)
      .setFriction(0.7).setRestitution(0.08), player);
    return { body: player, collider };
  });
  const contactEvents = new RAPIER.EventQueue(true);
  const playerByCollider = new Map(players.map((player, index) => [player.collider.handle, index]));

  const scatter = random(Math.round(length * 1000 + width));

  const spin = { x: 0, y: 0, z: 0 };
  const rotation = { x: 0, y: 0, z: 0, w: 1 };
  function setSpin(value) { spin.x = value.x; spin.y = value.y; spin.z = value.z; }
  // Turn the rendered ball by its spin: q += 0.5 * (0, spin) * q * dt.
  function integrateRotation(dt) {
    const { x, y, z, w } = rotation, h = 0.5 * dt;
    rotation.x += h * (spin.x * w + spin.y * z - spin.z * y);
    rotation.y += h * (spin.y * w + spin.z * x - spin.x * z);
    rotation.z += h * (spin.z * w + spin.x * y - spin.y * x);
    rotation.w -= h * (spin.x * x + spin.y * y + spin.z * z);
    const size = Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w);
    rotation.x /= size; rotation.y /= size; rotation.z /= size; rotation.w /= size;
  }

  // Air drag on every moving ball, Magnus curve and spin decay in the air,
  // rolling resistance and spin matched to rolling on the ground.
  function applyForces(dt) {
    const p = body.translation(), v = body.linvel(), w = spin;
    body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    const speed = Math.hypot(v.x, v.y, v.z);
    const onGround = p.y <= ballRadius + 0.03 && Math.abs(v.y) < 0.6;
    if (speed < 0.12 && Math.hypot(w.x, w.z) * ballRadius < 0.12 && onGround) {
      if (speed > 0) body.setLinvel({ x: 0, y: v.y, z: 0 }, true);
      setSpin({ x: 0, y: 0, z: 0 });
      return;
    }
    // Drag always; Magnus curve only in the air (src/ballistics.js).
    const { x: ax, y: ay, z: az } = airAcceleration(v, w, ballRadius, !onGround);
    v.x += ax * dt; v.y += ay * dt; v.z += az * dt;
    if (!onGround) {
      const decay = Math.exp(-BALL.airSpinDecay * dt);
      setSpin({ x: w.x * decay, y: w.y * decay, z: w.z * decay });
    } else {
      applySurfaceGrip(v, w, 9.81 * dt, surface.sliding, ballRadius);
      const horizontal = Math.hypot(v.x, v.z);
      if (horizontal > 0) {
        const keep = Math.max(0, 1 - surface.rolling * dt / horizontal);
        v.x *= keep; v.z *= keep;
        w.x *= keep; w.z *= keep;
      }
      w.y *= Math.exp(-12 * dt);
    }
    body.setLinvel(v, true);
  }

  // A landing ball grips the surface and loses some pace; uneven pitches also
  // knock it slightly off its line.
  function landing(before) {
    if (before > -1.2) return;
    const v = body.linvel();
    if (v.y < 0.3 || body.translation().y > ballRadius + 0.08) return;
    v.y = Math.max(0, v.y - BALL.bounceLoss);
    const angle = (scatter() * 2 - 1) * surface.bounceScatter;
    const cos = Math.cos(angle) * surface.bounceGrip, sin = Math.sin(angle) * surface.bounceGrip;
    const x = v.x, z = v.z;
    v.x = x * cos - z * sin; v.z = x * sin + z * cos;
    applySurfaceGrip(v, spin, v.y - before, surface.sliding, ballRadius);
    body.setLinvel(v, true);
  }

  let accumulator = 0;
  return {
    reset(position, velocity, spin = { x: 0, y: 0, z: 0 }) {
      body.setTranslation(position, true);
      body.setLinvel(velocity, true);
      setSpin(spin);
      accumulator = 0;
    },
    // Spin in radians per second, set at the moment of a kick.
    setSpin,
    spin() { return { ...spin }; },
    step(dt, position, velocity, playerPositionsNow = [], carrier = -1) {
      // Gameplay events (kicks, tackles, carrying) move the ball directly;
      // physics resolves everything in between.
      const current = body.translation();
      const currentVelocity = body.linvel();
      if (Math.hypot(position.x - current.x, position.y - current.y, position.z - current.z) > 0.01)
        body.setTranslation(position, true);
      if (Math.hypot(velocity.x - currentVelocity.x, velocity.y - currentVelocity.y, velocity.z - currentVelocity.z) > 0.01)
        body.setLinvel(velocity, true);
      players.forEach(({ body: player, collider }, index) => {
        collider.setSensor(index === carrier);
        const position = playerPositionsNow[index];
        if (position) player.setNextKinematicTranslation({ x: position.x, y: 0.85, z: position.z });
      });
      accumulator = Math.min(0.1, accumulator + dt);
      let lastTouch = -1;
      while (accumulator >= world.timestep - 1e-9) {
        applyForces(world.timestep);
        const before = body.linvel().y;
        world.step(contactEvents);
        contactEvents.drainCollisionEvents((first, second, started) => {
          if (!started) return;
          const other = first === ballCollider.handle ? second : second === ballCollider.handle ? first : null;
          const index = playerByCollider.get(other);
          // Carrying uses a sensor: proximity to the owner is not a deflection.
          if (index !== undefined && !players[index].collider.isSensor()) lastTouch = index;
        });
        // A dribbler can regain control while still touching a defender.
        // Contact-start events alone miss that continuing obstruction.
        world.contactPairsWith(ballCollider, other => {
          const index = playerByCollider.get(other.handle);
          if (index === undefined || other.isSensor()) return;
          world.contactPair(ballCollider, other, manifold => {
            if (manifold.numSolverContacts() > 0) lastTouch = index;
          });
        });
        landing(before);
        integrateRotation(world.timestep);
        accumulator -= world.timestep;
      }
      return { position: body.translation(), velocity: body.linvel(), rotation: { ...rotation }, spin: { ...spin }, lastTouch };
    },
    free() { contactEvents.free(); world.free(); },
  };
}
