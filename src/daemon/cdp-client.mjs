import {
  DEFAULT_ALLOWED_ORIGINS,
  isAllowedOrigin,
  readPortFromFile,
  fetchTargetsFromPort
} from '../shared.mjs';
import { getDbSignature } from '../telemetry/sqlite-reader.mjs';
import { getLsLogSig } from '../telemetry/ls-log.mjs';

export function createCdpBridge({ bundleCtrl, metricsReader, coldStartCtrl, runOnce = false }) {
  const attached = new Map();
  let isSyncing = false;
  let tick = 0;

  function attachTarget(target, endpoint) {
    const wsUrl = target.webSocketDebuggerUrl;
    if (!wsUrl) return Promise.resolve(false);
    const isSwarm = target.type === 'iframe' && String(target.url || '').startsWith('plugin://swarm--');

    return new Promise((resolveAttach) => {
      let settled = false;
      const done = (ok) => {
        if (!settled) { settled = true; resolveAttach(ok); }
      };
      const attachTimer = setTimeout(() => done(false), 3000);

      let ws;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        clearTimeout(attachTimer);
        done(false);
        return;
      }

      let msgId = 1;
      let evalScriptId = null;
      let hostOk = isSwarm;
      let navTimer = null;
      const pending = new Map();
      const pushedHashes = new Map();

      const send = (method, params = {}) =>
        new Promise((resolve) => {
          if (ws.readyState !== WebSocket.OPEN) return resolve(null);
          const id = msgId++;
          const timer = setTimeout(() => {
            pending.delete(id);
            resolve(null);
          }, 2500);
          pending.set(id, (msg) => {
            clearTimeout(timer);
            resolve(msg);
          });
          try {
            ws.send(JSON.stringify({ id, method, params }));
          } catch {
            clearTimeout(timer);
            pending.delete(id);
            resolve(null);
          }
        });

      const verifyHost = async () => {
        if (isSwarm) return true;
        const r = await send('Runtime.evaluate', {
          expression: `Boolean(
            location.protocol === 'vscode-file:' ||
            window.__APP_CONFIG__?.productName === 'antigravity' ||
            typeof window.electronNative?.setTitleBarOverlay === 'function' ||
            document.querySelector('[id="antigravity.agentSidePanelInputBox"], body[data-agy-theme]')
          )`,
          returnByValue: true
        });
        return r?.result?.result?.value === true;
      };

      const injectTwoTier = async (forceAssets = false) => {
        if (!hostOk) return false;
        const { assetsHash, assetsScript, runtimeScript } = bundleCtrl.getState();

        if (forceAssets) {
          await send('Runtime.evaluate', { expression: assetsScript, returnByValue: true });
        } else {
          const hasAssets = await send('Runtime.evaluate', {
            expression: `window.__ag_mg_assets_hash === ${JSON.stringify(assetsHash)} && Boolean(document.getElementById("ag-mg-assets"))`,
            returnByValue: true
          });
          if (hasAssets?.result?.result?.value !== true) {
            await send('Runtime.evaluate', { expression: assetsScript, returnByValue: true });
          }
        }

        const res = await send('Runtime.evaluate', { expression: runtimeScript, returnByValue: true });
        if (res?.result?.exceptionDetails) {
          console.error('[MidnightGlass] Inject exception:', res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text);
          return false;
        }
        return true;
      };

      const registerOnNewDocument = async () => {
        if (!hostOk) return;
        const { activeConfig, assetsScript, runtimeScript } = bundleCtrl.getState();
        if (evalScriptId) {
          await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: evalScriptId });
          evalScriptId = null;
        }
        if (activeConfig.enabled) {
          const r = await send('Page.addScriptToEvaluateOnNewDocument', {
            source: `${assetsScript}\n${runtimeScript}`
          });
          if (r?.result?.identifier) evalScriptId = r.result.identifier;
        }
      };

      const syncMetrics = async (force = false) => {
        if (isSwarm || !hostOk) return;
        const { activeConfig } = bundleCtrl.getState();
        if (!activeConfig.enabled || !activeConfig.telemetryEnabled) return;

        const cidRes = await send('Runtime.evaluate', {
          expression: `typeof window.__ag_mg_get_cids === 'function' ? window.__ag_mg_get_cids() : []`,
          returnByValue: true
        });
        const cids = Array.isArray(cidRes?.result?.result?.value) ? cidRes.result.result.value : [];
        if (cids.length === 0) return;

        for (const cid of cids) {
          const dbSig = getDbSignature(cid, endpoint.conversationsDir) || 'empty';
          const lsSig = getLsLogSig(endpoint.lsLogFile);
          const key = `${cid}@${dbSig}|${activeConfig.telemetryLayout}|${activeConfig.telemetryCacheMode}|${lsSig}`;
          if (!force && pushedHashes.get(cid) === key) continue;

          const payload = metricsReader.parseConversationMetrics(cid, endpoint.conversationsDir, {
            lsLogFile: endpoint.lsLogFile,
            lsSig
          });
          if (!payload || payload.transientError) continue;
          await send('Runtime.evaluate', {
            expression: `window.__ag_mg_render_metrics && window.__ag_mg_render_metrics(${JSON.stringify(payload)})`,
            returnByValue: false
          });
          pushedHashes.set(cid, key);
        }
      };

      const ensureFresh = async (assetsChanged, runtimeChanged) => {
        if (!hostOk) return;
        const { runtimeVersion, activeConfig } = bundleCtrl.getState();
        if (assetsChanged || runtimeChanged) {
          await registerOnNewDocument();
          await injectTwoTier(assetsChanged);
          await syncMetrics(true);
          return;
        }
        const chk = await send('Runtime.evaluate', {
          expression: `window.__ag_mg_version === ${JSON.stringify(runtimeVersion)} && (${JSON.stringify(!activeConfig.enabled)} || Boolean(document.getElementById("ag-mg-theme")))`,
          returnByValue: true
        });
        if (chk?.result?.result?.value !== true) {
          await injectTwoTier(false);
          await syncMetrics(true);
        }
      };

      const closeHandler = () => {
        clearTimeout(attachTimer);
        if (navTimer) { clearTimeout(navTimer); navTimer = null; }
        for (const [, cb] of pending) cb(null);
        pending.clear();
        attached.delete(target.id);
        done(false);
      };

      ws.addEventListener('open', async () => {
        try {
          await send('Page.enable');
          await send('Runtime.enable');
          hostOk = await verifyHost();
          if (!hostOk) {
            try { ws.close(); } catch {}
            closeHandler();
            return;
          }
          const ref = attached.get(target.id);
          if (ref) ref.hostOk = true;
          await registerOnNewDocument();
          const ok = await injectTwoTier(false);
          await syncMetrics(true);
          clearTimeout(attachTimer);
          done(ok);
        } catch {
          closeHandler();
        }
      });

      ws.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          if (msg.id && pending.has(msg.id)) {
            const cb = pending.get(msg.id);
            pending.delete(msg.id);
            cb(msg);
            return;
          }
          if (msg.method === 'Page.frameNavigated' || msg.method === 'Page.loadEventFired') {
            if (!msg.params?.frame?.parentId) {
              if (navTimer) clearTimeout(navTimer);
              navTimer = setTimeout(() => {
                navTimer = null;
                ensureFresh(false, false).catch(() => {});
              }, 120);
            }
          }
        } catch {}
      });

      ws.addEventListener('close', closeHandler);
      ws.addEventListener('error', closeHandler);

      attached.set(target.id, { ws, hostOk, ensureFresh, syncMetrics });
    });
  }

  async function sync(forceDiscover = false) {
    if (isSyncing) return;
    isSyncing = true;
    tick = (tick + 1) % 10000;
    try {
      const { assetsChanged, runtimeChanged } = bundleCtrl.rebuildIfNeeded();
      const { activeConfig } = bundleCtrl.getState();

      const shouldDiscover = runOnce || forceDiscover || assetsChanged || runtimeChanged || attached.size === 0 || tick % 10 === 1;
      if (!shouldDiscover) {
        for (const entry of attached.values()) {
          if (!entry.hostOk) continue;
          await entry.syncMetrics(false);
        }
        return;
      }

      const activeIds = new Set();
      const pendingTargets = [];
      const probedPorts = new Set();

      for (const ep of activeConfig.endpoints) {
        const port = readPortFromFile(ep.portFile);
        let targets = [];
        if (port && !probedPorts.has(port)) {
          probedPorts.add(port);
          targets = await fetchTargetsFromPort(port);
        }
        if (targets.length === 0 && ep.channelInstalled && ep.fallbackPort && !probedPorts.has(ep.fallbackPort)) {
          probedPorts.add(ep.fallbackPort);
          targets = await fetchTargetsFromPort(ep.fallbackPort);
        }
        for (const t of targets) {
          if (!t?.id || !t.webSocketDebuggerUrl) continue;
          const isPage = t.type === 'page';
          const isSwarm = t.type === 'iframe' && String(t.url || '').startsWith('plugin://swarm--');
          if (!isPage && !isSwarm) continue;
          if (String(t.url || '').startsWith('devtools://')) continue;
          if (!isAllowedOrigin(t.url, DEFAULT_ALLOWED_ORIGINS)) continue;
          if (String(t.title || '').includes('Launchpad')) continue;
          activeIds.add(t.id);
          pendingTargets.push({ target: t, endpoint: ep });
        }
      }

      const attachJobs = [];
      for (const { target, endpoint } of pendingTargets) {
        const existing = attached.get(target.id);
        if (!existing) {
          attachJobs.push(attachTarget(target, endpoint));
        } else if (existing.hostOk) {
          await existing.ensureFresh(assetsChanged, runtimeChanged);
          await existing.syncMetrics(assetsChanged || runtimeChanged);
        }
      }
      if (attachJobs.length > 0) await Promise.allSettled(attachJobs);

      for (const [id, entry] of attached.entries()) {
        if (!activeIds.has(id)) {
          try { entry.ws.close(); } catch {}
          attached.delete(id);
        }
      }

      if (!runOnce && pendingTargets.length === 0 && attached.size === 0 && coldStartCtrl) {
        coldStartCtrl.maybeAutoRelaunch(activeConfig);
      }
    } catch (err) {
      console.error('[MidnightGlass] Sync error:', err?.message || err);
    } finally {
      isSyncing = false;
    }
  }

  function closeAll() {
    for (const entry of attached.values()) {
      try { entry.ws.close(); } catch {}
    }
    attached.clear();
  }

  return { sync, closeAll };
}
