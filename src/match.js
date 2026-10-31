// Match rules on top of single hands: borrowing from the bank, elimination,
// and the chip target that ends the game. Pure functions over the engine's
// players plus the table meta { buyIn, target, maxBorrows, borrows[], continued }.
// maxBorrows < 0 means unlimited; target 0 means no target.

export const UNLIMITED = -1;

export function borrowsLeft(table, seat) {
  if (table.maxBorrows < 0) return Infinity;
  return Math.max(0, table.maxBorrows - (table.borrows[seat] ?? 0));
}

export const canBorrow = (table, seat) => borrowsLeft(table, seat) > 0;

/** Still in the match: has chips, or is busted but can still borrow. */
export function isAlive(table, p) {
  return !p.eliminated && (p.chips > 0 || canBorrow(table, p.seat));
}

/**
 * How the match stands after a hand. Returns null to keep playing, or
 *   { type: 'out' }                   the human busted with no borrows left
 *   { type: 'target', winner }        someone reached the chip target
 *   { type: 'last', winner }          only one player is left in the match
 */
export function checkGameEnd(players, table, humanSeat) {
  const human = players[humanSeat];
  if (!isAlive(table, human)) return { type: 'out' };
  if (table.target > 0 && !table.continued) {
    const leader = [...players].sort((a, b) => b.chips - a.chips)[0];
    if (leader.chips >= table.target) return { type: 'target', winner: leader.seat };
  }
  const alive = players.filter((p) => isAlive(table, p));
  if (alive.length === 1) return { type: 'last', winner: alive[0].seat };
  return null;
}

/** Players ordered for a results table: still alive first, then by chips. */
export function standings(players, table) {
  return [...players]
    .map((p) => ({
      seat: p.seat, name: p.name, avatar: p.avatar, chips: p.chips,
      borrows: table.borrows[p.seat] ?? 0, out: !isAlive(table, p),
    }))
    .sort((a, b) => (a.out - b.out) || (b.chips - a.chips));
}
