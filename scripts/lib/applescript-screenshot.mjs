import { execSync } from 'node:child_process';
import os from 'node:os';

/**
 * 用 macOS screencapture 截取 Chrome 前端窗口。
 * @param {string} outputPath - 输出文件路径
 * @returns {Promise<string>} 输出文件路径
 */
export async function screenshot(outputPath) {
  if (os.platform() !== 'darwin') {
    throw new Error('screencapture only available on macOS');
  }
  const windowId = execSync(
    `osascript -e 'tell application "Google Chrome" to id of front window'`,
    { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
  execSync(`screencapture -l${windowId} -x "${outputPath}"`, {
    timeout: 10000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return outputPath;
}
