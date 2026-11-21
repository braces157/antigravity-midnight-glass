/**
 * src/installer/launchers.mjs — Windows .lnk CDP Flag Setup, Live Inspection & Safe Relaunch
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  PID_FILE,
  fetchTargetsFromPort,
  isConfirmedNodePid,
  isPidAlive,
  readPortFromFile,
  resolveChannelEndpoints,
  sleepSync
} from '../shared.mjs';

export function ensureWindowsShortcuts() {
  if (process.platform !== 'win32') return { patched: [], already: [] };
  const ps = [
    `$ErrorActionPreference = 'SilentlyContinue'`,
    `$wsh = New-Object -ComObject WScript.Shell`,
    `$dirs = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'), (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'), (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs'), (Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar'))`,
    `$patched = @(); $already = @()`,
    `foreach ($d in $dirs) { if ($d -and (Test-Path -LiteralPath $d)) { Get-ChildItem -LiteralPath $d -Filter '*.lnk' -Recurse | ForEach-Object { try { $sc = $wsh.CreateShortcut($_.FullName); $leaf = [IO.Path]::GetFileName([string]$sc.TargetPath); if ($leaf -ieq 'Antigravity.exe' -or $leaf -ieq 'Antigravity - Insiders.exe') { if ([string]$sc.Arguments -match '--remote-debugging-port') { $already += $_.FullName } else { $sc.Arguments = if (([string]$sc.Arguments).Trim()) { "$(([string]$sc.Arguments).Trim()) --remote-debugging-port=0" } else { '--remote-debugging-port=0' }; $sc.Save(); $patched += $_.FullName } } } catch {} } } }`,
    `@{ patched = $patched; already = $already } | ConvertTo-Json -Compress -Depth 3`
  ].join('\n');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 8000
  });
  try {
    const p = JSON.parse(String(r.stdout || '{}').trim() || '{}');
    const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
    return { patched: arr(p.patched), already: arr(p.already) };
  } catch {
    return { patched: [], already: [] };
  }
}

export async function inspectLiveWindow(channel = 'auto') {
  const endpoints = resolveChannelEndpoints(channel);
  for (const ep of endpoints) {
    const port = readPortFromFile(ep.portFile) || ep.fallbackPort;
    const targets = await fetchTargetsFromPort(port);
    const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !String(t.url || '').startsWith('devtools://'));
    if (!page) continue;

    return await new Promise((resolve) => {
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      const timer = setTimeout(() => { try { ws.close(); } catch {} resolve({ reachable: false }); }, 3000);
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression: `(async () => {
              await document.fonts.ready;
              const strip = document.getElementById('ag-mg-strip-main');
              return {
                version: window.__ag_mg_version || null,
                assetsHash: window.__ag_mg_assets_hash || null,
                hasAssets: Boolean(document.getElementById('ag-mg-assets')),
                hasTheme: Boolean(document.getElementById('ag-mg-theme')),
                interVariableLoaded: document.fonts.check('14px "Inter Variable"'),
                stripMounted: Boolean(strip),
                stripText: strip ? strip.innerText.replace(/\\s+/g, ' ').trim() : null
              };
            })()`,
            awaitPromise: true,
            returnByValue: true
          }
        }));
      });
      ws.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          if (msg.id === 1) {
            clearTimeout(timer);
            try { ws.close(); } catch {}
            resolve({ reachable: true, channel: ep.channel, port, title: page.title, state: msg?.result?.result?.value || null });
          }
        } catch {}
      });
      ws.addEventListener('error', () => { clearTimeout(timer); resolve({ reachable: false }); });
    });
  }
  return { reachable: false };
}

export function getDaemonStatus() {
  let pid = null;
  let running = false;
  try {
    if (fs.existsSync(PID_FILE)) {
      pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      running = isConfirmedNodePid(pid);
    }
  } catch {}
  return { pid, running, pidFile: PID_FILE };
}

export async function bakeWallpaperViaCdp(projectRoot, wpCfg = {}) {
  const srcImg = path.join(projectRoot, 'user', 'wallpaper.jpg');
  if (!fs.existsSync(srcImg)) throw new Error(`Missing wallpaper source: ${srcImg}`);
  const endpoints = resolveChannelEndpoints('auto');
  let page = null;
  for (const ep of endpoints) {
    const port = readPortFromFile(ep.portFile) || ep.fallbackPort;
    const targets = await fetchTargetsFromPort(port);
    page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !String(t.url || '').startsWith('devtools://'));
    if (page) break;
  }
  if (!page) throw new Error('Antigravity CDP window not reachable for wallpaper bake.');

  const b64In = fs.readFileSync(srcImg).toString('base64');
  const blur = Number.isFinite(wpCfg.blur) ? wpCfg.blur : 8;
  const br = Number.isFinite(wpCfg.brightness) ? wpCfg.brightness : 0.62;
  const ct = Number.isFinite(wpCfg.contrast) ? wpCfg.contrast : 1.06;
  const sat = Number.isFinite(wpCfg.saturate) ? wpCfg.saturate : 1.16;
  const op = Number.isFinite(wpCfg.opacity) ? wpCfg.opacity : 0.82;

  const val = await new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('Bake timeout')); }, 10000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `(async () => {
            const img = new Image();
            img.src = "data:image/jpeg;base64,${b64In}";
            await img.decode();
            const maxW = 1920;
            const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1;
            const w = Math.round(img.naturalWidth * scale);
            const h = Math.round(img.naturalHeight * scale);
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#0b0e17';
            ctx.fillRect(0, 0, w, h);
            ctx.save();
            ctx.globalAlpha = ${op};
            ctx.filter = 'blur(${blur}px) brightness(${br}) contrast(${ct}) saturate(${sat})';
            const pad = Math.round(Math.max(w, h) * 0.04);
            ctx.drawImage(img, -pad, -pad, w + pad * 2, h + pad * 2);
            ctx.restore();
            return { w, h, webp: c.toDataURL('image/webp', 0.86) };
          })()`,
          awaitPromise: true,
          returnByValue: true
        }
      }));
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id === 1) {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve(msg?.result?.result?.value);
      }
    });
    ws.addEventListener('error', (e) => { clearTimeout(timer); reject(e); });
  });

  if (!val?.webp?.startsWith('data:image/webp;base64,')) throw new Error('Canvas WebP bake returned empty data.');
  const outBuf = Buffer.from(val.webp.slice('data:image/webp;base64,'.length), 'base64');
  const outPath = path.join(projectRoot, 'assets', 'wallpaper-baked.webp');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, outBuf);
  return { outPath, width: val.w, height: val.h, bytes: outBuf.length };
}

export async function relaunchAntigravity() {
  if (process.platform !== 'win32') return { ok: false, reason: 'windows-only-relaunch' };
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const exe = path.join(localAppData, 'Programs', 'Antigravity', 'Antigravity.exe');
  if (!fs.existsSync(exe)) return { ok: false, reason: 'exe-not-found' };

  const stopPs = `Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow(); if (-not $_.WaitForExit(1800)) { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } }`;
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', stopPs], {
    windowsHide: true,
    stdio: 'ignore',
    timeout: 6000
  });
  sleepSync(300);
  const child = spawn(exe, ['--remote-debugging-port=0'], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  for (let i = 0; i < 20; i++) {
    sleepSync(500);
    const live = await inspectLiveWindow('auto');
    if (live.reachable) return { ok: true, live };
  }
  return { ok: false, reason: 'cdp-not-ready-after-relaunch' };
}
