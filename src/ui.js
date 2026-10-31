// DOM rendering, animation and input for the table. Knows nothing about rules:
// it draws engine snapshots and turns taps into action objects.

import { RANKS, SUITS, SUIT_SYMBOLS } from './cards.js';

// Seat positions (percent of the table area), clockwise from the human at the bottom.
const LAYOUTS = {
  2: [[50, 86], [50, 11]],
  3: [[50, 86], [15, 30], [85, 30]],
  4: [[50, 86], [12, 50], [50, 11], [88, 50]],
  5: [[50, 86], [12, 62], [23, 16], [77, 16], [88, 62]],
  6: [[50, 86], [12, 65], [12, 31], [50, 11], [88, 31], [88, 65]],
};
const CENTER = [50, 45];
const lerp = (a, b, t) => a + (b - a) * t;

export const fmt = (n) => Math.round(n).toLocaleString('en-US');

export function cardEl(card, faceUp = true) {
  const el = document.createElement('div');
  el.className = 'card';
  if (card == null || !faceUp) {
    el.classList.add('back');
    return el;
  }
  const suit = SUITS[card & 3];
  const rank = RANKS[card >> 2];
  el.classList.add(suit === 'h' || suit === 'd' ? 'red' : 'black');
  el.dataset.card = card;
  el.innerHTML = `<span class="rank">${rank === 'T' ? '10' : rank}</span><span class="suit">${SUIT_SYMBOLS[suit]}</span>`;
  return el;
}

function actionLabel(a) {
  if (!a) return '';
  switch (a.type) {
    case 'fold': return 'Fold';
    case 'check': return 'Check';
    case 'call': return `Call ${fmt(a.amount)}`;
    case 'bet': return `Bet ${fmt(a.amount)}`;
    case 'raise': return `Raise ${fmt(a.amount)}`;
    case 'allin': return 'All-in';
    default: return '';
  }
}

export class TableUI {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.$ = $;
    this.seatsEl = $('seats');
    this.boardEl = $('board');
    this.potEl = $('pot');
    this.msgEl = $('message');
    this.hintEl = $('hint-panel');
    this.actionRow = $('action-row');
    this.btnFold = $('btn-fold');
    this.btnCall = $('btn-call');
    this.btnRaise = $('btn-raise');
    this.raisePanel = $('raise-panel');
    this.slider = $('raise-slider');
    this.presetsEl = $('raise-presets');
    this.dealBtn = $('btn-deal');
    this.waitEl = $('waiting');
    this.modal = $('modal');
    this.modalTitle = $('modal-title');
    this.modalBody = $('modal-body');
    this.modalBack = $('modal-back');

    this.pending = null;
    this.legal = null;
    this.seatEls = [];
    this.betEls = [];
    this.modalStack = [];
    this.onSeatClick = null;

