import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBundleController } from '../src/daemon/bundle.mjs';
import { buildPopoverHtml, buildStripHtml, fmtTok } from '../src/telemetry/renderer.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('2-tier bundle splits static assets from lean live runtime', () => {
  const ctrl = createBundleController({ hasSqlite: true });
  const res = ctrl.rebuildIfNeeded();
  assert.equal(res.assetsChanged, true);
  assert.equal(res.runtimeChanged, true);

  const st = ctrl.getState();
  assert.ok(st.assetsHash.length === 10);
  assert.ok(st.assetsScript.includes('Inter Variable'));
  assert.ok(st.assetsScript.includes('data:image/webp;base64,'), 'Uses pre-baked GPU-free WebP wallpaper');
  assert.ok(st.assetsScript.includes('--mg-wallpaper-filter:none'), 'Disables runtime CSS blur when baked');
  assert.equal(st.runtimeScript.includes('data:font/woff2;base64,'), false);
  assert.equal(st.runtimeScript.includes('data:image/webp;base64,'), false);
  assert.ok(st.runtimeScript.length < 60000, `Expected lean runtime < 60KB, got ${st.runtimeScript.length}`);

  const res2 = ctrl.rebuildIfNeeded();
  assert.equal(res2.assetsChanged, false);
  assert.equal(res2.runtimeChanged, false);
});

test('telemetry renderer builds 3-group SVG strip and Midnight Glass popover', () => {
  const strip = buildStripHtml({
    statusDotHtml: '<span class="ag-mg-dot is-idle"></span>',
    displayTps: 185,
    lastCtx: 120000,
    limitKStr: '512k',
    ctxClass: '',
    ctxPct: 23,
    compactedPending: false,
    outTok: 3500,
    lastCacheRate: '94.2',
    sessionCacheRate: '91.4',
    turnsCount: 2,
    stepsCount: 14,
    totalTokens: 420000
  });
  assert.ok(strip.includes('2 turns 14 steps'));
  assert.ok(strip.includes('185 tok/s'));
  assert.ok(strip.includes('420K tok'));
  assert.ok(strip.includes('Cache hit 91%'));
  assert.ok(strip.includes('23%'));
  assert.ok(strip.includes('ag-mg-ring'));

  const pop = buildPopoverHtml({
    genIdx: 14,
    streamTps: 185.2,
    e2eTps: 31.4,
    streamTpsValid: true,
    last: { ctx: 120000, inTok: 4000, cacheWrite: 0, cacheRead: 116000, outTok: 900, thinkTok: 300, respTok: 600, ttft: 1.2, stream: 4.8, totDur: 6.0 },
    lastCacheRate: '96.7',
    ctxPct: 23,
    contextLimitTokens: 512000,
    limitKStr: '512k',
    remainCtx: 392000,
    compactedPending: false,
    compactSummaryKb: 0,
    compactingNow: false,
    generatingPending: false,
    pendingRetrying: false,
    lastErrorMsg: '',
    turnSteps: 4,
    turnOut: 2200,
    turnThink: 800,
    turnResp: 1400,
    turnDur: 12.4,
    userStepsCount: 2,
    validCount: 14,
    totalIn: 18000,
    totalCacheWrite: 0,
    totalCache: 390000,
    totalPrompt: 408000,
    sessionCacheRate: '95.6',
    totalOut: 12000,
    totalThink: 4000,
    totalResp: 8000
  });
  assert.ok(pop.includes('Session'));
  assert.ok(pop.includes('#14'));
  assert.ok(pop.includes('mg-stat-row'));
  assert.ok(pop.includes('mg-kv-list'));
});

test('CSS invariants preserve overlay blur, keep sidebar glass, and occlude sticky headers', () => {
  const surfaces = fs.readFileSync(path.join(ROOT, 'src', 'styles', '10-surfaces.css'), 'utf8');
  assert.equal(surfaces.includes('backdrop-filter: none !important;\n}'), false);
  assert.ok(surfaces.includes('.bg-sidebar:has(> [data-testid="section-header"])'), 'Sticky header rule must use direct child > so outer sidebar stays translucent');
  assert.equal(surfaces.includes('.bg-sidebar:has([data-testid="section-header"])'), false, 'Descendant :has() would turn the entire sidebar opaque');
  assert.ok(surfaces.includes('rgba(13, 17, 28, 0.93)'));
  assert.equal(fmtTok(1500000), '1.5M');
});

test('config accent is dynamically wired and sanitized in bundle', () => {
  const ctrl = createBundleController({ hasSqlite: true });
  ctrl.rebuildIfNeeded();
  const { runtimeScript } = ctrl.getState();
  assert.ok(runtimeScript.includes('--mg-accent:#4f83f2'));
  assert.ok(runtimeScript.includes('triggerLiveQuotaRefresh'));
});

test('context window breakdown renders segmented hairline and L2 category rows', () => {
  const pop = buildPopoverHtml({
    genIdx: 22,
    streamTps: 140,
    e2eTps: 60,
    streamTpsValid: true,
    last: { ctx: 91300, inTok: 2500, cacheWrite: 0, cacheRead: 88800, outTok: 900, thinkTok: 300, respTok: 600, ttft: 1.5, stream: 4.0, totDur: 5.5 },
    lastCacheRate: '97.3',
    ctxPct: 18,
    contextLimitTokens: 512000,
    limitKStr: '512k',
    remainCtx: 420700,
    ctxBreakdown: {
      estimatedTotal: 91461,
      system: 4055,
      rules: 1553,
      tools: 8346,
      toolCount: 19,
      mcp: 227,
      skills: 3241,
      subagents: 2885,
      plugins: 1624,
      messages: 69530,
      msgCount: 36,
      msgCheckpoint: 18197,
      msgUser: 1200,
      msgAssistant: 9800,
      msgToolOut: 40333,
      other: 0
    },
    compactedPending: false,
    compactSummaryKb: 0,
    compactingNow: false,
    generatingPending: false,
    pendingRetrying: false,
    lastErrorMsg: '',
    turnSteps: 4,
    turnOut: 2200,
    turnThink: 800,
    turnResp: 1400,
    turnDur: 12.4,
    userStepsCount: 3,
    validCount: 22,
    totalIn: 18000,
    totalCacheWrite: 0,
    totalCache: 390000,
    totalPrompt: 408000,
    sessionCacheRate: '95.6',
    totalOut: 12000,
    totalThink: 4000,
    totalResp: 8000
  });
  assert.ok(pop.includes('mg-hairline-seg is-sys'));
  assert.ok(pop.includes('mg-hairline-seg is-ext'));
  assert.ok(pop.includes('mg-hairline-seg is-ctx'));
  assert.ok(pop.includes('Context Window Breakdown'));
  assert.ok(pop.includes('System &amp; Rules'));
  assert.ok(pop.includes('19 tools'));
  assert.ok(pop.includes('Messages (36)'));
  assert.ok(pop.includes('Ckpt 18K'));
});
