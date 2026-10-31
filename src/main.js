// App controller: owns the table, runs the hand loop, and wires engine <-> bots <-> UI.

import { Game } from './engine.js';
import { decideAction, DIFFICULTIES, PERSONALITIES } from './bot.js';
import { estimateEquity, chenScore } from './equity.js';
import { evaluate, describeHand } from './evaluator.js';
import { RANKS, shuffle } from './cards.js';
import { load, save, remove } from './storage.js';
import { emptyStats, recordHand } from './stats.js';
import { sfx, unlockAudio, setSoundEnabled } from './sound.js';
import { TableUI, fmt } from './ui.js';
import { menuView, settingsView, statsView, historyView, replayView, helpView } from './screens.js';

const HUMAN = 0;
const MAX_HISTORY = 50;
const TABLE_KEYS = ['numBots', 'difficulty', 'smallBlind', 'bigBlind', 'stackBB'];
const DEFAULT_SETTINGS = {
  numBots: 5, difficulty: 'mixed', smallBlind: 10, bigBlind: 20, stackBB: 100,
  speed: 'normal', hints: false, sound: true,
};
const SPEEDS = {
  slow: { bot: 1300, street: 900, deal: 130, award: 700 },
  normal: { bot: 800, street: 600, deal: 90, award: 550 },
  fast: { bot: 350, street: 300, deal: 50, award: 350 },
};
const BOT_ROSTER = [
  ['Ada', '🦊'], ['Blaze', '🐯'], ['Cody', '🐻'], ['Dex', '🦉'], ['Echo', '🐼'],
  ['Finn', '🐺'], ['Gus', '🐸'], ['Hana', '🦁'], ['Iris', '🐙'], ['Jax', '🦈'],
];

let settings = { ...DEFAULT_SETTINGS, ...load('settings', {}) };
delete settings.autoDeal; // retired setting
let stats = { ...emptyStats(), ...load('stats', {}) };
let history = load('history', []);
let game = null;
let table = null; // { buyIn, config }
let loopToken = 0;

const ui = new TableUI();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const speed = () => SPEEDS[settings.speed] ?? SPEEDS.normal;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pct = (x) => `${Math.round(x * 100)}%`;

// ---------- table setup ----------

function tableConfig() {
  return Object.fromEntries(TABLE_KEYS.map((k) => [k, settings[k]]));
}

function createTable() {
  const buyIn = settings.stackBB * settings.bigBlind;
  const roster = shuffle([...BOT_ROSTER], Math.random).slice(0, settings.numBots);
  const difficulties = Object.keys(DIFFICULTIES);
  const players = [
    { name: 'You', avatar: '🙂', chips: buyIn, isHuman: true },
    ...roster.map(([name, avatar]) => ({
      name, avatar, chips: buyIn, isHuman: false,
      bot: {
        difficulty: settings.difficulty === 'mixed' ? pick(difficulties) : settings.difficulty,
        personality: pick(Object.keys(PERSONALITIES)),
      },
    })),
  ];
  table = { buyIn, config: tableConfig() };
  return new Game({ players, smallBlind: settings.smallBlind, bigBlind: settings.bigBlind });
}

function restoreTable(saved) {
  try {
    if (!saved?.players?.length || saved.players.length < 2 || !saved.players[HUMAN]?.isHuman) return null;
    table = { buyIn: saved.buyIn, config: saved.config };
    return new Game({
      players: saved.players,
      smallBlind: saved.smallBlind,
      bigBlind: saved.bigBlind,
      button: saved.button,
      handNumber: saved.handNumber,
    });
  } catch {
    return null;
  }
}

function saveTable() {
  save('table', { ...game.serialize(), buyIn: table.buyIn, config: table.config });
}

function startTable(newGame, firstRun = false) {
  loopToken++;
  ui.cancelPrompt();
  ui.hideHint();
  ui.setMessage('');
  game = newGame;
  ui.setupSeats(game.players);
  ui.render(game.snapshot());
  updateInfo();
  saveTable();
  run(loopToken, firstRun);
}

function updateInfo() {
  ui.setInfo(`Blinds ${fmt(game.smallBlind)}/${fmt(game.bigBlind)}`, `Hand #${game.handNumber}`);
}

// ---------- hand loop ----------

async function run(token, firstRun) {
  const alive = () => token === loopToken;
  if (firstRun) {
    ui.setMessage(game.handNumber ? 'Welcome back!' : 'Welcome to the table!');
    const r = await ui.waitForDeal(game.handNumber ? 'Continue' : 'Start');
    if (r == null || !alive()) return;
    ui.setMessage('');
  }
  while (alive()) {
    if (!(await handleBusts(token)) || !alive()) return;
    game.startHand();
    updateInfo();
    ui.setMessage('');
    await playEvents(token);

    while (!game.handOver) {
      if (!alive()) return;
      const p = game.players[game.toAct];
      let action;
      if (p.isHuman) {
        action = await humanTurn();
      } else {
        ui.setWaiting(`${p.name} is thinking…`);
        await sleep(speed().bot * (0.7 + Math.random() * 0.6));
        if (!alive()) return;
        action = decideAction(game);
      }
      if (!alive() || !action) return;
      game.act(action);
      await playEvents(token);
    }
    if (!alive()) return;
    finishHand();

    // Wait for a tap so there's time to study the shown hands.
    const r = await ui.waitForDeal('Deal next hand');
    if (r == null || !alive()) return;
  }
}

