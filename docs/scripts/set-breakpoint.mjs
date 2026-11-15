#!/usr/bin/env node
/**
 * set-breakpoint.mjs
 *
 * Moves Horizon's mobile/desktop breakpoint from 750px to Coszus's 820px
 * (HANDOFF section 2: mobile is max-width 820px, desktop starts at 821px).
 *
 *   node docs/scripts/set-breakpoint.mjs <theme-root> [--dry-run] [--no-container] [--quiet]
 *
 * Re-run it after every Horizon update (Horizon ships with 750px), then check
 * nothing is left:  grep -rnP "(?<![0-9.])7(49|50)(?![0-9])" assets blocks layout sections snippets
 * (the only expected hits are SVG path numbers in snippets/icon.liquid).
 *
 * What it rewrites (and nothing else):
 *   - Media features in parentheses, wherever they appear (CSS @media in
 *     assets/*.css and in {% stylesheet %}/{% style %}/<style> blocks, Liquid
 *     `sizes` strings, <source media="...">, JS matchMedia strings):
 *        (min-width: 750px)       -> (min-width: 821px)
 *        (max-width: 749px)       -> (max-width: 820px)
 *        (max-width: 749.98px)    -> (max-width: 820.98px)  (fraction kept, so no gap)
 *        (max-width: 750px)       -> (max-width: 820px)     (Horizon off-by-one, means "mobile")
 *        em equivalents 46.875em (750) / 46.8125em (749) -> 51.3125em / 51.25em
 *   - Range syntax: (width >= 750px) -> 821px, (width < 750px) -> 821px,
 *     (width <= 749px) -> 820px, (width > 749px) -> 820px, and the reversed
 *     forms (750px <= width) etc.
 *   - @container queries using the same numbers (skip with --no-container).
 *   - JS viewport checks: innerWidth < 750 / >= 750 -> 821;
 *     innerWidth <= 749 / > 749 -> 820.
 *   - Liquid: `assign min_breakpoint = 750` (util-autofill-img-size-attr).
 *   - Three Horizon comments that document the breakpoint.
 *
 * Idempotent: every output value (820/821) is outside every input pattern, so
 * a second run reports 0 changes. Files are only written when they change.
 * Only .liquid/.css/.js/.mjs/.json files are scanned; .git, node_modules and
 * docs/ are skipped. SVG path data (snippets/icon.liquid, *.svg) contains
 * "749"/"750" as digit substrings; no rule can match there because every rule
 * requires a width keyword, a unit, or a JS/Liquid identifier next to it.
 */
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const MOBILE_MAX = 820; // last mobile pixel
const DESKTOP_MIN = 821; // first desktop pixel

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith('--'));
const DRY = args.includes('--dry-run');
const NO_CONTAINER = args.includes('--no-container');
const QUIET = args.includes('--quiet');

if (!root) {
  console.error('Usage: node set-breakpoint.mjs <theme-root> [--dry-run] [--no-container] [--quiet]');
  process.exit(2);
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'docs', '.shopify']);
const EXTS = new Set(['.liquid', '.css', '.js', '.mjs', '.json']);

/** Map an old breakpoint number (as written) to the new one, keeping units. */
function mapValue(num, unit, kind) {
  // kind: 'min' = first desktop pixel, 'max' = last mobile pixel
  if (unit === 'em' || unit === 'rem') {
    const px = Number(num) * 16;
    if (kind === 'min' && px === 750) return `${DESKTOP_MIN / 16}${unit}`;
    if (kind === 'max' && (px === 749 || px === 750)) return `${MOBILE_MAX / 16}${unit}`;
    return null;
  }
  const n = Number(num);
  if (kind === 'min' && n === 750) return `${DESKTOP_MIN}${unit}`;
  if (kind === 'max') {
    if (n === 750 || n === 749) return `${MOBILE_MAX}${unit}`;
    if (n > 749 && n < 750) return `${MOBILE_MAX}${num.slice(num.indexOf('.'))}${unit}`; // 749.98 -> 820.98
  }
  return null;
}

/** Is offset `i` inside an @container prelude (i.e. the closest at-rule before it, on the same prelude, is @container)? */
function inContainerPrelude(text, i) {
  const start = Math.max(text.lastIndexOf('{', i), text.lastIndexOf('}', i), text.lastIndexOf(';', i));
  const prelude = text.slice(start + 1, i);
  return /@container\b/.test(prelude);
}

const NUM_PX = String.raw`(7(?:49(?:\.\d+)?|50))(px)`;
const NUM_EM = String.raw`(46\.875|46\.8125)(em|rem)`;

/**
 * Each rule: { id, re, kind(match) -> 'min'|'max', build(match, groups) -> replacement | null }.
 * All regexes are global; replacement is done via a callback so we can count and skip.
 */
