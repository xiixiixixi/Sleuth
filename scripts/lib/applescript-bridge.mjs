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
    // Chrome 149+ 的 AppleScript 字典要求嵌套 tell 格式，
    // 单行 'execute javascript "..." in active tab' 会报 -1723。
    const result = execSync(`osascript -e '
      tell application "Google Chrome"
        tell front window
          tell active tab
            execute javascript "1+1"
          end tell
        end tell
      end tell'`, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return result !== '';
  } catch {
    return false;
  }
}

/**
 * 在 Chrome 当前活跃标签页执行 JS，返回结果字符串。
 * @param {string} js - JavaScript 代码
 * @returns {Promise<string>}
 */
export async function execJS(js) {
  const escapedJs = js.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  // Chrome 149+ 要求嵌套 tell 格式（单行 'in active tab' 报 -1723）
  const script = `tell application "Google Chrome"
    tell front window
      tell active tab
        execute javascript "${escapedJs}"
      end tell
    end tell
  end tell`;
  return execSync(`osascript -e '${script.replace(/'/g, "'\\\\''")}'`, {
    encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/**
 * 列出 Chrome 所有窗口的所有标签页。
 * @returns {Promise<Array<{url: string, title: string}>>}
 */
export async function listTabs() {
  const script = `tell application "Google Chrome"
    set output to ""
    repeat with w in windows
      repeat with t in tabs of w
        set output to output & (URL of t) & "\\t" & (title of t) & "\\n"
      end repeat
    end repeat
    return output
  end tell`;
  const raw = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map(line => {
    const [url, ...titleParts] = line.split('\t');
    return { url: url || '', title: titleParts.join('\t') || '' };
  });
}

/**
 * 在 Chrome 打开 URL（新窗口或当前窗口）。
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function openTab(url) {
  const script = `tell application "Google Chrome" to open location "${url}"`;
  execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
