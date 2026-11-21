/* src/runtime/20-live-probe.js — Lightweight Live Status Probe */
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const escapeUiHtml = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const extractMainCid = () => {
    try {
      const m = String(window.location?.pathname || '').match(/\/c\/([0-9a-f-]{36})/i);
      if (m) return m[1];
      const view = document.querySelector('[data-testid="conversation-view"][data-cascade-id]');
      const v = view?.getAttribute('data-cascade-id')?.trim() || '';
      if (UUID_RE.test(v)) return v;
      if (!document.querySelector('[data-testid="home-greeting"], [data-testid="home-splash-content"]')) {
        const sel = document.querySelector('[data-testid="conversation-row-sidebar"][data-selected="true"]');
        const sc = sel?.getAttribute('data-cascade-id')?.trim() || '';
        if (UUID_RE.test(sc)) return sc;
      }
    } catch {}
    return '';
  };

  const isStopBtnVisible = (inputBox) => {
    if (!inputBox) return false;
    const btn = inputBox.querySelector('[data-testid="input-cancel-button"]');
    if (!btn) return false;
    const rc = btn.getBoundingClientRect();
    return rc.width > 0 && rc.height > 0;
  };

  const formatResetCountdown = (resetSec) => {
    if (!Number.isFinite(resetSec) || resetSec <= 0) return '';
    const diffSec = Math.max(0, Math.round(resetSec - Date.now() / 1000));
    if (diffSec < 60) return 'Resets <1m';
    const hrs = Math.floor(diffSec / 3600);
    const mins = Math.floor((diffSec % 3600) / 60);
    if (hrs >= 24) {
      const days = Math.floor(hrs / 24);
      const remH = hrs % 24;
      return `Resets in ${days}d ${remH}h`;
    }
    return hrs > 0 ? `Resets in ${hrs}h ${mins}m` : `Resets in ${mins}m`;
  };

  let quotaLastRefreshMs = 0;
  let quotaRefreshInFlight = null;

  const findModelFiberData = (inputBox) => {
    try {
      const trig = inputBox?.querySelector?.('[data-testid="model-selector-trigger"]') || document.querySelector('[data-testid="model-selector-trigger"]');
      if (!trig) return null;
      const fk = Object.keys(trig).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      let f = fk ? trig[fk] : null;
      let cfg = null;
      let refreshModels = null;
      for (let i = 0; i < 45 && f; i++, f = f.return) {
        const p = f.memoizedProps;
        if (!refreshModels && typeof p?.refreshModels === 'function') {
          refreshModels = p.refreshModels;
        }
        if (!cfg && p?.currentModelConfig?.quotaInfo && typeof p.currentModelConfig.quotaInfo.remainingFraction === 'number') {
          cfg = p.currentModelConfig;
        }
        if (cfg && refreshModels) break;
      }
      return { cfg, refreshModels };
    } catch {
      return null;
    }
  };

  const readLiveQuotaInfo = (inputBox) => {
    const data = findModelFiberData(inputBox);
    const cfg = data?.cfg;
    if (!cfg || !cfg.quotaInfo || typeof cfg.quotaInfo.remainingFraction !== 'number') return null;
    const rawPct = Math.max(0, Math.min(100, cfg.quotaInfo.remainingFraction * 100));
    const pct = Math.round(rawPct);
    const pctLabel = rawPct >= 99.95 ? '100' : rawPct <= 0.05 ? '0' : rawPct.toFixed(1).replace(/\.0$/, '');
    const resetSec = cfg.quotaInfo.resetTime?.seconds != null ? Number(cfg.quotaInfo.resetTime.seconds) : 0;
    return {
      label: String(cfg.label || 'Current Model'),
      pct,
      pctLabel,
      rawPct,
      resetText: formatResetCountdown(resetSec),
      canRefresh: typeof data?.refreshModels === 'function',
      refreshing: Boolean(quotaRefreshInFlight),
      lastSyncMs: quotaLastRefreshMs
    };
  };

  const triggerLiveQuotaRefresh = (inputBox, { force = false, onUpdated = null } = {}) => {
    const now = Date.now();
    const minCooldown = force ? 3000 : 15000;
    if (quotaRefreshInFlight || now - quotaLastRefreshMs < minCooldown) return false;
    const data = findModelFiberData(inputBox);
    if (typeof data?.refreshModels !== 'function') return false;
    quotaLastRefreshMs = now;
    const job = Promise.resolve()
      .then(() => data.refreshModels())
      .catch(() => {})
      .then(() => new Promise((r) => setTimeout(r, 140)))
      .finally(() => {
        if (quotaRefreshInFlight === job) quotaRefreshInFlight = null;
        try { onUpdated?.(); } catch {}
      });
    quotaRefreshInFlight = job;
    try { onUpdated?.(); } catch {}
    return true;
  };

  const computeVisualStatus = ({ st, stopActive }) => {
    const errMsg = st?.lastErrorMsg || '';
    const retrying = Boolean(st?.pendingRetrying);
    const running = Boolean(stopActive || (st?.pendingKind && st.pendingKind !== 'idle'));
    if (errMsg && !running && !retrying) {
      return {
        dotClass: 'ag-mg-dot is-error',
        title: `Error · ${errMsg.slice(0, 120)}`,
        chipText: 'Error',
        chipClass: 'is-error',
        noteClass: 'is-visible is-error',
        noteHtml: `<strong>Error:</strong> ${escapeUiHtml(errMsg.slice(0, 180))}`
      };
    }
    if (retrying) {
      return {
        dotClass: 'ag-mg-dot is-slow',
        title: `Retrying… ${st?.retryReason || ''}`.trim(),
        chipText: 'Retrying…',
        chipClass: 'is-slow',
        noteClass: 'is-visible',
        noteHtml: `<strong>Retrying:</strong> ${escapeUiHtml(st?.retryReason || 'Waiting for model response…')}`
      };
    }
    if (running) {
      return {
        dotClass: 'ag-mg-dot is-running',
        title: 'Running · Model streaming',
        chipText: 'Running…',
        chipClass: '',
        noteClass: '',
        noteHtml: ''
      };
    }
    return {
      dotClass: 'ag-mg-dot is-idle',
      title: 'Ready · Hover or click for session telemetry',
      chipText: '',
      chipClass: '',
      noteClass: '',
      noteHtml: ''
    };
  };
