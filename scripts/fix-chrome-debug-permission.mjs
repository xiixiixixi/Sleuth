#!/usr/bin/env node
/**
 * fix-chrome-debug-permission.mjs — 检查或设置 Chrome 远程调试许可。
 *
 * 重要：这个配置只表示允许进入远程调试流程，不会自动批准每个新连接。
 * Chrome 144+ 对新调试连接仍可能弹一次授权框；同一连接内反复弹才异常。
 * Sleuth 研究主流程不自动运行本脚本，只引导用户在现有登录态 Chrome
 * 打开 chrome://inspect/#remote-debugging。
 *
 * 平台方案（2026-07-14 更新）：
 *   macOS  → Chrome Local State: devtools.remote_debugging.user-enabled = true
 *            （旧方案写 /Library/Managed Preferences/ plist 在 macOS 26 失效——
 *             cfprefsd 重启清文件；profiles install 命令也被禁。改走用户配置。）
 *            前提：Chrome 必须关闭（在跑时改会被覆盖回去）。不需要 sudo。
 *   Linux  → /etc/opt/chrome/policies/managed/ 企业策略 JSON（pkexec 提权）
 *   Windows → 注册表 HKLM\SOFTWARE\Policies\Google\Chrome（UAC 提权）
 *
 * 用法：
 *   node scripts/fix-chrome-debug-permission.mjs            # 安装（macOS 需先关 Chrome）
 *   node scripts/fix-chrome-debug-permission.mjs --check     # 只检测
 *   node scripts/fix-chrome-debug-permission.mjs --uninstall # 卸载
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';

// ── 平台常量 ────────────────────────────────────────────────

const PLATFORM = process.platform;        // 'darwin' | 'linux' | 'win32'
const HOME     = os.homedir();

// Chrome 策略文件路径（按平台）
// macOS 不用固定路径——走 profiles 命令管理 .mobileconfig 描述文件
const POLICY_PATHS = {
  linux:  '/etc/opt/chrome/policies/managed/sleuth-remote-debug.json',
  // Windows 走注册表，不用文件
};

// Chrome 策略内容（按平台）
// macOS 方案变更（2026-07-14）：
//   旧方案（写 /Library/Managed Preferences/ plist）在 macOS 26 失效——
//   cfprefsd 守护进程重启后清理手动放入的文件；profiles install 命令也被禁。
//   新方案：设置 Chrome 用户级 Local State 里的
//   devtools.remote_debugging.user-enabled = true。
//   这个值存在 ~/Library/Application Support/Google/Chrome/Local State，
//   不受 cfprefsd 管，重启不丢，不需要 sudo。
//   前提：Chrome 必须关闭（在跑时改会被 Chrome 覆盖回去）。
const CHROME_LOCAL_STATE_REL = 'Library/Application Support/Google/Chrome/Local State';

const POLICY_CONTENT = {
  linux: `{
  "RemoteDebuggingAllowed": true
}`,
};

// ── 工具函数 ────────────────────────────────────────────────

function log(msg) { console.log(msg); }
function err(msg) { console.error(msg); }

/**
 * 执行命令，返回 stdout（失败返回 null）。
 */
function run(cmd, options = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
      ...options,
    }).trim();
  } catch {
    return null;
  }
}

// ── 幂等检测 ────────────────────────────────────────────────

/**
 * 检测策略是否已安装。
 * @returns {{ installed: boolean, detail: string }}
 */
function checkInstalled() {
  switch (PLATFORM) {
    case 'darwin': {
      // 查 Chrome Local State 里的 devtools.remote_debugging.user-enabled
      const lsPath = path.join(HOME, CHROME_LOCAL_STATE_REL);
      if (!fs.existsSync(lsPath)) {
        return { installed: false, detail: 'Chrome Local State 文件不存在（Chrome 没装过？）' };
      }
      try {
        const ls = JSON.parse(fs.readFileSync(lsPath, 'utf8'));
        const enabled = ls?.devtools?.remote_debugging?.['user-enabled'];
        if (enabled === true) {
          return { installed: true, detail: 'Chrome Local State: devtools.remote_debugging.user-enabled = true' };
        }
        return { installed: false, detail: 'Local State 里 user-enabled 不是 true' };
      } catch {
        return { installed: false, detail: 'Chrome Local State 不是有效 JSON' };
      }
    }
    case 'linux': {
      if (fs.existsSync(POLICY_PATHS.linux)) {
        const content = fs.readFileSync(POLICY_PATHS.linux, 'utf8');
        if (content.includes('"RemoteDebuggingAllowed"')) {
          return { installed: true, detail: POLICY_PATHS.linux };
        }
      }
      return { installed: false, detail: '策略文件不存在' };
    }
    case 'win32': {
      const reg = run('reg query "HKLM\\SOFTWARE\\Policies\\Google\\Chrome" /v RemoteDebuggingAllowed 2>nul');
      if (reg && reg.includes('0x1')) {
        return { installed: true, detail: '注册表 HKLM\\SOFTWARE\\Policies\\Google\\Chrome\\RemoteDebuggingAllowed = 1' };
      }
      return { installed: false, detail: '注册表项不存在' };
    }
    default:
      return { installed: false, detail: `不支持的平台: ${PLATFORM}` };
  }
}

