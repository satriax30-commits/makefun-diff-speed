[![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/c/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/satriax30-commits/makefun-diff-speed/rank.svg)](https://make.fun/c/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/satriax30-commits/makefun-diff-speed/reward.svg)](https://make.fun/c/diff-speed-01-run-20261126)

# makefun-diff-speed

A faster drop-in for make.fun's own `makefun-diff` 1.0.0, written from the
published specification for the
[diff-speed-01-run-20261126](https://make.fun/c/diff-speed-01-run-20261126)
competition ("Diff two texts faster, 27 November 2026"). `run(input)` returns
exactly the answer `makefun-diff` 1.0.0 returns for every `{ old, new }` —
same patch, same edit script — only faster.

## How it works

The reference builds a path object per Myers step. This entry keeps the exact
same search semantics (common prefix, then common suffix, then Myers greedy
with the deletion-wins tie-break, no edge pruning, snakes over equal runs)
but executes it on integers instead of objects:

- **Line ids.** Every distinct line is mapped once to a small integer id
  (one `Map` over the split parts — no line strings are ever built). A bare
  last line, one with no trailing `\n`, carries a flag bit on its id, so it
  stays distinct from the same text with a newline, as the rule requires.
  The whole search then compares `Int32` ids instead of strings.
- **Typed-array V-trace.** The Myers search keeps its V arrays as
  `Int32Array`s (one per `d`, `-2` = "no path reaches this diagonal")
  instead of allocating a path object per `(d, k)` step. The full trace is
  kept, so the exact edit script is rebuilt by backtracking, replaying the
  same candidate-validity and tie-break rules the forward search used —
  which reproduces the reference's script exactly, including its choice
  between equally short scripts.
- **Cheap patch assembly.** The patch is built by pushing pieces
  (`op`, text, newline) into one array and joining once — no per-line
  string concatenation.
- **Early exits.** Prefix/suffix trimming on ids, and identical texts return
  the header alone without running the search.

Deterministic: `run` is a pure function of its input — no clock, no
randomness, no network, nothing cached from one case to the next, so the
two graded executions write byte-identical outputs.

## Measured on the practice set (4 cases, ~1 MB each)

| entry | CPU time, total |
| --- | --- |
| this entry (`solve.js`) | ~465 ms (warmed) |
| house baseline (`makefun-diff` 1.0.0) | ~1,561 ms |

About **3.3x faster** than the baseline, same machine, same cases, all 4
cases byte-identical to the reference. Differential fuzzing against the
reference: 3,500 small random cases plus 30 larger (500–4,000 line) cases
with CRLF mixes, bare endings, repeated lines, swaps, duplications and
moved blocks — 0 mismatches.

## Files

- `main.ts` — the house driver (unchanged); reads `/input/cases.json`,
  answers each case with `run`, writes `/output/answers.json`.
- `solve.js` — the entry. Dependency-free ES module, exports `run(input)`.
- `package.json` — `{"type": "module"}`, so `solve.js` parses as ESM directly.
- `LICENSE` — MIT.

## License

MIT — see [LICENSE](LICENSE).
