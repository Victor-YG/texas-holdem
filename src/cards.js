// Cards are integers 0..51: rank = card >> 2 (0 = deuce .. 12 = ace), suit = card & 3.

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';
export const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };

export const rankOf = (card) => card >> 2;
export const suitOf = (card) => card & 3;

export function cardToString(card) {
  return RANKS[rankOf(card)] + SUITS[suitOf(card)];
}

export function parseCard(str) {
  const rank = RANKS.indexOf(str[0].toUpperCase());
  const suit = SUITS.indexOf(str[1]?.toLowerCase());
  if (rank < 0 || suit < 0) throw new Error(`Bad card: ${str}`);
  return rank * 4 + suit;
}

export function parseCards(str) {
  return str.trim().split(/\s+/).filter(Boolean).map(parseCard);
}

export function newDeck() {
  return Array.from({ length: 52 }, (_, i) => i);
}

const u32 = new Uint32Array(1);

/** Uniform [0, 1) from the platform CSPRNG when available. Used for shuffling. */
export function secureRandom() {
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(u32);
    return u32[0] / 4294967296;
  }
  return Math.random();
}

/** Small seeded PRNG, used by tests for reproducible games. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng = secureRandom) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
