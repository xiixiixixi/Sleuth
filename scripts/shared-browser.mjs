#!/usr/bin/env node
/**
 * shared-browser.mjs — 多 Agent 共用默认 agent-browser 连接的动作级协调器
 *
 * 调用者只提交一条浏览器命令。脚本在命令执行期间取得短锁，自动选回
 * 调用者自己的标签页，把命令与 URL/标题核验放进同一批次，然后释放锁。
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const HELP = `用法：
  node scripts/shared-browser.mjs exec --owner <id> --tab <label> -- <browser-command>
  node scripts/shared-browser.mjs status [--json]

说明：
  exec   只在这一条浏览器命令期间排队；自动选择自己的标签并核验最终 URL/标题
  status 只读查看当前是否有浏览器命令正在执行

环境变量：
  SLEUTH_CDP_PORT  同次 full 检查返回的端口
  SLEUTH_CDP_WS    同次 full 检查返回的完整本机 WebSocket 地址`;

const CONTROL_DIR = path.join(os.homedir(), '.sleuth', 'shared-browser-control');
const LOCK_DIR = path.join(CONTROL_DIR, 'lock');
const LOCK_META = path.join(LOCK_DIR, 'owner.json');
const SAFE_AGENT_BROWSER_CONFIG = path.join(CONTROL_DIR, 'agent-browser.json');
const LOCK_WAIT_MS = positiveInteger(process.env.SLEUTH_SHARED_BROWSER_WAIT_MS, 30000);
const LOCK_POLL_MS = positiveInteger(process.env.SLEUTH_SHARED_BROWSER_POLL_MS, 40);
const COMMAND_TIMEOUT_MS = positiveInteger(process.env.SLEUTH_BROWSER_COMMAND_TIMEOUT_MS, 120000);

const FORBIDDEN_FLAGS = new Set([
  '--auto-connect',
  '--args',
  '--cdp',
  '--config',
  '--enable',
  '--engine',
  '--executable-path',
  '--extension',
  '--headed',
  '--idle-timeout',
  '--init-script',
  '--namespace',
  '--new-tab',
  '--profile',
  '--provider',
  '--restore',
  '--restore-check-fn',
  '--restore-check-text',
  '--restore-check-url',
  '--restore-save',
  '--session',
  '--session-name',
  '--state',
]);
const UNSAFE_AGENT_BROWSER_ENV = [
  'AGENT_BROWSER_ARGS',
  'AGENT_BROWSER_AUTO_CONNECT',
  'AGENT_BROWSER_CDP',
  'AGENT_BROWSER_CONFIG',
  'AGENT_BROWSER_ENABLE',
  'AGENT_BROWSER_ENGINE',
  'AGENT_BROWSER_EXECUTABLE_PATH',
  'AGENT_BROWSER_EXTENSIONS',
  'AGENT_BROWSER_HEADED',
  'AGENT_BROWSER_IDLE_TIMEOUT_MS',
  'AGENT_BROWSER_INIT_SCRIPTS',
  'AGENT_BROWSER_NAMESPACE',
  'AGENT_BROWSER_PROFILE',
  'AGENT_BROWSER_PROVIDER',
  'AGENT_BROWSER_RESTORE',
  'AGENT_BROWSER_SESSION',
  'AGENT_BROWSER_SESSION_NAME',
  'AGENT_BROWSER_STATE',
];
const FORBIDDEN_COMMANDS = new Set([
  'auth',
  'batch',
  'chat',
  'close',
  'connect',
  'cookies',
  'dashboard',
  'doctor',
  'install',
  'mcp',
  'plugin',
  'profiles',
  'session',
  'state',
  'storage',
  'upgrade',
]);

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  const action = argv[0];
  if (!action || action === '--help' || action === '-h') return { action: 'help' };
  if (!['exec', 'status'].includes(action)) fail('shared-browser 只支持 exec 或 status；没有 acquire/release 任务级接口');

  if (action === 'status') {
    const unknown = argv.slice(1).filter((arg) => arg !== '--json');
    if (unknown.length) fail(`status 不支持参数：${unknown.join(', ')}`);
    return { action, json: argv.includes('--json') };
  }

  const separator = argv.indexOf('--');
  if (separator < 0) fail('exec 必须用 -- 分隔浏览器命令');
  const optionArgs = argv.slice(1, separator);
  const command = argv.slice(separator + 1);
  const values = {};
  for (let i = 0; i < optionArgs.length; i += 2) {
    const flag = optionArgs[i];
    const value = optionArgs[i + 1];
    if (!['--owner', '--tab'].includes(flag) || !value) fail(`exec 参数错误：${flag || '(empty)'}`);
    values[flag.slice(2)] = value;
  }
  if (!values.owner) fail('exec 缺少 --owner');
  if (!values.tab) fail('exec 缺少 --tab');
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(values.owner)) fail('--owner 只允许字母、数字、点、横线和下划线');
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(values.tab)) fail('--tab 只允许字母、数字、点、横线和下划线');
  if (!command.length) fail('exec 的 -- 后必须有一条浏览器命令');
  validateBrowserCommand(command, values.tab);
  return { action, ...values, command };
}

function validateBrowserCommand(command, ownTab) {
  for (const arg of command) {
    const forbiddenFlag = [...FORBIDDEN_FLAGS].find((flag) => arg === flag || arg.startsWith(`${flag}=`));
    if (forbiddenFlag) fail(`共享浏览器命令禁止使用 ${forbiddenFlag}`);
    if (/^@e\d+$/.test(arg)) {
      fail('共享浏览器禁止跨命令复用 @eN；请使用稳定选择器或单命令 find，避免切换标签后误操作');
    }
  }

  const name = command[0];
  if (FORBIDDEN_COMMANDS.has(name)) fail(`共享浏览器命令禁止直接使用 ${name}`);
  if (name === 'eval' && command.slice(1).some((arg) => /window\s*\.\s*open\s*\(/i.test(arg))) {
    fail('共享浏览器命令禁止用 window.open 新建无归属标签；先读取链接地址，再在自己的标签执行 open');
  }
  if (name !== 'tab') return;
  if (command[1] !== 'close') fail('tab 的选择和创建由 shared-browser 自动完成，调用者不能自行切换标签');
  if (command.length !== 3 || command[2] !== ownTab) fail('调用者只能关闭自己的标签');
}

function resolveCdpTarget() {
  const port = process.env.SLEUTH_CDP_PORT || '';
  const wsUrl = process.env.SLEUTH_CDP_WS || '';
  if (!port || !wsUrl) fail('BROWSER_CONTROL_REQUIRED: 缺少同次 full 检查的端口或完整调试地址', 1);
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    fail('BROWSER_CONTROL_REQUIRED: SLEUTH_CDP_PORT 不是有效端口', 1);
  }

  let parsed;
  try { parsed = new URL(wsUrl); }
  catch { fail('BROWSER_CONTROL_REQUIRED: SLEUTH_CDP_WS 不是完整本机调试地址', 1); }
  if (
    parsed.protocol !== 'ws:'
    || parsed.hostname !== '127.0.0.1'
    || parsed.port !== port
    || parsed.username
    || parsed.password
    || !/^\/devtools\/browser\/[A-Za-z0-9._-]+$/.test(parsed.pathname)
    || parsed.search
    || parsed.hash
  ) fail('BROWSER_CONTROL_REQUIRED: 完整调试地址必须是端口一致的本机浏览器级地址', 1);
  return { port, wsUrl };
}

function readLock() {
  try {
    return JSON.parse(readFileSync(LOCK_META, 'utf8'));
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function acquireLock(owner, tab) {
  mkdirSync(CONTROL_DIR, { recursive: true });
  const token = randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (true) {
    try {
      mkdirSync(LOCK_DIR);
      const metadata = {
        owner,
        tab,
        pid: process.pid,
        token,
        started_at: new Date().toISOString(),
      };
      writeFileSync(LOCK_META, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
      return metadata;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) {
        const current = readLock();
        if (!current || !isProcessAlive(current.pid)) {
          throw new Error('BROWSER_BUSY: 上一次协调器可能异常退出；为避免与仍在运行的孤儿浏览器命令重叠，残留锁禁止自动强拆');
        }
        const description = current ? `${current.owner}（进程 ${current.pid}）` : '未知调用者';
        throw new Error(`BROWSER_BUSY: ${description} 的当前浏览器命令尚未结束`);
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
}

function releaseLock(metadata) {
  const current = readLock();
  if (current?.token !== metadata.token) return;
  try { rmSync(LOCK_DIR, { recursive: true }); }
  catch { /* 锁已被安全回收时无需重复处理 */ }
}

