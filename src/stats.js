// Player statistics, accumulated from engine hand histories.

export function emptyStats() {
  return {
    handsPlayed: 0, handsWon: 0, vpip: 0, pfr: 0, showdowns: 0, showdownsWon: 0,
    net: 0, bbNet: 0, biggestPot: 0, rebuys: 0,
  };
}

export function recordHand(stats, hand, seat) {
  const me = hand.players.find((p) => p.seat === seat);
  if (!me || !hand.result) return stats;
  const s = { ...stats };
  s.handsPlayed++;

  const pre = hand.actions.filter((a) => a.street === 'preflop' && a.seat === seat);
  if (pre.some((a) => a.type === 'call' || a.type === 'raise')) s.vpip++;
  if (pre.some((a) => a.type === 'raise')) s.pfr++;

  const net = me.endChips - me.startChips;
  s.net += net;
  s.bbNet += net / hand.bigBlind;

  const won = hand.result.awards.filter((a) => !a.uncalled && a.winners.includes(seat));
  if (won.length) {
    s.handsWon++;
    s.biggestPot = Math.max(s.biggestPot, won.reduce((t, a) => t + a.amount, 0));
  }
  if (hand.result.showdown && hand.result.shown.some((x) => x.seat === seat)) {
    s.showdowns++;
    if (won.length) s.showdownsWon++;
  }
  return s;
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
const signed = (n) => (n > 0 ? `+${n.toLocaleString('en-US')}` : n.toLocaleString('en-US'));

export function summarize(s) {
  return [
    ['Hands played', s.handsPlayed.toLocaleString('en-US')],
    ['Hands won', `${s.handsWon} (${pct(s.handsWon, s.handsPlayed)})`],
    ['Net chips', signed(Math.round(s.net))],
    ['BB / 100 hands', s.handsPlayed ? ((100 * s.bbNet) / s.handsPlayed).toFixed(1) : '—'],
    ['VPIP', pct(s.vpip, s.handsPlayed)],
    ['Preflop raise', pct(s.pfr, s.handsPlayed)],
    ['Went to showdown', pct(s.showdowns, s.handsPlayed)],
    ['Won at showdown', pct(s.showdownsWon, s.showdowns)],
    ['Biggest pot won', s.biggestPot.toLocaleString('en-US')],
    ['Rebuys', String(s.rebuys)],
  ];
}
