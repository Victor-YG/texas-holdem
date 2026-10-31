// No-limit Texas Hold'em table engine. Pure logic, no DOM.
//
// Usage: game.startHand(); then, while !game.handOver, call
// game.act({ type: 'fold' | 'check' | 'call' | 'raise' | 'allin', amount })
// for the player at game.toAct. `amount` for a raise is the total
// "raise to" amount for this street. Each state change pushes an event
// (with a snapshot) that the UI drains to animate the hand step by step.

import { newDeck, shuffle, secureRandom } from './cards.js';
import { evaluate, describeHand, bestFive } from './evaluator.js';

const NEXT_STREET = { preflop: 'flop', flop: 'turn', turn: 'river' };
const STREET_CARDS = { flop: 3, turn: 1, river: 1 };

export class Game {
  constructor({ players, smallBlind, bigBlind, button = -1, handNumber = 0, rng = secureRandom }) {
    if (!players || players.length < 2) throw new Error('A table needs at least 2 players');
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.rng = rng;
    this.button = button;
    this.handNumber = handNumber;
    this.players = players.map((p, seat) => ({
      ...p, seat, hole: [], bet: 0, totalBet: 0, inHand: false, folded: false,
      allIn: false, acted: false, actedSeq: -1, lastAction: null,
    }));
    this.board = [];
    this.pot = 0;
    this.street = null;
    this.toAct = -1;
    this.handOver = true;
    this.revealed = false;
    this.events = [];
    this.history = null;
    this.result = null;
  }

  canStartHand() {
    return this.players.filter((p) => p.chips > 0).length >= 2;
  }

  /** `deck` (optional, for tests): cards are drawn with pop(), i.e. from the end. */
  startHand({ deck } = {}) {
    if (!this.handOver) throw new Error('Hand already in progress');
    if (!this.canStartHand()) throw new Error('Need at least 2 players with chips');
    this.handNumber++;
    for (const p of this.players) {
      Object.assign(p, {
        hole: [], bet: 0, totalBet: 0, inHand: p.chips > 0, folded: false,
        allIn: false, acted: false, actedSeq: -1, lastAction: null,
      });
    }
    this.board = [];
    this.pot = 0;
    this.result = null;
    this.handOver = false;
    this.revealed = false;
    this.events = [];
    this.deck = deck ? [...deck] : shuffle(newDeck(), this.rng);

    const dealtIn = (p) => p.inHand;
    const from = this.button < 0 ? Math.floor(this.rng() * this.players.length) - 1 : this.button;
    this.button = this._next(from, dealtIn);
    const headsUp = this.players.filter(dealtIn).length === 2;
    this.sbSeat = headsUp ? this.button : this._next(this.button, dealtIn);
    this.bbSeat = this._next(this.sbSeat, dealtIn);
    this.street = 'preflop';
    this.currentBet = this.bigBlind;
    this.minRaise = this.bigBlind;
    this.fullRaiseSeq = 0;

    this.history = {
      handNumber: this.handNumber,
      time: Date.now(),
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      button: this.button,
      sbSeat: this.sbSeat,
      bbSeat: this.bbSeat,
      players: this.players.filter(dealtIn).map((p) => ({
        seat: p.seat, name: p.name, startChips: p.chips, endChips: p.chips, hole: [],
      })),
      actions: [],
      board: [],
      result: null,
    };

    this._post(this.sbSeat, this.smallBlind, 'sb');
    this._post(this.bbSeat, this.bigBlind, 'bb');

    const order = this._seatsFrom(this.button + 1).filter((i) => this.players[i].inHand);
    for (let round = 0; round < 2; round++) {
      for (const i of order) this.players[i].hole.push(this.deck.pop());
    }
    for (const hp of this.history.players) hp.hole = [...this.players[hp.seat].hole];

    this._emit('handStart');
    this._progress(this.bbSeat);
  }

  legalActions() {
    if (this.handOver || this.toAct < 0) return null;
    const p = this.players[this.toAct];
    const owed = Math.max(0, this.currentBet - p.bet);
    const toCall = Math.min(owed, p.chips);
    const othersCanAct = this.players.some((o) => o !== p && this._canAct(o));
    // A short all-in raise does not reopen betting for players who already acted.
    const reopened = !p.acted || p.actedSeq < this.fullRaiseSeq;
    const maxRaiseTo = p.bet + p.chips;
    return {
      seat: p.seat,
      toCall,
      canCheck: owed === 0,
      canRaise: p.chips > owed && othersCanAct && reopened,
      minRaiseTo: Math.min(this.currentBet + this.minRaise, maxRaiseTo),
      maxRaiseTo,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      pot: this.totalPot(),
      isBet: this.currentBet === 0,
    };
  }

