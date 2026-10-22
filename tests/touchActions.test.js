import test from 'node:test';
import assert from 'node:assert/strict';
import { touchActions } from '../src/touchActions.js';

test('four stable touch buttons switch from attack to standing/slide defence', () => {
  const attack=touchActions(true),defend=touchActions(false);
  assert.equal(attack.length,4); assert.deepEqual(attack.map(x=>x.id),defend.map(x=>x.id));
  assert.deepEqual(attack.map(x=>x.label),['JOCKEY','SHOOT','PASS','SPRINT']);
  assert.deepEqual(defend.map(x=>x.label),['SWITCH','SLIDE','TACKLE','SPRINT']);
  assert.equal(attack[0].key,'h','jockey must protect the ball, not make a teammate run');
  assert.equal(defend[1].key,'u','circle must slide, not make a standing tackle');
  assert.equal(defend[2].key,'touchTackle');assert.equal(defend[0].key,'touchSwitch');
});

test('keeper can still put the ball down using the existing context button', () => {
  const controls=touchActions(true,true);
  assert.equal(controls.length,4);assert.equal(controls[0].key,'q');assert.equal(controls[0].label,'PUT DOWN');
  assert.equal(controls[1].key,'k');assert.equal(controls[2].key,'j');
});
