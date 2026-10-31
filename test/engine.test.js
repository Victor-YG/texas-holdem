import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCards, mulberry32, newDeck, shuffle } from '../src/cards.js';
import { evaluate } from '../src/evaluator.js';
import { Game } from '../src/engine.js';
import { decideAction, DIFFICULTIES, PERSONALITIES } from '../src/bot.js';

/** Deck that yields `draws` in order (engine draws with pop()). */
function rig(draws) {
  const used = new Set(draws);
  const rest = newDeck().filter((c) => !used.has(c));
  return [...rest, ...[...draws].reverse()];
}

function table(stacks, { sb = 5, bb = 10, button } = {}) {
  // The engine moves the button one seat at startHand(), so pass the seat before the desired button.
  const players = stacks.map((chips, i) => ({ name: `P${i}`, chips }));
  const before = (button - 1 + stacks.length) % stacks.length;
  return new Game({ players, smallBlind: sb, bigBlind: bb, button: before, rng: mulberry32(7) });
}

const total = (g) => g.players.reduce((s, p) => s + p.chips, 0) + g.totalPot();

test('heads-up: button posts small blind, acts first preflop and last postflop', () => {
  const g = table([1000, 1000], { button: 0 });
  g.startHand();
  assert.equal(g.button, 0);
  assert.equal(g.sbSeat, 0);
  assert.equal(g.bbSeat, 1);
  assert.equal(g.toAct, 0);
  g.act({ type: 'call' });
  // Big blind gets the option.
  assert.equal(g.toAct, 1);
  const legal = g.legalActions();
  assert.ok(legal.canCheck && legal.canRaise);
  g.act({ type: 'check' });
  assert.equal(g.street, 'flop');
  assert.equal(g.toAct, 1);
});

test('everyone folds to the big blind', () => {
  const g = table([1000, 1000, 1000], { button: 0 });
  g.startHand();
  assert.equal(g.toAct, 0); // UTG in 3-handed is the button
  g.act({ type: 'fold' });
  g.act({ type: 'fold' });
  assert.ok(g.handOver);
  assert.deepEqual(g.players.map((p) => p.chips), [1000, 995, 1005]);
  assert.equal(g.result.showdown, false);
});

test('min-raise tracks the last raise size', () => {
  const g = table([1000, 1000], { button: 0 });
  g.startHand();
  g.act({ type: 'raise', amount: 50 }); // raise of 40
  assert.equal(g.legalActions().minRaiseTo, 90);
  g.act({ type: 'raise', amount: 10 }); // too small: clamped up to the minimum
  assert.equal(g.players[1].bet, 90);
});

test('side pots with three all-ins', () => {
  const g = table([100, 300, 500], { button: 0 });
  const [a1, a2] = parseCards('As Ah');
  const [k1, k2] = parseCards('Ks Kh');
  const [q1, q2] = parseCards('Qs Qh');
  // Deal order starts left of the button: seats 1, 2, 0, 1, 2, 0.
  const deck = rig([k1, q1, a1, k2, q2, a2, ...parseCards('5d 2c 7d 9h 6d 3s 8d 4c')]);
  g.startHand({ deck });
  g.act({ type: 'allin' }); // seat 0: 100
  g.act({ type: 'allin' }); // seat 1: 300
  assert.equal(g.legalActions().canRaise, false); // nobody left to raise against
  g.act({ type: 'allin' }); // seat 2: becomes a call of 300
  assert.ok(g.handOver);
  assert.deepEqual(g.players.map((p) => p.chips), [300, 400, 200]);
  assert.equal(g.result.awards.length, 2);
  assert.deepEqual(g.result.awards[0], { amount: 300, winners: [0], handName: 'Pair of Aces', uncalled: false });
});

test('uncalled bet is returned', () => {
  const g = table([1000, 200], { button: 0 });
  const deck = rig(parseCards('2c 3d 4h 5s 9c 9d Jh 7s 8s Kc Qd Td Ac'));
  g.startHand({ deck });
  g.act({ type: 'raise', amount: 600 });
  g.act({ type: 'call' }); // seat 1 all-in for 200
  assert.ok(g.handOver);
  assert.equal(total(g), 1200);
  assert.ok(g.result.awards.some((a) => a.uncalled && a.amount === 400 && a.winners[0] === 0));
});

