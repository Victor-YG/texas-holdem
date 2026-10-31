# Texas Hold'em vs. Bots

No-limit Texas Hold'em cash game against 1–5 bots. It's a zero-dependency Progressive Web App: plain HTML, CSS and JavaScript ES modules, with no build step and no npm packages. It installs on Android from Chrome and plays offline.

## Run locally

```sh
npm start          # http://localhost:8080  (or: node tools/serve.mjs)
npm test           # unit tests (Node 18+ built-in test runner)
```

ES modules don't load from `file://`, so open the game through the server.

To try it on your phone over Wi-Fi, run `npm run start:lan` and open the printed `http://192.168.x.x:8080` address. Over plain http the game plays, but Chrome won't offer "Install".

## Install on Android

The game is published with GitHub Pages from [Victor-YG/texas-holdem](https://github.com/Victor-YG/texas-holdem) (Settings → Pages → Deploy from branch → `main` / root):

**Play / install: https://victor-yg.github.io/texas-holdem/**

1. Open that link in Chrome on your phone.
2. In the ⋮ menu, choose **Add to Home screen** (or **Install app**).
3. Launch it from the spade icon. It runs full-screen and works offline.

To ship an update, commit and push to `main`. Pages redeploys within a minute or two, and the installed app picks up the new version the next time it opens while online. Stats, settings and the saved table live on the phone, so updates don't reset them.

To publish a real APK or Play Store listing later, wrap the same files with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) (a Trusted Web Activity) or Capacitor. No code changes are needed.

## Features

- 2–6 player tables (you plus 1–5 bots), configurable blinds and buy-in, chosen under Menu → New game.
- Match rules: the first player to reach the chip goal (default 10,000) wins, with an option to keep playing. Busted players borrow a buy-in from the bank up to a limit (default 5); with none left they are out. Bots follow the same rules.
- Full no-limit rules:
  - Blinds, including the heads-up rule that the button posts the small blind.
  - Minimum raises, and a short all-in raise does not reopen betting.
  - Side pots, uncalled bets returned, and odd chips split to the left of the button.
  - All-in run-outs with hands turned face up.
- Bots at three difficulty levels and five personalities (tap a bot to see its type).
- An odds hint (💡) showing your Monte Carlo equity, the pot odds you're getting, and whether calling is +EV.
- Statistics: hands, win rate, net chips, bb/100, VPIP, PFR, showdown %.
- Hand history of the last 50 hands, with a step-by-step replay.
- Animations (dealing, chips, winner highlight) and synthesized sound effects. There are no audio files.
- Persists the table, settings, stats and history in `localStorage`. You can close the app and resume later.

## Design

```
index.html, styles.css         UI shell (mobile-first, portrait)
src/cards.js                   card encoding (0..51), deck, shuffle (crypto RNG), seeded PRNG for tests
src/evaluator.js               5–7 card hand evaluator -> comparable integer score + hand names
src/equity.js                  Monte Carlo equity (optional opponent range floors), Chen preflop score
src/engine.js                  table state machine: blinds, betting rounds, side pots, showdown, history
src/bot.js                     heuristic bot AI
src/stats.js                   player statistics from hand histories
src/match.js                   match rules: borrowing, elimination, chip goal, standings
src/ui.js                      rendering, animations, action input (slider, presets)
src/screens.js                 menu, settings, stats, history + replay, help
src/sound.js                   Web Audio sound effects
src/storage.js                 safe localStorage wrapper
src/main.js                    controller: hand loop, bots, hints, persistence
sw.js, manifest.webmanifest    PWA (offline cache, installability)
tools/serve.mjs                dev server;  tools/make_icons.py  icon generator
test/                          node:test unit tests
```

**Engine.** `Game` is pure logic with no DOM, so it's fully unit-tested. Call `startHand()`, then `act({type, amount})` for `game.toAct` until `handOver`. `legalActions()` tells the UI and bots what is allowed. Every state change queues an event carrying a snapshot. The UI drains those events and animates them one by one, so an all-in run-out shows the flop, turn and river in sequence even though the engine resolves them instantly.

**Bots.**
- *Preflop:* uses the Chen hand score. The opening threshold depends on how many players are left to act, whether the pot has been raised and the raise size, and the bot's personality. Stacks of 12 BB or less switch to push-or-fold.
- *Postflop:* estimates equity by Monte Carlo and compares it to the pot odds. That decides between value bets, check-calls, slow-plays, bluffs and semi-bluff raises. Bet sizes are a fraction of the pot.
- *Difficulty:* sets simulation size, decision noise and calling leaks. Hard bots also read ranges: when sampling an opponent's cards, they skip hands that player would not have raised or called with preflop.

In a 6-max bot-only simulation (20k hands, two seeds), hard bots won about +40 to +65 bb/100, medium about −12 to +25, and easy about −40 to −80. The levels separate as intended.

**Updating the deployed app.** The service worker is network-first. Online users get new files on their next launch, and offline users get the cached copy. If you add files, list them in `sw.js` and bump `CACHE`.

## Ideas for later

- Tournament (sit-and-go) mode with rising blinds.
- Pre-action buttons (check/fold in turn) and a time bank.
- A Web Worker for larger equity simulations.
