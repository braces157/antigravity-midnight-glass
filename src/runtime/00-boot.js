(function (BOOT) {
  'use strict';
  if (!BOOT || typeof document === 'undefined') return;

  if (Array.isArray(window.__ag_mg_cleanups)) {
    for (const fn of window.__ag_mg_cleanups) {
      try { fn(); } catch {}
    }
  }
  const cleanups = (window.__ag_mg_cleanups = []);
  const onCleanup = (fn) => { if (typeof fn === 'function') cleanups.push(fn); };

  if (Array.isArray(window.__ag_cleanup_fns)) {
    for (const fn of window.__ag_cleanup_fns) { try { fn(); } catch {} }
    window.__ag_cleanup_fns = [];
  }
  for (const timerKey of ['__ag_metrics_route_watcher', '__ag_live_probe_timer', '__ag_tt_show_timer', '__ag_tt_hide_timer', '__ag_turn_tt_show_timer', '__ag_turn_tt_hide_timer']) {
    if (window[timerKey]) {
      try { clearInterval(window[timerKey]); } catch {}
      try { clearTimeout(window[timerKey]); } catch {}
      window[timerKey] = null;
    }
  }
  for (const obsKey of ['__ag_turn_metrics_observer', '__ag_theme_mode_observer']) {
    if (window[obsKey] && typeof window[obsKey].disconnect === 'function') {
      try { window[obsKey].disconnect(); } catch {}
      window[obsKey] = null;
    }
  }
  if (window.__ag_pane_states && typeof window.__ag_pane_states === 'object') {
    for (const ps of Object.values(window.__ag_pane_states)) {
      if (ps?.ro && typeof ps.ro.disconnect === 'function') { try { ps.ro.disconnect(); } catch {} }
    }
    window.__ag_pane_states = {};
  }
  window.__ag_refresh_wait_ui = () => {};
  window.__ag_render_metrics = () => {};
  window.__ag_on_route_change = () => {};
  for (const legacyId of ['ag-codex-theme', 'ag-codex-user-css', 'ag-live-metrics-pill', 'ag-side-metrics-pill', 'ag-live-metrics-tooltip', 'ag-turn-metrics-tooltip']) {
    document.getElementById(legacyId)?.remove();
  }
  document.querySelectorAll('.ag-live-metrics-pill, .ag-turn-metrics').forEach((el) => el.remove());

  const mountStyle = (id, cssText) => {
    let el = document.getElementById(id);
    if (!cssText) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      (document.head || document.documentElement).appendChild(el);
    }
    if (el.textContent !== cssText) el.textContent = cssText;
  };

  if (!BOOT.enabled) {
    mountStyle('ag-mg-theme', '');
    mountStyle('ag-mg-user-css', '');
    mountStyle('ag-mg-assets', '');
    document.documentElement.removeAttribute('data-ag-mg-mode');
    window.__ag_mg_version = BOOT.version;
    return;
  }

  mountStyle('ag-mg-theme', BOOT.themeCss || '');
  mountStyle('ag-mg-user-css', BOOT.userCss || '');
  window.__ag_mg_version = BOOT.version;
  window.__ag_mg_ready = true;
