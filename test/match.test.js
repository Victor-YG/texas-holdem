import { test } from 'node:test';
import assert from 'node:assert/strict';
import { borrowsLeft, canBorrow, checkGameEnd, isAlive, standings } from '../src/match.js';

const players = (...chips) => chips.map((c, seat) => ({ seat, name: `P${seat}`, chips: c }));
const meta = (over = {}) => ({ buyIn: 2000, target: 10000, maxBorrows: 5, borrows: [0, 0, 0], continued: false, ...over });

test('borrow limits', () => {
  const t = meta({ borrows: [5, 2, 0] });
  assert.equal(borrowsLeft(t, 0), 0);
  assert.equal(borrowsLeft(t, 1), 3);
  assert.equal(canBorrow(t, 0), false);
  assert.equal(canBorrow(t, 2), true);
  assert.equal(borrowsLeft(meta({ maxBorrows: -1, borrows: [99, 0, 0] }), 0), Infinity);
  assert.equal(canBorrow(meta({ maxBorrows: 0 }), 1), false);
});

test('a busted player with borrows left is still alive', () => {
  const t = meta({ borrows: [5, 4, 0] });
  const [a, b] = players(0, 0, 100);
  assert.equal(isAlive(t, a), false);
  assert.equal(isAlive(t, b), true);
  assert.equal(isAlive(t, { ...b, eliminated: true }), false);
});

test('no end while nobody has reached the target', () => {
  assert.equal(checkGameEnd(players(9999, 3000, 3000), meta(), 0), null);
});

test('anyone reaching the target wins, the biggest stack first', () => {
  assert.deepEqual(checkGameEnd(players(10000, 2000, 4000), meta(), 0), { type: 'target', winner: 0 });
  assert.deepEqual(checkGameEnd(players(3000, 10500, 12000), meta(), 0), { type: 'target', winner: 2 });
});

test('after choosing to keep playing, the target no longer ends the game', () => {
  assert.equal(checkGameEnd(players(15000, 2000, 2000), meta({ continued: true }), 0), null);
});

test('no target configured', () => {
  assert.equal(checkGameEnd(players(50000, 2000, 2000), meta({ target: 0 }), 0), null);
});

test('the human busting with no borrows left is game over, even if someone also hit the target', () => {
  const t = meta({ borrows: [5, 0, 0] });
  assert.deepEqual(checkGameEnd(players(0, 12000, 3000), t, 0), { type: 'out' });
  // With a borrow left, it's not over.
  assert.equal(checkGameEnd(players(0, 5000, 3000), meta({ borrows: [4, 0, 0] }), 0), null);
});

test('last player standing wins', () => {
  const t = meta({ maxBorrows: 0, borrows: [0, 0, 0] });
  assert.deepEqual(checkGameEnd(players(6000, 0, 0), t, 0), { type: 'last', winner: 0 });
  const t2 = meta({ borrows: [0, 5, 5] });
  assert.deepEqual(checkGameEnd(players(6000, 0, 0), t2, 0), { type: 'last', winner: 0 });
  // Bots that can still borrow keep the match going.
  assert.equal(checkGameEnd(players(6000, 0, 0), meta({ borrows: [0, 5, 4] }), 0), null);
});

test('standings put players still in first, ordered by chips', () => {
  const t = meta({ maxBorrows: 1, borrows: [0, 1, 0] });
  const rows = standings(players(3000, 0, 5000), t);
  assert.deepEqual(rows.map((r) => [r.seat, r.out]), [[2, false], [0, false], [1, true]]);
});
