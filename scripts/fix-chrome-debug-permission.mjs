#!/usr/bin/env node
/**
 * fix-chrome-debug-permission.mjs — 一键安装 Chrome 企业策略
 * RemoteDebuggingAllowed = true，压住 Chrome 144+ 的「要允许远程调试吗?」弹窗。
 *
 * Chrome 144+ 每次有程序通过调试端口连日常 Chrome 都会弹许可框。
 * sleuth 需要带着用户登录态操作浏览器，必须连日常 Chrome，
 * 所以每个 Chrome 144+ 用户都需要安装这个策略。
 *
 * 支持 macOS / Linux / Windows。
 * 零 npm 依赖，只用系统自带工具（osascript / pkexec / PowerShell）。
 *
 * 用法：
 *   node scripts/fix-chrome-debug-permission.mjs            # 安装策略
 *   node scripts/fix-chrome-debug-permission.mjs --check     # 只检测不安装
 *   node scripts/fix-chrome-debug-permission.mjs --uninstall # 卸载策略
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
const POLICY_PATHS = {
  darwin: '/Library/Managed Preferences/com.google.Chrome.plist',
  linux:  '/etc/opt/chrome/policies/managed/sleuth-remote-debug.json',
  // Windows 走注册表，不用文件
};

// 策略文件内容（按平台）
const POLICY_CONTENT = {
  darwin: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>RemoteDebuggingAllowed</key>
    <true/>
</dict>
</plist>`,
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
      const content = run(`defaults read "${POLICY_PATHS.darwin}" 2>/dev/null`);
      if (content && content.includes('RemoteDebuggingAllowed')) {
        return { installed: true, detail: `${POLICY_PATHS.darwin}（值 = 1）` };
      }
      return { installed: false, detail: '策略文件不存在或内容缺失' };
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

function installMacOS() {
  const plistPath = POLICY_PATHS.darwin;
  const plistContent = POLICY_CONTENT.darwin;
  const dir = path.dirname(plistPath);   // /Library/Managed Preferences

  // 写到临时文件（当前用户能写的位置）
  const tmpFile = path.join(HOME, '.sleuth', '_chrome-policy.plist');
  fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
  fs.writeFileSync(tmpFile, plistContent, 'utf8');

  // 用 osascript with administrator privileges 弹系统密码框
  // 把临时文件拷到目标位置 + 改权限，全程一步到位
  const script = `do shell script "mkdir -p '${dir}' && cp '${tmpFile}' '${plistPath}' && chown root:wheel '${plistPath}' && chmod 644 '${plistPath}' && rm -f '${tmpFile}'" with administrator privileges`;

  log('  → 系统会弹一个密码框，请输入你的开机密码...');
  const result = run(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 120000 });

  if (result === null) {
    // osascript 失败——可能是用户取消了密码框，或密码错误
    // 清理临时文件
    try { fs.unlinkSync(tmpFile); } catch {}
    err('✗ 安装失败。可能的原因：密码输入错误 / 点击了取消。');
    err('  可以手动跑这条命令（需要 sudo）：');
    err(`  sudo mkdir -p '${dir}' && sudo cp '${tmpFile}' '${plistPath}' && sudo chown root:wheel '${plistPath}' && sudo chmod 644 '${plistPath}'`);
    process.exit(1);
  }

  log(`✓ 策略已安装到 ${plistPath}`);
}

function uninstallMacOS() {
  const plistPath = POLICY_PATHS.darwin;
  const script = `do shell script "rm -f '${plistPath}'" with administrator privileges`;

  log('  → 系统会弹一个密码框，请输入你的开机密码...');
  const result = run(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 120000 });

  if (result === null) {
    err('✗ 卸载失败。可能的原因：密码输入错误 / 点击了取消。');
    process.exit(1);
  }

  log(`✓ 策略已删除：${plistPath}`);
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
  log('安装 Chrome 远程调试策略 (RemoteDebuggingAllowed = true)');
  log('作用：压住 Chrome 144+ 的「要允许远程调试吗?」弹窗');
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
  log('⚠ 重要：需要完全重启 Chrome 才能生效。');
  log('  1. 完全退出 Chrome（macOS: Cmd+Q / Windows: 关闭所有窗口 / Linux: 退出进程）');
  log('  2. 重新打开 Chrome');
  log('  3. 打开 chrome://policy 确认 RemoteDebuggingAllowed 显示为 true / 正常');
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
  log('作用：安装 Chrome 企业策略 RemoteDebuggingAllowed = true，');
  log('      压住 Chrome 144+ 的「要允许远程调试吗?」弹窗。');
  log('      macOS 用 osascript / Linux 用 pkexec / Windows 用 UAC 弹密码框。');
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
    log(`✓ 已安装：${detail}`);
    log('  Chrome 144+ 的调试弹窗应该已被压住。');
  } else {
    log(`✗ 未安装：${detail}`);
    log('  Chrome 144+ 用户连日常 Chrome 时会反复弹「要允许远程调试吗?」');
    log('  跑 node scripts/fix-chrome-debug-permission.mjs 安装策略。');
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
  log(`✓ 策略已安装（${detail}），无需重复安装。`);
  log('  如需卸载：node scripts/fix-chrome-debug-permission.mjs --uninstall');
  process.exit(0);
}

install();