test('split pot gives the odd chip to the first winner left of the button', () => {
  const g = table([1000, 1000, 1000], { button: 0 });
  // Deal order: seats 1, 2, 0, 1, 2, 0. Board is a royal flush, so everyone chops.
  const deck = rig([...parseCards('6c 4c 2c 7d 5d 3d'), ...parseCards('8c Ah Kh Qh 8d Jh 9d Th')]);
  g.startHand({ deck });
  g.act({ type: 'call' }); // seat 0 (button) limps
  g.act({ type: 'fold' }); // seat 1 (SB) folds, leaving 5 dead
  g.act({ type: 'check' }); // seat 2 (BB)
  for (let i = 0; i < 6; i++) g.act({ type: 'check' });
  assert.ok(g.handOver);
  assert.deepEqual(g.players.map((p) => p.chips), [1002, 995, 1003]);
});

test('a short all-in raise does not reopen betting', () => {
  const g = table([1000, 1000, 45], { button: 0 });
  g.startHand();
  g.act({ type: 'raise', amount: 30 }); // seat 0, raise of 20
  g.act({ type: 'call' }); // seat 1
  g.act({ type: 'allin' }); // seat 2 (BB): all-in to 45, only 15 more
  assert.equal(g.toAct, 0);
  let legal = g.legalActions();
  assert.equal(legal.toCall, 15);
  assert.equal(legal.canRaise, false);
  g.act({ type: 'call' });
  legal = g.legalActions();
  assert.equal(g.toAct, 1);
  assert.equal(legal.canRaise, false);
});

test('a full raise reopens betting', () => {
  const g = table([1000, 1000, 1000], { button: 0 });
  g.startHand();
  g.act({ type: 'raise', amount: 30 });
  g.act({ type: 'call' });
  g.act({ type: 'raise', amount: 60 });
  assert.equal(g.legalActions().canRaise, true);
});

test('short big blind: heads-up small blind does not have to call more', () => {
  const g = table([1000, 5], { button: 0 });
  g.startHand();
  // BB is all-in for 5, SB already has 5 in: nothing left to decide.
  assert.ok(g.handOver);
  assert.equal(total(g), 1005);
});

test('fuzz: bots play many hands without losing or creating chips', () => {
  const rng = mulberry32(42);
  const diffs = Object.keys(DIFFICULTIES);
  const pers = Object.keys(PERSONALITIES);
  for (let tableNo = 0; tableNo < 6; tableNo++) {
    const n = 2 + (tableNo % 5);
    const players = Array.from({ length: n }, (_, i) => ({
      name: `B${i}`,
      chips: 200 + Math.floor(rng() * 1800),
      bot: { difficulty: diffs[i % diffs.length], personality: pers[(i + tableNo) % pers.length] },
    }));
    const g = new Game({ players, smallBlind: 5, bigBlind: 10, rng });
    const startTotal = g.players.reduce((s, p) => s + p.chips, 0);
    for (let hand = 0; hand < 60; hand++) {
      for (const p of g.players) if (p.chips === 0) p.chips = 1000; // rebuy
      const expected = g.players.reduce((s, p) => s + p.chips, 0);
      g.startHand();
      let steps = 0;
      while (!g.handOver) {
        const action = decideAction(g, rng, { iterations: 60 });
        g.act(action);
        assert.ok(++steps < 300, 'hand did not terminate');
        assert.equal(total(g), expected);
      }
      assert.equal(total(g), expected);
      for (const p of g.players) assert.ok(p.chips >= 0 && Number.isInteger(p.chips));
      g.drainEvents();
    }
    assert.ok(startTotal > 0);
  }
});

