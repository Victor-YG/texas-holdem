import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCards, mulberry32 } from '../src/cards.js';
import { estimateEquity, chenScore } from '../src/equity.js';

test('AA vs one random hand is about 85%', () => {
  const { equity } = estimateEquity(parseCards('As Ah'), [], 1, 20000, mulberry32(1));
  assert.ok(Math.abs(equity - 0.852) < 0.015, `got ${equity}`);
});

test('72o vs one random hand is about 35%', () => {
  const { equity } = estimateEquity(parseCards('7s 2h'), [], 1, 20000, mulberry32(2));
  assert.ok(Math.abs(equity - 0.346) < 0.015, `got ${equity}`);
});

test('equity drops with more opponents', () => {
  const rng = mulberry32(3);
  const one = estimateEquity(parseCards('Ks Kh'), [], 1, 5000, rng).equity;
  const five = estimateEquity(parseCards('Ks Kh'), [], 5, 5000, rng).equity;
  assert.ok(five < one - 0.3);
});

test('the nuts on the river always wins', () => {
  const { equity } = estimateEquity(parseCards('Ah Kh'), parseCards('Qh Jh Th 2c 3d'), 3, 500, mulberry32(4));
  assert.equal(equity, 1);
});

test('range floors make opponents stronger', () => {
  const rng = mulberry32(5);
  const vsAny = estimateEquity(parseCards('Ts 9s'), [], 1, 8000, rng).equity;
  const vsStrong = estimateEquity(parseCards('Ts 9s'), [], 1, 8000, rng, [9]).equity;
  assert.ok(vsStrong < vsAny - 0.05, `${vsStrong} vs ${vsAny}`);
});

test('chen scores', () => {
  assert.equal(chenScore(...parseCards('As Ah')), 20);
  assert.equal(chenScore(...parseCards('As Ks')), 12);
  assert.equal(chenScore(...parseCards('2s 2h')), 5);
  assert.equal(chenScore(...parseCards('Js Ts')), 9);
  assert.equal(chenScore(...parseCards('7s 2h')), -1);
});
