const KEY = 'legon-football-team-progress-v1';

export function readTeamProgress(team, storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage.getItem(KEY) || '{}')[team];
    return { wins: Math.max(0, Math.min(100000, Math.floor(Number(value?.wins) || 0))),
      matches: Array.isArray(value?.matches) ? value.matches.filter(id => typeof id === 'string').slice(-100) : [] };
  } catch { return { wins: 0, matches: [] }; }
}

export function abilityForWins(wins) {
  return 1 + Math.min(20, Math.max(0, Number(wins) || 0)) * 0.01;
}

// Device-local solo progression only. Paid entitlements must come from an
// authenticated service after payment-provider webhook verification.
export function recordTeamWin(team, matchId, storage = globalThis.localStorage) {
  const current = readTeamProgress(team, storage);
  if (current.matches.includes(matchId)) return current;
  const data = JSON.parse(storage.getItem(KEY) || '{}');
  const next = { wins: current.wins + 1, matches: [...current.matches, matchId].slice(-100) };
  storage.setItem(KEY, JSON.stringify({ ...data, [team]: next }));
  return next;
}
