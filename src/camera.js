import { Vector3 } from 'three';

// Fit the taker, ball, target and (for close attacking restarts) goal frame.
// Asymmetric vertical margins leave space for the scoreboard and phone HUD.
export function restartFraming({ piece, taker, aim, goalX, goalWidth, goalHeight, aspect, fov, phone = false, extraPoints = [] }) {
  const { spot, type } = piece;
  const ahead = new Vector3(aim.x - spot.x, 0, aim.z - spot.z).normalize();
  if (ahead.lengthSq() < 0.01) ahead.set(piece.home ? 1 : -1, 0, 0);
  const tactical = ['goalKick', 'throwIn'].includes(type) || Math.abs(goalX - spot.x) > 32;
  const back = new Vector3(-ahead.x * 0.85 - ahead.z * 0.12, tactical ? 0.38 : 0.28,
    -ahead.z * 0.85 + ahead.x * 0.12).normalize();
  const right = new Vector3(back.z, 0, -back.x).normalize(), up = back.clone().cross(right).normalize();
  const points = [new Vector3(spot.x, 0.11, spot.z), new Vector3(taker.x, 0, taker.z),
    new Vector3(taker.x, 1.8, taker.z), new Vector3(aim.x, aim.y || 0.5, aim.z)];
  for (const p of extraPoints) points.push(new Vector3(p.x, p.y || 0.11, p.z));
  if (!tactical) for (const z of [-goalWidth / 2, goalWidth / 2]) {
    points.push(new Vector3(goalX, 0, z), new Vector3(goalX, goalHeight, z));
  }
  const min = points[0].clone(), max = min.clone();
  for (const point of points) { min.min(point); max.max(point); }
  const centre = min.add(max).multiplyScalar(0.5);
  const bounds = { left: -0.78, right: 0.78, bottom: phone ? -0.72 : -0.78, top: phone ? 0.34 : 0.65 };
  const midY = (bounds.bottom + bounds.top) / 2;
  const tanV = Math.tan(fov * Math.PI / 360), tanH = tanV * aspect;
  let distance = tactical ? 20 : 8;
  for (const point of points) {
    const delta = point.clone().sub(centre), x = delta.dot(right), y = delta.dot(up), z = delta.dot(back);
    distance = Math.max(distance, z + 1,
      z + x / ((x >= 0 ? bounds.right : bounds.left) * tanH),
      (y / tanV + bounds.top * z) / (bounds.top - midY),
      (-y / tanV - bounds.bottom * z) / (midY - bounds.bottom));
  }
  distance *= 1.04;
  const focus = centre.clone().addScaledVector(up, -midY * distance * tanV);
  return { position: focus.clone().addScaledVector(back, distance), focus, points, bounds };
}

// Like the reference camera, favour the possession player and add bounded
// anticipation. Track across the pitch rather than fitting both touchlines.
export function gameplayFraming({ ball, velocity, carrier = null, target = null, width, length, aspect, wide = false }) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const anchor = target || (carrier ? {
    x: ball.x * 0.4 + carrier.x * 0.6,
    z: ball.z * 0.4 + carrier.z * 0.6,
  } : ball);
  const leadX = target ? 0 : clamp(velocity.x * 0.18, -2.8, 2.8);
  const leadZ = target ? 0 : clamp(velocity.z * 0.14, -1.8, 1.8);
  const focus = new Vector3(clamp(anchor.x + leadX, -length / 2 + 2, length / 2 - 2),
    0.9 + clamp((ball.y - 0.5) * 0.4, 0, 4), clamp(anchor.z + leadZ, -width / 2, width / 2));
  // A much closer, lower broadcast view; Wide retains more passing context.
  const distance = (wide ? 1.28 : 1) * (aspect < 1.2 ? 1.2 : 1);
  return { focus, position: focus.clone().add(new Vector3(0, width * 0.30 * distance, width * 0.39 * distance)) };
}
