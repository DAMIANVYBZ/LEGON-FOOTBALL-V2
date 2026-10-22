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
  const threshold = style === 'standing' ? 2.8 : style === 'hard' ? 1.8 : 2;
  const foul = blocked && contact && approachSpeed > threshold;
  const card = !foul ? null : style === 'slide' && approachSpeed > 5 ? 'red'
    : style === 'slide' || approachSpeed > 5 ? 'yellow' : null;
  return { blocked, contact, foul, card, approachSpeed };
}

// Primary defender works around a shield; support stays goal-side to contain.
// A blocked route is a positioning problem, not a reason to spam tackles.
export function defensiveApproach(defender, carrier, ball, { goalX, primary = true } = {}) {
  if (!primary) {
    const dx = goalX - carrier.x, dz = -carrier.z, size = Math.hypot(dx, dz) || 1;
    return { x: carrier.x + dx / size * 1.8, z: carrier.z + dz / size * 1.8 + (defender.z >= carrier.z ? .9 : -.9) };
  }
  if (!assessChallenge(defender, carrier, ball).blocked) return { x: ball.x, z: ball.z };
  const dx = ball.x - carrier.x, dz = ball.z - carrier.z, size = Math.hypot(dx, dz) || 1;
  const side = ((defender.x - carrier.x) * -dz + (defender.z - carrier.z) * dx) >= 0 ? 1 : -1;
  // Finish on the ball side of the carrier. A point only .35 m ahead still
  // leaves the body blocking a close touch, trapping the defender in jockey.
  return { x: carrier.x + dx / size * .95 - dz / size * side * 1.25,
    z: carrier.z + dz / size * .95 + dx / size * side * 1.25 };
}

// Slide and follow-through for 1.1 s, then rise for .6 s: back in play after
// 1.7 s whether the boot finds the ball or misses. No extra prone hold.
export const SLIDE_TIMING = Object.freeze({ animation: 1.1,
  missedRecovery: .6, groundHold: 0, getUp: .6 });
