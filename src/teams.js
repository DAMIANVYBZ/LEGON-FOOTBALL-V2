// University of Ghana sides, in the three groups the setup screen shows.
// short is the scoreboard name. Kit colours are the game's own choices.
export const TEAM_GROUPS = {
  'Traditional halls': [
    { name: 'Commonwealth', short: 'Commonwealth', color: '#c8102e' },
    { name: 'Mensah Sarbah', short: 'Mensah Sarbah', color: '#0b2a5b' },
    { name: 'Legon', short: 'Legon', color: '#e08a1e' },
    { name: 'Akuafo', short: 'Akuafo', color: '#2e8b3a' },
    { name: 'Volta', short: 'Volta', color: '#1f3a93' },
  ],
  'UGEL halls': [
    { name: 'Hilla Limann', short: 'Limann', color: '#5560e0' },
    { name: 'Alexander Adum Kwapong', short: 'Kwapong', color: '#c23b8a' },
    { name: 'Elizabeth Frances Sey', short: 'E. F. Sey', color: '#8a9a1c' },
    { name: 'Diamond Jubilee', short: 'Diamond Jubilee', color: '#6b4fbb' },
    { name: 'Jean Nelson Aka', short: 'Jean Nelson', color: '#16a3a3' },
    { name: 'Jubilee Hall', short: 'Jubilee', color: '#d4502a' },
    { name: 'ISH 1', short: 'ISH 1', color: '#2b7bb9' },
    { name: 'ISH 2', short: 'ISH 2', color: '#1b9e77' },
    { name: 'Valco Hall', short: 'Valco', color: '#7a5230' },
    { name: 'Legon Annex C', short: 'Legon Annex', color: '#b8860b' },
    { name: 'Sarbah Annex C & D', short: 'Sarbah Annex', color: '#34495e' },
    { name: 'Akuafo Annex C & D', short: 'Akuafo Annex', color: '#5d8a2f' },
  ],
  'Private hostels': [
    { name: 'TF Hostel', short: 'TF', color: '#e84393' },
    { name: 'Bani Hall', short: 'Bani', color: '#ff6f00' },
    { name: 'Evandy Hostel (United Nations)', short: 'Evandy', color: '#4fc3f7' },
    { name: 'Pent Hostel (African Union)', short: 'Pent', color: '#2e7d32' },
    { name: 'Sarbah Vikings Hostel', short: 'Vikings', color: '#263238', note: 'semi-private' },
  ],
};

export const TEAMS = Object.values(TEAM_GROUPS).flat();
export const TEAM_COLORS = Object.fromEntries(TEAMS.map(team => [team.name, team.color]));
export const hasTeam = name => TEAMS.some(team => team.name === name);
export const teamShort = name => TEAMS.find(team => team.name === name)?.short || name;

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
// Kits for a match. When the two colours are hard to tell apart, the away
// side wears its white change kit.
export function matchKits(home, away) {
  const homeColor = TEAM_COLORS[home] || '#c8102e', awayColor = TEAM_COLORS[away] || '#0b2a5b';
  const [a, b] = [rgb(homeColor), rgb(awayColor)];
  const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return { home: homeColor, away: distance < 110 ? '#f1f1ec' : awayColor };
}
