/**
 * auth-verify.mjs — 登录态验证核心逻辑
 *
 * 设计文档：docs/browser-auth-and-channel-intelligence-plan.md § Authentication Verification
 *
 * 核心原则：
 *   - CDP 连接 ≠ 登录成功
 *   - Profile 目录存在 ≠ 登录成功
 *   - 只有页面级验证才算数（page-level verification）
 *
 * 验证器层级（按优先级）：
 *   1. site-pattern 中的 auth.verify 配置（DOM selector 验证）
 *   2. 通用登录墙检测器（generic login-wall detector）
 *   3. 用户确认（visible page inspection）
 *
 * 输出格式（文档规定）：
 *   {
 *     "domain": "example.com",
 *     "auth_state": "verified" | "not_verified" | "skipped" | "unknown",
 *     "signals": ["not_login_url", "account_menu_present"],
 *     "sensitive_values_printed": false
 *   }
 *
 * 安全约束：
 *   - 不打印用户名、邮箱、cookie、token、账号 ID
 *   - sensitive_values_printed 始终为 false
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SITE_PATTERNS_DIR = path.join(os.homedir(), '.sleuth', 'site-patterns');

// ── 站点经验 auth 配置解析 ──────────────────────────────────────────

/**
 * 从 site-pattern 文件中解析 auth 配置。
 *
 * 支持格式（YAML frontmatter 中）：
 *   auth:
 *     login_url: "https://example.com/login"
 *     verify:
 *       type: "dom"
 *       selector: "[data-testid='account-menu']"
 *
 * @param {string} domain - 目标域名
 * @returns {{login_url: string|null, verify: {type: string, selector: string}|null}|null}
 */
function parseSiteAuth(domain) {
  if (!fs.existsSync(SITE_PATTERNS_DIR)) return null;

  // 尝试精确匹配文件名
  const candidates = [
    `${domain}.md`,
    // 去掉 www. 前缀再试
    domain.startsWith('www.') ? `${domain.slice(4)}.md` : `www.${domain}.md`,
  ];

  let raw = null;
  for (const name of candidates) {
    const fp = path.join(SITE_PATTERNS_DIR, name);
    if (fs.existsSync(fp)) {
      raw = fs.readFileSync(fp, 'utf-8');
      break;
    }
  }
  if (!raw) return null;

  // 提取 YAML frontmatter
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const fm = fmMatch[1];

  // 简单解析 auth 块（避免引入 YAML 库）
  const authIdx = fm.indexOf('\nauth:');
  if (authIdx === -1 && !fm.startsWith('auth:')) return null;

  const authStart = fm.startsWith('auth:') ? 0 : authIdx + 1;
  // 找到 auth 块结束（下一个顶层 key 或文件末尾）
  const afterAuth = fm.slice(authStart + 5); // 跳过 "auth:"
  const lines = afterAuth.split('\n');

  let loginUrl = null;
  let verifyType = null;
  let verifySelector = null;

  for (const line of lines) {
    // 顶层 key（无缩进）表示 auth 块结束
    if (/^\S/.test(line) && line.trim() !== '') break;

    const loginMatch = line.match(/^\s+login_url:\s*"?([^"]+)"?\s*$/);
    if (loginMatch) loginUrl = loginMatch[1].trim();

    const typeMatch = line.match(/^\s+type:\s*"?([^"]+)"?\s*$/);
    if (typeMatch) verifyType = typeMatch[1].trim();

    const selectorMatch = line.match(/^\s+selector:\s*"?([^"]+)"?\s*$/);
    if (selectorMatch) verifySelector = selectorMatch[1].trim();
  }

  const verify = verifyType && verifySelector
    ? { type: verifyType, selector: verifySelector }
    : null;

  return { login_url: loginUrl, verify };
}

// ── 通用登录墙检测 ─────────────────────────────────────────────────

