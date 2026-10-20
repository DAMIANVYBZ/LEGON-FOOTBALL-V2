import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePlayer, carryBall, canWinTackle, keeperThreat, forwardFromHeading, meshYawForHeading, pickPassTarget, supportPosition } from '../src/gameplay.js';
import { createMatchPhysics } from '../src/matchPhysics.js';

test('a player accelerates and comes to a stop without instant direction changes', () => {
  const player = { x: 0, z: 0, vx: 0, vz: 0, heading: 0 };
  advancePlayer(player, { x: 1, z: 0 }, 1 / 60);
  assert.ok(player.vx > 0 && player.vx < 5.8);
  for (let i = 0; i < 30; i++) advancePlayer(player, { x: 1, z: 0 }, 1 / 60);
  const running = player.vx;
  advancePlayer(player, { x: -1, z: 0 }, 1 / 60);
  assert.ok(player.vx > 0 && player.vx < running);
  for (let i = 0; i < 40; i++) advancePlayer(player, { x: 0, z: 0 }, 1 / 60);
  assert.ok(Math.abs(player.vx) < 0.01);
});

test('players and keepers face upfield, with the ball ahead of their feet', () => {
  const home = forwardFromHeading(0), away = forwardFromHeading(Math.PI);
  assert.deepEqual(home, { x: 1, z: 0 });
  assert.ok(Math.abs(away.x + 1) < 1e-10);
  assert.equal(meshYawForHeading(0), Math.PI / 2);
  assert.equal(meshYawForHeading(Math.PI), -Math.PI / 2);
});

test('support runs stay inside the pitch and passes prefer the aimed teammate', () => {
  const target = supportPosition([44, 28], { x: 42, z: 26 }, { length: 95, width: 60 },
    { home: true, attacking: true, run: true, lane: 1 });
  assert.ok(target.x <= 45 && target.z <= 28);
  const teammate = pickPassTarget([
    { index: 1, home: true, keeper: false, x: 12, z: 1 },
    { index: 2, home: true, keeper: false, x: 11, z: -11 },
    { index: 3, home: false, keeper: false, x: 15, z: 0 },
  ], { x: 0, z: 0 }, { x: 1, z: 0 }, 0);
  assert.equal(teammate, 1);
  const crossRun = supportPosition([12, -18], { x: 23, z: -23 }, { length: 95, width: 60 },
    { home: true, attacking: true, run: true, lane: -1, role: 6 });
  assert.ok(crossRun.x > 30);
  assert.ok(Math.abs(crossRun.z) < 10);
});

test('the ball collides with the ground and keeps travelling after a kick', async () => {
  const simulation = await createMatchPhysics({ length: 95, width: 60, goalWidth: 7.32,
    goalHeight: 2.44, ballRadius: 0.11 });
  const position = { x: 0, y: 2, z: 0 }, velocity = { x: 7, y: 0, z: 0 };
  simulation.reset(position, velocity);
  for (let i = 0; i < 120; i++) {
    const next = simulation.step(1 / 60, position, velocity);
    Object.assign(position, next.position); Object.assign(velocity, next.velocity);
  }
  assert.ok(position.x > 5);
  assert.ok(position.y >= 0.10 && position.y < 0.3);
  simulation.free();
});

test('a fast ball hits a player instead of passing through their legs', async () => {
  const simulation = await createMatchPhysics({ length: 95, width: 60, goalWidth: 7.32,
    goalHeight: 2.44, ballRadius: 0.11, playerPositions: [{ x: 2, z: 0 }] });
  const position = { x: 0, y: 0.11, z: 0 }, velocity = { x: 12, y: 0, z: 0 };
  simulation.reset(position, velocity);
  for (let i = 0; i < 25; i++) {
    const next = simulation.step(1 / 60, position, velocity, [{ x: 2, z: 0 }]);
    Object.assign(position, next.position); Object.assign(velocity, next.velocity);
  }
  assert.ok(position.x < 1.8);
  assert.ok(velocity.x < 0);
  simulation.free();
});

test('dribbling stays ahead through a full turn and does not hit the owner collider', async () => {
  const motion = { x: 0, z: 0, vx: 0, vz: 0, heading: 0 };
  let ball = { x: 0.68, y: 0.11, z: 0 };
  const physics = await createMatchPhysics({ length: 95, width: 60, goalWidth: 7.32, goalHeight: 2.44,
    ballRadius: 0.11, playerPositions: [motion] });
  for (let i = 0; i < 180; i++) {
    const angle = i / 180 * Math.PI * 2;
    advancePlayer(motion, { x: Math.cos(angle), z: Math.sin(angle) }, 1 / 60, { dribbling: true });
    const step = physics.step(1 / 60, ball, { x: motion.vx, y: 0, z: motion.vz }, [motion], 0);
    ball = carryBall(step.position, motion, 1 / 60);
    const f = forwardFromHeading(motion.heading);
    assert.ok((ball.x - motion.x) * f.x + (ball.z - motion.z) * f.z >= 0.499);
    assert.ok(Math.hypot(ball.x - motion.x, ball.z - motion.z) < 1);
  }
  physics.free();
});