  act(action) {
    if (this.handOver || this.toAct < 0) throw new Error('No action expected');
    const p = this.players[this.toAct];
    const legal = this.legalActions();
    let { type, amount } = action;
    if (type === 'allin') {
      if (legal.canRaise) { type = 'raise'; amount = legal.maxRaiseTo; } else type = 'call';
    }
    if (type === 'bet') type = 'raise';
    if (type === 'call' && legal.canCheck) type = 'check';

    let put = 0;
    let to;
    let logType = type;
    switch (type) {
      case 'fold':
        p.folded = true;
        break;
      case 'check':
        if (!legal.canCheck) throw new Error('Cannot check facing a bet');
        break;
      case 'call':
        put = legal.toCall;
        this._put(p, put);
        break;
      case 'raise': {
        if (!legal.canRaise) throw new Error('Raising is not allowed here');
        to = Math.floor(Number(amount));
        if (!Number.isFinite(to)) throw new Error('Raise needs an amount');
        to = Math.min(Math.max(to, legal.minRaiseTo), legal.maxRaiseTo);
        logType = this.currentBet === 0 ? 'bet' : 'raise';
        const increment = to - this.currentBet;
        put = to - p.bet;
        this._put(p, put);
        if (increment >= this.minRaise) {
          this.minRaise = increment;
          this.fullRaiseSeq++;
        }
        this.currentBet = Math.max(this.currentBet, to);
        break;
      }
      default:
        throw new Error(`Unknown action: ${type}`);
    }

    p.acted = true;
    p.actedSeq = this.fullRaiseSeq;
    p.lastAction = {
      type: p.allIn && type !== 'fold' ? 'allin' : logType,
      amount: type === 'raise' ? to : put,
    };
    this.history.actions.push({ street: this.street, seat: p.seat, type: logType, put, to, allIn: p.allIn });
    this._emit('action', { seat: p.seat, action: logType, amount: put, to, allIn: p.allIn });
    this._progress(p.seat);
  }

