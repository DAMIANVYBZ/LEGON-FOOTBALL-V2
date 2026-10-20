import test from 'node:test';
import assert from 'node:assert/strict';
import { abilityForWins, readTeamProgress, recordTeamWin } from '../src/progression.js';

test('completed wins persist per team, cannot be awarded twice, and ability is bounded', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  assert.equal(readTeamProgress('Legon', storage).wins, 0);
  recordTeamWin('Legon', 'match-1', storage);
  recordTeamWin('Legon', 'match-1', storage);
  assert.equal(readTeamProgress('Legon', storage).wins, 1);
  assert.equal(readTeamProgress('Volta', storage).wins, 0);
  recordTeamWin('Legon', 'match-2', storage);
  assert.equal(abilityForWins(readTeamProgress('Legon', storage).wins), 1.02);
  assert.equal(abilityForWins(1000), 1.2);
});
