import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCards } from '../src/cards.js';
import { evaluate, describeHand, handCategory, bestFive } from '../src/evaluator.js';

const score = (s) => evaluate(parseCards(s));

test('category ordering', () => {
  const hands = [
    '2c 7d 9h Js Kd 3c 4h', // high card
    '2c 2d 9h Js Kd 3c 4h', // pair
    '2c 2d 9h 9s Kd 3c 4h', // two pair
    '2c 2d 2h 9s Kd 3c 4h', // trips
    '5c 6d 7h 8s 9d 2c 2h', // straight
    '2h 7h 9h Jh Kh 3c 4d', // flush
    '2c 2d 2h 9s 9d 3c 4h', // full house
    '2c 2d 2h 2s Kd 3c 4h', // quads
    '5h 6h 7h 8h 9h 2c 2d', // straight flush
  ];
  hands.forEach((h, i) => assert.equal(handCategory(score(h)), i, h));
  for (let i = 1; i < hands.length; i++) assert.ok(score(hands[i]) > score(hands[i - 1]));
});

test('wheel is the lowest straight', () => {
  assert.equal(handCategory(score('Ac 2d 3h 4s 5d Kc Kh')), 4);
  assert.ok(score('2d 3h 4s 5d 6c Kc Qh') > score('Ac 2d 3h 4s 5d Kc Qh'));
  assert.equal(describeHand(score('Ac 2d 3h 4s 5d Kc Qh')), 'Straight, Five high');
});

test('steel wheel and royal flush', () => {
  assert.equal(describeHand(score('Ah 2h 3h 4h 5h Kc Qd')), 'Straight Flush, Five high');
  assert.equal(describeHand(score('Ah Kh Qh Jh Th 2c 3d')), 'Royal Flush');
});

test('flush uses the top five suited cards', () => {
  assert.ok(score('Ah Kh 9h 7h 4h 2h 3c') > score('Ah Kh 9h 7h 3h 2h 4c'));
});

test('kickers decide pairs and two pair', () => {
  assert.ok(score('Ac Ad Kh 9s 7d 3c 2h') > score('Ac Ad Qh 9s 7d 3c 2h'));
  // Three pairs: best two pair plays, and the third pair's rank can be the kicker.
  assert.equal(score('Ac Ad Kh Ks Qd Qc 2h'), score('Ac Ad Kh Ks Qd 3c 2h'));
  assert.equal(describeHand(score('Ac Ad Kh Ks Qd Qc 2h')), 'Two Pair, Aces and Kings');
});

test('two sets make a full house', () => {
  assert.equal(describeHand(score('9c 9d 9h 4s 4d 4c 2h')), 'Full House, Nines full of Fours');
});

test('quads kicker', () => {
  assert.ok(score('9c 9d 9h 9s Ad 2c 3h') > score('9c 9d 9h 9s Kd 2c 3h'));
});

test('board plays: exact tie', () => {
  assert.equal(score('2c 3d Ah Kh Qh Jh Th'), score('4c 5d Ah Kh Qh Jh Th'));
});

test('bestFive returns the cards making the hand', () => {
  const best = bestFive(parseCards('Ah Kh 2c 7d Qh Jh Th'));
  assert.deepEqual([...best].sort((a, b) => a - b), parseCards('Th Jh Qh Kh Ah').sort((a, b) => a - b));
});