function browserArgs(target) {
  return [
    '--cdp', target.wsUrl,
    '--idle-timeout', '0',
    '--config', SAFE_AGENT_BROWSER_CONFIG,
  ];
}

function runAgentBrowser(target, command, input) {
  mkdirSync(CONTROL_DIR, { recursive: true });
  writeFileSync(SAFE_AGENT_BROWSER_CONFIG, '{}\n', { encoding: 'utf8', mode: 0o600 });
  const childEnv = { ...process.env };
  for (const key of UNSAFE_AGENT_BROWSER_ENV) delete childEnv[key];
  return spawnSync('agent-browser', [...browserArgs(target), ...command], {
    encoding: 'utf8',
    input,
    maxBuffer: 16 * 1024 * 1024,
    timeout: COMMAND_TIMEOUT_MS,
    env: childEnv,
  });
}

function commandFailureText(result) {
  if (result.error?.code === 'ENOENT') return 'agent-browser CLI 不存在，请先运行 full 检查自动安装或升级';
  if (result.error?.code === 'ETIMEDOUT') return 'agent-browser 命令超时';
  return String(result.stderr || result.error?.message || `退出码 ${result.status}`).trim();
}

function looksLikeConnectionFailure(message) {
  return /CDP|WebSocket|socket|connect|connection|browser.*(?:closed|disconnected)|ECONNREFUSED/i.test(message);
}