// ── macOS 安装 ──────────────────────────────────────────────

function isChromeRunning() {
  return run('pgrep -f "Google Chrome.app/Contents/MacOS/Google Chrome"') !== null;
}

function installMacOS() {
  // 前置检查：Chrome 必须关闭（在跑时改 Local State 会被 Chrome 覆盖回去）
  if (isChromeRunning()) {
    err('✗ Chrome 正在运行。改 Local State 必须先关闭 Chrome（否则改动会被覆盖回去）。');
    err('  1. 完全退出 Chrome（Cmd+Q）');
    err('  2. 再跑本脚本');
    process.exit(1);
  }

  const lsPath = path.join(HOME, CHROME_LOCAL_STATE_REL);
  if (!fs.existsSync(lsPath)) {
    err(`✗ Chrome Local State 不存在：${lsPath}`);
    err('  可能 Chrome 从没启动过。先打开一次 Chrome 再跑本脚本。');
    process.exit(1);
  }

  // 读 + 改 + 写 Local State（JSON 操作，不需要 sudo）
  let ls;
  try {
    ls = JSON.parse(fs.readFileSync(lsPath, 'utf8'));
  } catch {
    err(`✗ Chrome Local State 不是有效 JSON：${lsPath}`);
    err('  先备份该文件，再删掉让它重新生成。');
    process.exit(1);
  }

  // 备份原文件（防写坏）
  const bakPath = lsPath + '.sleuth-bak';
  try {
    fs.copyFileSync(lsPath, bakPath);
  } catch {}

  // 设置 devtools.remote_debugging.user-enabled = true
  if (!ls.devtools) ls.devtools = {};
  if (!ls.devtools.remote_debugging) ls.devtools.remote_debugging = {};
  ls.devtools.remote_debugging['user-enabled'] = true;

  try {
    fs.writeFileSync(lsPath, JSON.stringify(ls, null, 2), 'utf8');
  } catch (e) {
    err(`✗ 写 Local State 失败：${e.message}`);
    err(`  原文件已备份到 ${bakPath}`);
    process.exit(1);
  }

  log(`✓ 已设置 Chrome Local State: devtools.remote_debugging.user-enabled = true`);
  log(`  原文件备份：${bakPath}`);
  log('  这个值存在用户配置目录，重启不丢，不需要 sudo。');
}

function uninstallMacOS() {
  if (isChromeRunning()) {
    err('✗ Chrome 正在运行。改 Local State 必须先关闭 Chrome。');
    err('  完全退出 Chrome（Cmd+Q）后再跑本脚本。');
    process.exit(1);
  }

  const lsPath = path.join(HOME, CHROME_LOCAL_STATE_REL);
  if (!fs.existsSync(lsPath)) {
    log('Chrome Local State 不存在，无需卸载。');
    process.exit(0);
  }

  let ls;
  try {
    ls = JSON.parse(fs.readFileSync(lsPath, 'utf8'));
  } catch {
    err(`✗ Chrome Local State 不是有效 JSON，无法卸载。`);
    process.exit(1);
  }

  if (ls?.devtools?.remote_debugging?.['user-enabled'] !== true) {
    log('user-enabled 不是 true，无需卸载。');
    process.exit(0);
  }

  ls.devtools.remote_debugging['user-enabled'] = false;
  try {
    fs.writeFileSync(lsPath, JSON.stringify(ls, null, 2), 'utf8');
  } catch (e) {
    err(`✗ 写 Local State 失败：${e.message}`);
    process.exit(1);
  }

  log(`✓ 已关闭 Chrome 远程调试授权（user-enabled = false）`);
}

