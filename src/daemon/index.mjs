#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { PID_FILE, isConfirmedNodePid } from '../shared.mjs';
import { ASSETS_DIR, RUNTIME_DIR, STYLES_DIR, USER_DIR, createBundleController } from './bundle.mjs';
import { createCdpBridge } from './cdp-client.mjs';
import { createColdStartController } from './cold-start.mjs';
import { createMetricsReader } from '../telemetry/sqlite-reader.mjs';

let DatabaseSync = null;
try {
  const mod = await import('node:sqlite').catch(() => null);
  if (mod && typeof mod.DatabaseSync === 'function') DatabaseSync = mod.DatabaseSync;
} catch {}

const runOnce = process.argv.includes('--once');

function acquirePidLock() {
  if (runOnce) return;
  try {
    if (fs.existsSync(PID_FILE)) {
      const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      if (isConfirmedNodePid(oldPid)) {
        try { process.kill(oldPid, 'SIGTERM'); } catch {}
      }
    }
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
    const clean = () => {
      try {
        if (fs.existsSync(PID_FILE) && fs.readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) {
          fs.unlinkSync(PID_FILE);
        }
      } catch {}
    };
    process.on('exit', clean);
    process.on('SIGINT', () => { clean(); process.exit(0); });
    process.on('SIGTERM', () => { clean(); process.exit(0); });
  } catch {}
}

export async function startDaemon() {
  if (!runOnce) {
    process.on('unhandledRejection', (err) => console.error('[MidnightGlass] Unhandled rejection:', err?.message || err));
    process.on('uncaughtException', (err) => console.error('[MidnightGlass] Uncaught exception:', err?.message || err));
  }

  acquirePidLock();

  const bundleCtrl = createBundleController({ hasSqlite: Boolean(DatabaseSync) });
  bundleCtrl.rebuildIfNeeded();

  const metricsReader = createMetricsReader({
    getDatabaseSync: () => DatabaseSync,
    getConfig: () => bundleCtrl.getState().activeConfig
  });

  const cdp = createCdpBridge({
    bundleCtrl,
    metricsReader,
    coldStartCtrl: createColdStartController(),
    runOnce
  });

  const { runtimeVersion, assetsHash, activeConfig } = bundleCtrl.getState();
  console.log(`[MidnightGlass] Started v${runtimeVersion} (assets:${assetsHash}) | sqlite=${Boolean(DatabaseSync)}`);

  await cdp.sync(true);

  if (runOnce) {
    cdp.closeAll();
    process.exit(0);
  }

  let debounceTimer = null;
  const triggerFastSync = (forceDiscover = false) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      cdp.sync(forceDiscover).catch(() => {});
    }, 80);
  };

  const watchDirs = [USER_DIR, STYLES_DIR, RUNTIME_DIR, ASSETS_DIR];
  const convDirs = new Set();
  for (const ep of activeConfig.endpoints) {
    if (ep.dataDir && fs.existsSync(ep.dataDir)) watchDirs.push(ep.dataDir);
    if (ep.conversationsDir && fs.existsSync(ep.conversationsDir)) convDirs.add(ep.conversationsDir);
  }

  for (const dir of watchDirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      fs.watch(dir, { persistent: false }, (_ev, filename) => {
        if (!filename) return;
        const name = String(filename);
        if (dir === activeConfig.endpoints[0]?.dataDir && !name.includes('DevToolsActivePort')) return;
        triggerFastSync(name.includes('DevToolsActivePort'));
      });
    } catch {}
  }

  let metricsDebounce = null;
  for (const dir of convDirs) {
    try {
      fs.watch(dir, { persistent: false }, (_ev, filename) => {
        if (!filename || !String(filename).includes('.db')) return;
        if (metricsDebounce) clearTimeout(metricsDebounce);
        metricsDebounce = setTimeout(() => {
          metricsDebounce = null;
          cdp.sync(false).catch(() => {});
        }, 120);
      });
    } catch {}
  }

  setInterval(() => {
    cdp.sync(false).catch(() => {});
  }, 3000);
}

await startDaemon();
