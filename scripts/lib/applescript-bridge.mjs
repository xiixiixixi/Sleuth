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

/**
 * 点击匹配选择器的元素。
 * @param {string} selector - CSS 选择器
 * @returns {Promise<string>} 'clicked' | 'not_found'
 */
export async function clickViaJS(selector) {
  return execJS(`
    (function() {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'not_found';
      el.click();
      return 'clicked';
    })()
  `);
}

/**
 * 填充输入框。
 * @param {string} selector - CSS 选择器
 * @param {string} value - 填入的值
 * @returns {Promise<string>} 'filled' | 'not_found'
 */
export async function fillViaJS(selector, value) {
  const escapedValue = JSON.stringify(value);
  return execJS(`
    (function() {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'not_found';
      el.value = ${escapedValue};
      el.dispatchEvent(new Event('input', {bubbles: true}));
      el.dispatchEvent(new Event('change', {bubbles: true}));
      return 'filled';
    })()
  `);
}

/**
 * 滚动页面。
 * @param {number} x - 水平像素
 * @param {number} y - 垂直像素
 * @returns {Promise<void>}
 */
export async function scrollViaJS(x = 0, y = 500) {
  await execJS(`window.scrollBy(${x}, ${y})`);
}

/**
 * 导航到 URL（在当前标签页）。
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function navigate(url) {
  await execJS(`location.href = ${JSON.stringify(url)}`);
}

/**
 * 提取页面的交互元素树（agent-browser snapshot 的 AppleScript 近似版）。
 * @returns {Promise<string>} JSON 字符串
 */
export async function pseudoSnapshot() {
  return execJS(`
    (function() {
      var interactive = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [onclick]';
      var els = document.querySelectorAll(interactive);
      var results = [];
      for (var i = 0; i < els.length && i < 200; i++) {
        var el = els[i];
        var rect = el.getBoundingClientRect();
        var visible = rect.width > 0 && rect.height > 0 && el.offsetParent !== null;
        if (!visible) continue;
        var selector = el.id ? '#' + el.id : el.className ? el.tagName.toLowerCase() + '.' + el.className.split(' ')[0] : el.tagName.toLowerCase();
        var text = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().slice(0, 80);
        results.push({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || '',
          text: text,
          href: el.getAttribute('href') || '',
          selector: selector,
          type: el.getAttribute('type') || ''
        });
      }
      return JSON.stringify(results);
    })()
  `);
}

