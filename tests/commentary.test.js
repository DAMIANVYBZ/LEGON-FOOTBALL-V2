import test from 'node:test';
import assert from 'node:assert/strict';
import { pickLine, resultLine, scoreLine } from '../src/commentary.js';
import { playerName, setPlayerNames } from '../src/players.js';

test('score and result lines read like a commentator', () => {
  assert.equal(scoreLine('Commonwealth', 'Sarbah', [0, 0]), 'Still goalless');
  assert.equal(scoreLine('Commonwealth', 'Sarbah', [1, 0]), 'Commonwealth lead 1, nil');
  assert.equal(scoreLine('Commonwealth', 'Sarbah', [1, 2]), 'Sarbah lead 2, 1');
  assert.equal(scoreLine('Commonwealth', 'Sarbah', [2, 2]), '2 all');
  assert.equal(resultLine('Commonwealth', 'Sarbah', [3, 1]), 'Commonwealth win it, 3, 1.');
});

test('lines name the hall, or the username when there is one, and never repeat back to back', () => {
  const last = {};
  const values = { team: 'Commonwealth', venue: 'UG Stadium' };
  const first = pickLine('shot', values, () => 0, last);
  assert.ok(!first.text.includes('{'));
  for (let i = 0; i < 30; i++) assert.ok(!/from Commonwealth!$|path of Commonwealth/.test(pickLine('through', values, Math.random, last).text));
  const second = pickLine('shot', values, () => 0, last);
  assert.notEqual(second.text, first.text);
  assert.ok(pickLine('shot', { ...values, who: 'DamianVybz' }, () => 0, {}).text.includes('DamianVybz'));
  assert.equal(pickLine('goal', values, () => 0, {}).priority, 3);
  assert.equal(pickLine('nonsense', values), null);
});

test('usernames come from the campus game, and a solo player follows the controlled body', () => {
  setPlayerNames({ solo: 'DamianVybz', away: { 3: 'Kwame_10' } });
  assert.equal(playerName(5, 5), 'DamianVybz');
  assert.equal(playerName(4, 5), '');
  assert.equal(playerName(10, 5), 'Kwame_10');
  setPlayerNames({ home: { 2: 'Ama' } });
  assert.equal(playerName(2, 5), 'Ama');
});
