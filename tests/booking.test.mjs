import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookingRules, readDemoBookings, reserveDemoSlot, slotStarts } from '../src/booking.js';

test('five-minute slots do not overlap', () => {
  const starts = slotStarts(Date.UTC(2026, 9, 19, 10, 2));
  assert.equal(starts[0], Date.UTC(2026, 9, 19, 10, 5));
  assert.equal(starts[1] - starts[0], 5 * 60_000);
});

test('each slot has two team places and charges once per reservation', () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  const now = Date.UTC(2026, 9, 19, 10, 2);
  const start = slotStarts(now)[0];
  reserveDemoSlot(start, 'A', 'Commonwealth', now);
  assert.throws(() => reserveDemoSlot(start, 'A', 'Legon', now), /already booked/);
  reserveDemoSlot(start, 'B', 'Legon', now);
  const result = readDemoBookings(now);
  assert.equal(result.reservations.length, 2);
  assert.equal(result.coins, bookingRules.demoStartingCoins - 2 * bookingRules.priceCoins);
  assert.throws(() => reserveDemoSlot(start, 'C', 'Volta', now), /available session/);
});
