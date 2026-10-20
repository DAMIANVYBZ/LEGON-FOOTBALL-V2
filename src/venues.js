// Pitches are sized for seven-a-side: 75% of each field's full marked size.
export const VENUES = [
  { id: 'sarbah', name: 'Mensah Sarbah Field', shortName: 'Sarbah Field', surface: 'worn', kind: 'park', length: 71, width: 45, description: 'A broad, worn grass and red-earth campus field with trees and a modest covered seating area.', reference: 'Reference 1' },
  { id: 'gonja', name: 'Gonja Park', shortName: 'Gonja Park', surface: 'soil', kind: 'park', length: 59, width: 38, description: 'A compact red-earth clearing bordered by dense trees and simple park seating.', reference: 'Reference 2' },
  { id: 'nania-main', name: 'Nania FC Park — Main', shortName: 'Nania Main', surface: 'grass', kind: 'nania', field: 'main', length: 75, width: 48, description: 'The main grass pitch of the three-field Nania FC complex, beside its larger covered stand.', reference: 'Reference 5 · west field' },
  { id: 'nania-north', name: 'Nania FC Park — North', shortName: 'Nania North', surface: 'mixed', kind: 'nania', field: 'north', length: 66, width: 42, description: 'The northern practice park, with mixed grass and exposed red earth.', reference: 'Reference 5 · centre field' },
  { id: 'nania-east', name: 'Nania FC Park — East', shortName: 'Nania East', surface: 'grass', kind: 'nania', field: 'east', length: 69, width: 44, description: 'The eastern grass park, with paths, trees and a small covered stand.', reference: 'Reference 5 · east field' },
  { id: 'astro', name: 'Presec Astroturf', shortName: 'Astroturf', surface: 'astro', kind: 'astro', length: 56, width: 36, description: 'An enclosed, bright-green artificial turf pitch with perimeter fencing and compact seating.', reference: 'Reference 6' },
  { id: 'oval', name: 'Athletic Oval Mini Stadium', shortName: 'Athletic Oval', surface: 'mixed', kind: 'oval', length: 75, width: 45, description: 'An oval campus ground with a worn grass field, running track, basketball and tennis courts.', reference: 'Reference 4' },
  { id: 'ug-stadium', name: 'University of Ghana Stadium', shortName: 'UG Stadium', surface: 'grass', kind: 'stadium', length: 79, width: 51, description: 'A full-size grass stadium with blue athletics track, floodlights and a continuous seating bowl.', reference: 'Reference 3' },
];

export const DEFAULT_VENUE = 'ug-stadium';
export const getVenue = id => VENUES.find(venue => venue.id === id) || VENUES.find(venue => venue.id === DEFAULT_VENUE);
export const hasVenue = id => VENUES.some(venue => venue.id === id);
