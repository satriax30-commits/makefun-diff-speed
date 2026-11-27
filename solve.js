// makefun-diff/1 — a fast, original re-implementation written from the published
// specification (the rule stated in the competition kit: tokenize on "\n", keep the
// common prefix then the common suffix, Myers greedy between them with the
// deletion-wins tie-break, no edge pruning, snakes over equal runs, then the
// makefun-diff/1 patch format with 3 lines of context and hunks merged across
// at most 6 kept lines). No code is copied from any public diff library; the
// algorithm below is an independent implementation of that specification.
//
// How it is fast:
//  - Every distinct line is mapped once to a small integer id (a Map over the
//    line strings), so the whole search compares Int32 ids instead of strings.
//    The split parts are mapped directly — no line strings are ever built —
//    and a bare last line (no trailing "\n") carries a flag bit on its id, so
//    it stays distinct from the same text with a newline, as the rule requires.
//  - The Myers search keeps its whole V-trace as Int32Arrays (one per d)
//    instead of allocating a path object per (d, k) step the way the
//    reference does, and uses -2 as the "no path" sentinel so the candidate
//    checks need no extra definedness test.
//  - The full V-trace is kept so the exact edit script can be rebuilt by
//    backtracking, replaying the same candidate-validity and tie-break rules
//    the forward search used, which reproduces the reference's script exactly.
//  - The patch is assembled by pushing pieces (op, text, newline) into one
//    array and joining once — no per-line string concatenation.
//  - Prefix/suffix trimming on ids and an early exit for identical texts avoid
//    the search entirely in the common easy cases.
//
// Deterministic: a pure function of its input — no clock, no randomness, no
// network, nothing cached from one case to the next.

/** Internal op codes for the runs the search returns. */
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** The patch's first word. */
const FORMAT = 'makefun-diff/1';

/** The kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

/** V-trace sentinel: no path of d edits reaches this diagonal. */
const NONE = -2;

/** Flag bit on a line id: the line is its text's last line and has no trailing "\n". */
const BARE = 0x40000000;

/**
 * The runs of the edit script of the middle slices A[a0 .. a0+N) into
 * B[b0 .. b0+M): [[kind, count], ...] in order, consecutive runs of one kind
 * merged. kind is KEEP, DELETE or INSERT. The runs are exactly the ones the
 * specification's greedy search produces: for d = 0, 1, 2, ... and each
 * diagonal k = x - y from -d to d in steps of 2, the furthest point a path of
 * d edits reaches on k is one old line past the furthest (d-1)-point on
 * diagonal k - 1 (a deletion) or one new line past the furthest (d-1)-point
 * on diagonal k + 1 (an insertion), whichever lies further into the old
 * text, and the deletion when both reach the same point; a move past the end
 * of either text is no candidate, no edge diagonal is pruned, and from that
 * point the path keeps every line equal in both texts as far as it can.
 */
function myersRuns(A, a0, N, B, b0, M) {
  if (N === 0 && M === 0) return [];

  // The V-trace: vs[d] is the Int32Array of the furthest x reached on each
  // diagonal k = -d..d (index j = k + d) by a path of d edits, or NONE where
  // no path of d edits reaches that diagonal. Kept whole for the backtrack.
  const vs = [];

  // d = 0: the snake from (0, 0) over the equal lines.
  let x = 0;
  let y = 0;
  while (x < N && y < M && A[a0 + x] === B[b0 + y]) {
    x++;
    y++;
  }
  const v0 = new Int32Array(1);
  v0[0] = x;
  vs.push(v0);
  if (x === N && y === M) return x > 0 ? [[KEEP, x]] : [];

  let D = 0;
  let found = false;
  for (let d = 1; d <= N + M && !found; d++) {
    const v = new Int32Array(2 * d + 1);
    const vp = vs[d - 1];
    const vpLast = 2 * d - 2; // last valid index of vp
    const twoD = 2 * d;
    for (let j = 0; j <= twoD; j += 2) {
      const k = j - d;
      // The deletion candidate: one old line past V[d-1] on diagonal k - 1,
      // valid only when its next old line is in range (NONE reads as -1 here,
      // which is below 0 and so never chosen).
      let xDel = -1;
      if (j >= 2) {
        const xv = vp[j - 2];
        if (xv < N) xDel = xv + 1;
      }
      // The insertion candidate: V[d-1] on diagonal k + 1, same x, valid
      // only when its next new line is in range (NONE reads as -2, below 0).
      let xIns = -1;
      if (j <= vpLast) {
        const xv = vp[j];
        if (xv - (k + 1) < M) xIns = xv;
      }
      if (xDel < 0 && xIns < 0) {
        v[j] = NONE;
        continue;
      }
      // Further into the old text wins; the deletion wins a tie.
      let xx = xDel >= xIns ? xDel : xIns;
      let yy = xx - k;
      let ai = a0 + xx;
      let bi = b0 + yy;
      while (xx < N && yy < M && A[ai] === B[bi]) {
        xx++;
        yy++;
        ai++;
        bi++;
      }
      v[j] = xx;
      if (xx === N && yy === M) {
        D = d;
        found = true;
        break;
      }
    }
    vs.push(v);
  }
  if (!found) throw new Error('makefun-diff: the search ended without reaching both ends');

  // Backtrack from (N, M) at depth D. At each d the predecessor is recomputed
  // from V[d-1] with exactly the forward step's validity and tie-break rules,
  // so the rebuilt script is the forward search's own script.
  const ops = []; // flat [kind, count, ...], in reverse order
  let cx = N;
  let cy = M;
  for (let d = D; d >= 1; d--) {
    const k = cx - cy;
    const vp = vs[d - 1];
    const j = k + d;
    let xDel = -1;
    if (j >= 2) {
      const xv = vp[j - 2];
      if (xv < N) xDel = xv + 1;
    }
    let xIns = -1;
    if (j <= 2 * d - 2) {
      const xv = vp[j];
      if (xv - (k + 1) < M) xIns = xv;
    }
    const isDel = xDel >= xIns;
    const xStart = isDel ? xDel : xIns;
    const yStart = xStart - k;
    if (cx > xStart) ops.push(KEEP, cx - xStart); // the snake's kept lines
    if (isDel) {
      ops.push(DELETE, 1);
      cx = xStart - 1;
      cy = yStart;
    } else {
      ops.push(INSERT, 1);
      cx = xStart;
      cy = yStart - 1;
    }
  }
  if (cx > 0) ops.push(KEEP, cx); // the d = 0 snake

  // Reverse into runs, merging consecutive runs of one kind.
  const runs = [];
  for (let i = ops.length - 2; i >= 0; i -= 2) {
    const kind = ops[i];
    const count = ops[i + 1];
    const last = runs[runs.length - 1];
    if (last !== undefined && last[0] === kind) last[1] += count;
    else runs.push([kind, count]);
  }
  return runs;
}

