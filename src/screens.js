// Modal screens: menu, settings, stats, hand history + replay, help.

import { cardEl, fmt } from './ui.js';
import { summarize } from './stats.js';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

const signed = (n) => (n > 0 ? `+${fmt(n)}` : fmt(n));

export function menuView(items) {
  return h('div', { class: 'menu-list' },
    items.map(([icon, label, onclick]) => h('button', { class: 'menu-item', onclick }, h('span', { class: 'ico' }, icon), label)));
}

// ---------- settings ----------

function select(name, label, options, value) {
  return h('label', { class: 'field' },
    h('span', {}, label),
    h('select', { name }, options.map(([v, text]) => h('option', { value: v, selected: String(v) === String(value) }, text))));
}

/** Play options only; they apply immediately to the current game. */
export function settingsView(settings, onApply) {
  const checkbox = (name, label) => h('label', { class: 'field' },
    h('span', {}, label), h('input', { type: 'checkbox', name, checked: !!settings[name] }));

  const form = h('form', { class: 'settings' },
    select('speed', 'Game speed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']], settings.speed),
    checkbox('hints', 'Show odds hints'),
    checkbox('sound', 'Sound effects'),
    h('p', { class: 'note' }, 'Table size, blinds, chip goal and borrowing are chosen under Menu → New game.'),
    h('button', { type: 'submit', class: 'btn primary' }, 'Save'));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    onApply({
      speed: fd.get('speed'),
      hints: fd.get('hints') === 'on',
      sound: fd.get('sound') === 'on',
    });
  });
  return form;
}

// ---------- new game ----------

const TARGETS = [[0, 'No goal (play forever)'], [5000, '5,000'], [10000, '10,000'], [20000, '20,000'], [50000, '50,000'], [100000, '100,000']];
const BORROWS = [[0, 'None (bust = out)'], [1, '1'], [2, '2'], [3, '3'], [5, '5'], [10, '10'], [-1, 'Unlimited']];

export function newGameView(settings, onStart) {
  const error = h('p', { class: 'note neg', hidden: true });
  const form = h('form', { class: 'settings' },
    h('h3', {}, 'Table'),
    select('numBots', 'Opponents', [[1, '1 (heads-up)'], [2, '2'], [3, '3'], [4, '4'], [5, '5 (6-max)']], settings.numBots),
    select('difficulty', 'Bot difficulty', [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['mixed', 'Mixed']], settings.difficulty),
    select('blinds', 'Blinds', [['5/10', '5 / 10'], ['10/20', '10 / 20'], ['25/50', '25 / 50'], ['50/100', '50 / 100']],
      `${settings.smallBlind}/${settings.bigBlind}`),
    select('stackBB', 'Buy-in', [[50, '50 big blinds'], [100, '100 big blinds'], [200, '200 big blinds']], settings.stackBB),
    h('h3', {}, 'Match'),
    select('target', 'Win at (chips)', TARGETS, settings.target),
    select('maxBorrows', 'Borrows per player', BORROWS, settings.maxBorrows),
    h('p', { class: 'note' },
      'The first player to reach the goal wins (you can choose to keep playing). A player who busts borrows a buy-in from the bank; ',
      'with no borrows left, they are out. Bots follow the same rules.'),
    error,
    h('button', { type: 'submit', class: 'btn primary' }, 'Start new game'));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const [sb, bb] = String(fd.get('blinds')).split('/').map(Number);
    const next = {
      numBots: Number(fd.get('numBots')),
      difficulty: fd.get('difficulty'),
      smallBlind: sb,
      bigBlind: bb,
      stackBB: Number(fd.get('stackBB')),
      target: Number(fd.get('target')),
      maxBorrows: Number(fd.get('maxBorrows')),
    };
    const buyIn = next.stackBB * bb;
    if (next.target > 0 && next.target <= buyIn) {
      error.textContent = `The goal must be more than the buy-in (${fmt(buyIn)}). Pick a higher goal or smaller blinds/buy-in.`;
      error.hidden = false;
      return;
    }
    onStart(next);
  });
  return form;
}

// ---------- game over ----------

export function gameOverView({ detail, rows, winner, maxBorrows, actions }) {
  const limit = maxBorrows < 0 ? '' : ` / ${maxBorrows}`;
  return h('div', { class: 'game-over' },
    h('p', { class: 'go-detail' }, detail),
    h('div', { class: 'standings' },
      h('div', { class: 'st-row st-head' }, h('span', {}, '#'), h('span', {}, 'Player'), h('span', {}, 'Chips'), h('span', {}, 'Borrowed')),
      rows.map((r, i) => h('div', { class: `st-row${r.seat === winner ? ' st-win' : ''}${r.out ? ' st-out' : ''}` },
        h('span', {}, r.seat === winner ? '🏆' : String(i + 1)),
        h('span', {}, `${r.avatar ?? ''} ${r.seat === 0 ? 'You' : r.name}`, r.out ? h('em', {}, ' out') : null),
        h('span', { class: 'st-num' }, fmt(r.chips)),
        h('span', { class: 'st-num' }, `${r.borrows}${limit}`)))),
    h('div', { class: 'go-actions' }, actions.map(({ label, primary, onclick }) =>
      h('button', { class: `btn${primary ? ' primary' : ''}`, onclick }, label))));
}

