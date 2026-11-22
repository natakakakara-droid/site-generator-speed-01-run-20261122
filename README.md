# site-generator-speed-01-run-20261122

[![make.fun bounty](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/natakakakara-droid/site-generator-speed-01-run-20261122/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/natakakakara-droid/site-generator-speed-01-run-20261122/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)

A faster drop-in for **makefun-site 1.0.0**, built for the [make.fun bounty "Build a static site faster, 22 November 2026"](https://make.fun/bounty/site-generator-speed-01-run-20261122). It answers exactly as makefun-site does on every case — byte-for-byte identical output trees — and beats it on CPU time.

## What it is

- `solve.js` — a dependency-free ES module exporting `run(input)`. It reimplements
  makefun-site 1.0.0 as a tight single pass: front matter, its Markdown subset, its
  template dialect, its slug rule, collections, tags, pagination and build report.
- `main.ts` — the program the harness runs (`node main.ts`, Node 22): reads every case
  from `/input/cases.json` (or `MAKEFUN_INPUT_DIR`), answers each one alone with
  `run()`, and writes `/output/answers.json`.

## How it is faster

- Each template is compiled once per case into a flat op list with jumps — no tree
  walk, no re-parsing per page — and rendered by an iterative loop with an explicit
  loop stack.
- Markdown is lexed and rendered in one pass with hand-rolled `indexOf`/`charCodeAt`
  scanners instead of per-line regexes, and inline text is rendered in a single pass
  that slices plain runs out whole.
- Output is built in arrays and joined once; repeated work is cached per case only
  (slugs, long dates, reading minutes). Nothing is cached from one case to the next.
- No clock, no randomness, no network, no file reads: the output is a function of
  the input alone, so two runs are byte-for-byte identical.

## Verification

- Practice set: **3/3 cases, passed=1** (kit scorer).
- Two fresh sets drawn with the kit generator: **3/3 each**.
- Differential fuzzing against the reference: **1200 random adversarial sites,
  byte-identical outputs**.
- Determinism: two runs into separate output directories are identical.
- Official grade-local (`grade-local --driver process`): **3/3, passed=1**,
  L1 regrade reproduced byte for byte.
- Speed on the practice set (this machine, 11 rounds): baseline median **519 ms**
  wall / **620 ms** CPU vs this entry **161 ms** wall / **174 ms** CPU — about
  **3.2x faster**.

## License

MIT — see [LICENSE](LICENSE).