function listTabs(target) {
  const listed = runAgentBrowser(target, ['tab', '--json']);
  if (listed.status !== 0) {
    throw new Error(`BROWSER_CONTROL_REQUIRED: 无法读取现有 Chrome 标签列表：${commandFailureText(listed)}`);
  }
  try {
    const tabs = JSON.parse(listed.stdout)?.data?.tabs;
    if (!Array.isArray(tabs)) throw new Error('missing tabs');
    return tabs;
  } catch {
    throw new Error('BROWSER_CONTROL_REQUIRED: agent-browser 返回了无法核验的标签列表');
  }
}

function ensureOwnTab(target, tab) {
  let matches = listTabs(target).filter((item) => item?.label === tab);
  if (matches.length > 1) {
    throw new Error(`BROWSER_CONTROL_REQUIRED: 任务标签 ${tab} 不唯一，禁止猜测要操作哪一页`);
  }
  if (matches.length === 0) {
    const created = runAgentBrowser(target, ['tab', 'new', '--label', tab]);
    if (created.status !== 0) {
      throw new Error(`BROWSER_CONTROL_REQUIRED: 无法连接现有 Chrome 或创建任务标签：${commandFailureText(created)}`);
    }
    matches = listTabs(target).filter((item) => item?.label === tab);
    if (matches.length !== 1) {
      throw new Error(`BROWSER_CONTROL_REQUIRED: 创建后的任务标签 ${tab} 数量异常，禁止继续操作`);
    }
  }

  const selected = runAgentBrowser(target, ['tab', tab]);
  if (selected.status !== 0) {
    throw new Error(`BROWSER_CONTROL_REQUIRED: 选择任务标签失败，禁止误建新标签：${commandFailureText(selected)}`);
  }
}

function executeBrowserCommand(target, owner, tab, command) {
  ensureOwnTab(target, tab);
  const closesOwnTab = command[0] === 'tab' && command[1] === 'close';
  const batch = closesOwnTab
    ? [['tab', tab], command]
    : [['tab', tab], command, ['tab', tab], ['get', 'url'], ['get', 'title']];
  const result = runAgentBrowser(target, ['batch', '--bail', '--json'], JSON.stringify(batch));
  if (result.status !== 0) {
    const detail = commandFailureText(result);
    const prefix = looksLikeConnectionFailure(detail) ? 'BROWSER_CONTROL_REQUIRED' : '浏览器命令失败';
    throw new Error(`${prefix}: ${detail}`);
  }

  let browserResults;
  try { browserResults = JSON.parse(result.stdout); }
  catch { browserResults = result.stdout.trim(); }
  console.log(JSON.stringify({
    ok: true,
    owner,
    tab,
    browser_results: browserResults,
  }, null, 2));
}

function printStatus(json) {
  const metadata = readLock();
  const locked = Boolean(metadata && isProcessAlive(metadata.pid));
  const lockExists = existsSync(LOCK_DIR);
  const result = {
    locked,
    owner: locked ? metadata.owner : null,
    tab: locked ? metadata.tab : null,
    pid: locked ? metadata.pid : null,
    started_at: locked ? metadata.started_at : null,
    stale: lockExists && !locked,
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.stale) console.log('检测到残留保护锁，需要人工核查；为避免抢页不会自动强拆');
  else console.log(locked ? `浏览器命令执行中：${result.owner}` : '当前没有浏览器命令占用短锁');
}

const parsed = parseArgs(process.argv.slice(2));
if (parsed.action === 'help') {
  console.log(HELP);
} else if (parsed.action === 'status') {
  printStatus(parsed.json);
} else {
  const target = resolveCdpTarget();
  let lock;
  let executionError;
  try {
    lock = await acquireLock(parsed.owner, parsed.tab);
    executeBrowserCommand(target, parsed.owner, parsed.tab, parsed.command);
  } catch (error) {
    executionError = error;
  } finally {
    if (lock) releaseLock(lock);
  }
  if (executionError) {
    console.error(executionError.message);
    process.exitCode = 1;
  }
}
