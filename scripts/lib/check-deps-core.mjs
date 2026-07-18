/**
 * check-deps-core.mjs — sleuth 环境检查核心
 *
 * 只走一条路：Chrome 144+ approval mode（chrome://inspect toggle）。
 * toggle 没开就报错，不自起 Chrome。
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getWebSocketUrl } from './browser-discovery.mjs';
import { resolveOutputDir, ensureOutputDir } from './output.mjs';

const SITE_PATTERNS_DIR = path.join(os.homedir(), '.sleuth', 'site-patterns');

function checkAgentBrowser() {
  try {
    const version = execSync('agent-browser --version', {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000,
    }).trim();
    const match = version.match(/(\d+\.\d+\.\d+)/);
    const parsed = match ? match[1].split('.').map(Number) : null;
    const supported = parsed && (parsed[0] > 0 || parsed[1] >= 28);
    return { status: supported ? 'ok' : 'outdated', version: match ? `v${match[1]}` : version, minimum: 'v0.28.0' };
  } catch {
    return { status: 'not-found', version: null };
  }
}

function checkOptionalDep(name) {
  try {
    const cmd = os.platform() === 'win32' ? `where "${name}"` : `which "${name}"`;
    execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { status: 'ok' };
  } catch {
    return { status: 'not-found' };
  }
}

function listSitePatterns() {
  if (!fs.existsSync(SITE_PATTERNS_DIR)) return [];
  try {
    return fs.readdirSync(SITE_PATTERNS_DIR)
      .filter(entry => entry.endsWith('.md') && fs.statSync(path.join(SITE_PATTERNS_DIR, entry)).isFile());
  } catch {
    return [];
  }
}

export async function main(options = {}) {
  const results = {};
  const mode = options.mode || 'light';
  results.mode = mode;

  // 1. agent-browser（只有 full 模式必需）
  const ab = checkAgentBrowser();
  results.agentBrowser = ab;
  if (!options.json) console.log(`agent-browser: ${ab.status}${ab.version ? ` (${ab.version})` : ''}`);

  // 2. Chrome toggle（只有 full 模式必需）——不启动或关闭 Chrome
  const wsInfo = mode === 'full' && ab.status === 'ok' ? await getWebSocketUrl() : null;
  if (wsInfo) {
    if (!options.json) {
      console.log(`chrome-cdp: ok (${wsInfo.label}, port ${wsInfo.port})`);
      console.log(`SLEUTH_CDP_WS=${wsInfo.wsUrl}`);
      console.log(`SLEUTH_CDP_PORT=${wsInfo.port}`);
    }
    results.cdp = {
      browser_mode: 'approval',
      cdp_port: wsInfo.port,
      cdp_ws: wsInfo.wsUrl,
      browser_label: wsInfo.label,
      auth_state: 'unknown',
    };
  } else {
    if (!options.json && mode === 'full') {
      console.log('chrome: 未发现可连的浏览器');
      console.log('  如本任务需要浏览器：打开 chrome://inspect/#remote-debugging 并勾选开关');
    }
    results.cdp = {
      browser_mode: mode === 'light' ? 'not-checked' : 'unavailable',
      cdp_port: null,
      cdp_ws: null,
      browser_label: null,
      auth_state: 'unknown',
    };
  }

  results.ready = mode === 'light' || (ab.status === 'ok' && Boolean(wsInfo));
  if (mode === 'full' && ab.status === 'not-found' && !options.json) console.error('full 模式需要 agent-browser >= 0.28：npm i -g agent-browser@latest');
  if (mode === 'full' && ab.status === 'outdated' && !options.json) console.error(`agent-browser ${ab.version} 过旧，至少需要 v0.28.0`);
  if (mode === 'full' && !wsInfo && !options.json) console.error('full 模式需要用户先允许 Chrome 远程调试；Sleuth 不会自行启动或关闭 Chrome');

  // 3. 输出目录
  // 3. 输出目录（任务模式优先于日期模式）
  const outDir = resolveOutputDir(options.taskName);
  results.outputDir = outDir;
  if (!options.checkOnly) {
    ensureOutputDir(outDir);
    if (!options.json) console.log(`output-dir: ${outDir}`);
  }

  // 4. site-patterns（占位，给 agent 用）
  const patterns = listSitePatterns();
  results.sitePatterns = patterns;
  if (!options.json) console.log(patterns.length ? `site-patterns: ${patterns.join(', ')}` : 'site-patterns: (none)');

  // 5. 可选依赖
  const optDeps = {
    sqlite3: { install: 'macOS/Linux 预装；Windows: winget install sqlite.sqlite' },
    'yt-dlp': { install: 'pip install yt-dlp' },
    python3: { install: 'macOS/Linux 预装；Windows: winget install python3' },
  };
  results.optionalDeps = {};
  for (const dep of Object.keys(optDeps)) {
    results.optionalDeps[dep] = checkOptionalDep(dep).status;
  }

  // 6. JSON 输出
  if (options.json) {
    const jsonOut = { ready: results.ready, mode, agentBrowser: results.agentBrowser, ...results.cdp, outputDir: results.outputDir, sitePatterns: results.sitePatterns, optionalDeps: results.optionalDeps };
    console.log(JSON.stringify(jsonOut, null, 2));
  }

  if (!results.ready) process.exitCode = 1;
  return results;
}

export {
  checkAgentBrowser,
  listSitePatterns,
  resolveOutputDir,
  ensureOutputDir,
};
