import { Quaternion, Vector3 } from 'three';

const hipAt = new Vector3(), kneeAt = new Vector3(), ankleAt = new Vector3(), toeAt = new Vector3();
const target = new Vector3(), axis = new Vector3(), pole = new Vector3(), kneeTarget = new Vector3();
const from = new Vector3(), to = new Vector3(), parentRotation = new Quaternion(), turn = new Quaternion(), ankleRotation = new Quaternion();

function pointBone(bone, child, destination) {
  bone.getWorldPosition(from); child.getWorldPosition(to); to.sub(from).normalize();
  from.subVectors(destination, from).normalize(); turn.setFromUnitVectors(to, from);
  bone.parent.getWorldQuaternion(parentRotation);
  turn.premultiply(parentRotation.clone().invert()).multiply(parentRotation);
  bone.quaternion.premultiply(turn); bone.updateWorldMatrix(false, true);
}

// A small two-joint reach for trapping/turning. Preserve the boot's world
// orientation and the authored knee bend; never stretch either leg segment.
export function plantControlFoot(toe, ball, maxReach = 0.35) {
  const ankle = toe.parent, knee = ankle?.parent, hip = knee?.parent;
  if (!hip?.isBone || !knee.isBone || !ankle.isBone) return false;
  toe.getWorldPosition(toeAt);
  const gap = Math.hypot(ball.x - toeAt.x, ball.z - toeAt.z);
  if (gap < 0.2 || gap > maxReach + 0.32) return false;
  ankle.getWorldQuaternion(ankleRotation);
  hip.getWorldPosition(hipAt); knee.getWorldPosition(kneeAt); ankle.getWorldPosition(ankleAt);
  const amount = Math.min(maxReach, gap - 0.18) / gap;
  target.copy(ankleAt); target.x += (ball.x - toeAt.x) * amount; target.z += (ball.z - toeAt.z) * amount;
  const upper = hipAt.distanceTo(kneeAt), lower = kneeAt.distanceTo(ankleAt);
  axis.subVectors(target, hipAt);
  const distance = Math.min(axis.length(), (upper + lower) * 0.995);
  if (distance < Math.abs(upper - lower) + 0.01) return false;
  axis.normalize(); target.copy(hipAt).addScaledVector(axis, distance);
  pole.subVectors(kneeAt, hipAt).addScaledVector(axis, -pole.dot(axis));
  if (pole.lengthSq() < 1e-8) return false;
  pole.normalize();
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  kneeTarget.copy(hipAt).addScaledVector(axis, along).addScaledVector(pole, Math.sqrt(Math.max(0, upper * upper - along * along)));
  pointBone(hip, knee, kneeTarget); pointBone(knee, ankle, target);
  ankle.parent.getWorldQuaternion(parentRotation);
  ankle.quaternion.copy(parentRotation.invert().multiply(ankleRotation));
  ankle.updateWorldMatrix(false, true);
  return true;
}