    this.boardSlots = Array.from({ length: 5 }, () => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      this.boardEl.appendChild(slot);
      return slot;
    });
    this._bind();
  }

  _bind() {
    this.btnFold.onclick = () => this._resolve({ type: 'fold' });
    this.btnCall.onclick = () => this._resolve({ type: this.legal?.canCheck ? 'check' : 'call' });
    this.btnRaise.onclick = () => {
      if (this.raisePanel.hidden) {
        this.raisePanel.hidden = false;
        this._updateRaiseLabel();
        return;
      }
      this._resolve({ type: 'raise', amount: this._raiseValue() });
    };
    this.$('raise-cancel').onclick = () => {
      this.raisePanel.hidden = true;
      this._updateRaiseLabel();
    };
    this.$('raise-minus').onclick = () => this._nudge(-1);
    this.$('raise-plus').onclick = () => this._nudge(1);
    this.slider.oninput = () => this._updateRaiseLabel();
    this.dealBtn.onclick = () => this._resolve('deal');

    this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.closeModal(); });
    this.$('modal-close').onclick = () => this.closeModal();
    this.modalBack.onclick = () => this.backModal();

    document.addEventListener('keydown', (e) => {
      if (!this.modal.hidden) {
        if (e.key === 'Escape') this.closeModal();
        return;
      }
      if (!this.dealBtn.hidden && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); this.dealBtn.click(); return; }
      if (!this.legal) return;
      const key = e.key.toLowerCase();
      if (key === 'f' && !this.btnFold.disabled) this.btnFold.click();
      else if (key === 'c' || key === 'k') this.btnCall.click();
      else if ((key === 'r' || key === 'b' || key === 'enter') && !this.btnRaise.hidden) this.btnRaise.click();
      else if (key === 'escape') this.raisePanel.hidden = true;
    });
  }

  // ---------- table ----------

  setupSeats(players) {
    this.seatsEl.innerHTML = '';
    this.seatEls = [];
    this.betEls = [];
    const layout = LAYOUTS[players.length];
    this.layout = layout;
    players.forEach((p, i) => {
      const [x, y] = layout[i];
      const seat = document.createElement('div');
      seat.className = `seat${p.isHuman ? ' human' : ''}`;
      seat.style.left = `${x}%`;
      seat.style.top = `${y}%`;
      seat.innerHTML = `
        <div class="hole"><div class="cw"></div><div class="cw"></div></div>
        <div class="plate"><span class="avatar"></span><div class="info"><div class="name"></div><div class="stack"></div></div></div>
        <div class="tag" hidden></div>`;
      seat.querySelector('.avatar').textContent = p.avatar ?? '🙂';
      seat.querySelector('.name').textContent = p.name;
      seat.querySelector('.plate').onclick = () => this.onSeatClick?.(i);
      this.seatsEl.appendChild(seat);
      this.seatEls.push(seat);

      const bet = document.createElement('div');
      bet.className = 'bet';
      bet.hidden = true;
      bet.style.left = `${lerp(x, CENTER[0], 0.45)}%`;
      bet.style.top = `${lerp(y, CENTER[1], 0.45)}%`;
      bet.innerHTML = '<span class="chip"></span><span class="amt"></span>';
      this.seatsEl.appendChild(bet);
      this.betEls.push(bet);
    });
    this.dealerEl = document.createElement('div');
    this.dealerEl.className = 'dealer-btn';
    this.dealerEl.textContent = 'D';
    this.dealerEl.hidden = true;
    this.seatsEl.appendChild(this.dealerEl);
    for (const slot of this.boardSlots) this._setCard(slot, null);
  }

  _dealerPos(i) {
    const [x, y] = this.layout[i];
    if (i === 0) return [x + 27, y - 4]; // beside the human's cards
    const t = 0.24;
    return [lerp(x, CENTER[0], t) + (x < 50 ? 9 : x > 50 ? -9 : 12), lerp(y, CENTER[1], t)];
  }

  /** Put `card` into `container`, animating only when it actually changes. */
  _setCard(container, card, faceUp = true, salt = '', delay = 0) {
    const key = card == null ? '' : `${salt}|${card}|${faceUp ? 1 : 0}`;
    const prev = container.dataset.key ?? '';
    if (prev === key) return container.firstChild;
    container.dataset.key = key;
    container.innerHTML = '';
    container.classList.toggle('filled', card != null);
    if (card == null) return null;
    const el = cardEl(card, faceUp);
    const flipped = prev && prev.startsWith(`${salt}|${card}|0`) && faceUp;
    el.classList.add(flipped ? 'flip' : 'deal');
    if (delay) el.style.animationDelay = `${delay}ms`;
    container.appendChild(el);
    return el;
  }

  /**
   * Draw a snapshot. Options:
   *  winners: seats to highlight; highlight: Set of cards (winning five);
   *  handNames: { seat: name } shown as tags; pot: override pot display;
   *  dealStagger: ms between hole cards when dealing.
   */
  render(snap, { winners = [], highlight = null, handNames = null, pot = null, dealStagger = 0 } = {}) {
    const potValue = pot ?? snap.pot;
    this.potEl.classList.toggle('empty', !potValue);
    this.potEl.innerHTML = `<span class="chip"></span>Pot ${fmt(potValue)}`;

    for (let i = 0; i < 5; i++) {
      this._setCard(this.boardSlots[i], snap.board[i], true, snap.handNumber, i < 3 ? i * 90 : 0);
    }

    const dealOrder = [];
    const n = snap.players.length;
    for (let k = 1; k <= n; k++) {
      const s = (snap.button + k) % n;
      if (snap.players[s].inHand) dealOrder.push(s);
    }

    snap.players.forEach((p, i) => {
      const seat = this.seatEls[i];
      seat.classList.toggle('folded', p.folded);
      seat.classList.toggle('out', !p.inHand);
      seat.classList.toggle('active', snap.toAct === i && !snap.handOver);
      seat.classList.toggle('winner', winners.includes(i));
      seat.querySelector('.stack').textContent = p.inHand && p.allIn && p.chips === 0 && !snap.handOver ? 'ALL-IN' : fmt(p.chips);

      const hasCards = p.inHand && p.hole.length === 2 && (!p.folded || p.isHuman);
      const faceUp = p.isHuman || (snap.revealed && !p.folded);
      const order = dealOrder.indexOf(i);
      seat.querySelectorAll('.cw').forEach((w, k) => {
        const delay = dealStagger ? (k * dealOrder.length + order) * dealStagger : 0;
        this._setCard(w, hasCards ? p.hole[k] : null, faceUp, snap.handNumber, delay);
      });

      const tag = seat.querySelector('.tag');
      const handName = handNames?.[i];
      const label = handName ?? actionLabel(p.lastAction);
      tag.hidden = !label;
      tag.textContent = label;
      tag.className = `tag ${handName ? 'hand' : p.lastAction?.type ?? ''}`;

      const bet = this.betEls[i];
      bet.hidden = !(p.bet > 0);
      bet.querySelector('.amt').textContent = fmt(p.bet);
    });

    if (snap.button >= 0 && this.layout) {
      const [x, y] = this._dealerPos(snap.button);
      this.dealerEl.hidden = false;
      this.dealerEl.style.left = `${x}%`;
      this.dealerEl.style.top = `${y}%`;
    }

    // Winning-hand highlight.
    const all = [...this.boardEl.querySelectorAll('.card'), ...this.seatsEl.querySelectorAll('.seat .card')];
    for (const el of all) el.classList.remove('best', 'dim');
    if (highlight) {
      for (const el of this.boardEl.querySelectorAll('.card')) {
        el.classList.add(highlight.has(Number(el.dataset.card)) ? 'best' : 'dim');
      }
      for (const s of winners) {
        for (const el of this.seatEls[s].querySelectorAll('.card')) {
          if (highlight.has(Number(el.dataset.card))) el.classList.add('best');
        }
      }
    }
  }

  setInfo(blinds, hand) {
    this.$('blinds-label').textContent = blinds;
    this.$('hand-label').textContent = hand;
  }

  setMessage(text) {
    this.msgEl.textContent = text ?? '';
  }

  showHint(html) {
    this.hintEl.innerHTML = html;
    this.hintEl.hidden = false;
  }

  hideHint() {
    this.hintEl.hidden = true;
  }

  toast(text, ms = 2200) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // ---------- animation ----------

  _fly(from, to, ms, delay = 0) {
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    if ((!a.width && !a.height) || !document.body.animate) return Promise.resolve();
    const chip = document.createElement('div');
    chip.className = 'chip fly';
    chip.style.left = `${a.left + a.width / 2 - 8}px`;
    chip.style.top = `${a.top + a.height / 2 - 8}px`;
    document.body.appendChild(chip);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const anim = chip.animate(
      [{ transform: 'translate(0, 0)', opacity: delay ? 0 : 1, offset: 0 }, { opacity: 1, offset: 0.05 },
        { transform: `translate(${dx}px, ${dy}px)`, opacity: 1 }],
      { duration: ms, delay, easing: 'cubic-bezier(.45, 0, .25, 1)', fill: 'both' },
    );
    return anim.finished.catch(() => {}).then(() => chip.remove());
  }

  /** Slide every visible bet into the pot. */
  async animateCollect(ms) {
    const jobs = [];
    this.betEls.forEach((bet) => {
      if (!bet.hidden) jobs.push(this._fly(bet, this.potEl, ms));
    });
    for (const bet of this.betEls) bet.hidden = true;
    await Promise.all(jobs);
  }

  /** Slide chips from the pot to each winner. */
  async animateAward(awards, ms) {
    const jobs = [];
    for (const award of awards) {
      for (const seat of award.winners) {
        const plate = this.seatEls[seat].querySelector('.plate');
        for (let k = 0; k < 3; k++) jobs.push(this._fly(this.potEl, plate, ms, k * 70));
      }
    }
    await Promise.all(jobs);
  }

  // ---------- input ----------

  _mode(mode) {
    this.actionRow.hidden = mode !== 'action';
    this.dealBtn.hidden = mode !== 'deal';
    this.waitEl.hidden = mode !== 'wait';
    if (mode !== 'action') this.raisePanel.hidden = true;
  }

  setWaiting(text) {
    this._mode('wait');
    this.waitEl.textContent = text;
  }

  _resolve(value) {
    const resolve = this.pending;
    if (!resolve) return;
    this.pending = null;
    this.legal = null;
    this._mode('wait');
    this.waitEl.textContent = '';
    resolve(value);
  }

  /** Abort whatever the UI is waiting for (resolves with null). */
  cancelPrompt() {
    this._resolve(null);
  }

  waitForDeal(label) {
    this._mode('deal');
    this.dealBtn.textContent = label;
    return new Promise((resolve) => { this.pending = resolve; });
  }

  promptAction(legal, me, unit) {
    this.legal = legal;
    this.unit = unit;
    this._mode('action');
    this.btnFold.disabled = legal.canCheck; // never fold when checking is free
    this.btnCall.textContent = legal.canCheck
      ? 'Check'
      : legal.toCall >= me.chips ? `All-in ${fmt(legal.toCall)}` : `Call ${fmt(legal.toCall)}`;
    this.btnRaise.hidden = !legal.canRaise;
    if (legal.canRaise) this._setupRaise(legal);
    this.raisePanel.hidden = true;
    this._updateRaiseLabel();
    return new Promise((resolve) => { this.pending = resolve; });
  }

  // The slider runs over step indexes so that all-in is always reachable,
  // even when the stack is not a multiple of the chip unit.
  _setupRaise(legal) {
    const { minRaiseTo: min, maxRaiseTo: max } = legal;
    this.raiseSteps = Math.max(0, Math.ceil((max - min) / this.unit));
    this.slider.min = 0;
    this.slider.max = this.raiseSteps;
    this.slider.value = 0;

    const potAfterCall = legal.pot + legal.toCall;
    const fromPot = (f) => legal.currentBet + f * potAfterCall;
    const presets = [['Min', min], ['½ Pot', fromPot(0.5)], ['¾ Pot', fromPot(0.75)], ['Pot', fromPot(1)], ['All-in', max]];
    this.presetsEl.innerHTML = '';
    for (const [label, amount] of presets) {
      const b = document.createElement('button');
      b.textContent = label;
      b.disabled = amount < min && label !== 'Min';
      b.onclick = () => {
        this.slider.value = this._stepFor(amount);
        this._updateRaiseLabel();
      };
      this.presetsEl.appendChild(b);
    }
  }

  _stepFor(amount) {
    const { minRaiseTo: min, maxRaiseTo: max } = this.legal;
    if (amount >= max) return this.raiseSteps;
    return Math.max(0, Math.min(this.raiseSteps, Math.round((amount - min) / this.unit)));
  }

  _raiseValue() {
    const { minRaiseTo: min, maxRaiseTo: max } = this.legal;
    const step = Number(this.slider.value);
    return step >= this.raiseSteps ? max : Math.min(max, min + step * this.unit);
  }

  _nudge(dir) {
    this.slider.value = Math.max(0, Math.min(this.raiseSteps, Number(this.slider.value) + dir));
    this._updateRaiseLabel();
  }

  _updateRaiseLabel() {
    if (!this.legal?.canRaise) return;
    const word = this.legal.isBet ? 'Bet' : 'Raise';
    if (this.raisePanel.hidden) {
      this.btnRaise.textContent = `${word}…`;
      return;
    }
    const amount = this._raiseValue();
    this.btnRaise.textContent = amount >= this.legal.maxRaiseTo
      ? `All-in ${fmt(amount)}`
      : `${this.legal.isBet ? 'Bet' : 'Raise to'} ${fmt(amount)}`;
  }

  // ---------- modal ----------

  openModal(title, content, { push = false } = {}) {
    if (push && !this.modal.hidden) {
      this.modalStack.push({ title: this.modalTitle.textContent, nodes: [...this.modalBody.childNodes] });
    } else {
      this.modalStack = [];
    }
    this.modalTitle.textContent = title;
    this.modalBody.replaceChildren(content);
    this.modalBody.scrollTop = 0;
    this.modalBack.hidden = this.modalStack.length === 0;
    this.modal.hidden = false;
  }

  backModal() {
    const prev = this.modalStack.pop();
    if (!prev) return this.closeModal();
    this.modalTitle.textContent = prev.title;
    this.modalBody.replaceChildren(...prev.nodes);
    this.modalBack.hidden = this.modalStack.length === 0;
  }

  closeModal() {
    this.modal.hidden = true;
    this.modalStack = [];
    this.modalBody.replaceChildren();
  }
}