const rules = [
  {
    id: 'mq-min-width',
    re: new RegExp(String.raw`\(\s*min-width\s*:\s*(?:${NUM_PX}|${NUM_EM})\s*\)`, 'g'),
    kind: 'min',
  },
  {
    id: 'mq-max-width',
    re: new RegExp(String.raw`\(\s*max-width\s*:\s*(?:${NUM_PX}|${NUM_EM})\s*\)`, 'g'),
    kind: 'max',
  },
  {
    // (width >= 750px) / (width > 749px) / (width < 750px) / (width <= 749px)
    id: 'mq-range',
    re: new RegExp(String.raw`\bwidth\s*(>=|>|<=|<)\s*(?:${NUM_PX}|${NUM_EM})`, 'g'),
    kind: null, // decided from operator
  },
  {
    // reversed: (750px <= width) / (749px < width) / (750px > width) / (749px >= width)
    id: 'mq-range-reversed',
    re: new RegExp(String.raw`(?<![\d.])(?:${NUM_PX}|${NUM_EM})\s*(>=|>|<=|<)\s*width\b`, 'g'),
    kind: null,
  },
  {
    id: 'js-innerWidth',
    re: /\b(innerWidth|documentElement\.clientWidth)(\s*)(>=|>|<=|<)(\s*)(749|750)(?![\d.])/g,
    kind: null,
  },
  {
    id: 'liquid-min_breakpoint',
    re: /(\bassign\s+min_breakpoint\s*=\s*)750(?![\d.])/g,
    kind: 'min',
  },
  {
    id: 'comment',
    re: /(Tablet-specific overrides - )750px( to 989px)|(take over at ≥)750px|(only applies at )750px( and up)/g,
    kind: 'min',
  },
];

function applyRule(rule, text, counts) {
  return text.replace(rule.re, (...m) => {
    const match = m[0];
    const offset = m[m.length - 2];
    const isContainer = inContainerPrelude(text, offset);
    if (NO_CONTAINER && isContainer) return match;

    let out = null;
    switch (rule.id) {
      case 'mq-min-width':
      case 'mq-max-width': {
        const [num, unit] = m[1] !== undefined ? [m[1], m[2]] : [m[3], m[4]];
        const v = mapValue(num, unit, rule.kind);
        if (v) out = match.replace(num + unit, v);
        break;
      }
      case 'mq-range': {
        const op = m[1];
        const [num, unit] = m[2] !== undefined ? [m[2], m[3]] : [m[4], m[5]];
        // width >= X / width < X : X is first desktop px; width > X / width <= X : X is last mobile px
        const kind = op === '>=' || op === '<' ? 'min' : 'max';
        const v = mapValue(num, unit, kind);
        if (v) out = match.replace(num + unit, v);
        break;
      }
      case 'mq-range-reversed': {
        const [num, unit] = m[1] !== undefined ? [m[1], m[2]] : [m[3], m[4]];
        const op = m[5];
        // X <= width / X > width : X is first desktop px; X < width / X >= width : X is last mobile px
        const kind = op === '<=' || op === '>' ? 'min' : 'max';
        const v = mapValue(num, unit, kind);
        if (v) out = match.replace(num + unit, v);
        break;
      }
      case 'js-innerWidth': {
        const [, ident, s1, op, s2, num] = m;
        const kind = op === '>=' || op === '<' ? 'min' : 'max';
        const v = mapValue(num, '', kind);
        // innerWidth < 750 -> < 821 ; innerWidth <= 749 -> <= 820
        if (v) out = `${ident}${s1}${op}${s2}${v}`;
        break;
      }
      case 'liquid-min_breakpoint':
        out = `${m[1]}${DESKTOP_MIN}`;
        break;
      case 'comment':
        out = match.replace('750px', `${DESKTOP_MIN}px`);
        break;
    }
    if (out === null || out === match) return match;
    const key = isContainer ? `${rule.id}(container)` : rule.id;
    counts[key] = (counts[key] || 0) + 1;
    return out;
  });
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(path.join(dir, entry.name));
    } else if (EXTS.has(path.extname(entry.name))) {
      yield path.join(dir, entry.name);
    }
  }
}

/** Warn about combined ranges that become empty, e.g. (min-width: 821px) and (max-width: 800px). */
function emptyRangeWarnings(text, rel) {
  const warnings = [];
  const re = /\(\s*min-width\s*:\s*([\d.]+)px\s*\)\s*and\s*\(\s*max-width\s*:\s*([\d.]+)px\s*\)/g;
  for (const m of text.matchAll(re)) {
    if (Number(m[2]) < Number(m[1])) warnings.push(`${rel}: empty range ${m[0]}`);
  }
  return warnings;
}

const absRoot = path.resolve(root);
if (!(await stat(absRoot)).isDirectory()) {
  console.error(`Not a directory: ${absRoot}`);
  process.exit(2);
}

let totalChanges = 0;
let filesChanged = 0;
const totalsByRule = {};
const warnings = [];

for await (const file of walk(absRoot)) {
  const rel = path.relative(absRoot, file);
  const before = await readFile(file, 'utf8');
  const counts = {};
  let after = before;
  for (const rule of rules) after = applyRule(rule, after, counts);
  warnings.push(...emptyRangeWarnings(after, rel));
  const n = Object.values(counts).reduce((a, b) => a + b, 0);
  if (n === 0) continue;
  filesChanged++;
  totalChanges += n;
  for (const [k, v] of Object.entries(counts)) totalsByRule[k] = (totalsByRule[k] || 0) + v;
  if (!QUIET) {
    const detail = Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    console.log(`${String(n).padStart(4)}  ${rel}  (${detail})`);
  }
  if (!DRY) await writeFile(file, after, 'utf8');
}

console.log('');
console.log(`${DRY ? '[dry run] ' : ''}${totalChanges} change(s) in ${filesChanged} file(s); breakpoint: mobile <= ${MOBILE_MAX}px, desktop >= ${DESKTOP_MIN}px`);
for (const [k, v] of Object.entries(totalsByRule).sort()) console.log(`  ${k}: ${v}`);
for (const w of warnings) console.warn(`WARNING ${w}`);