/**
 * 通过 CDP 在页面上运行通用登录墙检测。
 *
 * 检测逻辑（文档规定）：
 *   - URL 不是登录 URL（不含 /login, /signin, /auth 等路径）
 *   - 页面不显示明显的登录提示（sign in, log in 按钮等）
 *   - 存在账号菜单/头像/创建/发布/dashboard 元素
 *
 * @param {number} cdpPort - CDP 端口
 * @param {string} targetUrl - 要验证的目标 URL
 * @param {object} [siteAuth] - site-pattern auth 配置（可选）
 * @returns {Promise<{auth_state: string, signals: string[]}>}
 */
async function verifyAuth(cdpPort, targetUrl, siteAuth = null) {
  const signals = [];
  let authState = 'unknown';

  try {
    // 获取当前页面列表
    const pagesResp = await fetch(`http://127.0.0.1:${cdpPort}/json/list`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!pagesResp.ok) return { auth_state: 'unknown', signals: ['cdp_list_failed'] };

    const pages = await pagesResp.json();
    if (!pages.length) return { auth_state: 'unknown', signals: ['no_pages'] };

    // 找到目标页面：精确 URL 匹配优先，其次域名匹配；未找到则返回 unknown
    const targetDomain = extractDomain(targetUrl);
    const exactPage = pages.find(p => p.url === targetUrl);
    const domainPage = pages.find(p => p.url && extractDomain(p.url) === targetDomain);
    const targetPage = exactPage || domainPage;
    if (!targetPage) {
      return { auth_state: 'unknown', signals: ['target_domain_not_found_in_tabs'] };
    }
    const pageUrl = targetPage.url || '';

    // ── 检测 1：URL 是否为登录页面 ──
    const loginPatterns = [
      /\/login/i, /\/signin/i, /\/sign-in/i, /\/auth/i,
      /\/sso/i, /\/oauth/i, /\/cas/i, /\/account\/login/i,
      /\/session\/new/i, /\/users\/sign_in/i,
    ];

    // 如果有 site-pattern 指定的 login_url，也加入检测
    if (siteAuth?.login_url) {
      try {
        const loginPath = new URL(siteAuth.login_url).pathname;
        loginPatterns.push(new RegExp(loginPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      } catch {}
    }

    const isLoginUrl = loginPatterns.some(p => p.test(pageUrl));
    if (isLoginUrl) {
      signals.push('on_login_url');
      return { auth_state: 'not_verified', signals };
    }
    signals.push('not_login_url');

    // ── 检测 2：site-specific DOM selector（如果有配置） ──
    if (siteAuth?.verify?.type === 'dom' && siteAuth.verify.selector) {
      const selectorResult = await evalOnPage(cdpPort, targetPage, `
        !!document.querySelector(${JSON.stringify(siteAuth.verify.selector)})
      `);
      if (selectorResult === true) {
        signals.push('site_selector_found');
        authState = 'verified';
        return { auth_state: authState, signals };
      } else {
        signals.push('site_selector_missing');
        // 不直接返回 not_verified，继续通用检测
      }
    }

    // ── 检测 3：通用登录墙检测（DOM 分析） ──
    const genericResult = await evalOnPage(cdpPort, targetPage, `
      (() => {
        const signals = [];

        // 检测登录提示（sign in / log in 按钮、表单）
        const loginPrompts = document.querySelectorAll(
          'a[href*="login"], a[href*="signin"], a[href*="sign-in"], ' +
          'button[class*="login"], button[class*="signin"], ' +
          '[data-testid*="login"], [data-testid*="signin"], ' +
          'form[action*="login"], form[action*="signin"]'
        );
        // 只有大量登录提示（>=2）且无账号元素时才算登录墙
        if (loginPrompts.length >= 2) signals.push('login_prompts_present');

        // 检测账号相关元素（头像、菜单、dashboard）
        const accountSelectors = [
          '[data-testid*="account"]', '[data-testid*="avatar"]',
          '[data-testid*="profile"]', '[data-testid*="user-menu"]',
          '[class*="avatar"]', '[class*="user-menu"]', '[class*="account-menu"]',
          '[aria-label*="account"]', '[aria-label*="profile"]',
          'a[href*="/dashboard"]', 'a[href*="/settings"]',
          'a[href*="/profile"]', 'a[href*="/account"]',
          'img[alt*="avatar"]', 'img[class*="avatar"]',
        ];
        const accountFound = accountSelectors.some(s => document.querySelector(s));
        if (accountFound) signals.push('account_menu_present');

        return signals;
      })()
    `);

    if (Array.isArray(genericResult)) {
      signals.push(...genericResult);
    }

    // ── 判定最终状态 ──
    if (signals.includes('account_menu_present') && !signals.includes('login_prompts_present')) {
      authState = 'verified';
    } else if (signals.includes('login_prompts_present') && !signals.includes('account_menu_present')) {
      authState = 'not_verified';
    } else {
      // Level 3：无法自动判定（可能是公开页面、无明显登录元素）
      // 文档规定有效状态为 verified | not_verified | skipped | unknown
      authState = 'unknown';
      signals.push('level3_ambiguous');
    }

  } catch (err) {
    signals.push('verification_error');
    authState = 'unknown';
  }

  return { auth_state: authState, signals };
}

// ── CDP 页面 eval 辅助 ──────────────────────────────────────────────

/**
 * 在指定页面上执行 JavaScript 表达式。
 *
 * @param {number} cdpPort
 * @param {object} page - /json/list 返回的页面对象（需要 webSocketDebuggerUrl）
 * @param {string} expression - JS 表达式
 * @returns {Promise<any>}
 */
async function evalOnPage(cdpPort, page, expression) {
  // 优先使用 WebSocket 直连目标 page（确保在正确的标签页执行）
  if (page?.webSocketDebuggerUrl) {
    try {
      return await evalViaWebSocket(page.webSocketDebuggerUrl, expression);
    } catch {
      // WebSocket 连接失败，fail-closed 避免在错误标签页执行
      return null;
    }
  }

  // 没有 webSocketDebuggerUrl 时 fail-closed，不回退到 agent-browser 活跃标签
  return null;
}

/**
 * 通过 WebSocket 直接调用 CDP Runtime.evaluate。
 * 需要 Node.js >= 22（内置 WebSocket）。
 *
 * @param {string} wsUrl - WebSocket URL
 * @param {string} expression - JS 表达式
 * @returns {Promise<any>}
 */
function evalViaWebSocket(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    // Node 22+ 有全局 WebSocket
    if (typeof globalThis.WebSocket === 'undefined') {
      reject(new Error('WebSocket 不可用，需要 Node.js >= 22 或安装 agent-browser'));
      return;
    }

    const ws = new WebSocket(wsUrl);
    const id = 1;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket eval 超时'));
    }, 8000);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true },
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.close();
          if (msg.result?.result?.value !== undefined) {
            resolve(msg.result.result.value);
          } else {
            resolve(null);
          }
        }
      } catch {
        clearTimeout(timeout);
        ws.close();
        resolve(null);
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      ws.close();
      reject(new Error('WebSocket 连接失败'));
    };
  });
}

// ── 辅助函数 ────────────────────────────────────────────────────────

/**
 * 从 URL 中提取域名。
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * 构造验证结果（文档规定格式）。
 *
 * @param {string} domain
 * @param {string} authState - verified | not_verified | skipped | unknown
 * @param {string[]} signals
 * @param {string} [verificationMethod] - site_specific | generic | user_confirmation
 * @returns {object}
 */
function buildVerifyResult(domain, authState, signals, verificationMethod) {
  return {
    domain,
    auth_state: authState,
    verification_method: verificationMethod || (signals.includes('site_specific') ? 'site_specific' : signals.includes('user_skipped') ? 'skipped' : 'generic'),
    timestamp: new Date().toISOString(),
    signals,
    sensitive_values_printed: false,
  };
}

// ── 导出 ──────────────────────────────────────────────────────────

export {
  verifyAuth,
  parseSiteAuth,
  buildVerifyResult,
  extractDomain,
  evalOnPage,
  evalViaWebSocket,
  SITE_PATTERNS_DIR,
};
