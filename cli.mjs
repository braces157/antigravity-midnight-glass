#!/usr/bin/env node
/**
 * cli.mjs — Antigravity Midnight Glass CLI
 *
 * Usage:
 *   node cli.mjs install      Configure CDP launchers, register Windows Task Scheduler daemon, and inject now
 *   node cli.mjs doctor       Inspect daemon health, Task Scheduler isolation, font load, and live window state
 *   node cli.mjs bake         Pre-bake user/wallpaper.jpg into GPU-free blurred assets/wallpaper-baked.webp
 *   node cli.mjs relaunch     Safely restart Antigravity with --remote-debugging-port=0
 *   node cli.mjs uninstall    Stop daemon, remove Task Scheduler service, and clean injected styles
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureArgvRemoteDebugging, readJsonSafe, sleepSync } from './src/shared.mjs';
import { registerService, stopDaemonProcess, uninstallService } from './src/installer/service.mjs';
import { bakeWallpaperViaCdp, ensureWindowsShortcuts, getDaemonStatus, inspectLiveWindow, relaunchAntigravity } from './src/installer/launchers.mjs';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const cmd = process.argv[2] || 'help';

switch (cmd) {
  case 'install': {
    const argv = ensureArgvRemoteDebugging('auto');
    const shortcuts = ensureWindowsShortcuts();
    const service = registerService(ROOT_DIR);
    // Run one immediate synchronous pass so the live window updates before returning
    const daemonEntry = path.join(ROOT_DIR, 'src', 'daemon', 'index.mjs');
    spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', daemonEntry, '--once'], { stdio: 'inherit' });
    sleepSync(800);
    const daemon = getDaemonStatus();
    const live = await inspectLiveWindow('auto');
    console.log(JSON.stringify({ ok: Boolean(live.reachable && live.state?.hasTheme), argv, shortcuts, service, daemon, live }, null, 2));
    break;
  }

  case 'status':
  case 'doctor': {
    const daemon = getDaemonStatus();
    const live = await inspectLiveWindow('auto');
    const bakedPath = path.join(ROOT_DIR, 'assets', 'wallpaper-baked.webp');
    const ok = Boolean(daemon.running && live.reachable && live.state?.hasTheme && live.state?.hasAssets);
    console.log(
      JSON.stringify(
        {
          ok,
          node: process.version,
          projectRoot: ROOT_DIR,
          bakedWallpaperBytes: fs.existsSync(bakedPath) ? fs.statSync(bakedPath).size : 0,
          daemon,
          live
        },
        null,
        2
      )
    );
    if (!ok) process.exitCode = 1;
    break;
  }

  case 'bake': {
    const cfg = readJsonSafe(path.join(ROOT_DIR, 'user', 'config.json'), {});
    const res = await bakeWallpaperViaCdp(ROOT_DIR, cfg.wallpaper || {});
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    break;
  }

  case 'relaunch': {
    const res = await relaunchAntigravity();
    console.log(JSON.stringify(res, null, 2));
    if (!res.ok) process.exitCode = 1;
    break;
  }

  case 'stop': {
    const stopped = stopDaemonProcess();
    console.log(JSON.stringify({ ok: true, stopped }, null, 2));
    break;
  }

  case 'uninstall': {
    uninstallService(ROOT_DIR);
    const cfgPath = path.join(ROOT_DIR, 'user', 'config.json');
    const orig = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : null;
    if (orig) {
      const cfg = readJsonSafe(cfgPath, {});
      cfg.enabled = false;
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
      const daemonEntry = path.join(ROOT_DIR, 'src', 'daemon', 'index.mjs');
      spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', daemonEntry, '--once'], { stdio: 'ignore', windowsHide: true });
      fs.writeFileSync(cfgPath, orig, 'utf8');
    }
    console.log('[MidnightGlass] Uninstalled daemon service and cleaned injected theme styles.');
    break;
  }

  default:
    console.log(`antigravity-midnight-glass CLI:
  node cli.mjs install      Install service, configure shortcuts, and inject live
  node cli.mjs doctor       Check daemon, fonts, pre-baked wallpaper, and live DOM
  node cli.mjs bake         Re-bake user/wallpaper.jpg into GPU-free WebP
  node cli.mjs relaunch     Restart Antigravity with --remote-debugging-port=0
  node cli.mjs uninstall    Stop daemon and remove injected styles`);
    break;
}