/** Bots rebuy automatically; the human is asked. Returns false if cancelled. */
async function handleBusts(token) {
  for (const p of game.players) {
    if (!p.isHuman && p.chips <= 0) {
      p.chips = table.buyIn;
      ui.toast(`${p.name} rebuys for ${fmt(table.buyIn)}`);
    }
  }
  ui.render(game.snapshot());
  if (game.players[HUMAN].chips <= 0) {
    ui.setMessage('You are out of chips.');
    const r = await ui.waitForDeal(`Rebuy ${fmt(table.buyIn)}`);
    if (r == null || token !== loopToken) return false;
    game.players[HUMAN].chips = table.buyIn;
    stats.rebuys++;
    save('stats', stats);
    ui.setMessage('');
    ui.render(game.snapshot());
  }
  return true;
}

async function humanTurn() {
  const legal = game.legalActions();
  sfx.turn();
  if (settings.hints) scheduleHint(legal);
  const action = await ui.promptAction(legal, game.players[HUMAN], game.smallBlind);
  ui.hideHint();
  return action;
}

function playActionSound(ev) {
  if (ev.allIn) return sfx.allin();
  if (ev.action === 'fold') return sfx.fold();
  if (ev.action === 'check') return sfx.check();
  return sfx.chip();
}

async function playEvents(token) {
  for (const ev of game.drainEvents()) {
    if (token !== loopToken) return;
    const s = speed();
    switch (ev.type) {
      case 'handStart': {
        const dealt = ev.snapshot.players.filter((p) => p.inHand).length * 2;
        ui.render(ev.snapshot, { dealStagger: s.deal });
        for (let i = 0; i < dealt; i++) setTimeout(sfx.deal, i * s.deal);
        await sleep(dealt * s.deal + 300);
        break;
      }
      case 'action':
        playActionSound(ev);
        ui.render(ev.snapshot);
        await sleep(150);
        break;
      case 'collect':
        await sleep(250);
        sfx.chips();
        await ui.animateCollect(s.award * 0.7);
        ui.render(ev.snapshot);
        break;
      case 'reveal':
        sfx.flip();
        ui.render(ev.snapshot);
        await sleep(s.street + 300);
        break;
      case 'street':
        for (let i = 0; i < ev.cards.length; i++) setTimeout(sfx.deal, i * 90);
        ui.render(ev.snapshot);
        await sleep(s.street);
        break;
      case 'handEnd':
        await showResult(ev, s);
        break;
      default:
        ui.render(ev.snapshot);
    }
  }
}

async function showResult(ev, s) {
  const { result, snapshot } = ev;
  const real = result.awards.filter((a) => !a.uncalled);
  const winners = [...new Set((real.length ? real : result.awards).flatMap((a) => a.winners))];
  // Seat tags get the short category ("Two Pair"); the message has the full name.
  const handNames = result.showdown
    ? Object.fromEntries(result.shown.map((x) => [x.seat, x.handName.split(',')[0]]))
    : null;
  let highlight = null;
  if (result.showdown && real.length) {
    const top = result.shown.find((x) => x.seat === real[0].winners[0]);
    highlight = new Set(top.best);
  }
  const totalPot = result.awards.reduce((t, a) => t + a.amount, 0);

  const name = (seat) => (seat === HUMAN ? 'You' : game.players[seat].name);
  ui.setMessage((real.length ? real : result.awards).map((a, i, arr) => {
    const who = a.winners.map(name).join(' & ');
    const verb = a.winners.length > 1 ? 'split' : a.winners[0] === HUMAN ? 'win' : 'wins';
    const which = arr.length > 1 ? (i === 0 ? ' main pot' : ' side pot') : '';
    const how = result.showdown && a.handName ? ` with ${a.handName}` : '';
    return `${who} ${verb} ${fmt(a.amount)}${which}${how}`;
  }).join(' · ') + humanNetText());

  // Show the result with chips still in the pot, then slide them to the winners.
  const before = structuredClone(snapshot);
  for (const award of result.awards) {
    const share = award.amount / award.winners.length;
    for (const w of award.winners) before.players[w].chips -= share;
  }
  ui.render(before, { winners, highlight, handNames, pot: totalPot });
  if (result.showdown) sfx.flip();
  await sleep(result.showdown ? s.street + 400 : 250);
  if (winners.includes(HUMAN)) sfx.win();
  else sfx.chips();
  await ui.animateAward(result.awards, s.award);
  ui.render(snapshot, { winners, highlight, handNames, pot: 0 });
}

