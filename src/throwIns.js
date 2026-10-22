const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Throw from overhead into the pitch. Power changes the flight's pace/height;
// the aim point controls its direction and range, up to a realistic 22 metres.
export function throwInPlan(spot, aim, power, field) {
  const side = Math.sign(spot.z) || 1;
  const target = { x: clamp(aim.x, -field.length / 2 + 1, field.length / 2 - 1),
    z: clamp(aim.z, -field.width / 2 + 1, field.width / 2 - 1) };
  target.z = side > 0 ? Math.min(target.z, spot.z - 1) : Math.max(target.z, spot.z + 1);
  let dx = target.x - spot.x, dz = target.z - spot.z;
  let distance = Math.hypot(dx, dz);
  if (distance < 4) { target.x = spot.x; target.z = spot.z - side * 4; }
  else if (distance > 22) { target.x = spot.x + dx / distance * 22; target.z = spot.z + dz / distance * 22; }
  dx = target.x - spot.x; dz = target.z - spot.z; distance = Math.hypot(dx, dz);
  return { target, origin: { x: spot.x, y: 1.8, z: spot.z }, height: 0.18,
    speed: distance / (1 + distance * 0.02) * (0.85 + clamp(power, 0, 1) * 0.3),
    minLift: 1.5, spin: () => ({ x: 0, y: 0, z: 0 }), style: 'none', thrown: true };
}
