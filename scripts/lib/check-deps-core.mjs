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
import { fileURLToPath } from 'node:url';
import { getWebSocketUrl } from './browser-discovery.mjs';
import { resolveOutputDir, ensureOutputDir } from './output.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '../..');
const SITE_PATTERNS_DIR = path.join(os.homedir(), '.sleuth', 'site-patterns');

function checkAgentBrowser() {
  try {
    const version = execSync('agent-browser --version', {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000,
    }).trim();
    const match = version.match(/(\d+\.\d+\.\d+)/);
    return { status: 'ok', version: match ? `v${match[1]}` : version };
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

  // 1. agent-browser（必需）
  const ab = checkAgentBrowser();
  results.agentBrowser = ab;
  if (ab.status !== 'ok') {
    console.error('agent-browser: not found — npm i -g agent-browser && agent-browser install');
    process.exit(1);
  }
  if (!options.json) console.log(`agent-browser: ok (${ab.version})`);

  // 2. Chrome toggle（必需）—— 只走 approval mode 一条路
  const wsInfo = await getWebSocketUrl();
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
    if (!options.json) {
      console.log('chrome: 未发现可连的浏览器');
      console.log('  推荐：chrome://inspect/#remote-debugging 勾 toggle（Chrome 144+）');
    }
    results.cdp = {
      browser_mode: 'unavailable',
      cdp_port: null,
      cdp_ws: null,
      browser_label: null,
      auth_state: 'unknown',
    };
  }

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
    const jsonOut = { ...results.cdp, outputDir: results.outputDir, sitePatterns: results.sitePatterns, optionalDeps: results.optionalDeps };
    console.log(JSON.stringify(jsonOut, null, 2));
  }

  return results;
}

export {
  main as ensureCDP,
  checkAgentBrowser,
  listSitePatterns,
  resolveOutputDir,
  ensureOutputDir,
};