test('splitting a side pot while losing the main pot can still cost chips', () => {
  // You (seat 0) cover everyone. Seat 1 is all-in short with the best hand and takes the
  // main pot; you split only the side pot with seat 2, so you finish below your start.
  const g = table([1000, 300, 1000], { button: 0 });
  const you = parseCards('Kc Qd');
  const shortStack = parseCards('As Ad');
  const other = parseCards('Kd Qc');
  // Deal order: seats 1, 2, 0, 1, 2, 0. Board gives you and seat 2 the same straight-less K-Q high.
  const deck = rig([shortStack[0], other[0], you[0], shortStack[1], other[1], you[1],
    ...parseCards('2h 3s 7h 9c 4d Jh 5s 8s')]);
  g.startHand({ deck });
  g.act({ type: 'allin' }); // seat 0: 1000
  g.act({ type: 'allin' }); // seat 1: 300
  g.act({ type: 'call' }); // seat 2: 1000
  assert.ok(g.handOver);
  assert.deepEqual(g.result.awards.map((a) => [a.amount, a.winners]), [[900, [1]], [1400, [0, 2]]]);
  assert.deepEqual(g.players.map((p) => p.chips), [700, 900, 700]);
});

test('fuzz: payouts match a layer-by-layer reference, including ties and side pots', () => {
  const rng = mulberry32(99);
  const royal = parseCards('Ah Kh Qh Jh Th');
  for (let t = 0; t < 1500; t++) {
    const n = 2 + Math.floor(rng() * 5);
    const players = Array.from({ length: n }, (_, i) => ({ name: `P${i}`, chips: 50 + Math.floor(rng() * 40) * 25 }));
    const g = new Game({ players, smallBlind: 5, bigBlind: 10, rng });
    let deck;
    if (rng() < 0.6) {
      // Royal flush on board: every live player ties, maximising split pots.
      const rest = shuffle(newDeck().filter((c) => !royal.includes(c)), rng);
      const holes = rest.splice(0, n * 2);
      deck = rig([...holes, rest.pop(), ...royal.slice(0, 3), rest.pop(), royal[3], rest.pop(), royal[4]]);
    }
    const start = g.players.map((p) => p.chips);
    g.startHand({ deck });
    while (!g.handOver) {
      const legal = g.legalActions();
      const r = rng();
      if (r < 0.35 && legal.canRaise) g.act({ type: 'allin' });
      else if (r < 0.5 && legal.canRaise) g.act({ type: 'raise', amount: legal.minRaiseTo + Math.floor(rng() * 100) });
      else if (r < 0.62 && !legal.canCheck) g.act({ type: 'fold' });
      else g.act({ type: 'call' });
    }
    const end = g.players.map((p) => p.chips);
    assert.equal(end.reduce((a, b) => a + b), start.reduce((a, b) => a + b));
    if (!g.result.showdown) continue;

    const live = g.players.map((p) => p.inHand && !p.folded);
    const score = g.players.map((p) => (live[p.seat] ? evaluate([...p.hole, ...g.board]) : -1));
    const bets = g.players.map((p) => p.totalBet);
    const expected = start.map((s, i) => s - bets[i]);
    const levels = [...new Set(bets.filter((b, i) => b > 0 && live[i]))].sort((a, b) => a - b);
    let prev = 0;
    for (const level of levels) {
      let amount = 0;
      for (const b of bets) amount += Math.max(0, Math.min(b, level) - prev);
      if (level === levels[levels.length - 1]) for (const b of bets) amount += Math.max(0, b - level);
      const eligible = [...live.keys()].filter((i) => live[i] && bets[i] >= level);
      const best = Math.max(...eligible.map((i) => score[i]));
      const order = [...Array(n).keys()].map((k) => (g.button + 1 + k) % n)
        .filter((i) => eligible.includes(i) && score[i] === best);
      const share = Math.floor(amount / order.length);
      let rem = amount - share * order.length;
      for (const i of order) expected[i] += share + (rem-- > 0 ? 1 : 0);
      prev = level;
    }
    assert.deepEqual(end, expected, `hand ${t}`);
    // Whoever holds the best live hand can never finish the hand down.
    const top = Math.max(...score);
    for (let i = 0; i < n; i++) if (score[i] === top) assert.ok(end[i] >= start[i]);
  }
});
