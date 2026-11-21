/* src/runtime/10-theme-overlay.js — Dark Mode Sync & Transparent Windows TitleBarOverlay */
  const isSwarmFrame = Boolean(window.location && window.location.protocol === 'plugin:');

  const syncModeAndOverlay = () => {
    const body = document.body;
    const isDark = !body || body.classList.contains('dark') || body.classList.contains('theme-dark') || !body.classList.contains('light');
    const mode = isDark ? 'dark' : 'light';
    if (document.documentElement.getAttribute('data-ag-mg-mode') !== mode) {
      document.documentElement.setAttribute('data-ag-mg-mode', mode);
    }
    if (!isSwarmFrame && isDark) {
      try {
        window.electronNative?.setTitleBarOverlay?.({
          color: '#00000000',
          symbolColor: '#E5E7EB'
        });
      } catch {}
    }
  };

  syncModeAndOverlay();
  const tOverlay1 = setTimeout(syncModeAndOverlay, 150);
  const tOverlay2 = setTimeout(syncModeAndOverlay, 800);
  window.addEventListener('focus', syncModeAndOverlay);

  let modeObs = null;
  if (typeof MutationObserver !== 'undefined' && document.body) {
    modeObs = new MutationObserver(syncModeAndOverlay);
    modeObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  onCleanup(() => {
    clearTimeout(tOverlay1);
    clearTimeout(tOverlay2);
    window.removeEventListener('focus', syncModeAndOverlay);
    if (modeObs) { try { modeObs.disconnect(); } catch {} }
  });
