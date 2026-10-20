import test from 'node:test';
import assert from 'node:assert/strict';
import { aimShot, aimChip, spinStyle, stickZone } from '../src/shooting.js';
import { flight, liftFor } from '../src/ballistics.js';
import { createRandom } from '../src/keeper.js';

const goal = { goalX: 35.5, goalWidth: 7.32, goalHeight: 2.44 };

test('a shot roughly toward goal is assisted into the goal mouth', () => {
  const random = createRandom(4);
  // Stick points 2 m outside the post: still assisted, aimed inside it.
  const aimed = aimShot({ ball: { x: 19.5, z: 0 }, direction: { x: 16, z: 5.7 }, ...goal, power: 0.5, random: () => 0.5 });
  assert.ok(aimed.assisted);
  assert.ok(aimed.z < goal.goalWidth / 2 + 0.3, `inside the post: ${aimed.z}`);
  // Turned well away from goal: no help, so it misses.
  const wild = aimShot({ ball: { x: 19.5, z: 0 }, direction: { x: 0.5, z: 1 }, ...goal, power: 0.5, random });
  assert.equal(wild.assisted, false);
  assert.ok(Math.abs(wild.z) > goal.goalWidth / 2);
});

test('a normal shot rises with power, a low driven one stays down', () => {
  const at = (power, style) => aimShot({ ball: { x: 19.5, z: 0 }, direction: { x: 1, z: 0 }, ...goal, power, style, random: () => 0.5 });
  assert.ok(at(0.08).height < 0.4, 'a tap is along the ground');
  assert.ok(at(0.5).height > 1, 'past a tenth of the bar it is raised');
  assert.ok(at(0.9).height > at(0.5).height);
  assert.ok(at(0.5, 'low').height < 0.4);
  assert.ok(at(0.5).speed > 25, 'struck hard');
});

test('unassisted shots keep backward, sideways and diagonal input bearings', () => {
  const ball = { x: 8, z: 2 };
  for (const direction of [{ x: -1, z: 0 }, { x: 0, z: -1 }, { x: -0.6, z: 0.8 }]) {
    const aimed = aimShot({ ball, direction, ...goal, random: createRandom(19) });
    assert.equal(aimed.assisted, false);
    const dx = aimed.x - ball.x, dz = aimed.z - ball.z;
    const alignment = (dx * direction.x + dz * direction.z) / Math.hypot(dx, dz);
    assert.ok(alignment > 0.99, JSON.stringify({ direction, aimed }));
  }
  const assisted = aimShot({ ball, direction: { x: 1, z: 0 }, ...goal, random: createRandom(19) });
  assert.equal(assisted.x, goal.goalX);
});

test('trajectory calculations without samples return identical flight states', () => {
  const from = { x: 3, y: 0.11, z: -2 }, velocity = { x: 22, y: 7, z: 4 }, spin = { x: 1, y: -40, z: -18 };
  const sampled = flight(from, velocity, spin, { distance: 25 });
  const direct = flight(from, velocity, spin, { distance: 25, sample: false });
  assert.deepEqual(direct.position, sampled.position);
  assert.deepEqual(direct.velocity, sampled.velocity);
  assert.equal(direct.time, sampled.time);
  assert.equal(direct.landed, sampled.landed);
  assert.deepEqual(direct.points, []);
  assert.ok(sampled.points.length > 10);
});

test('the launch solver puts the ball at the wanted height', () => {
  const from = { x: 0, y: 0.11, z: 0 }, ground = { x: 26, z: 0 }, spin = { x: 0, y: 0, z: -18 };
  const lift = liftFor({ from, ground, spin, distance: 20, height: 1.8 });
  const end = flight(from, { ...ground, y: lift }, spin, { distance: 20 }).position;
  assert.ok(Math.abs(end.y - 1.8) < 0.05, `arrives at ${end.y}`);
});

test('right-stick gestures pick the set-piece spin', () => {
  assert.equal(stickZone(0, 0.2), null);
  assert.equal(stickZone(0, 0.9), 'D');
  assert.equal(spinStyle(['D', 'U']), 'dip');
  assert.equal(spinStyle(['D', 'U', 'D']), 'knuckle');
  assert.equal(spinStyle(['L', 'D', 'R']), 'curlRight');
  assert.equal(spinStyle(['R', 'U', 'L']), 'curlLeft');
  assert.equal(spinStyle([]), 'none');
});


test('chip shots keep backward and sideways aim outside the assist cone', () => {
  for (const direction of [{x:-1,z:0},{x:0,z:1},{x:0,z:-1}]) {
    const ball={x:10,z:0};
    const chip=aimChip({ball,direction,...goal,power:.5,random:()=>.5});
    assert.equal(chip.assisted,false);
    assert.ok((chip.x-ball.x)*direction.x+(chip.z-ball.z)*direction.z>10);
    assert.ok(chip.height>1 && chip.speed>=9);
  }
});
