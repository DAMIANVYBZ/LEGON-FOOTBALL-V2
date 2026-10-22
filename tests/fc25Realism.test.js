import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttributes, createTeamAttributes, hashSeed, positionGroup, paceFactor, accelerationFactor, agilityFactor, finishingAccuracy, staminaFactor, handlingFactor, looseTouchChance, tackleChance, ATTRIBUTE_KEYS } from '../src/attributes.js';
import { aimShot } from '../src/shooting.js';
import { shotTarget, decideCarrier } from '../src/cpuBrain.js';
import { footTouch, createBallControl } from '../src/ballControl.js';
import { createRandom } from '../src/keeper.js';
import { DIFFICULTY, STAMINA } from '../src/physicsConfig.js';

const goal = { goalX: 35.5, goalWidth: 7.32, goalHeight: 2.44 };
const mean = (list, pick) => list.reduce((sum, item) => sum + pick(item), 0) / list.length;

test('every footballer has their own attributes, stable for a given team', () => {
  const a = createTeamAttributes(10, { seed: hashSeed('Commonwealth') });
  const b = createTeamAttributes(10, { seed: hashSeed('Commonwealth') });
  const c = createTeamAttributes(10, { seed: hashSeed('Akuafo') });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(a.length, 10);
  for (const player of a) for (const key of ATTRIBUTE_KEYS) assert.ok(player[key] >= 0.2 && player[key] <= 0.95);
  assert.ok(new Set(a.map(p => p.pace.toFixed(3))).size > 5, 'players are not clones');
});

test('positions differ: forwards finish and run, defenders tackle, the keeper handles', () => {
  const squads = Array.from({ length: 40 }, (_, i) => createTeamAttributes(10, { seed: i + 1 }));
  const group = name => squads.flatMap(squad => squad.filter((_, role) => positionGroup(role, 10) === name));
  assert.ok(mean(group('FWD'), p => p.finishing) > mean(group('DEF'), p => p.finishing) + 0.2);
  assert.ok(mean(group('FWD'), p => p.pace) > mean(group('DEF'), p => p.pace) + 0.1);
  assert.ok(mean(group('DEF'), p => p.tackling) > mean(group('FWD'), p => p.tackling) + 0.2);
  assert.ok(mean(group('GK'), p => p.handling) > mean(group('DEF'), p => p.handling) + 0.2);
  assert.equal(positionGroup(0, 10), 'GK');
  assert.equal(positionGroup(1, 7), 'DEF');
  assert.equal(positionGroup(6, 7), 'FWD');
});

test('attribute factors stay in modest, documented ranges', () => {
  const low = Object.fromEntries(ATTRIBUTE_KEYS.map(k => [k, 0.2])), high = Object.fromEntries(ATTRIBUTE_KEYS.map(k => [k, 0.95]));
  for (const [fn, lo, hi] of [[paceFactor, 0.94, 1.06], [accelerationFactor, 0.78, 1.28], [agilityFactor, 0.8, 1.2], [finishingAccuracy, 0.7, 1.5], [staminaFactor, 0.75, 1.25], [handlingFactor, 0.92, 1.08]]) {
    assert.ok(fn(low) >= lo - 1e-9 && fn(high) <= hi + 1e-9 && fn(high) > fn(low), fn.name);
  }
  assert.ok(looseTouchChance(low) > looseTouchChance(high));
  assert.equal(paceFactor(undefined) > 0.9, true, 'a player with no attributes still moves');
});

test('tackling skill beats dribbling skill, and a shielded or side-on challenge is harder', () => {
  const tackler = { tackling: 0.85, strength: 0.7 }, dribbler = { dribbling: 0.8, strength: 0.5 };
  const strong = tackleChance({ tackler, carrier: { dribbling: 0.3, strength: 0.5 } });
  const weak = tackleChance({ tackler: { tackling: 0.3, strength: 0.4 }, carrier: dribbler });
  assert.ok(strong > weak + 0.3);
  assert.ok(tackleChance({ tackler, carrier: dribbler, shielding: true }) < tackleChance({ tackler, carrier: dribbler }));
  assert.ok(tackleChance({ tackler, carrier: dribbler, front: false }) < tackleChance({ tackler, carrier: dribbler }));
  for (const chance of [strong, weak]) assert.ok(chance >= 0.15 && chance <= 0.88, 'no tackle is certain or hopeless');
});

test('shots are genuinely missed: more with distance, pressure and a weak finisher', () => {
  const rate = (distance, accuracy, pressure) => {
    const random = createRandom(11); let missed = 0; const N = 3000;
    for (let i = 0; i < N; i++) {
      const aimed = aimShot({ ball: { x: goal.goalX - distance, z: 0 }, direction: { x: distance, z: 3 }, ...goal, power: 0.6, accuracy, pressure, random });
      if (Math.abs(aimed.z) > goal.goalWidth / 2 + 0.11 || aimed.height > goal.goalHeight) missed++;
    }
    return missed / N;
  };
  const clean = rate(18, 1, 0);
  assert.ok(clean > 0.08 && clean < 0.45, `aiming at the corner from 18 m misses sometimes: ${clean}`);
  assert.ok(rate(18, 1, 1) > clean + 0.04, 'a defender at his shoulder hurries the shot');
  assert.ok(rate(18, 0.7, 0) > rate(18, 1.5, 0) + 0.1, 'a poor finisher misses more than a good one');
  assert.ok(rate(28, 1, 0) > rate(10, 1, 0), 'long range is harder');
});

