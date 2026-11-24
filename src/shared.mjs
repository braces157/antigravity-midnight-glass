import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const APP_ID = 'antigravity-midnight-glass';
export const SERVICE_TASK_NAME = 'AntigravityMidnightGlassDaemon';
export const SERVICE_VBS_NAME = 'AntigravityMidnightGlassDaemon.vbs';
export const PID_FILE = path.join(os.tmpdir(), 'ag-midnight-glass-daemon.pid');
export const RELAUNCH_GUARD_FILE = path.join(os.tmpdir(), 'ag-midnight-glass-relaunch-guard.json');

export const DEFAULT_ALLOWED_ORIGINS = [
  'http://127.0.0.1',
  'https://127.0.0.1',
  'http://localhost',
  'https://localhost',
  'vscode-file://',
  'plugin://swarm--'
];

export const NON_HOST_CMD_RE =
  /--type=|--crashpad|--utility-sub-type=|--import=|sidecar_sdk|--ms-enable-electron-run-as-node/i;

export function stripBom(raw) {
  if (typeof raw !== 'string') return '';
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

export function readJsonSafe(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(stripBom(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return fallback;
  }
}

export function readTextSafe(filePath, fallback = '') {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

export function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.round(ms));
  } catch {}
}

export function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

export function isConfirmedNodePid(pid) {
  if (!pid || pid <= 0 || pid === process.pid || !isPidAlive(pid)) return false;
  if (process.platform === 'win32') {
    const res = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 1500
    });
    return String(res.stdout || '').toLowerCase().includes('node.exe');
  }
  const res = spawnSync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8', timeout: 1500 });
  const out = String(res.stdout || '');
  return out.includes('antigravity-midnight-glass') || out.includes('src/daemon/index.mjs');
}

export function isAllowedOrigin(urlStr, allowedOrigins = DEFAULT_ALLOWED_ORIGINS) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  return allowedOrigins.some((prefix) => urlStr.startsWith(prefix));
}

export function readPortFromFile(portFile) {
  try {
    const raw = fs.readFileSync(portFile, 'utf8').trim();
    const port = parseInt(raw.split(/\r?\n/)[0], 10);
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export function fetchTargetsFromPort(port, timeoutMs = 450) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/json/list', timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => {
      req.destroy();
      resolve([]);
    });
  });
}

export function resolveChannelEndpoints(channelMode = 'auto') {
  const home = os.homedir();
  const build = (ch) => {
    const isIns = ch === 'insiders';
    const appDirName = isIns ? 'Antigravity - Insiders' : 'Antigravity';
    const geminiSub = isIns ? '.gemini/antigravity-insiders' : '.gemini/antigravity';
    let dataDir;
    if (process.platform === 'win32') {
      dataDir = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), appDirName);
    } else if (process.platform === 'darwin') {
      dataDir = path.join(home, 'Library', 'Application Support', appDirName);
    } else {
      dataDir = path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), appDirName);
    }
    const dotDir = path.join(home, isIns ? '.antigravity-insiders' : '.antigravity');
    const portFile = path.join(dataDir, 'DevToolsActivePort');
    const lsLogFile =
      process.platform === 'darwin'
        ? path.join(home, 'Library', 'Logs', appDirName, 'language_server.log')
        : path.join(dataDir, 'logs', 'language_server.log');
    return {
      channel: ch,
      dataDir,
      dotDir,
      portFile,
      lsLogFile,
      fallbackPort: isIns ? 9223 : 9222,
      conversationsDir: path.join(home, geminiSub, 'conversations'),
      channelInstalled: fs.existsSync(portFile) || fs.existsSync(dataDir) || fs.existsSync(dotDir)
    };
  };
  if (channelMode === 'stable' || channelMode === 'insiders') return [build(channelMode)];
  return [build('stable'), build('insiders')];
}

export function ensureArgvRemoteDebugging(channel = 'auto') {
  const endpoints = resolveChannelEndpoints(channel).filter((e) => e.channelInstalled);
  const results = [];
  for (const ep of endpoints) {
    const argvPath = path.join(ep.dotDir, 'argv.json');
    try {
      fs.mkdirSync(ep.dotDir, { recursive: true });
      if (!fs.existsSync(argvPath)) {
        fs.writeFileSync(argvPath, JSON.stringify({ 'remote-debugging-port': ep.fallbackPort }, null, 2) + '\n', 'utf8');
        results.push({ path: argvPath, action: 'created' });
        continue;
      }
      const raw = fs.readFileSync(argvPath, 'utf8');
      if (/"remote-debugging-port"\s*:/.test(raw)) {
        results.push({ path: argvPath, action: 'already-present' });
        continue;
      }
      const next = raw.replace(/\{/, `{\n\t"remote-debugging-port": ${ep.fallbackPort},`);
      fs.writeFileSync(argvPath, next, 'utf8');
      results.push({ path: argvPath, action: 'added' });
    } catch (err) {
      results.push({ path: argvPath, action: 'error', error: String(err?.message || err) });
    }
  }
  return results;
}
