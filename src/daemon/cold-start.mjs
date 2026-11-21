/**
 * src/daemon/cold-start.mjs — Safe Cold-Start CDP Relay for Antigravity 2.33+ (WAL-Protected)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { RELAUNCH_GUARD_FILE, isPidAlive, readJsonSafe, readPortFromFile, sleepSync } from '../shared.mjs';

function hasActiveWalWrite(conversationsDir, windowSec = 15) {
  try {
    if (!conversationsDir || !fs.existsSync(conversationsDir)) return false;
    const now = Date.now();
    for (const f of fs.readdirSync(conversationsDir)) {
      if (!f.endsWith('.db-wal')) continue;
      const st = fs.statSync(path.join(conversationsDir, f), { throwIfNoEntry: false });
      if (st && st.size > 4096 && now - st.mtimeMs < windowSec * 1000) return true;
    }
  } catch {}
  return false;
}

export function createColdStartController() {
  const ignoredPids = new Set();
  let busy = false;

  function probeWindowsUnflaggedHost(endpoints) {
    if (process.platform !== 'win32') return null;
    const stableEp = endpoints.find((e) => e.channel === 'stable');
    if (stableEp && readPortFromFile(stableEp.portFile)) return null;

    // Fast tasklist pre-check before touching CIM
    const tl = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Antigravity.exe', '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 2000
    });
    if (tl.status !== 0 || !String(tl.stdout || '').toLowerCase().includes('antigravity.exe')) return null;

    const ps = [
      `$ErrorActionPreference = 'SilentlyContinue'`,
      `$now = [DateTime]::UtcNow`,
      `$p = Get-CimInstance Win32_Process -Filter "Name = 'Antigravity.exe'" | Where-Object { $_.CommandLine -notmatch '--type=|--crashpad|--utility-sub-type=|--import=|sidecar_sdk|--ms-enable-electron-run-as-node' } | Select-Object -First 1`,
      `if ($p) { $age = if ($p.CreationDate) { [Math]::Max(0, [int][Math]::Round(($now - ([DateTime]$p.CreationDate).ToUniversalTime()).TotalSeconds)) } else { 999 }; @{ pid = [int]$p.ProcessId; exe = [string]$p.ExecutablePath; cmd = [string]$p.CommandLine; elapsedSec = $age } | ConvertTo-Json -Compress }`
    ].join('; ');
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 4000
    });
    if (r.status !== 0 || !r.stdout?.trim()) return null;
    try {
      const info = JSON.parse(r.stdout.trim());
      return {
        pid: Number(info.pid),
        exePath: String(info.exe || ''),
        elapsedSec: Number(info.elapsedSec),
        hasCdp: /--remote-debugging-port(?:=|\s|$)/i.test(String(info.cmd || '')),
        hasUpdated: /--updated(?:\s|$)/i.test(String(info.cmd || ''))
      };
    } catch {
      return null;
    }
  }

  function maybeAutoRelaunch(activeConfig) {
    if (busy || !activeConfig?.enabled || !activeConfig?.cdpAutoRelaunch) return false;
    for (const pid of [...ignoredPids]) if (!isPidAlive(pid)) ignoredPids.delete(pid);

    const proc = probeWindowsUnflaggedHost(activeConfig.endpoints || []);
    if (!proc || !proc.pid || proc.hasCdp || ignoredPids.has(proc.pid)) return false;

    const maxWindow = proc.hasUpdated ? 25 : 12;
    const stableEp = (activeConfig.endpoints || []).find((e) => e.channel === 'stable');
    if (proc.elapsedSec > maxWindow || hasActiveWalWrite(stableEp?.conversationsDir, 15)) {
      ignoredPids.add(proc.pid);
      return false;
    }

    const guard = readJsonSafe(RELAUNCH_GUARD_FILE, {});
    if (Date.now() - (Number(guard.lastAt) || 0) < 60000) {
      ignoredPids.add(proc.pid);
      return false;
    }

    busy = true;
    try {
      ignoredPids.add(proc.pid);
      fs.writeFileSync(RELAUNCH_GUARD_FILE, JSON.stringify({ lastAt: Date.now(), pid: proc.pid }) + '\n', 'utf8');
      const stopPs = `$gp = Get-Process -Id ${proc.pid} -ErrorAction SilentlyContinue; if ($gp) { [void]$gp.CloseMainWindow(); if (-not $gp.WaitForExit(1800)) { Stop-Process -Id ${proc.pid} -Force -ErrorAction SilentlyContinue } }`;
      spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', stopPs], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: 4500
      });
      for (let i = 0; i < 40 && isPidAlive(proc.pid); i++) sleepSync(80);
      sleepSync(180);
      if (proc.exePath) {
        const child = spawn(proc.exePath, ['--remote-debugging-port=0'], { detached: true, stdio: 'ignore', windowsHide: false });
        child.unref();
      }
      return true;
    } catch {
      return false;
    } finally {
      busy = false;
    }
  }

  return { maybeAutoRelaunch };
}
