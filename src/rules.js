// Pitch x increases in the home team's attacking direction. Players use their
// ground position as the body proxy; arms and animation bones are not measured.
export function offsidePositions(passer, ball, players) {
  const direction = passer.home ? 1 : -1;
  const active = players.filter(p => !p.sentOff);
  const defenders = active.filter(p => p.home !== passer.home).map(p => p.x * direction).sort((a, b) => b - a);
  const line = Math.max(0, ball.x * direction, defenders[1] ?? -Infinity);
  return { home: passer.home, line: line * direction,
    candidates: active.filter(p => p.home === passer.home && p.index !== passer.index && p.x * direction > line + 0.01).map(p => p.index) };
}

export function createOffsideTracker() {
  let phase = null;
  return {
    clear() { phase = null; },
    snapshot() { return phase ? { ...phase, candidates: [...phase.candidates] } : null; },
    involved(player) {
      return Boolean(phase && player.home === phase.home && phase.candidates.includes(player.index));
    },
    touch(player, ball, players, { deliberate = false, save = false, exempt = false } = {}) {
      if (this.involved(player)) {
        phase = null;
        return { index: player.index, home: player.home, x: player.x, z: player.z };
      }
      // A save or an opponent's accidental deflection does not put an attacker
      // back onside. A deliberate opponent play or new teammate touch does.
      if (save) return null;
      if (exempt) phase = null;
      else if (deliberate || !phase || phase.home === player.home) phase = offsidePositions(player, ball, players);
      return null;
    },
  };
}

// Ground-position proxies for challenging an opponent or screening a keeper.
// This is deliberately separate from position tracking: position alone is not
// an infringement. Screening is considered only for a shot heading at goal.
export function offsideInterference(phase, ball, players, { shot = false } = {}) {
  if (!phase) return null;
  const opponents = players.filter(p => p.home !== phase.home && !p.sentOff);
  for (const p of players) {
    if (p.sentOff || !phase.candidates.includes(p.index)) continue;
    if (Math.hypot(p.x - ball.x, p.z - ball.z) < 1.5
      && opponents.some(o => Math.hypot(o.x - p.x, o.z - p.z) < 1.2)) return p.index;
    const keeper = opponents.find(o => o.keeper);
    if (!shot || !keeper || Math.hypot(keeper.x - p.x, keeper.z - p.z) > 6) continue;
    const dx = keeper.x - ball.x, dz = keeper.z - ball.z, distance2 = dx * dx + dz * dz;
    if (distance2 < 0.01) continue;
    const t = ((p.x - ball.x) * dx + (p.z - ball.z) * dz) / distance2;
    const gap = Math.hypot(p.x - ball.x - dx * t, p.z - ball.z - dz * t);
    const sightHeight = ball.y + (1.7 - ball.y) * t;
    if (t > 0 && t < 1 && gap < 0.4 && sightHeight < 1.9) return p.index;
  }
  return null;
}

export function goalCrossing(from, exit, goal, radius = 0.11) {
  return Boolean(exit?.line === 'goalLine'
    && exit.side * from.x <= goal.length / 2 + radius
    && Math.abs(exit.point.z) + radius < goal.width / 2
    && exit.point.y + radius < goal.height);
}