// ── Linux 安装 ──────────────────────────────────────────────

function installLinux() {
  const jsonPath = POLICY_PATHS.linux;
  const jsonContent = POLICY_CONTENT.linux;
  const dir = path.dirname(jsonPath);    // /etc/opt/chrome/policies/managed

  // 写到临时文件
  const tmpFile = path.join(HOME, '.sleuth', '_chrome-policy.json');
  fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
  fs.writeFileSync(tmpFile, jsonContent, 'utf8');

  // 检测 pkexec 是否可用（GNOME/KDE 桌面环境自带）
  const hasPkexec = run('which pkexec 2>/dev/null');

  if (hasPkexec) {
    log('  → 系统会弹一个密码框，请输入你的开机密码...');
    const cmd = `pkexec sh -c "mkdir -p '${dir}' && cp '${tmpFile}' '${jsonPath}' && chown root:root '${jsonPath}' && chmod 644 '${jsonPath}' && rm -f '${tmpFile}'"`;
    const result = run(cmd, { timeout: 120000 });

    if (result === null) {
      try { fs.unlinkSync(tmpFile); } catch {}
      err('✗ 安装失败。可能的原因：密码输入错误 / 点击了取消。');
      err('  可以手动跑这条命令（需要 sudo）：');
      err(`  sudo mkdir -p '${dir}' && sudo cp '${tmpFile}' '${jsonPath}' && sudo chown root:root '${jsonPath}' && sudo chmod 644 '${jsonPath}'`);
      process.exit(1);
    }

    log(`✓ 策略已安装到 ${jsonPath}`);
  } else {
    // pkexec 不可用（无桌面环境 / 服务器）→ 打印命令让用户手动跑
    err('✗ 自动提权不可用（未找到 pkexec）。请手动跑以下命令：');
    err('');
    err(`  sudo mkdir -p '${dir}'`);
    err(`  sudo cp '${tmpFile}' '${jsonPath}'`);
    err(`  sudo chown root:root '${jsonPath}'`);
    err(`  sudo chmod 644 '${jsonPath}'`);
    err('');
    err(`（临时文件在 ${tmpFile}，安装成功后可删）`);
    process.exit(1);
  }
}

function uninstallLinux() {
  const jsonPath = POLICY_PATHS.linux;
  const hasPkexec = run('which pkexec 2>/dev/null');

  if (hasPkexec) {
    log('  → 系统会弹一个密码框，请输入你的开机密码...');
    const result = run(`pkexec rm -f '${jsonPath}'`, { timeout: 120000 });

    if (result === null) {
      err('✗ 卸载失败。');
      process.exit(1);
    }
    log(`✓ 策略已删除：${jsonPath}`);
  } else {
    err('✗ 自动提权不可用。请手动跑：');
    err(`  sudo rm -f '${jsonPath}'`);
    process.exit(1);
  }
}

// ── Windows 安装 ────────────────────────────────────────────

function installWindows() {
  // 用 PowerShell Start-Process -Verb RunAs 弹 UAC 提权框
  const psScript = `Start-Process reg -ArgumentList 'add','HKLM\\SOFTWARE\\Policies\\Google\\Chrome','/v','RemoteDebuggingAllowed','/t','REG_DWORD','/d','1','/f' -Verb RunAs -Wait`;

  log('  → 系统会弹一个 UAC 提权框，点击「是」...');
  const result = run(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, { timeout: 120000 });

  if (result === null) {
    err('✗ 安装失败。可能的原因：UAC 被拒绝 / 权限不足。');
    err('  可以手动以管理员身份打开 PowerShell，跑：');
    err('  reg add "HKLM\\SOFTWARE\\Policies\\Google\\Chrome" /v RemoteDebuggingAllowed /t REG_DWORD /d 1 /f');
    process.exit(1);
  }

  log('✓ 策略已写入注册表 HKLM\\SOFTWARE\\Policies\\Google\\Chrome\\RemoteDebuggingAllowed = 1');
}

function uninstallWindows() {
  const psScript = `Start-Process reg -ArgumentList 'delete','HKLM\\SOFTWARE\\Policies\\Google\\Chrome','/v','RemoteDebuggingAllowed','/f' -Verb RunAs -Wait`;

  log('  → 系统会弹一个 UAC 提权框，点击「是」...');
  const result = run(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, { timeout: 120000 });

  if (result === null) {
    err('✗ 卸载失败。');
    process.exit(1);
  }
  log('✓ 注册表项已删除');
}