test('a defender wins an exposed ball, shielding helps, and distant tackles fail', () => {
  const carrier = { x: 0, z: 0 }, ball = { x: 0.68, y: 0.11, z: 0 };
  assert.equal(canWinTackle({ x: 1.6, z: 0 }, carrier, ball), true);
  assert.equal(canWinTackle({ x: 1.6, z: 0 }, carrier, ball, true), false);
  assert.equal(canWinTackle({ x: 1.1, z: 0 }, carrier, ball, true), true);
  assert.equal(canWinTackle({ x: 4, z: 0 }, carrier, ball), false);
});

test('keepers distinguish catchable shots, high punches, wide dives and unreachable shots', () => {
  const keeper = { x: -45, z: 0 };
  assert.equal(keeperThreat({ x: -42, y: 1, z: 0 }, { x: -10, y: 0, z: 0 }, keeper, true).result, 'catch');
  assert.equal(keeperThreat({ x: -42, y: 2.2, z: 0 }, { x: -22, y: 0, z: 0 }, keeper, true).result, 'punch');
  assert.equal(keeperThreat({ x: -40, y: 0.5, z: 2 }, { x: -18, y: 1, z: 0 }, keeper, true).dive, true);
  assert.equal(keeperThreat({ x: -44, y: 1, z: 5 }, { x: -20, y: 0, z: 0 }, keeper, true), null);
  assert.equal(keeperThreat({ x: -42, y: 1, z: 0 }, { x: 10, y: 0, z: 0 }, keeper, true), null);
  const mirrored = keeperThreat({ x: 42, y: 1, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 45, z: 0 }, false);
  assert.equal(mirrored.result, 'catch');
});

test('attackers run ahead of the ball and both sides converge on cross receiving lanes', () => {
  const field = { length: 95, width: 60 };
  for (const home of [true, false]) {
    const sign = home ? 1 : -1;
    const run = supportPosition([sign * 8, -15], { x: sign * 20, z: 0 }, field,
      { home, attacking: true, run: true, role: 5 });
    assert.ok(sign * run.x > 25);
    const cross = supportPosition([sign * 8, -15], { x: sign * 25, z: 24 }, field,
      { home, attacking: true, run: true, role: 6 });
    assert.ok(sign * cross.x > 30 && Math.abs(cross.z) < 10);
  }
});

async function flight(options, position, velocity, spin, seconds, until = () => false) {
  const simulation = await createMatchPhysics({ length: 105, width: 68, goalWidth: 7.32, goalHeight: 2.44, ...options });
  const p = { ...position }, v = { ...velocity };
  simulation.reset(p, v, spin);
  for (let i = 0; i < Math.round(seconds * 60) && !until(p, v); i++) {
    const next = simulation.step(1 / 60, p, v);
    Object.assign(p, next.position); Object.assign(v, next.velocity);
  }
  simulation.free();
  return { position: p, velocity: v };
}

test('side spin curls a shot and topspin makes it dip sooner', async () => {
  const start = { x: 20, y: 0.11, z: 0 };
  const plain = await flight({}, start, { x: 24, y: 1.8, z: 0 }, { x: 0, y: 0, z: 0 }, 2, p => p.x >= 45);
  const curled = await flight({}, start, { x: 24, y: 1.8, z: 0 }, { x: 0, y: 45, z: 0 }, 2, p => p.x >= 45);
  assert.ok(Math.abs(plain.position.z) < 0.01);
  assert.ok(curled.position.z < -1, `curl ${curled.position.z}`);
  const high = await flight({}, start, { x: 20, y: 7, z: 0 }, { x: 0, y: 0, z: 0 }, 3, (p, v) => v.y < 0 && p.y < 0.2);
  const dipping = await flight({}, start, { x: 20, y: 7, z: 0 }, { x: 0, y: 0, z: -30 }, 3, (p, v) => v.y < 0 && p.y < 0.2);
  assert.ok(dipping.position.x < high.position.x - 1, `${dipping.position.x} vs ${high.position.x}`);
});

test('a rolling pass runs further on astroturf than on red earth', async () => {
  const stopped = (p, v) => Math.hypot(v.x, v.z) < 0.01;
  const roll = { x: 0, y: 0, z: -12 / 0.11 };
  const astro = await flight({ surface: 'astro' }, { x: 0, y: 0.11, z: 0 }, { x: 12, y: 0, z: 0 }, roll, 10, stopped);
  const grass = await flight({ surface: 'grass' }, { x: 0, y: 0.11, z: 0 }, { x: 12, y: 0, z: 0 }, roll, 10, stopped);
  const soil = await flight({ surface: 'soil' }, { x: 0, y: 0.11, z: 0 }, { x: 12, y: 0, z: 0 }, roll, 10, stopped);
  assert.ok(astro.position.x > grass.position.x && grass.position.x > soil.position.x);
  assert.ok(grass.position.x > 20 && grass.position.x < 40, `grass ${grass.position.x}`);
});

test('the net stops a goal and the round post sends the ball back out', async () => {
  const netted = await flight({}, { x: 48, y: 1, z: 0 }, { x: 25, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 1.5);
  assert.ok(netted.position.x > 52.6 && netted.position.x < 54.6, `net ${netted.position.x}`);
  assert.ok(Math.hypot(netted.velocity.x, netted.velocity.z) < 1);
  const post = await flight({}, { x: 45, y: 1, z: 3.72 }, { x: 20, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0.5);
  assert.ok(post.velocity.x < 0 && post.velocity.z > 0, JSON.stringify(post.velocity));
});
