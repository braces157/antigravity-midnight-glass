/**
 * src/daemon/bundle.mjs — 2-Tier Asset & Lean Theme/Runtime Bundle Builder
 *
 * Tier 1 (Static Assets): Embedded Inter Variable woff2 + pre-baked GPU-free WebP wallpaper.
 *   Injected ONCE per document (guarded by SHA-256 hash) so hot-reloads transfer ~0 asset bytes.
 * Tier 2 (Live Runtime): Theme CSS + user overrides + lean runtime JS (~20KB total).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJsonSafe, readTextSafe, resolveChannelEndpoints } from '../shared.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '../..');
export const STYLES_DIR = path.join(ROOT_DIR, 'src', 'styles');
export const RUNTIME_DIR = path.join(ROOT_DIR, 'src', 'runtime');
export const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
export const USER_DIR = path.join(ROOT_DIR, 'user');
export const BASE_VERSION = '1.0.0';

function mtimeSig(filePath) {
  try {
    const st = fs.statSync(filePath, { throwIfNoEntry: false });
    return st ? `${st.mtimeMs}:${st.size}` : '0:0';
  } catch {
    return '0:0';
  }
}

function listSorted(dir, ext) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(ext))
      .sort((a, b) => a.localeCompare(b))
      .map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

function buildFontFaceCss() {
  const specs = [
    {
      file: 'inter-vietnamese.woff2',
      range: 'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB'
    },
    {
      file: 'inter-latin-ext.woff2',
      range: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF'
    },
    {
      file: 'inter-latin.woff2',
      range: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
    }
  ];
  const blocks = [];
  for (const s of specs) {
    const p = path.join(ASSETS_DIR, 'fonts', s.file);
    if (!fs.existsSync(p)) continue;
    const b64 = fs.readFileSync(p).toString('base64');
    blocks.push(
      `@font-face{font-family:"Inter Variable";font-style:normal;font-display:swap;font-weight:100 900;src:url("data:font/woff2;base64,${b64}") format("woff2");unicode-range:${s.range};}`
    );
  }
  return blocks.join('\n');
}

function buildWallpaperCss(cfg) {
  const bakedPath = path.join(ASSETS_DIR, 'wallpaper-baked.webp');
  if (fs.existsSync(bakedPath)) {
    const b64 = fs.readFileSync(bakedPath).toString('base64');
    return `:root{--mg-wallpaper-url:url("data:image/webp;base64,${b64}");--mg-wallpaper-opacity:1;--mg-wallpaper-filter:none;--mg-wallpaper-transform:translateZ(0);}`;
  }
  const rawPath = path.join(USER_DIR, 'wallpaper.jpg');
  if (!fs.existsSync(rawPath)) return '';
  const b64 = fs.readFileSync(rawPath).toString('base64');
  const wp = cfg.wallpaper || {};
  const blur = Number.isFinite(wp.blur) ? wp.blur : 8;
  const br = Number.isFinite(wp.brightness) ? wp.brightness : 0.62;
  const ct = Number.isFinite(wp.contrast) ? wp.contrast : 1.06;
  const sat = Number.isFinite(wp.saturate) ? wp.saturate : 1.16;
  const op = Number.isFinite(wp.opacity) ? wp.opacity : 0.82;
  return `:root{--mg-wallpaper-url:url("data:image/jpeg;base64,${b64}");--mg-wallpaper-opacity:${op};--mg-wallpaper-filter:blur(${blur}px) brightness(${br}) contrast(${ct}) saturate(${sat});--mg-wallpaper-transform:scale(1.04);}`;
}

export function createBundleController({ hasSqlite = true } = {}) {
  let lastAssetsSig = '';
  let lastRuntimeSig = '';
  let assetsHash = '';
  let assetsScript = '';
  let runtimeVersion = '';
  let runtimeScript = '';
  let activeConfig = null;

  function rebuildIfNeeded() {
    const cfgPath = path.join(USER_DIR, 'config.json');
    const styleFiles = listSorted(STYLES_DIR, '.css');
    const runtimeFiles = listSorted(RUNTIME_DIR, '.js');
    const userCssPath = path.join(USER_DIR, 'custom.css');
    const userJsPath = path.join(USER_DIR, 'custom.js');
    const assetFiles = [
      path.join(ASSETS_DIR, 'wallpaper-baked.webp'),
      path.join(USER_DIR, 'wallpaper.jpg'),
      path.join(ASSETS_DIR, 'fonts', 'inter-latin.woff2'),
      path.join(ASSETS_DIR, 'fonts', 'inter-latin-ext.woff2'),
      path.join(ASSETS_DIR, 'fonts', 'inter-vietnamese.woff2')
    ];

    const aSig = assetFiles.map(mtimeSig).join('|') + '|' + mtimeSig(cfgPath);
    const rSig =
      [...styleFiles, ...runtimeFiles, cfgPath, userCssPath, userJsPath].map(mtimeSig).join('|') + `|sq:${hasSqlite}`;

    let assetsChanged = false;
    let runtimeChanged = false;

    const rawCfg = readJsonSafe(cfgPath, {});
    const enabled = rawCfg.enabled !== false;
    const channel = rawCfg.channel || 'auto';
    const tel = rawCfg.telemetry || {};
    const rawLimit = tel.contextLimit;
    const isAuto = rawLimit == null || String(rawLimit).trim() === '' || String(rawLimit).toLowerCase() === 'auto';
    const manualContextLimit = !isAuto && Number(rawLimit) > 0 ? Number(rawLimit) : 0;

    activeConfig = {
      enabled,
      channel,
      accent: rawCfg.accent || '#4f83f2',
      wallpaper: rawCfg.wallpaper || {},
      cdpAutoRelaunch: rawCfg.cdpAutoRelaunch !== false,
      telemetryEnabled: Boolean(hasSqlite && tel.enabled !== false),
      telemetryLayout: tel.layout === 'detailed' ? 'detailed' : 'compact',
      telemetryCacheMode: tel.cacheMode === 'step' ? 'step' : 'session',
      manualContextLimit,
      fallbackContextLimit: 256000,
      endpoints: resolveChannelEndpoints(channel)
    };

    if (aSig !== lastAssetsSig || !assetsScript) {
      const assetsCss = enabled ? `${buildFontFaceCss()}\n${buildWallpaperCss(activeConfig)}` : '';
      assetsHash = crypto.createHash('sha256').update(assetsCss).digest('hex').slice(0, 10);
      assetsScript = `(() => {
        if (window.__ag_mg_assets_hash === ${JSON.stringify(assetsHash)} && document.getElementById("ag-mg-assets")) return false;
        let el = document.getElementById("ag-mg-assets");
        const css = ${JSON.stringify(assetsCss)};
        if (!css) { if (el) el.remove(); window.__ag_mg_assets_hash = ${JSON.stringify(assetsHash)}; return true; }
        if (!el) { el = document.createElement("style"); el.id = "ag-mg-assets"; (document.head || document.documentElement).appendChild(el); }
        el.textContent = css;
        window.__ag_mg_assets_hash = ${JSON.stringify(assetsHash)};
        return true;
      })();`;
      lastAssetsSig = aSig;
      assetsChanged = true;
    }

    if (rSig !== lastRuntimeSig || !runtimeScript) {
      const minifyCss = (s) =>
        s
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/[ \t]*\r?\n[ \t]*/g, ' ')
          .replace(/\s*([{};])\s*/g, '$1')
          .replace(/\s{2,}/g, ' ')
          .trim();
      const safeAccent = /^#[0-9a-f]{3,8}$/i.test(String(activeConfig.accent || '').trim())
        ? String(activeConfig.accent).trim()
        : '#4f83f2';
      const accentOverride = `html[data-ag-mg-mode="dark"],body.dark{--mg-accent:${safeAccent} !important;--primary:${safeAccent} !important;}`;
      const themeCss = minifyCss(styleFiles.map((f) => readTextSafe(f, '')).join('\n')) + '\n' + accentOverride;
      const userCss = minifyCss(readTextSafe(userCssPath, ''));
      const userJs = readTextSafe(userJsPath, '');
      const runtimeSrc = runtimeFiles.map((f) => readTextSafe(f, '')).join('\n');
      const hash = crypto
        .createHash('sha256')
        .update(String(enabled))
        .update(themeCss)
        .update(userCss)
        .update(userJs)
        .update(runtimeSrc)
        .update(JSON.stringify({ accent: activeConfig.accent, tel: activeConfig.telemetryEnabled }))
        .digest('hex')
        .slice(0, 8);
      runtimeVersion = `${BASE_VERSION}-${hash}`;
      const bootPayload = {
        version: runtimeVersion,
        enabled,
        telemetryEnabled: activeConfig.telemetryEnabled,
        themeCss,
        userCss,
        userJs,
        config: { accent: activeConfig.accent, telemetryLayout: activeConfig.telemetryLayout }
      };
      runtimeScript = runtimeSrc.replace('})(__AG_MG_BOOT__);', () => `})(${JSON.stringify(bootPayload)});`);
      lastRuntimeSig = rSig;
      runtimeChanged = true;
    }

    return { assetsChanged, runtimeChanged };
  }

  return {
    rebuildIfNeeded,
    getState: () => ({
      activeConfig,
      assetsHash,
      assetsScript,
      runtimeVersion,
      runtimeScript
    })
  };
}
