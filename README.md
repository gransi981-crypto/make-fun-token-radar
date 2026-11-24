# make-fun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/gransi981-crypto/make-fun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/gransi981-crypto/make-fun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads the sealed DefiLlama snapshot of 14 November 2026, fits an implied-value model on the snapshot's own live-token comps, and ranks 200 pre-token protocols — the 40-protocol watchlist plus the early radar below its floor — each with a dollar-costed farm plan. The output is a sortable, filterable dashboard with a detail view per protocol.

The model (radar-2) fits `log10(market cap) = a + b · log10(TVL)` by least squares over the snapshot's live-token protocols, applies a sector factor (each category's median actual-to-fitted market cap, shrunk toward 1), a growth multiplier from the seven-day TVL change, and a no-token clock from the time since the protocol was first listed. No protocol name is special-cased.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22.18 or later, standard library only, no network. The program reads the snapshot, writes `board.json` (the ranked board), `data.js` (the dashboard's dataset), copies `dashboard/` and `screenshots/` to the output directory, and writes `dossier.json`, the summary the judge reads. Two runs write byte-identical output.

## Layout

- `main.ts` — the entrypoint: snapshot in, board and dashboard out.
- `lib/radar.ts` — the model: comps fit, sector factors, scoring, farm plans, board checks.
- `vendor/makefun-board.ts` — make.fun's dossier library (vendored, as the kit instructs).
- `dashboard/` — the page: `index.html`, `app.css`, `app.js`. It renders from `data.js` and recomputes every row's implied value in the page, so the code and the board agree.
- `screenshots/` — the board, a detail view and a filtered view of the dashboard.

---

<sub>Entered on [make.fun](https://make.fun/?ref=pab8n0ew&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
