// Team sizes are venue-specific; Presec retains its existing seven-a-side game.
export const SMALL_FORMATIONS = ['2–2–2', '3–2–1', '2–3–1'];
export const LARGE_FORMATIONS = ['3–3–3', '4–3–2', '3–4–2'];
export const teamSizeForVenue = venue => venue?.kind === 'astro' || venue?.id === 'astro' ? 7 : 10;
export const formationsForVenue = venue => teamSizeForVenue(venue) === 7 ? SMALL_FORMATIONS : LARGE_FORMATIONS;
export function resolveFormation(formation, teamSize) {
  const choices = teamSize === 7 ? SMALL_FORMATIONS : LARGE_FORMATIONS;
  if (choices.includes(formation)) return formation;
  const previous = (teamSize === 7 ? LARGE_FORMATIONS : SMALL_FORMATIONS).indexOf(formation);
  return choices[Math.max(0, previous)];
}
export function fieldPositions(formation, side, length, width, teamSize = 7) {
  const rows = resolveFormation(formation, teamSize).split('–').map(Number);
  const xRows = [-length * .34, -length * .19, -length * .055];
  const positions = [[side * -length * .46, 0]];
  rows.forEach((count, row) => {
    for (let i = 0; i < count; i++) positions.push([side * xRows[row], (i - (count - 1) / 2) * (Math.min(38, width * .66) / Math.max(count - 1, 1))]);
  });
  return positions;
}
export const kickoffRoles = teamSize => teamSize === 7 ? [5, 6, 4, 3, 2, 1] : [8, 9, 7, 6, 5, 4, 3, 2, 1];