// ---------- stats ----------

export function statsView(stats, onReset) {
  const grid = h('div', { class: 'stats-grid' },
    summarize(stats).map(([k, v]) => h('div', { class: 'stat' }, h('div', { class: 'v' }, v), h('div', { class: 'k' }, k))));
  const reset = h('button', { class: 'btn danger' }, 'Reset statistics');
  reset.onclick = () => {
    if (reset.dataset.armed) return onReset();
    reset.dataset.armed = '1';
    reset.textContent = 'Tap again to confirm';
  };
  return h('div', {},
    grid,
    h('p', { class: 'note' }, 'VPIP = how often you voluntarily put chips in preflop. Typical winning players: 20–28% VPIP, 15–22% PFR.'),
    reset);
}

// ---------- history ----------

function nameOf(hand, seat, humanSeat) {
  return seat === humanSeat ? 'You' : hand.players.find((p) => p.seat === seat)?.name ?? `Seat ${seat + 1}`;
}

function resultText(hand, humanSeat) {
  const awards = (hand.result?.awards ?? []).filter((a) => !a.uncalled);
  if (!awards.length) return '';
  return awards.map((a, i) => {
    const who = a.winners.map((s) => nameOf(hand, s, humanSeat)).join(' & ');
    const verb = a.winners.length > 1 ? 'split' : who === 'You' ? 'win' : 'wins';
    const pot = awards.length > 1 ? (i === 0 ? ' (main pot)' : ' (side pot)') : '';
    const how = a.handName && hand.result.showdown ? ` with ${a.handName}` : '';
    return `${who} ${verb} ${fmt(a.amount)}${pot}${how}`;
  }).join(' · ');
}

export function historyView(history, humanSeat, onOpen) {
  if (!history.length) return h('p', { class: 'muted' }, 'No hands played yet.');
  return h('div', { class: 'history-list' }, history.map((hand) => {
    const me = hand.players.find((p) => p.seat === humanSeat);
    const net = me ? me.endChips - me.startChips : 0;
    return h('button', { class: 'history-item', onclick: () => onOpen(hand) },
      h('div', { class: 'hi-top' },
        h('span', {}, `Hand #${hand.handNumber}`),
        h('span', { class: net > 0 ? 'pos' : net < 0 ? 'neg' : 'muted' }, signed(net))),
      h('div', { class: 'hi-cards' }, me ? me.hole.map((c) => cardEl(c)) : null, h('span', { class: 'hi-sep' }), hand.board.map((c) => cardEl(c))),
      h('div', { class: 'hi-sub muted' }, resultText(hand, humanSeat)));
  }));
}

const STREET_CARDS = { preflop: 0, flop: 3, turn: 4, river: 5 };
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function describeAction(name, a) {
  const allIn = a.allIn ? ' (all-in)' : '';
  switch (a.type) {
    case 'sb': return `${name} posts small blind ${fmt(a.put)}${allIn}`;
    case 'bb': return `${name} posts big blind ${fmt(a.put)}${allIn}`;
    case 'fold': return `${name} folds`;
    case 'check': return `${name} checks`;
    case 'call': return `${name} calls ${fmt(a.put)}${allIn}`;
    case 'bet': return `${name} bets ${fmt(a.to)}${allIn}`;
    case 'raise': return `${name} raises to ${fmt(a.to)}${allIn}`;
    default: return `${name} ${a.type}`;
  }
}

/** Rebuild table state after each action of a recorded hand. */
export function buildReplaySteps(hand, humanSeat) {
  const stacks = new Map(hand.players.map((p) => [p.seat, p.startChips]));
  let bets = new Map();
  const folded = new Set();
  let pot = 0;
  let street = 'preflop';
  const steps = [];
  const push = (text, extra = {}) => steps.push({
    text, street, board: hand.board.slice(0, STREET_CARDS[street]),
    stacks: new Map(stacks), bets: new Map(bets), folded: new Set(folded), pot, ...extra,
  });

  for (const a of hand.actions) {
    if (a.street !== street) {
      for (const v of bets.values()) pot += v;
      bets = new Map();
      street = a.street;
      push(`${cap(street)}`, { marker: true });
    }
    stacks.set(a.seat, stacks.get(a.seat) - (a.put || 0));
    if (a.put) bets.set(a.seat, (bets.get(a.seat) || 0) + a.put);
    if (a.type === 'fold') folded.add(a.seat);
    push(describeAction(nameOf(hand, a.seat, humanSeat), a), { actor: a.seat });
  }
  steps.push({
    text: resultText(hand, humanSeat) || 'Hand over',
    street: 'end',
    board: hand.board,
    stacks: new Map(hand.players.map((p) => [p.seat, p.endChips])),
    bets: new Map(),
    folded,
    pot: 0,
    final: true,
  });
  return steps;
}

