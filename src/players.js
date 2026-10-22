// Usernames of real players, supplied by the parent campus game. Indices are
// match slots use the active venue team size; each team starts with its keeper.
// A solo player's username follows whichever home player they control.
let names = { home: {}, away: {}, solo: '' };

export function setPlayerNames({ home = {}, away = {}, solo } = {}) {
  names = { home: { ...home }, away: { ...away }, solo: typeof solo === 'string' ? solo.trim().slice(0, 24) : names.solo };
}

export function playerName(index, controlled = -1, teamSize = 7) {
  const home = index < teamSize, slot = home ? index : index - teamSize;
  const named = (home ? names.home : names.away)[slot];
  if (named) return String(named).slice(0, 24);
  return home && index === controlled && names.solo ? names.solo : '';
}

// ?player=Name in the launch URL sets the solo username.
const fromUrl = new URLSearchParams(globalThis.location?.search || '').get('player');
if (fromUrl) setPlayerNames({ solo: fromUrl });
