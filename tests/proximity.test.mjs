import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nearbyFootballVenue } from '../integration/legonrush-proximity.js';

test('the main game can identify a mapped field when walking or riding nearby', () => {
  assert.equal(nearbyFootballVenue(-167.3, 688.3)?.venueId, 'sarbah');
  assert.equal(nearbyFootballVenue(777, 1414)?.venueId, 'ug-stadium');
  assert.equal(nearbyFootballVenue(-400, -400), null);
});
