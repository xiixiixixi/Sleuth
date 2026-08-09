/**
 * check-deps-core.mjs — sleuth 环境检查核心
 *
 * 只走一条路：Chrome 144+ approval mode（chrome://inspect toggle）。
 * toggle 没开就报错，不自起 Chrome。
 */

import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getBrowserConnection } from './browser-discovery.mjs';
import { resolveOutputDir, ensureOutputDir } from './output.mjs';

const SITE_PATTERNS_DIR = path.join(os.homedir(), '.sleuth', 'site-patterns');

function checkNodeRuntime(version = process.versions.node) {
  const normalized = String(version || '').replace(/^v/, '');
  const major = Number(normalized.split('.')[0]) || 0;
  return {
    version: normalized ? `v${normalized}` : null,
    major,
    browserSupported: major >= 24,
    browserMinimum: 'v24.0.0',
  };
}

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

const AGENT_BROWSER_INSTALL_COMMAND = 'npm i -g agent-browser@latest';

/** full 执行模式自动补齐 CLI；check-only 永远不会调用这里。 */
function provisionAgentBrowser(previousStatus) {
  const successStatus = previousStatus === 'not-found' ? 'installed' : 'upgraded';
  try {
    execFileSync('npm', ['i', '-g', 'agent-browser@latest'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
    });
    const verified = checkAgentBrowser();
    if (verified.status !== 'ok') {
      return {
        attempted: true,
        status: 'failed',
        command: AGENT_BROWSER_INSTALL_COMMAND,
        error: '安装命令已结束，但 agent-browser 仍不可用',
      };
    }
    return {
      attempted: true,
      status: successStatus,
      command: AGENT_BROWSER_INSTALL_COMMAND,
      verified,
    };
  } catch (error) {
    return {
      attempted: true,
      status: 'failed',
      command: AGENT_BROWSER_INSTALL_COMMAND,
      error: error?.stderr?.toString().trim() || error.message,
    };
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
  const nodeRuntime = checkNodeRuntime(options.nodeVersion);
  results.nodeRuntime = nodeRuntime;

  // 1. agent-browser（只有 full 模式必需）
  let ab = checkAgentBrowser();
  results.cliProvisioning = {
    attempted: false,
    status: 'not-needed',
    command: AGENT_BROWSER_INSTALL_COMMAND,
  };
  if (mode === 'full' && !nodeRuntime.browserSupported) {
    results.cliProvisioning = {
      attempted: false,
      status: 'blocked-unsupported-node',
      command: AGENT_BROWSER_INSTALL_COMMAND,
    };
  } else if (mode === 'full' && !options.checkOnly && ab.status !== 'ok') {
    if (!options.json) {
      const verb = ab.status === 'not-found' ? '安装' : '升级';
      console.log(`agent-browser: 正在自动${verb} CLI，不会下载或启动测试浏览器`);
    }
    const provisioning = provisionAgentBrowser(ab.status);
    const { verified, ...publicProvisioning } = provisioning;
    results.cliProvisioning = publicProvisioning;
    if (verified) ab = verified;
    else ab = checkAgentBrowser();
  }
  results.agentBrowser = ab;
  if (!options.json) console.log(`agent-browser: ${ab.status}${ab.version ? ` (${ab.version})` : ''}`);

  // 2. Chrome toggle（只有 full 模式必需）——必须先核验监听进程身份
  const browserConnection = mode === 'full' && nodeRuntime.browserSupported && ab.status === 'ok'
    ? await getBrowserConnection()
    : { kind: 'empty', rejected: [] };
  const wsInfo = browserConnection.kind === 'ok' ? browserConnection : null;
  if (wsInfo) {
    if (!options.json) {
      console.log(`chrome-cdp: ok (${wsInfo.label}, port ${wsInfo.port})`);
      console.log('connection-target: 用户当前使用、已有登录态的 Chrome（不会另开浏览器）');
      console.log(`SLEUTH_CDP_WS=${wsInfo.wsUrl}`);
      console.log(`SLEUTH_CDP_PORT=${wsInfo.port}`);
    }
    results.cdp = {
      browser_mode: 'approval',
      cdp_port: wsInfo.port,
      cdp_ws: wsInfo.wsUrl,
      browser_label: wsInfo.label,
      browser_identity: wsInfo.identity,
      rejected_browser_reason: null,
      auth_state: 'unknown',
    };
  } else {
    const rejected = browserConnection.rejected?.[0] || null;
    const rejectionUnverified = rejected?.identity === 'port-owner-unverified';
    results.cdp = {
      browser_mode: mode === 'light' ? 'not-checked' : 'unavailable',
      cdp_port: null,
      cdp_ws: null,
      browser_label: null,
      browser_identity: mode === 'light'
        ? 'not-checked'
        : rejected ? (rejectionUnverified ? 'unverified-browser' : 'rejected-non-user-browser') : 'unavailable',
      rejected_browser_reason: rejected?.identity || null,
      auth_state: 'unknown',
    };
  }

  results.ready = mode === 'light'
    || (nodeRuntime.browserSupported && ab.status === 'ok' && Boolean(wsInfo));
  results.connectionTarget = mode === 'full' ? 'existing-user-chrome' : null;
  results.nextActions = [];
  if (mode === 'full' && !nodeRuntime.browserSupported) {
    results.nextActions.push({
      action: 'upgrade_node_runtime',
      minimum: nodeRuntime.browserMinimum,
      instruction: '浏览器兜底依赖的 agent-browser 要求 Node.js 24 或更高版本；升级 Node.js 后再运行 full 检查',
    });
  } else if (mode === 'full' && ab.status === 'not-found') {
    results.nextActions.push({ action: 'install_agent_browser_cli', command: AGENT_BROWSER_INSTALL_COMMAND });
  } else if (mode === 'full' && ab.status === 'outdated') {
    results.nextActions.push({ action: 'upgrade_agent_browser_cli', command: AGENT_BROWSER_INSTALL_COMMAND });
  }
  if (mode === 'full' && browserConnection.kind === 'rejected') {
    const rejectionReason = browserConnection.rejected[0]?.identity || 'port-owner-unverified';
    results.nextActions.push({
      action: rejectionReason === 'port-owner-unverified'
        ? 'reject_unverified_browser'
        : 'reject_non_user_browser',
      reason: rejectionReason,
      instruction: rejectionReason === 'port-owner-unverified'
        ? '无法核验这个端口背后的浏览器身份，已安全拒绝；请在日常 Chrome 重新开启控制'
        : '已拒绝这个独立或测试浏览器；请确认后手动关闭它，不要让 Agent 代关',
    });
  }
  if (mode === 'full' && !wsInfo) {
    results.nextActions.push({
      action: 'enable_existing_chrome_control',
      url: 'chrome://inspect/#remote-debugging',
      instruction: '在平时使用且已经登录的 Chrome 中开启远程调试控制，并批准本次连接',
    });
    results.nextActions.push({
      action: 'rerun_check',
      command: options.checkOnly
        ? 'node scripts/check-deps.mjs --mode full --check-only'
        : 'node scripts/check-deps.mjs --mode full',
    });
  }
  if (mode === 'full' && !options.json && !results.ready) {
    console.error('浏览器兜底尚未就绪，请按顺序处理：');
    let step = 1;
    if (!nodeRuntime.browserSupported) {
      console.error(`  ${step++}. 当前 Node.js ${nodeRuntime.version} 不支持浏览器兜底，请先升级到 ${nodeRuntime.browserMinimum} 或更高版本`);
    }
    if (browserConnection.kind === 'rejected') {
      const reason = browserConnection.rejected[0]?.identity;
      const explanation = reason === 'port-owner-unverified'
        ? '无法核验当前端口背后的浏览器进程'
        : `当前端口属于独立、测试或非日常浏览器（${reason}）`;
      console.error(`  ${step++}. ${explanation}，Sleuth 已拒绝连接`);
    }
    if (nodeRuntime.browserSupported && ab.status === 'not-found') console.error(`  ${step++}. 安装 agent-browser CLI：npm i -g agent-browser@latest`);
    else if (nodeRuntime.browserSupported && ab.status === 'outdated') console.error(`  ${step++}. 升级 agent-browser CLI（当前 ${ab.version}，至少 v0.28.0）：npm i -g agent-browser@latest`);
    console.error(`  ${step++}. 在平时使用、已经登录的 Chrome 打开 chrome://inspect/#remote-debugging，并开启远程调试控制`);
    console.error(`  ${step}. 完成后重跑：node scripts/check-deps.mjs --mode full --check-only`);
    console.error('  Sleuth 只连接这个现有 Chrome；不会另开、重启或下载新的浏览器。');
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
    const jsonOut = { ready: results.ready, mode, nodeRuntime: results.nodeRuntime, agentBrowser: results.agentBrowser, cliProvisioning: results.cliProvisioning, ...results.cdp, connectionTarget: results.connectionTarget, nextActions: results.nextActions, outputDir: results.outputDir, sitePatterns: results.sitePatterns, optionalDeps: results.optionalDeps };
    console.log(JSON.stringify(jsonOut, null, 2));
  }

  if (!results.ready) process.exitCode = 1;
  return results;
}

export {
  checkAgentBrowser,
  checkNodeRuntime,
  provisionAgentBrowser,
  listSitePatterns,
  resolveOutputDir,
  ensureOutputDir,
};
