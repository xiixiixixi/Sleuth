import { execSync } from 'node:child_process';
import os from 'node:os';

/**
 * 检测 macOS 上 Chrome 的 "Allow JavaScript from Apple Events" 是否开启。
 *
 * 机制：尝试用 osascript 对 Chrome 执行一条无害 JS。
 * - 成功 → AppleScript 可用，Chrome 允许 JS 执行
 * - 失败（exit code 非 0）→ 要么不是 macOS，要么没开 "Allow JS from Apple Events"
 *
 * @returns {Promise<boolean>}
 */
export async function isAppleScriptAvailable() {
  if (os.platform() !== 'darwin') return false;

  try {
    const result = execSync(
      `osascript -e 'tell application "Google Chrome" to execute javascript "1+1" in active tab of front window'`,
      { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return result !== '';
  } catch {
    return false;
  }
}