  totalPot() {
    return this.pot + this.players.reduce((sum, p) => sum + p.bet, 0);
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  snapshot() {
    return {
      handNumber: this.handNumber,
      street: this.street,
      board: [...this.board],
      pot: this.pot,
      totalPot: this.totalPot(),
      currentBet: this.currentBet,
      button: this.button,
      sbSeat: this.sbSeat,
      bbSeat: this.bbSeat,
      toAct: this.toAct,
      handOver: this.handOver,
      revealed: this.revealed,
      players: this.players.map((p) => ({
        seat: p.seat, name: p.name, avatar: p.avatar, isHuman: !!p.isHuman,
        chips: p.chips, bet: p.bet, totalBet: p.totalBet, inHand: p.inHand,
        folded: p.folded, allIn: p.allIn, hole: [...p.hole], eliminated: !!p.eliminated,
        lastAction: p.lastAction && { ...p.lastAction },
      })),
    };
  }

  /** Table state worth persisting between hands. */
  serialize() {
    return {
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      button: this.button,
      handNumber: this.handNumber,
      players: this.players.map(({ name, avatar, chips, isHuman, bot, eliminated }) => ({ name, avatar, chips, isHuman, bot, eliminated })),
    };
  }

  // ---- internals ----

  _canAct(p) {
    return p.inHand && !p.folded && !p.allIn;
  }

  _needsToAct(p) {
    return this._canAct(p) && (!p.acted || p.bet < this.currentBet);
  }

  _next(from, pred) {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + k) % n) + n) % n;
      if (pred(this.players[i])) return i;
    }
    return -1;
  }

  _seatsFrom(start) {
    const n = this.players.length;
    return Array.from({ length: n }, (_, k) => (((start + k) % n) + n) % n);
  }

  _put(p, amount) {
    const amt = Math.min(amount, p.chips);
    p.chips -= amt;
    p.bet += amt;
    p.totalBet += amt;
    if (p.chips === 0) p.allIn = true;
    return amt;
  }

  _post(seat, amount, type) {
    const p = this.players[seat];
    const put = this._put(p, amount);
    this.history.actions.push({ street: 'preflop', seat, type, put, allIn: p.allIn });
    if (p.allIn) p.lastAction = { type: 'allin', amount: put };
  }

  _emit(type, extra = {}) {
    this.events.push({ type, ...extra, snapshot: this.snapshot() });
  }

  _progress(from) {
    const live = this.players.filter((p) => p.inHand && !p.folded);
    if (live.length === 1) return this._winUncontested(live[0]);

    const actors = this.players.filter((p) => this._canAct(p));
    let done;
    if (actors.length === 0) {
      done = true;
    } else if (actors.length === 1) {
      // Everyone else is all-in: the last player only acts if facing a bet.
      const me = actors[0];
      const maxOther = Math.max(0, ...live.filter((p) => p !== me).map((p) => p.bet));
      done = me.bet >= maxOther;
    } else {
      done = actors.every((p) => !this._needsToAct(p));
    }

    if (!done) {
      this.toAct = this._next(from, (p) => this._needsToAct(p));
      return;
    }
    this._endStreet();
  }

  _collectBets() {
    let collected = 0;
    for (const p of this.players) {
      collected += p.bet;
      this.pot += p.bet;
      p.bet = 0;
    }
    if (collected > 0) this._emit('collect');
  }

  _endStreet() {
    this.toAct = -1;
    this._collectBets();
    for (const p of this.players) {
      p.acted = false;
      p.actedSeq = -1;
      if (p.lastAction && p.lastAction.type !== 'fold' && !p.allIn) p.lastAction = null;
    }
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.fullRaiseSeq = 0;

    if (this.street === 'river') return this._showdown();

    const actors = this.players.filter((p) => this._canAct(p));
    if (actors.length <= 1 && !this.revealed) {
      // All-in with cards to come: turn the hands face up, then run the board.
      this.revealed = true;
      this._emit('reveal');
    }

    this.street = NEXT_STREET[this.street];
    this.deck.pop(); // burn
    const cards = [];
    for (let i = 0; i < STREET_CARDS[this.street]; i++) cards.push(this.deck.pop());
    this.board.push(...cards);
    this.history.board = [...this.board];
    this._emit('street', { street: this.street, cards });

    if (actors.length <= 1) return this._endStreet();
    this._progress(this.button);
  }

  _buildPots() {
    const live = this.players.filter((p) => p.inHand && !p.folded);
    const contributors = this.players.filter((p) => p.totalBet > 0);
    const levels = [...new Set(live.map((p) => p.totalBet))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
      let amount = 0;
      for (const p of contributors) amount += Math.max(0, Math.min(p.totalBet, level) - prev);
      if (amount > 0) {
        pots.push({ amount, eligible: live.filter((p) => p.totalBet >= level).map((p) => p.seat) });
      }
      prev = level;
    }
    // Defensive: dead money above the top live level goes to the last pot.
    const leftover = contributors.reduce((sum, p) => sum + Math.max(0, p.totalBet - prev), 0);
    if (leftover > 0 && pots.length) pots[pots.length - 1].amount += leftover;
    return pots;
  }

  /** Split `amount` between winners; odd chips go to the first winners left of the button. */
  _distribute(amount, winners) {
    const ordered = this._seatsFrom(this.button + 1).filter((s) => winners.includes(s));
    const share = Math.floor(amount / ordered.length);
    let remainder = amount - share * ordered.length;
    for (const s of ordered) {
      this.players[s].chips += share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
    }
  }

  _showdown() {
    this.street = 'showdown';
    this.revealed = true;
    const live = this.players.filter((p) => p.inHand && !p.folded);
    const scores = new Map(live.map((p) => [p.seat, evaluate([...p.hole, ...this.board])]));
    const awards = this._buildPots().map((pot) => {
      let best = -1;
      for (const s of pot.eligible) best = Math.max(best, scores.get(s));
      const winners = pot.eligible.filter((s) => scores.get(s) === best);
      this._distribute(pot.amount, winners);
      return { amount: pot.amount, winners, handName: describeHand(best), uncalled: pot.eligible.length === 1 };
    });
    const shown = live.map((p) => ({
      seat: p.seat,
      hole: [...p.hole],
      handName: describeHand(scores.get(p.seat)),
      best: bestFive([...p.hole, ...this.board]),
    }));
    this._finish({ showdown: true, awards, shown });
  }

  _winUncontested(winner) {
    this.toAct = -1;
    this._collectBets();
    const amount = this.pot;
    winner.chips += amount;
    this._finish({
      showdown: false,
      awards: [{ amount, winners: [winner.seat], handName: null, uncalled: false }],
      shown: [],
    });
  }

  _finish(result) {
    this.pot = 0;
    this.handOver = true;
    this.toAct = -1;
    this.result = result;
    for (const hp of this.history.players) hp.endChips = this.players[hp.seat].chips;
    this.history.board = [...this.board];
    this.history.result = result;
    this._emit('handEnd', { result });
  }
}
