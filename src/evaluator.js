// Fast 5-7 card poker hand evaluator.
// A hand score is category * 16^5 + up to five tie-break ranks in base 16,
// so a higher score is always a better hand and equal scores are exact ties.

export const CATEGORY_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

const RANK_NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
const RANK_PLURALS = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

const CATEGORY_BASE = 0x100000; // 16^5

// Scratch buffers reused across calls (evaluate is hot in Monte Carlo loops).
const counts = new Uint8Array(13);
const suitCounts = new Uint8Array(4);
const suitMasks = new Uint16Array(4);

/** High rank of the best straight in a 13-bit rank mask, or -1. */
function straightHigh(mask) {
  for (let hi = 12; hi >= 4; hi--) {
    const run = 0x1f << (hi - 4);
    if ((mask & run) === run) return hi;
  }
  return (mask & 0x100f) === 0x100f ? 3 : -1; // A-2-3-4-5 wheel
}

function topRanks(mask, n) {
  const out = [];
  for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r)) out.push(r);
  return out;
}

function pack(category, kickers) {
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 16 + (kickers[i] ?? 0);
  return score;
}

export function evaluate(cards) {
  counts.fill(0);
  suitCounts.fill(0);
  suitMasks.fill(0);
  let mask = 0;
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i] >> 2;
    const s = cards[i] & 3;
    counts[r]++;
    suitCounts[s]++;
    suitMasks[s] |= 1 << r;
    mask |= 1 << r;
  }

  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (suitCounts[s] >= 5) flushSuit = s;
  if (flushSuit >= 0) {
    const sf = straightHigh(suitMasks[flushSuit]);
    if (sf >= 0) return pack(8, [sf]);
  }

  let quad = -1, trip1 = -1, trip2 = -1, pair1 = -1, pair2 = -1;
  for (let r = 12; r >= 0; r--) {
    const c = counts[r];
    if (c === 4) { if (quad < 0) quad = r; }
    else if (c === 3) { if (trip1 < 0) trip1 = r; else if (trip2 < 0) trip2 = r; }
    else if (c === 2) { if (pair1 < 0) pair1 = r; else if (pair2 < 0) pair2 = r; }
  }

  if (quad >= 0) return pack(7, [quad, ...topRanks(mask & ~(1 << quad), 1)]);
  if (trip1 >= 0 && (trip2 >= 0 || pair1 >= 0)) return pack(6, [trip1, Math.max(trip2, pair1)]);
  if (flushSuit >= 0) return pack(5, topRanks(suitMasks[flushSuit], 5));
  const st = straightHigh(mask);
  if (st >= 0) return pack(4, [st]);
  if (trip1 >= 0) return pack(3, [trip1, ...topRanks(mask & ~(1 << trip1), 2)]);
  if (pair2 >= 0) return pack(2, [pair1, pair2, ...topRanks(mask & ~(1 << pair1) & ~(1 << pair2), 1)]);
  if (pair1 >= 0) return pack(1, [pair1, ...topRanks(mask & ~(1 << pair1), 3)]);
  return pack(0, topRanks(mask, 5));
}

export function handCategory(score) {
  return Math.floor(score / CATEGORY_BASE);
}

function kicker(score, i) {
  return Math.floor(score / 16 ** (4 - i)) % 16;
}

export function describeHand(score) {
  const k0 = kicker(score, 0);
  const k1 = kicker(score, 1);
  switch (handCategory(score)) {
    case 8: return k0 === 12 ? 'Royal Flush' : `Straight Flush, ${RANK_NAMES[k0]} high`;
    case 7: return `Four ${RANK_PLURALS[k0]}`;
    case 6: return `Full House, ${RANK_PLURALS[k0]} full of ${RANK_PLURALS[k1]}`;
    case 5: return `Flush, ${RANK_NAMES[k0]} high`;
    case 4: return `Straight, ${RANK_NAMES[k0]} high`;
    case 3: return `Three ${RANK_PLURALS[k0]}`;
    case 2: return `Two Pair, ${RANK_PLURALS[k0]} and ${RANK_PLURALS[k1]}`;
    case 1: return `Pair of ${RANK_PLURALS[k0]}`;
    default: return `${RANK_NAMES[k0]} High`;
  }
}

/** The five cards that make the best hand (used to highlight winners). */
export function bestFive(cards) {
  if (cards.length <= 5) return [...cards];
  let best = null;
  let bestScore = -1;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const hand = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const s = evaluate(hand);
            if (s > bestScore) { bestScore = s; best = hand; }
          }
  return best;
}
