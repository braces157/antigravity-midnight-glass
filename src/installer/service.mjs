/**
 * src/installer/service.mjs — Windows User-Scoped Task Scheduler & Process Isolation Manager
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { PID_FILE, SERVICE_TASK_NAME, SERVICE_VBS_NAME, isConfirmedNodePid } from '../shared.mjs';

export function stopDaemonProcess() {
  const stopped = [];
  const pidFiles = [
    PID_FILE,
    path.join(os.tmpdir(), 'ag-codex-daemon-default.pid'),
    path.join(os.tmpdir(), 'ag-codex-daemon-stable.pid')
  ];
  for (const pf of pidFiles) {
    try {
      if (!fs.existsSync(pf)) continue;
      const pid = parseInt(fs.readFileSync(pf, 'utf8').trim(), 10);
      if (isConfirmedNodePid(pid)) {
        try { process.kill(pid, 'SIGTERM'); stopped.push(pid); } catch {}
      }
      try { fs.unlinkSync(pf); } catch {}
    } catch {}
  }
  return stopped;
}

export function disableLegacyCodexThemeService() {
  if (process.platform !== 'win32') return;
  try {
    spawnSync('schtasks', ['/Delete', '/TN', 'AntigravityCodexThemeDaemon', '/F'], { stdio: 'ignore', windowsHide: true });
  } catch {}
  try {
    spawnSync('reg', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'AntigravityCodexThemeDaemon', '/f'], {
      stdio: 'ignore',
      windowsHide: true
    });
  } catch {}
}

export function registerService(projectRoot) {
  stopDaemonProcess();
  disableLegacyCodexThemeService();

  const daemonEntry = path.join(projectRoot, 'src', 'daemon', 'index.mjs');

  if (process.platform === 'win32') {
    // Store generated VBS wrapper outside the git repo so `git status` stays clean
    const runtimeDir = path.join(os.homedir(), '.gemini', 'antigravity', 'midnight-glass');
    fs.mkdirSync(runtimeDir, { recursive: true });
    const vbsPath = path.join(runtimeDir, SERVICE_VBS_NAME);
    // Clean up any legacy in-repo VBS file if present
    const legacyRepoVbs = path.join(projectRoot, SERVICE_VBS_NAME);
    try { if (fs.existsSync(legacyRepoVbs)) fs.unlinkSync(legacyRepoVbs); } catch {}
    const cmd = `""${process.execPath}"" --disable-warning=ExperimentalWarning ""${daemonEntry}""`;
    const vbs = `\uFEFFSet WshShell = CreateObject("WScript.Shell")\r\nWshShell.Run "${cmd}", 0, False\r\n`;
    fs.writeFileSync(vbsPath, vbs, 'utf16le');

    const escVbs = vbsPath.replace(/'/g, "''");
    const escTask = SERVICE_TASK_NAME.replace(/'/g, "''");
    const psReg = [
      `$ErrorActionPreference = 'Stop'`,
      `$user = if ($env:USERDOMAIN) { "$env:USERDOMAIN\\$env:USERNAME" } else { $env:USERNAME }`,
      `$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('//B //NoLogo "' + '${escVbs}' + '"')`,
      `$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user`,
      `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable`,
      `Register-ScheduledTask -TaskName '${escTask}' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null`
    ].join('; ');

    const regOk =
      spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psReg], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 10000
      }).status === 0;

    let startedViaTask = false;
    if (regOk) {
      startedViaTask =
        spawnSync('schtasks', ['/Run', '/TN', SERVICE_TASK_NAME], { stdio: 'ignore', windowsHide: true }).status === 0;
    }

    let autostart = regOk ? 'task-scheduler' : 'registry-run';
    if (!regOk) {
      spawnSync(
        'reg',
        ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', SERVICE_TASK_NAME, '/t', 'REG_SZ', '/d', `wscript.exe //B //NoLogo "${vbsPath}"`, '/f'],
        { stdio: 'ignore', windowsHide: true }
      );
    }

    if (!startedViaTask) {
      // Launch via Explorer Shell.Application to escape any parent IDE Job Object
      const psShell = `(New-Object -ComObject Shell.Application).ShellExecute('wscript.exe', '//B //NoLogo "${escVbs}"', '', '', 0)`;
      const shellOk =
        spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psShell], {
          stdio: 'ignore',
          windowsHide: true,
          timeout: 8000
        }).status === 0;
      if (!shellOk) {
        const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', daemonEntry], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        child.unref();
      }
      startedViaTask = shellOk;
    }

    return { platform: 'win32', autostart, taskName: SERVICE_TASK_NAME, vbsPath, started: startedViaTask };
  }

  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', daemonEntry], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  return { platform: process.platform, autostart: 'detached', started: true, pid: child.pid };
}

export function uninstallService(projectRoot) {
  stopDaemonProcess();
  if (process.platform === 'win32') {
    try { spawnSync('schtasks', ['/Delete', '/TN', SERVICE_TASK_NAME, '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
    try {
      spawnSync('reg', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', SERVICE_TASK_NAME, '/f'], {
        stdio: 'ignore',
        windowsHide: true
      });
    } catch {}
    for (const vbsPath of [
      path.join(projectRoot, SERVICE_VBS_NAME),
      path.join(os.homedir(), '.gemini', 'antigravity', 'midnight-glass', SERVICE_VBS_NAME)
    ]) {
      try { if (fs.existsSync(vbsPath)) fs.unlinkSync(vbsPath); } catch {}
    }
  }
}
