import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom, keeperPosition, keeperReach, saveOutcome, shotOnGoal } from '../src/keeper.js';
import { bestPassOption, decideCarrier, markingAssignments } from '../src/cpuBrain.js';

test('keepers cannot save balls above their vertical reach', () => {
  for (const diving of [false, true]) {
    assert.equal(saveOutcome({ gap: 0, height: 5, speed: 25, diving, random: () => 0.5 }), 'miss');
    assert.equal(saveOutcome({ gap: 0, height: 2.66, speed: 25, diving, random: () => 0.5 }), 'miss');
    assert.notEqual(saveOutcome({ gap: 0, height: 2.3, speed: 28, diving, random: () => 0.5 }), 'miss');
  }
});

test('the keeper narrows the angle and rushes out one-on-one', () => {
  const central = keeperPosition({ x: -20, z: 0 }, -35, 7.32);
  assert.ok(central.x > -35 && central.x < -32 && Math.abs(central.z) < 0.01);
  const wide = keeperPosition({ x: -30, z: 12 }, -35, 7.32);
  assert.ok(wide.z > 1.5 && wide.z <= 7.32 / 2, `near post ${wide.z}`);
  const rush = keeperPosition({ x: -25, z: 0 }, -35, 7.32, { oneOnOne: true });
  assert.ok(rush.x > central.x + 1, 'comes off the line to close down');
});

test('shots are tracked to the goal line and wide ones ignored', () => {
  const onTarget = shotOnGoal({ x: -20, y: 0.5, z: 0 }, { x: -20, y: 1, z: 1 }, -35, 7.32, 2.44);
  assert.ok(onTarget && Math.abs(onTarget.time - 0.75) < 1e-9 && onTarget.z > 0.5);
  assert.equal(shotOnGoal({ x: -20, y: 0.5, z: 0 }, { x: -20, y: 1, z: 12 }, -35, 7.32, 2.44), null);
  assert.equal(shotOnGoal({ x: -20, y: 0.5, z: 0 }, { x: 20, y: 1, z: 0 }, -35, 7.32, 2.44), null);
});

test('shots at the keeper are always stopped; stretching saves are not', () => {
  const random = createRandom(7);
  assert.equal(saveOutcome({ gap: 0.1, height: 1, speed: 10, diving: false, random }), 'catch');
  assert.equal(saveOutcome({ gap: 0, height: 2.15, speed: 29, diving: false, random }), 'punch');
  assert.ok(['parry', 'spill'].includes(saveOutcome({ gap: 0.2, height: 0.8, speed: 25, diving: false, random })), 'a hard shot at the body creates a rebound');
  assert.ok(['parry', 'spill'].includes(saveOutcome({ gap: 0.2, height: 0.8, speed: 33, diving: false, random })));
  assert.equal(saveOutcome({ gap: 3, height: 1, speed: 20, diving: true, random }), 'miss');
  assert.ok(keeperReach(1, true) > keeperReach(1, false));
  let saves = 0;
  for (let i = 0; i < 400; i++) if (saveOutcome({ gap: 1.4, height: 1, speed: 24, diving: true, random }) !== 'miss') saves++;
  assert.ok(saves > 40 && saves < 360, `a full-stretch save is sometimes made, sometimes not: ${saves}/400`);
});

test('the carrier passes to a free teammate rather than a marked one', () => {
  const carrier = { index: 9, x: 0, z: 0 };
  const option = bestPassOption(carrier, [{ index: 10, x: -10, z: 6 }, { index: 11, x: -10, z: -6 }],
    [{ index: 1, x: -10.5, z: 6.2 }], { x: -35, width: 7.32 });
  assert.equal(option.index, 11);
});

test('the CPU shoots in range, aims away from the keeper, and varies its play', () => {
  const field = { length: 70, width: 45 }, goal = { x: -35, width: 7.32 };
  const skill = { range: 18, accuracy: 0 };
  const random = createRandom(3);
  const shot = decideCarrier({ carrier: { index: 9, x: -24, z: 1 }, teammates: [], opponents: [], keeper: { x: -34, z: 1.5 },
    goal, field, skill, random: () => 0.5 });
  assert.equal(shot.type, 'shoot');
  assert.ok(shot.target.z < 0, 'aims at the far side from the keeper');
  const kinds = new Set();
  for (let i = 0; i < 200; i++) {
    kinds.add(decideCarrier({ carrier: { index: 9, x: -5, z: 0, vx: -3, vz: 0 }, teammates: [{ index: 10, x: -18, z: 8, vx: -4, vz: 0 }],
      opponents: [{ index: 1, x: -8.5, z: -1.5 }], keeper: { x: -34, z: 0 }, goal, field, skill, random }).type);
  }
  assert.ok(kinds.has('dribble') && (kinds.has('pass') || kinds.has('through')), [...kinds].join(','));
});

test('defenders mark goal-side of the attackers nearest goal', () => {
  const marks = markingAssignments([{ index: 1, x: -20, z: 5 }, { index: 2, x: -20, z: -5 }],
    [{ index: 9, x: -25, z: 6 }, { index: 10, x: -25, z: -6 }, { index: 11, x: 0, z: 0 }], -35);
  assert.equal(marks.get(1).attacker, 9);
  assert.equal(marks.get(2).attacker, 10);
  assert.ok(marks.get(1).x < -25, 'between the attacker and the goal');
});

test('teams are unique, grouped in three, and clashing kits get a change strip', async () => {
  const { TEAMS, TEAM_GROUPS, matchKits, teamShort } = await import('../src/teams.js');
  assert.deepEqual(Object.keys(TEAM_GROUPS), ['Traditional halls', 'UGEL halls', 'Private hostels']);
  assert.equal(new Set(TEAMS.map(team => team.name)).size, TEAMS.length);
  assert.ok(TEAMS.every(team => team.short.length <= 15), 'scoreboard names fit');
  assert.equal(matchKits('Commonwealth', 'Akuafo').away, '#2e8b3a');
  assert.equal(matchKits('Akuafo', 'Pent Hostel (African Union)').away, '#f1f1ec');
  assert.equal(teamShort('Evandy Hostel (United Nations)'), 'Evandy');
});


test('an unpressed CPU advances instead of recycling to a free teammate behind',()=>{
 const state={carrier:{index:9,x:0,z:0,vx:-3,vz:0},teammates:[{index:10,x:12,z:4,vx:0,vz:0}],opponents:[],
  keeper:{x:-34,z:0},goal:{x:-35.5,width:7.32},field:{length:71,width:45},skill:{range:18,accuracy:.8},random:()=>.1};
 assert.equal(decideCarrier(state).type,'dribble');
 const pressured=decideCarrier({...state,opponents:[{index:5,x:-1.5,z:1}]});
 assert.equal(pressured.type,'pass','a safe backward outlet is still available under pressure');
});
