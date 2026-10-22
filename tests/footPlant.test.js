import test from 'node:test';
import assert from 'node:assert/strict';
import { Bone, Object3D, Vector3, Quaternion } from 'three';
import { plantControlFoot, placeSlideFoot } from '../src/footPlant.js';

test('a control-foot reach moves the boot toward the ball without stretching the leg or twisting its sole', () => {
  const root = new Object3D(), hip = new Bone(), knee = new Bone(), ankle = new Bone(), toe = new Bone();
  root.add(hip); hip.add(knee); knee.add(ankle); ankle.add(toe);
  hip.position.set(0, 0.85, 0); knee.position.set(0.1, -0.4, 0); ankle.position.set(-0.1, -0.35, 0); toe.position.set(0.15, -0.06, 0);
  root.rotation.y = 0.5; root.updateMatrixWorld(true);
  const position = bone => bone.getWorldPosition(new Vector3());
  const upper = position(hip).distanceTo(position(knee)), lower = position(knee).distanceTo(position(ankle));
  const sole = ankle.getWorldQuaternion(new Quaternion());
  const before = position(toe), target = before.clone().add(new Vector3(0.35, 0, 0));
  assert.equal(plantControlFoot(toe, target), true);
  assert.ok(position(toe).distanceTo(target) < before.distanceTo(target));
  assert.ok(Math.abs(position(hip).distanceTo(position(knee)) - upper) < 1e-6);
  assert.ok(Math.abs(position(knee).distanceTo(position(ankle)) - lower) < 1e-6);
  assert.ok(ankle.getWorldQuaternion(new Quaternion()).angleTo(sole) < 1e-6);
  assert.equal(plantControlFoot(toe, target.clone().add(new Vector3(5, 0, 0))), false);
});

test('a grounded slide reach preserves both leg lengths even for an unreachable target', () => {
  const root = new Object3D(), hip = new Bone(), knee = new Bone(), ankle = new Bone(), toe = new Bone();
  root.add(hip); hip.add(knee); knee.add(ankle); ankle.add(toe);
  hip.position.set(0, .3, 0); knee.position.set(.2, -.35, 0); ankle.position.set(-.2, -.35, 0); toe.position.set(.15, -.06, 0);
  root.updateMatrixWorld(true);
  const position = b => b.getWorldPosition(new Vector3());
  const upper = position(hip).distanceTo(position(knee)), lower = position(knee).distanceTo(position(ankle));
  for (const x of [.5, .75, 3]) {
    placeSlideFoot(toe, { x, y: .06, z: .12 }, 1);
    assert.ok(position(toe).toArray().every(Number.isFinite));
    assert.ok(Math.abs(position(hip).distanceTo(position(knee)) - upper) < 1e-6);
    assert.ok(Math.abs(position(knee).distanceTo(position(ankle)) - lower) < 1e-6);
  }
});
