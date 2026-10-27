// Generates index.html — the local, single-user edition — from team.html.
//
//   node build-index.mjs           write index.html
//   node build-index.mjs --check   exit 1 if index.html is out of date
//
// index.html used to be a hand-maintained fork of team.html. It was rebuilt by
// hand twice and drifted again within days each time, so now it is derived:
// never edit index.html, edit team.html and rerun this.
//
// Two marker forms in team.html drive the transform:
//
//   <!-- @team --> … <!-- /@team -->   dropped from index.html
//   <!-- @local … -->                  unwrapped into index.html (inert in team)
//
// Behaviour that differs at runtime keys off TEAM_EDITION in team.html, which is
// false when local-fb.js (the localStorage stand-in for Firebase) has loaded.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, 'team.html');
const OUT = join(here, 'index.html');

const BANNER =
  '<!-- GENERATED from team.html by build-index.mjs — do not edit by hand.\n' +
  '     Local single-user edition: data stays in this browser (local-fb.js). -->\n';

function build(src) {
  const teamBlocks = src.match(/<!-- @team -->[\s\S]*?<!-- \/@team -->/g) || [];
  const localBlocks = src.match(/<!-- @local [\s\S]*?-->/g) || [];
  // Every opener must have found its closer; a stray one means a typo that
  // would otherwise leak Team-only markup into the local edition silently.
  const openers = (src.match(/<!-- @team -->/g) || []).length;
  const closers = (src.match(/<!-- \/@team -->/g) || []).length;
  if (openers !== closers || openers !== teamBlocks.length) {
    throw new Error(`unbalanced @team markers: ${openers} open, ${closers} close`);
  }
  if (!teamBlocks.length || !localBlocks.length) throw new Error('no edition markers found in team.html');

  // Block body: anything up to the FIRST closer, so one block can never swallow
  // the markup between it and the next.
  const BODY = '(?:(?!<!-- /@team -->)[\\s\\S])*';
  let out = src
    // A block on its own line(s) takes its indentation and line break with it…
    .replace(new RegExp('^[ \\t]*<!-- @team -->' + BODY + '<!-- /@team -->[ \\t]*\\r?\\n', 'gm'), '')
    // …an inline one (inside the header title) leaves the surrounding text.
    .replace(new RegExp('<!-- @team -->' + BODY + '<!-- /@team -->', 'g'), '')
    .replace(/<!-- @local ([\s\S]*?) -->/g, '$1');

  if (/@team|@local|auth\.js|whatsnew\.js/.test(out)) {
    throw new Error('index.html would still reference a Team-only marker or script');
  }
  out = out.replace(/^<!DOCTYPE html>\r?\n/i, m => m + BANNER);
  return out;
}

const out = build(readFileSync(SRC, 'utf8'));

if (process.argv.includes('--check')) {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (cur !== out) { console.error('index.html is stale — run: node build-index.mjs'); process.exit(1); }
  console.log('index.html is up to date');
} else {
  writeFileSync(OUT, out);
  console.log(`wrote index.html (${out.length.toLocaleString()} chars)`);
}
