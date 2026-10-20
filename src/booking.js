// One rule controls both the astroturf reservation window and its match clock.
// The campus backend may override this before the football window starts.
export const bookingRules = Object.freeze({
  slotMinutes: 5,
  priceCoins: 10,
  bookingHorizonSlots: 12,
  demoStartingCoins: 50,
});

const KEY = 'monkeypost.astroturf.demo.v1';

export function slotStarts(now = Date.now(), rules = bookingRules) {
  const duration = rules.slotMinutes * 60_000;
  const first = Math.ceil(now / duration) * duration;
  return Array.from({ length: rules.bookingHorizonSlots }, (_, index) => first + index * duration);
}

export function readDemoBookings(now = Date.now()) {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      coins: Number.isFinite(saved.coins) ? saved.coins : bookingRules.demoStartingCoins,
      reservations: (saved.reservations || []).filter(item => item.start + bookingRules.slotMinutes * 60_000 > now),
    };
  } catch {
    return { coins: bookingRules.demoStartingCoins, reservations: [] };
  }
}

// This local adapter is a playable preview. The main game must replace it with
// one authoritative reservation and wallet transaction for cross-device play.
export function reserveDemoSlot(start, side, team, now = Date.now()) {
  if (!slotStarts(now).includes(start) || !['A', 'B'].includes(side)) throw new Error('Choose an available session.');
  const data = readDemoBookings(now);
  if (data.reservations.some(item => item.start === start && item.side === side)) throw new Error('This side is already booked. Choose another opening.');
  if (data.coins < bookingRules.priceCoins) throw new Error('Not enough demo coins for this booking.');
  const reservation = { id: crypto.randomUUID(), venueId: 'astro', start, side, team, priceCoins: bookingRules.priceCoins };
  data.coins -= bookingRules.priceCoins;
  data.reservations.push(reservation);
  localStorage.setItem(KEY, JSON.stringify(data));
  return { reservation, coins: data.coins };
}

export function slotLabel(start) {
  const end = start + bookingRules.slotMinutes * 60_000;
  const format = time => new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${format(start)} – ${format(end)}`;
}
