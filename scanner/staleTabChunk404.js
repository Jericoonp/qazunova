#!/usr/bin/env node
/**
 * staleTabChunk404.js — reproduce the "stale tab" chunk-404 failure from outside the app.
 *
 * The Dashboard is a Vite SPA that code-splits: the entry bundle references lazy chunks by
 * content-hashed filename. Every deploy rehashes those filenames and the old files are removed
 * from the origin. A tab that was loaded BEFORE a deploy still holds the OLD filenames, so the
 * next lazy import in that tab fetches a URL that no longer exists.
 *
 * Vite raises a `vite:preloadError` event for exactly this case so an app can prompt a reload.
 * If nothing listens for it, the failed import surfaces as a dead button — no error, no reload.
 *
 * This script proves both halves without needing a login:
 *   1. chunks referenced by an OLD entry bundle 404 against the live origin  (the stale tab)
 *   2. chunks referenced by the CURRENT entry bundle 200                     (control)
 *   3. whether the current bundle registers a `vite:preloadError` listener   (the missing guard)
 *
 * Usage:
 *   node scanner/staleTabChunk404.js --old /tmp/prod-CgtJ3yDr.js
 *   node scanner/staleTabChunk404.js --old /tmp/stg-CIV8hK6p.js --origin https://dashboard.staging.zunou.ai
 *
 * --old is an entry bundle captured before a deploy. Capture one each time you probe:
 *   curl -s https://dashboard.zunou.ai/assets/index-<hash>.js -o /tmp/prod-<hash>.js
 * Old bundles are removed from the origin within minutes of a roll, so capture or lose them.
 *
 * Exits 1 if the stale-tab 404s reproduce, 0 if they do not.
 */

const fs = require('fs');

const DEFAULT_ORIGIN = 'https://dashboard.zunou.ai';
const SAMPLE = 25; // chunks to probe per side; the failure is uniform, no need to fetch all

function parseArgs(argv) {
  const args = { origin: DEFAULT_ORIGIN, old: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--old') args.old = argv[i + 1];
    if (argv[i] === '--origin') args.origin = argv[i + 1].replace(/\/$/, '');
  }
  return args;
}

/**
 * Chunk filenames a bundle will lazily import, as they appear in the emitted source.
 * Several lazy chunks are themselves named `index-<hash>.js`, so only the bundle's OWN
 * filename is excluded — filtering every `index-*` hides most of the surface.
 */
function chunkRefs(source, selfName) {
  const refs = source.match(/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.js/g) || [];
  return [...new Set(refs)].filter((f) => f !== selfName);
}

async function fetchEntryBundle(origin) {
  const html = await (await fetch(`${origin}/`)).text();
  const asset = (html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/) || [])[0];
  if (!asset) throw new Error(`no entry bundle found in ${origin}/`);
  return { asset, source: await (await fetch(`${origin}${asset}`)).text() };
}

async function probe(origin, files) {
  const results = await Promise.all(
    files.map(async (f) => {
      const res = await fetch(`${origin}/assets/${f}`, { method: 'HEAD' });
      return { file: f, status: res.status };
    })
  );
  return results;
}

(async () => {
  const { origin, old } = parseArgs(process.argv);
  if (!old) {
    console.error('error: --old <path to a bundle captured before a deploy> is required');
    process.exit(2);
  }
  if (!fs.existsSync(old)) {
    console.error(`error: ${old} not found — capture the entry bundle each time you probe`);
    process.exit(2);
  }

  const live = await fetchEntryBundle(origin);
  const oldSource = fs.readFileSync(old, 'utf8');

  console.log(`origin        ${origin}`);
  console.log(`live entry    ${live.asset}`);
  console.log(`stale entry   ${old}\n`);

  const staleChunks = chunkRefs(oldSource, old.split('/').pop()).slice(0, SAMPLE);
  const liveChunks = chunkRefs(live.source, live.asset.split('/').pop()).slice(0, SAMPLE);

  const stale = await probe(origin, staleChunks);
  const control = await probe(origin, liveChunks);

  const gone = stale.filter((r) => r.status === 404);
  const brokenControl = control.filter((r) => r.status !== 200);

  console.log(`stale tab   ${gone.length}/${stale.length} chunks 404`);
  gone.slice(0, 5).forEach((r) => console.log(`              404  ${r.file}`));
  console.log(`control     ${control.length - brokenControl.length}/${control.length} chunks 200`);
  brokenControl.forEach((r) => console.log(`              ${r.status}  ${r.file}`));

  // Vite always ships the dispatch side, so counting `vite:preloadError` alone always finds 1.
  // The guard is only present if something calls addEventListener for it.
  const listeners = (live.source.match(/addEventListener\(\s*["']vite:preloadError["']/g) || []).length;
  console.log(`\npreloadError listeners in the live bundle: ${listeners}`);
  console.log(
    listeners === 0
      ? '  => nothing handles the failed import: the user gets a dead control, not a reload prompt'
      : '  => the app can prompt a reload; verify it actually does'
  );

  const reproduced = gone.length > 0 && brokenControl.length === 0;
  console.log(`\nstale-tab chunk 404: ${reproduced ? 'REPRODUCED' : 'not reproduced'}`);
  process.exit(reproduced ? 1 : 0);
})().catch((err) => {
  console.error(err.message);
  process.exit(2);
});