/** make.fun's own patch of input.old into input.new, as one JSON string. */
export function run(input) {
  // The texts cut after every "\n"; a last part without "\n" is a line too,
  // and the empty text has no lines. The parts are mapped directly, so no
  // line strings are built; a bare last line carries the BARE flag on its id.
  const aParts = input.old.split('\n');
  const bParts = input.new.split('\n');
  const aLast = aParts.length - 1;
  const bLast = bParts.length - 1;
  const aBare = aParts[aLast] !== '';
  const bBare = bParts[bLast] !== '';
  const n = aLast + (aBare ? 1 : 0);
  const m = bLast + (bBare ? 1 : 0);

  // Map each distinct line to an integer id once; the search compares ids.
  const ids = new Map();
  let nextId = 0;
  const A = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const s = aParts[i];
    let id = ids.get(s);
    if (id === undefined) {
      id = nextId++;
      ids.set(s, id);
    }
    A[i] = i === n - 1 && aBare ? id | BARE : id;
  }
  const B = new Int32Array(m);
  for (let i = 0; i < m; i++) {
    const s = bParts[i];
    let id = ids.get(s);
    if (id === undefined) {
      id = nextId++;
      ids.set(s, id);
    }
    B[i] = i === m - 1 && bBare ? id | BARE : id;
  }

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  const minNM = n < m ? n : m;
  while (prefix < minNM && A[prefix] === B[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && A[n - 1 - suffix] === B[m - 1 - suffix]) suffix++;

  const midRuns = myersRuns(A, prefix, n - prefix - suffix, B, prefix, m - prefix - suffix);

  // The full run list: the kept prefix, the search's runs, the kept suffix.
  const runs = [];
  if (prefix > 0) runs.push([KEEP, prefix]);
  for (const r of midRuns) runs.push(r);
  if (suffix > 0) runs.push([KEEP, suffix]);

  // The change runs: each a stretch of deletions and insertions between two
  // kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    const kind = r[0];
    const count = r[1];
    if (kind === KEEP) {
      o += count;
      p += count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (kind === DELETE) {
      c.dels += count;
      o += count;
      deleted += count;
    } else {
      c.ins += count;
      p += count;
      inserted += count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  // The patch, assembled from pieces and joined once. A line is written as
  // its op, the line, a newline — and "%" on a line of its own when the line
  // ends its text with no newline (the bare last line).
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  const nLast = n - 1;
  const mLast = m - 1;
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) {
        out.push('=', aParts[at], at === nLast && aBare ? '\n%\n' : '\n');
      }
      for (let i = 0; i < c.dels; i++) {
        const li = c.o + i;
        out.push('-', aParts[li], li === nLast && aBare ? '\n%\n' : '\n');
      }
      for (let i = 0; i < c.ins; i++) {
        const li = c.p + i;
        out.push('+', bParts[li], li === mLast && bBare ? '\n%\n' : '\n');
      }
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) {
      out.push('=', aParts[at], at === nLast && aBare ? '\n%\n' : '\n');
    }
  }
  return out.join('');
}
