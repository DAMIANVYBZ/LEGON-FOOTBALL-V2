// Coordinates are metres in LEGONRUSH's src/game/campusmap.ts world frame.
// They come from src/data/legon-map.json in the supplied main-game folder.
// Only named, verified place anchors are listed here. The remaining fields
// need their pitch coordinates from the main game's owner/map data.
export const CAMPUS_FOOTBALL_ANCHORS = Object.freeze([
  { venueId: 'sarbah', place: 'Sarbah field', x: -167.3, z: 688.3, radius: 38 },
  { venueId: 'gonja', place: 'Gonja Park', x: 177.2, z: 603.7, radius: 32 },
  { venueId: 'oval', place: 'Athletic Oval', x: 6.4, z: 403.4, radius: 48 },
  { venueId: 'ug-stadium', place: 'University of Ghana Sports Stadium', x: 776.6, z: 1412, radius: 55 },
]);

export function nearbyFootballVenue(x, z) {
  let nearest = null;
  for (const anchor of CAMPUS_FOOTBALL_ANCHORS) {
    const distance = Math.hypot(x - anchor.x, z - anchor.z);
    if (distance <= anchor.radius && (!nearest || distance < nearest.distance)) nearest = { ...anchor, distance };
  }
  return nearest;
}
