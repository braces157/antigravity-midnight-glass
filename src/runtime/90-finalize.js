  if (BOOT.userJs && BOOT.userJs.trim()) {
    try {
      const ctx = { version: BOOT.version, config: BOOT.config, onCleanup };
      const fn = new Function('ctx', BOOT.userJs);
      fn(ctx);
    } catch (err) {
      console.error('[MidnightGlass] user/custom.js error:', err);
    }
  }
})(__AG_MG_BOOT__);