/** " · Your result: +120" for the hand just finished (blank if you sat out). */
function humanNetText() {
  const me = game.history.players.find((p) => p.seat === HUMAN);
  if (!me) return '';
  const net = me.endChips - me.startChips;
  return ` · Your result: ${net > 0 ? '+' : net < 0 ? '−' : '±'}${fmt(Math.abs(net))}`;
}

function finishHand() {
  const hand = structuredClone(game.history);
  history = [hand, ...history].slice(0, MAX_HISTORY);
  save('history', history);
  stats = recordHand(stats, hand, HUMAN);
  save('stats', stats);
  saveTable();
}

// ---------- hints ----------

function startingHandLabel([a, b]) {
  let [hi, lo] = [a >> 2, b >> 2];
  if (lo > hi) [hi, lo] = [lo, hi];
  if (hi === lo) return `Pocket ${RANKS[hi]}${RANKS[lo]}`;
  return `${RANKS[hi]}${RANKS[lo]}${(a & 3) === (b & 3) ? ' suited' : ' offsuit'}`;
}

function scheduleHint(legal) {
  const me = game.players[HUMAN];
  const opponents = game.players.filter((p) => p.inHand && !p.folded && p.seat !== HUMAN).length;
  ui.showHint('<span class="muted">Calculating odds…</span>');
  setTimeout(() => {
    if (!ui.legal || game.toAct !== HUMAN) return;
    const { equity } = estimateEquity(me.hole, game.board, opponents, 3000);
    const made = game.board.length
      ? describeHand(evaluate([...me.hole, ...game.board]))
      : `${startingHandLabel(me.hole)} (Chen ${chenScore(me.hole[0], me.hole[1])})`;
    const fair = 1 / (opponents + 1);
    let advice;
    if (legal.canCheck) {
      advice = equity > fair * 1.5
        ? '<span class="good">Strong: consider betting for value</span>'
        : equity > fair ? 'Above average: bet or check' : 'Checking is free';
    } else {
      const potOdds = legal.toCall / (legal.pot + legal.toCall);
      advice = equity >= potOdds
        ? `<span class="good">Calling is +EV</span> (need ${pct(potOdds)})`
        : `<span class="bad">Calling is −EV</span> (need ${pct(potOdds)})`;
    }
    ui.showHint(`<b>${made}</b> · equity <b>${pct(equity)}</b> vs ${opponents} random hand${opponents > 1 ? 's' : ''}<br>${advice}`);
  }, 30);
}

// ---------- menus ----------

function openMenu() {
  ui.openModal('Menu', menuView([
    ['⚙️', 'Settings', openSettings],
    ['📊', 'Statistics', () => ui.openModal('Statistics', statsView(stats, resetStats), { push: true })],
    ['🕘', 'Hand history', openHistory],
    ['🔄', 'New table', () => { ui.closeModal(); startTable(createTable(), true); }],
    ['❓', 'How to play & install', () => ui.openModal('Help', helpView(), { push: true })],
  ]));
}

function openSettings() {
  ui.openModal('Settings', settingsView(settings, (next) => {
    const tableChanged = TABLE_KEYS.some((k) => String(next[k]) !== String(table.config?.[k]));
    settings = { ...settings, ...next };
    save('settings', settings);
    applyToggles();
    ui.closeModal();
    if (tableChanged) {
      ui.toast('New table started');
      startTable(createTable(), true);
    }
  }), { push: true });
}

function openHistory() {
  ui.openModal('Hand history', historyView(history, HUMAN, (hand) => {
    ui.openModal(`Hand #${hand.handNumber}`, replayView(hand, HUMAN), { push: true });
  }), { push: true });
}

function resetStats() {
  stats = emptyStats();
  save('stats', stats);
  ui.openModal('Statistics', statsView(stats, resetStats));
}

function applyToggles() {
  setSoundEnabled(settings.sound);
  ui.$('btn-sound').classList.toggle('off', !settings.sound);
  ui.$('btn-hint').classList.toggle('off', !settings.hints);
}

ui.$('btn-menu').onclick = openMenu;
ui.$('btn-sound').onclick = () => {
  settings.sound = !settings.sound;
  save('settings', settings);
  applyToggles();
  ui.toast(settings.sound ? 'Sound on' : 'Sound off', 1200);
};
ui.$('btn-hint').onclick = () => {
  settings.hints = !settings.hints;
  save('settings', settings);
  applyToggles();
  ui.toast(settings.hints ? 'Odds hints on' : 'Odds hints off', 1200);
  if (settings.hints && ui.legal) scheduleHint(ui.legal);
  else ui.hideHint();
};
ui.onSeatClick = (seat) => {
  const p = game.players[seat];
  if (p.isHuman) return ui.toast(`You · ${fmt(p.chips)} chips`);
  ui.toast(`${p.name}: ${DIFFICULTIES[p.bot.difficulty].label} · ${PERSONALITIES[p.bot.personality].label}`);
};
document.addEventListener('pointerdown', unlockAudio, { passive: true });
document.addEventListener('keydown', unlockAudio);

// ---------- boot ----------

applyToggles();
const saved = load('table', null);
const restored = saved && restoreTable(saved);
if (!restored) remove('table');
startTable(restored || createTable(), true);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