export function replayView(hand, humanSeat) {
  const steps = buildReplaySteps(hand, humanSeat);
  const shownSeats = new Set((hand.result?.shown ?? []).map((s) => s.seat));
  const winners = new Set((hand.result?.awards ?? []).filter((a) => !a.uncalled).flatMap((a) => a.winners));
  let index = 0;
  let revealAll = false;

  const boardEl = h('div', { class: 'replay-board' });
  const potEl = h('div', { class: 'replay-pot' });
  const playersEl = h('div', { class: 'replay-players' });
  const textEl = h('div', { class: 'replay-text' });
  const countEl = h('span', { class: 'count' });
  const logEl = h('ol', { class: 'replay-log' });
  const prev = h('button', { onclick: () => go(index - 1) }, '‹ Prev');
  const next = h('button', { onclick: () => go(index + 1) }, 'Next ›');
  const reveal = h('input', { type: 'checkbox' });
  reveal.onchange = () => { revealAll = reveal.checked; draw(); };

  const logItems = steps.map((s, i) => h('li', { class: s.marker ? 'street' : '', onclick: () => go(i) }, s.text));
  logEl.append(...logItems);

  function go(i) {
    index = Math.max(0, Math.min(steps.length - 1, i));
    draw();
  }

  function draw() {
    const step = steps[index];
    boardEl.replaceChildren(...Array.from({ length: 5 }, (_, i) => {
      const slot = h('div', { class: 'slot' });
      if (step.board[i] != null) slot.replaceChildren(cardEl(step.board[i]));
      return slot;
    }));
    const betTotal = [...step.bets.values()].reduce((a, b) => a + b, 0);
    potEl.textContent = step.final ? '' : `Pot ${fmt(step.pot + betTotal)}`;
    playersEl.replaceChildren(...hand.players.map((p) => {
      const visible = p.seat === humanSeat || revealAll || (!!step.final && shownSeats.has(p.seat));
      const cls = ['rp-row'];
      if (step.actor === p.seat) cls.push('actor');
      if (step.folded.has(p.seat)) cls.push('folded');
      if (step.final && winners.has(p.seat)) cls.push('winner');
      const bet = step.bets.get(p.seat);
      return h('div', { class: cls.join(' ') },
        h('span', {}, nameOf(hand, p.seat, humanSeat), p.seat === hand.button ? ' Ⓓ' : ''),
        h('span', { class: 'rp-cards' }, p.hole.map((c) => cardEl(c, visible))),
        h('span', { class: 'rp-num' }, fmt(step.stacks.get(p.seat))),
        h('span', { class: 'rp-bet' }, bet ? fmt(bet) : ''));
    }));
    textEl.textContent = step.text;
    countEl.textContent = `${index + 1} / ${steps.length}`;
    prev.disabled = index === 0;
    next.disabled = index === steps.length - 1;
    logItems.forEach((li, i) => li.classList.toggle('current', i === index));
    logItems[index].scrollIntoView({ block: 'nearest' });
  }

  const root = h('div', { class: 'replay' },
    boardEl, potEl, playersEl, textEl,
    h('div', { class: 'replay-nav' }, prev, countEl, next),
    h('label', { class: 'check-row' }, reveal, 'Show all hole cards'),
    logEl);
  draw();
  return root;
}

// ---------- help ----------

export function helpView() {
  return h('div', { class: 'help' },
    h('h3', {}, 'Install on Android'),
    h('ol', {},
      h('li', {}, 'Open https://victor-yg.github.io/texas-holdem/ in Chrome on your phone.'),
      h('li', {}, 'Tap the ⋮ menu → “Add to Home screen” (or “Install app”).'),
      h('li', {}, 'Launch it from your home screen: it runs full-screen and works offline.')),
    h('h3', {}, 'Goal and borrowing'),
    h('p', {}, 'Each game has a chip goal (10,000 by default): the first player to reach it wins, and you can choose to keep playing afterwards. If you bust, you can borrow another buy-in from the bank, up to the limit you chose (5 by default). Run out of borrows and you are out. Bots play by the same rules, and the last player standing also wins. Pick the goal and limit under Menu → New game.'),
    h('h3', {}, 'How to play'),
    h('p', {}, 'No-limit Texas Hold’em. Each player gets two private cards; five shared cards come in three rounds (flop, turn, river). Make the best five-card hand from any of your seven cards, or make everyone else fold.'),
    h('p', {}, 'Tap Raise to open the bet slider, choose an amount (or a preset), then tap the button again to confirm. Tap a bot to see its style. On a keyboard: R raise, C call, K check, F fold, Space deals the next hand.'),
    h('h3', {}, 'Hand rankings (best first)'),
    h('ol', {},
      ['Straight flush — five in a row, same suit', 'Four of a kind', 'Full house — three of a kind + a pair',
        'Flush — five of the same suit', 'Straight — five in a row', 'Three of a kind', 'Two pair', 'Pair', 'High card']
        .map((t) => h('li', {}, t))),
    h('h3', {}, 'Odds hints'),
    h('p', {}, 'With 💡 on, you see your equity (chance to win against random hands) and the pot odds (the share of the final pot you must put in to call). If your equity beats the pot odds, calling makes money in the long run. Bots don’t play random hands, though, so treat it as a guide.'));
}
