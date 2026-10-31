// Heuristic poker bots.
// Preflop: Chen hand score, adjusted for position, raises faced and personality.
// Postflop: Monte Carlo equity vs. pot odds, with value bets, bluffs and semi-bluffs.
// Difficulty controls accuracy (simulation size, noise, range reading);
// personality controls style (how many hands, how aggressive, how often bluffing).

import { chenScore, estimateEquity } from './equity.js';

export const DIFFICULTIES = {
  easy: { label: 'Easy', iterations: 150, noise: 0.15, chenNoise: 3, callLoose: 0.12, betRespect: 0, useRanges: false, bluffMult: 0.4, shortStack: false },
  medium: { label: 'Medium', iterations: 400, noise: 0.06, chenNoise: 1.5, callLoose: 0.03, betRespect: 0.15, useRanges: false, bluffMult: 1, shortStack: true },
  hard: { label: 'Hard', iterations: 700, noise: 0.02, chenNoise: 0.5, callLoose: 0, betRespect: 0.05, useRanges: true, bluffMult: 1, shortStack: true },
};

export const PERSONALITIES = {
  balanced: { label: 'Balanced', open: 0, aggression: 0.55, bluff: 0.08, stickiness: 0 },
  tight: { label: 'Tight', open: 1.5, aggression: 0.5, bluff: 0.04, stickiness: -0.03 },
  loose: { label: 'Loose', open: -2, aggression: 0.45, bluff: 0.08, stickiness: 0.04 },
  aggressive: { label: 'Aggressive', open: -1, aggression: 0.85, bluff: 0.16, stickiness: 0 },
  passive: { label: 'Calling station', open: -1.5, aggression: 0.2, bluff: 0.02, stickiness: 0.1 },
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function botConfig(bot = {}) {
  return {
    ...(DIFFICULTIES[bot.difficulty] ?? DIFFICULTIES.medium),
    ...(PERSONALITIES[bot.personality] ?? PERSONALITIES.balanced),
  };
}

/** Choose an action for the player whose turn it is. Always returns a legal action. */
export function decideAction(game, rng = Math.random, overrides = null) {
  const legal = game.legalActions();
  const me = game.players[legal.seat];
  const cfg = { ...botConfig(me.bot), ...overrides };
  const opponents = game.players.filter((p) => p.inHand && !p.folded && p !== me);
  const ctx = {
    game, legal, me, opponents, rng, cfg,
    bb: game.bigBlind,
    unit: game.smallBlind,
    isHeadsUp: opponents.length === 1,
  };
  const action = game.street === 'preflop' ? preflop(ctx) : postflop(ctx);
  return sanitize(action, legal);
}

// ---- helpers ----

const check = () => ({ type: 'check' });
const call = () => ({ type: 'call' });
const fold = () => ({ type: 'fold' });
const passive = ({ legal }) => (legal.canCheck ? check() : call());
const foldOrCheck = ({ legal }) => (legal.canCheck ? check() : fold());

function raiseTo(ctx, amount) {
  const { legal, unit } = ctx;
  if (!legal.canRaise) return passive(ctx);
  let to = Math.round(amount / unit) * unit;
  to = Math.max(to, legal.minRaiseTo);
  if (to >= legal.maxRaiseTo * 0.8) to = legal.maxRaiseTo; // that close to all-in: just shove
  return { type: 'raise', amount: Math.min(to, legal.maxRaiseTo) };
}

/** Bet or raise by a fraction of the pot (pot measured after calling). */
function potRaise(ctx, fraction) {
  const { legal } = ctx;
  return raiseTo(ctx, legal.currentBet + fraction * (legal.pot + legal.toCall));
}

const allIn = (ctx) => (ctx.legal.canRaise ? { type: 'raise', amount: ctx.legal.maxRaiseTo } : passive(ctx));

function sanitize(action, legal) {
  switch (action.type) {
    case 'check': return legal.canCheck ? action : fold();
    case 'call': return legal.canCheck ? check() : action;
    case 'raise': return legal.canRaise ? action : (legal.canCheck ? check() : call());
    case 'fold': return legal.canCheck ? check() : action;
    default: return legal.canCheck ? check() : fold();
  }
}

function preflopInfo(game) {
  let raises = 0, limpers = 0;
  for (const a of game.history.actions) {
    if (a.street !== 'preflop') continue;
    if (a.type === 'raise') raises++;
    else if (a.type === 'call' && raises === 0) limpers++;
  }
  return { raises, limpers };
}

/** Players still to act behind `seat` preflop (BB acts last). */
function playersBehindPreflop(game, seat) {
  if (seat === game.bbSeat) return 0;
  const n = game.players.length;
  let behind = 0;
  for (let i = (seat + 1) % n; ; i = (i + 1) % n) {
    const p = game.players[i];
    if (p.inHand && !p.folded && !p.allIn) behind++;
    if (i === game.bbSeat) break;
  }
  return behind;
}

function isLastToActPostflop(game, seat) {
  const n = game.players.length;
  let last = -1;
  for (let k = 1; k <= n; k++) {
    const i = (game.button + k) % n;
    const p = game.players[i];
    if (p.inHand && !p.folded && !p.allIn) last = i;
  }
  return last === seat;
}

/** Hard bots narrow each opponent's range based on how they played preflop. */
function rangeFloor(game, seat) {
  let floor = -Infinity;
  for (const a of game.history.actions) {
    if (a.street !== 'preflop' || a.seat !== seat) continue;
    if (a.type === 'raise') return 7;
    if (a.type === 'call') floor = 5;
  }
  return floor;
}

// ---- preflop ----

function preflop(ctx) {
  const { game, legal, me, cfg, rng, bb } = ctx;
  const info = preflopInfo(game);
  const chen = chenScore(me.hole[0], me.hole[1]) + (rng() * 2 - 1) * cfg.chenNoise;
  const behind = playersBehindPreflop(game, me.seat);
  let openTh = 9 + cfg.open - (4 - Math.min(4, behind)) * 0.9;
  if (ctx.isHeadsUp) openTh -= 1.5;
  const stackBB = (me.chips + me.bet) / bb;
  const potOdds = legal.toCall / (legal.pot + legal.toCall);

  // Short stacks play push-or-fold.
  if (cfg.shortStack && stackBB <= 12) {
    if (chen >= openTh - 1 + (info.raises ? 2 : 0)) return allIn(ctx);
    return foldOrCheck(ctx);
  }

  if (info.raises === 0) {
    if (legal.canCheck) {
      // Big blind in a limped pot.
      if (chen >= openTh + 1 && rng() < 0.4 + cfg.aggression * 0.5) return raiseTo(ctx, (3 + info.limpers) * bb);
      return check();
    }
    if (chen >= openTh) return raiseTo(ctx, (2.5 + cfg.aggression + info.limpers) * bb);
    // Steal from late position.
    if (behind <= 2 && chen >= openTh - 3 && rng() < cfg.bluff * cfg.bluffMult * 3) return raiseTo(ctx, 2.5 * bb);
    if (chen >= openTh - 1.5 - Math.max(0, -cfg.open)) return call(); // limp
    if (me.seat === game.sbSeat && chen >= openTh - 3) return call(); // cheap completion
    if (rng() < cfg.callLoose * 2) return call();
    return fold();
  }

  // Facing one or more raises.
  const pressure = Math.min(4, legal.toCall / bb / 4);
  const threeBetTh = 12.5 + cfg.open * 0.5 + (info.raises - 1) * 2 - (ctx.isHeadsUp ? 2 : 0);
  const callTh = openTh + 1 + pressure + (info.raises - 1) * 1.5 - cfg.stickiness * 20;
  const committed = me.totalBet / (me.totalBet + me.chips);

  if (chen >= threeBetTh && legal.canRaise) {
    return raiseTo(ctx, legal.currentBet * (info.raises >= 2 ? 2.4 : 3));
  }
  if (info.raises === 1 && legal.canRaise && behind <= 2 && chen >= callTh - 2 &&
      rng() < cfg.bluff * cfg.bluffMult) {
    return raiseTo(ctx, legal.currentBet * 3); // light 3-bet
  }
  if (chen >= callTh) return call();
  if (potOdds <= 0.25 && chen >= callTh - 2) return call();
  if (committed > 0.45 && chen >= callTh - 3) return call();
  if (rng() < cfg.callLoose) return call();
  return fold();
}

// ---- postflop ----

function postflop(ctx) {
  const { game, legal, me, opponents, cfg, rng } = ctx;
  const floors = cfg.useRanges ? opponents.map((o) => rangeFloor(game, o.seat)) : null;
  const raw = estimateEquity(me.hole, game.board, opponents.length, cfg.iterations, rng, floors).equity;
  let eq = raw + (rng() * 2 - 1) * cfg.noise;

  const potBefore = Math.max(1, legal.pot - legal.toCall);
  if (legal.toCall > 0) {
    // Big bets usually mean strong hands.
    eq *= 1 - cfg.betRespect * Math.min(1, legal.toCall / potBefore);
  }
  eq = clamp(eq, 0, 1);

  const fair = 1 / (opponents.length + 1);
  const strongTh = fair + (1 - fair) * 0.38;
  const goodTh = fair + (1 - fair) * 0.12;
  const potOdds = legal.toCall / (legal.pot + legal.toCall);
  const spr = me.chips / Math.max(1, legal.pot);
  const inPosition = isLastToActPostflop(game, me.seat);
  const bluffRate = cfg.bluff * cfg.bluffMult * (ctx.isHeadsUp ? 1.5 : 0.6) * (inPosition ? 1.3 : 0.8);

  if (legal.canCheck) {
    if (eq >= strongTh) {
      if (spr < 1 && eq > 0.8) return allIn(ctx);
      // Occasionally slow-play a monster.
      if (rng() < 0.15 + cfg.aggression * 0.85) return potRaise(ctx, 0.55 + rng() * 0.3);
      return check();
    }
    if (eq >= goodTh && rng() < cfg.aggression * 0.6) return potRaise(ctx, 0.33 + rng() * 0.2);
    if (rng() < bluffRate * (game.street === 'river' ? 0.8 : 1)) return potRaise(ctx, 0.5 + rng() * 0.25);
    return check();
  }

  // Facing a bet.
  if (eq >= strongTh) {
    if (spr < 1.5 && eq > Math.min(0.9, strongTh * 1.2)) return allIn(ctx);
    if (legal.canRaise && rng() < cfg.aggression) return potRaise(ctx, 0.7 + rng() * 0.3);
    return call();
  }
  const margin = cfg.useRanges ? 0.03 : 0.01;
  if (eq + cfg.stickiness + cfg.callLoose >= potOdds + margin) return call();
  // Semi-bluff raise with some equity on earlier streets.
  if (game.street !== 'river' && legal.canRaise && eq >= goodTh * 0.7 && rng() < bluffRate * 0.5) {
    return potRaise(ctx, 0.8);
  }
  return fold();
}