// ── 安装入口 ────────────────────────────────────────────────

function install() {
  log('');
  log('设置 Chrome 远程调试许可');
  log('作用：允许进入远程调试流程；新连接仍可能需要用户确认一次');
  log('');

  switch (PLATFORM) {
    case 'darwin':
      installMacOS();
      break;
    case 'linux':
      installLinux();
      break;
    case 'win32':
      installWindows();
      break;
    default:
      err(`✗ 不支持的平台: ${PLATFORM}`);
      process.exit(1);
  }

  log('');
  if (PLATFORM === 'darwin') {
    log('⚠ 现在重新打开 Chrome 即可生效（Local State 已改好）。');
    log('  macOS 方案不显示在 chrome://policy 页面（那是企业策略页，用户配置不在那）。');
    log('  验证方式：重新打开 Chrome 后运行 full 检查；新连接仍可能弹一次授权确认。');
  } else {
    log('⚠ 重要：需要完全重启 Chrome 才能生效。');
    log('  1. 完全退出 Chrome（Windows: 关闭所有窗口 / Linux: 退出进程）');
    log('  2. 重新打开 Chrome');
    log('  3. 打开 chrome://policy 确认 RemoteDebuggingAllowed 显示为 true / 正常');
  }
  log('');
  log('如需卸载：node scripts/fix-chrome-debug-permission.mjs --uninstall');
}

function uninstall() {
  log('');
  log('卸载 Chrome 远程调试策略');
  log('');

  switch (PLATFORM) {
    case 'darwin':
      uninstallMacOS();
      break;
    case 'linux':
      uninstallLinux();
      break;
    case 'win32':
      uninstallWindows();
      break;
    default:
      err(`✗ 不支持的平台: ${PLATFORM}`);
      process.exit(1);
  }

  log('');
  log('⚠ 需要完全重启 Chrome 才能生效。');
}

// ── 参数解析 ────────────────────────────────────────────────

const args = process.argv.slice(2);
const isCheck = args.includes('--check') || args.includes('-c');
const isUninstall = args.includes('--uninstall') || args.includes('-u');
const isHelp = args.includes('--help') || args.includes('-h');

if (isHelp) {
  log('用法：');
  log('  node scripts/fix-chrome-debug-permission.mjs             安装策略（弹密码框）');
  log('  node scripts/fix-chrome-debug-permission.mjs --check     只检测是否已安装');
  log('  node scripts/fix-chrome-debug-permission.mjs --uninstall 卸载策略');
  log('');
  log('作用：设置 Chrome 远程调试许可。');
  log('      这不会自动批准每个新连接；Chrome 144+ 仍可能要求确认一次。');
  log('      macOS 修改 Local State / Linux 用 pkexec / Windows 用 UAC。');
  process.exit(0);
}

// 未知参数
const unknown = args.filter(a => !['--check', '-c', '--uninstall', '-u', '--help', '-h'].includes(a));
if (unknown.length > 0) {
  err(`未知参数: ${unknown.join(', ')}`);
  err('用 --help 查看用法');
  process.exit(2);
}

// ── 主流程 ═══════════════════════════════════════════════════

if (isCheck) {
  log('');
  log('检测 Chrome 远程调试策略状态...');
  log('');
  const { installed, detail } = checkInstalled();
  if (installed) {
    log(`✓ 已允许远程调试：${detail}`);
    log('  注意：新调试连接仍可能弹一次授权确认，这属于正常安全机制。');
  } else {
    log(`✗ 尚未设置：${detail}`);
    log('  研究任务优先在现有 Chrome 打开 chrome://inspect/#remote-debugging。');
    log('  本脚本是可选的手动环境工具，不是免确认方案。');
  }
  process.exit(installed ? 0 : 1);
}

if (isUninstall) {
  const { installed } = checkInstalled();
  if (!installed) {
    log('策略未安装，无需卸载。');
    process.exit(0);
  }
  uninstall();
  process.exit(0);
}

// 默认：安装
const { installed, detail } = checkInstalled();
if (installed) {
  log('');
  log(`✓ 远程调试许可已设置（${detail}），无需重复设置。`);
  log('  新连接仍可能需要用户确认一次；本配置不等于永久批准。');
  log('  如需卸载：node scripts/fix-chrome-debug-permission.mjs --uninstall');
  process.exit(0);
}

install();
