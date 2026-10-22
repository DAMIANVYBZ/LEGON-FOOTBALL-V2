import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoalRecorder, sampleGoalReplay, replayCamera, GOAL_ANGLES } from '../src/goalReplay.js';

const frame = x => ({ ball: [x, .5, 0], rotation: [0, 0, 0, 1], players: [{ x, z: 1, heading: x ? -3.1 : 3.1, action: 'jog', time: x / 10, visible: true }] });
test('goal recording is bounded, sampled at 30 Hz and cleared between matches', () => {
  const recorder = createGoalRecorder();
  for (let tick = 0; tick < 1200; tick++) if (recorder.wants(tick / 60)) recorder.push(tick / 60, frame(tick));
  const clip = recorder.clip();
  assert.ok(clip.length <= 181 && clip.length >= 179);
  assert.ok(clip.at(-1).t - clip[0].t <= 6.001);
  recorder.clear(); assert.deepEqual(recorder.clip(), []); assert.equal(recorder.wants(0), true);
});
test('goal playback interpolates the recorded ball, animation and shortest turn without changing history', () => {
  const frames = [{ ...frame(0), t: 10 }, { ...frame(2), t: 11 }], original = JSON.stringify(frames);
  const sample = sampleGoalReplay(frames, .5);
  assert.equal(sample.ball[0], 1); assert.equal(sample.players[0].x, 1); assert.equal(sample.players[0].time, .1);
  assert.ok(Math.abs(sample.players[0].heading - Math.PI) < .001);
  assert.equal(JSON.stringify(frames), original);
  assert.deepEqual(sampleGoalReplay(frames, 100).ball, frames[1].ball);
  assert.equal(sampleGoalReplay([], 0), null);
});
test('three distinct replay cameras work at either goal and on portrait screens', () => {
  assert.equal(GOAL_ANGLES, 3);
  for (const side of [-1, 1]) for (const aspect of [.6, 2.1]) {
    const cameras = Array.from({ length: GOAL_ANGLES }, (_, i) => replayCamera(i, [side * 30, 1, 2], side * 35.5, aspect));
    assert.equal(new Set(cameras.map(c => JSON.stringify(c.position))).size, 3);
    for (const c of cameras) assert.ok(Object.values(c.position).every(Number.isFinite));
  }
});
