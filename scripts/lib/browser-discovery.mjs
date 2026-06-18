import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/**
 * 已知支持 chrome://inspect#remote-debugging toggle 的 Chromium 系浏览器。
 */
export function knownBrowsers() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || '';
  switch (os.platform()) {
    case 'darwin':
      return [
        { id: 'chrome', label: 'Chrome', devToolsPath: path.join(home, 'Library/Application Support/Google/Chrome/DevToolsActivePort') },
        { id: 'edge', label: 'Microsoft Edge', devToolsPath: path.join(home, 'Library/Application Support/Microsoft Edge/DevToolsActivePort') },
      ];
    case 'linux':
      return [
        { id: 'chrome', label: 'Chrome', devToolsPath: path.join(home, '.config/google-chrome/DevToolsActivePort') },
        { id: 'edge', label: 'Microsoft Edge', devToolsPath: path.join(home, '.config/microsoft-edge/DevToolsActivePort') },
      ];
    case 'win32':
      return [
        { id: 'chrome', label: 'Chrome', devToolsPath: path.join(localAppData, 'Google/Chrome/User Data/DevToolsActivePort') },
        { id: 'edge', label: 'Microsoft Edge', devToolsPath: path.join(localAppData, 'Microsoft/Edge/User Data/DevToolsActivePort') },
      ];
    default:
      return [];
  }
}

/** TCP 端口探活 */
export function checkPort(port, host = '127.0.0.1', timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, host);
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

/** 返回所有"开了 remote debugging toggle 且端口活着"的浏览器 */
export async function detectAll() {
  const result = [];
  for (const browser of knownBrowsers()) {
    let content;
    try { content = fs.readFileSync(browser.devToolsPath, 'utf8'); }
    catch { continue; }
    const lines = content.trim().split(/\r?\n/).filter(Boolean);
    const port = parseInt(lines[0], 10);
    if (!(port > 0 && port < 65536)) continue;
    if (!(await checkPort(port))) continue;
    result.push({ ...browser, port, wsPath: lines[1] || null });
  }
  return result;
}

const PREFERENCE_ORDER = ['chrome', 'edge'];

/** 选择要连的浏览器（优先 chrome） */
export async function selectBrowser() {
  const detected = await detectAll();
  if (detected.length > 0) {
    const sorted = [...detected].sort(
      (a, b) => PREFERENCE_ORDER.indexOf(a.id) - PREFERENCE_ORDER.indexOf(b.id)
    );
    const chosen = sorted[0];
    return { kind: 'ok', browser: chosen, port: chosen.port, detected };
  }
  return { kind: 'empty', detected: [] };
}

/**
 * 从 DevToolsActivePort 构造完整的 ws:// URL。
 * agent-browser 用这个 URL 直连，绕过 /json/version HTTP 探测（404 问题）。
 * @returns {Promise<{wsUrl: string, port: number, label: string} | null>}
 */
export async function getWebSocketUrl() {
  const sel = await selectBrowser();
  if (sel.kind !== 'ok' || !sel.browser?.wsPath) return null;
  const wsUrl = `ws://127.0.0.1:${sel.port}${sel.browser.wsPath}`;
  return { wsUrl, port: sel.port, label: sel.browser.label };
}