test('the shot assist no longer drags a wild aim back into the goal', () => {
  const aimed = aimShot({ ball: { x: 19.5, z: 0 }, direction: { x: 16, z: 12 }, ...goal, power: 0.5, random: () => 0.5 });
  assert.equal(aimed.assisted, false, 'a shot struck 8 m wide is not pulled between the posts');
  assert.ok(Math.abs(aimed.z) > goal.goalWidth / 2);
});

test('the CPU varies where it shoots and does miss the target', () => {
  const goalSpec = { x: -35.5, width: 7.32 }, keeper = { x: -34, z: 1.5 };
  const random = createRandom(5);
  let wide = 0, far = 0, near = 0, central = 0; const N = 3000;
  for (let i = 0; i < N; i++) {
    const target = shotTarget(goalSpec, keeper, random, 1.3, { distance: 18 });
    if (Math.abs(target.z) > goalSpec.width / 2 + 0.11) wide++;
    if (Math.abs(target.z) < 1.9) central++; else if (target.z < 0) far++; else near++;
  }
  assert.ok(wide / N > 0.15, 'an Easy-level shooter misses the frame');
  assert.ok(far > near && near > N * 0.1 && central > N * 0.05, `far ${far} near ${near} central ${central}`);
  const exact = shotTarget(goalSpec, keeper, createRandom(1), 0);
  assert.ok(Math.abs(exact.z) < goalSpec.width / 2, 'a zero-error shooter always hits the frame');
});

test('a closing defender makes the CPU recycle sideways instead of running into him', () => {
  const field = { length: 71, width: 45 }, goalSpec = { x: -35.5, width: 7.32 };
  const base = { carrier: { index: 9, x: 0, z: 0, vx: -3, vz: 0 }, teammates: [{ index: 10, x: 1, z: 9, vx: 0, vz: 0 }],
    opponents: [{ index: 1, x: -3.5, z: 0.5 }], keeper: { x: -34, z: 0 }, goal: goalSpec, field, skill: { range: 18, accuracy: 0.8 } };
  const random = createRandom(2); const kinds = {};
  for (let i = 0; i < 300; i++) { const type = decideCarrier({ ...base, random }).type; kinds[type] = (kinds[type] || 0) + 1; }
  assert.ok(kinds.pass > 40 && kinds.dribble > 40, JSON.stringify(kinds));
  // A teammate well behind is never an outlet while unpressed and the defender is far off.
  const free = decideCarrier({ ...base, opponents: [], teammates: [{ index: 10, x: 12, z: 4, vx: 0, vz: 0 }], random: () => 0.1 });
  assert.equal(free.type, 'dribble');
});

test('weak dribblers take heavy touches at pace, strong ones do not', () => {
  const player = { x: 0, z: 0, vx: 7, vz: 0, heading: 0 }, ball = { x: 0.1, y: 0.11, z: 0 }, foot = { x: 0.1, y: 0.05, z: 0 };
  const touch = options => { const state = createBallControl(-1); state.lastTouch = 0; return footTouch(state, ball, { x: 7, y: 0, z: 0 }, player, [foot], 0.3, { sprint: true, ...options }); };
  const plain = touch({}), heavy = touch({ looseness: 0.8, random: () => 0 }), skilled = touch({ looseness: 0, random: () => 0 });
  assert.ok(heavy.velocity.x > plain.velocity.x + 0.5, 'a heavy touch sends the ball further ahead');
  assert.equal(skilled.velocity.x, plain.velocity.x, 'a skilled dribbler never takes one');
  assert.equal(touch({ looseness: 0.8 }).velocity.x, plain.velocity.x, 'without a random source touches are unchanged');
});

test('difficulty is about AI quality, not a speed hack, and stamina now matters', () => {
  for (const level of Object.values(DIFFICULTY)) assert.ok(level.pace >= 0.95 && level.pace <= 1.05);
  assert.ok(DIFFICULTY.Hard.quality > DIFFICULTY.Medium.quality && DIFFICULTY.Medium.quality > DIFFICULTY.Easy.quality);
  assert.ok(DIFFICULTY.Hard.pressers >= DIFFICULTY.Easy.pressers && DIFFICULTY.Easy.pressers >= 2);
  assert.ok(DIFFICULTY.Hard.shotRange > DIFFICULTY.Easy.shotRange);
  assert.ok(STAMINA.speedLoss >= 0.15, 'a tired player is visibly slower');
});
