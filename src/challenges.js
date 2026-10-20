// Judge the route to the ball before the tackler wins it. Being behind the
// carrier alone is not a foul: a clean poke can reach an exposed ball first.
export function assessChallenge(tackler, carrier, ball, { style = 'standing', reach = tackler } = {}) {
  const dx = ball.x - tackler.x, dz = ball.z - tackler.z, length2 = dx * dx + dz * dz;
  const cx = carrier.x - tackler.x, cz = carrier.z - tackler.z, bodyGap = Math.hypot(cx, cz);
  const along = length2 > 1e-8 ? (cx * dx + cz * dz) / length2 : -1;
  const laneGap = Math.hypot(cx - dx * along, cz - dz * along);
  const blocked = along > 0 && along < 1 && laneGap < 0.45;
  const contact = bodyGap < 0.85 || (style === 'slide' && Math.hypot(reach.x - carrier.x, reach.z - carrier.z) < 0.6);
  const toward = bodyGap > 0 ? ((tackler.vx || 0) * cx + (tackler.vz || 0) * cz) / bodyGap : 0;
  const relative = bodyGap > 0 ? (((tackler.vx || 0) - (carrier.vx || 0)) * cx + ((tackler.vz || 0) - (carrier.vz || 0)) * cz) / bodyGap : 0;
  const approachSpeed = Math.max(0, Math.min(toward, relative));
  const foul = blocked && contact && (style !== 'standing' || approachSpeed > 1.5);
  const card = !foul ? null : style === 'slide' && approachSpeed > 5 ? 'red'
    : style === 'slide' || approachSpeed > 5 ? 'yellow' : null;
  return { blocked, contact, foul, card, approachSpeed };
}
