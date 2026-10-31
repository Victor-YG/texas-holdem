import { evaluate } from './evaluator.js';

const CHEN_HIGH_CARD = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 10]; // 2..A
const CHEN_GAP_PENALTY = [0, 1, 2, 4];

/** Bill Chen's preflop hand score: roughly -1 (72o) to 20 (AA). */
export function chenScore(a, b) {
  let hi = a >> 2;
  let lo = b >> 2;
  if (lo > hi) [hi, lo] = [lo, hi];
  let score = CHEN_HIGH_CARD[hi];
  if (hi === lo) return Math.max(5, score * 2);
  if ((a & 3) === (b & 3)) score += 2;
  const gap = hi - lo - 1;
  score -= CHEN_GAP_PENALTY[gap] ?? 5;
  if (gap <= 1 && hi < 10) score += 1; // connected or one-gap, both below a queen
  return Math.ceil(score);
}

/**
 * Monte Carlo equity of `hole` against `numOpponents` unknown hands.
 * `oppFloors` (optional) gives a minimum Chen score per opponent, a cheap
 * way to model "this player raised preflop, so their range is strong".
 */
export function estimateEquity(hole, board, numOpponents, iterations = 1000, rng = Math.random, oppFloors = null) {
  if (numOpponents < 1) return { equity: 1, win: 1, tie: 0 };
  const dead = new Set([...hole, ...board]);
  const deck = [];
  for (let c = 0; c < 52; c++) if (!dead.has(c)) deck.push(c);
  const n = deck.length;
  const need = 5 - board.length;
  const opp = new Array(numOpponents * 2);
  const runout = new Array(5);
  const hand = new Array(7);
  for (let i = 0; i < board.length; i++) runout[i] = board[i];

  let share = 0, wins = 0, ties = 0;
  for (let it = 0; it < iterations; it++) {
    let k = 0;
    const pick = () => {
      const j = k + Math.floor(rng() * (n - k));
      const t = deck[k]; deck[k] = deck[j]; deck[j] = t;
      return deck[k++];
    };

    for (let o = 0; o < numOpponents; o++) {
      let c1 = pick(), c2 = pick();
      const floor = oppFloors?.[o];
      if (floor != null && floor > -10) {
        for (let tries = 0; tries < 8 && chenScore(c1, c2) < floor; tries++) {
          k -= 2;
          c1 = pick(); c2 = pick();
        }
      }
      opp[o * 2] = c1;
      opp[o * 2 + 1] = c2;
    }
    for (let i = 0; i < need; i++) runout[board.length + i] = pick();

    for (let i = 0; i < 5; i++) hand[i + 2] = runout[i];
    hand[0] = hole[0]; hand[1] = hole[1];
    const hero = evaluate(hand);

    let best = -1, bestCount = 0;
    for (let o = 0; o < numOpponents; o++) {
      hand[0] = opp[o * 2]; hand[1] = opp[o * 2 + 1];
      const s = evaluate(hand);
      if (s > best) { best = s; bestCount = 1; }
      else if (s === best) bestCount++;
    }
    if (hero > best) { share += 1; wins++; }
    else if (hero === best) { share += 1 / (bestCount + 1); ties++; }
  }
  return { equity: share / iterations, win: wins / iterations, tie: ties / iterations };
}
