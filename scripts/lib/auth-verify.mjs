/**
 * auth-verify.mjs — 登录态验证核心逻辑
 *
 * 核心原则：
 *   - CDP 连接 ≠ 登录成功
 *   - Profile 目录存在 ≠ 登录成功
 *   - 只有页面级验证才算数（page-level verification）
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SITE_PATTERNS_DIR = path.join(os.homedir(), '.sleuth', 'site-patterns');

// ── 站点经验 auth 配置解析 ──────────────────────────────────────────

function stripOuterQuotes(value) {
  return String(value || '').trim().replace(/^["']|["']$/g, '');
}

/**
 * 从 YAML frontmatter 文本解析 auth 配置。
 * 这是轻量解析器，只支持 Sleuth site-pattern 所需字段，不尝试成为通用 YAML parser。
 *
 * @param {string} fm - frontmatter 内容，不含 --- 包裹
 * @returns {{login_url: string|null, verify: {type: string, selector: string}|null}|null}
 */
function parseAuthFrontmatter(fm) {
  if (!fm || typeof fm !== 'string') return null;

  const lines = fm.split('\n');
  let inAuth = false;
  let inVerify = false;
  let loginUrl = null;
  let verifyType = null;
  let verifySelector = null;

  for (const line of lines) {
    if (!inAuth) {
      if (/^auth:\s*$/.test(line)) {
        inAuth = true;
      }
      continue;
    }

    // 下一个顶层 key 代表 auth 块结束
    if (/^\S/.test(line) && line.trim() !== '') break;

    const loginMatch = line.match(/^\s+login_url:\s*(.+?)\s*$/);
    if (loginMatch) {
      loginUrl = stripOuterQuotes(loginMatch[1]);
      continue;
    }

    if (/^\s+verify:\s*$/.test(line)) {
      inVerify = true;
      continue;
    }

    if (inVerify) {
      const typeMatch = line.match(/^\s+type:\s*(.+?)\s*$/);
      if (typeMatch) {
        verifyType = stripOuterQuotes(typeMatch[1]);
        continue;
      }

      const selectorMatch = line.match(/^\s+selector:\s*(.+?)\s*$/);
      if (selectorMatch) {
        verifySelector = stripOuterQuotes(selectorMatch[1]);
        continue;
      }
    }
  }

  const verify = verifyType && verifySelector
    ? { type: verifyType, selector: verifySelector }
    : null;

  if (!loginUrl && !verify) return null;
  return { login_url: loginUrl, verify };
}

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

  const normalized = normalizeDomain(domain);
  const candidates = [
    `${normalized}.md`,
    `www.${normalized}.md`,
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

  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  return parseAuthFrontmatter(fmMatch[1]);
}

// ── 通用登录墙检测 ─────────────────────────────────────────────────

async function verifyAuth(cdpPort, targetUrl, siteAuth = null) {
  const signals = [];
  let authState = 'unknown';

  try {
    const pagesResp = await fetch(`http://127.0.0.1:${cdpPort}/json/list`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!pagesResp.ok) return { auth_state: 'unknown', signals: ['cdp_list_failed'] };

    const pages = await pagesResp.json();
    if (!pages.length) return { auth_state: 'unknown', signals: ['no_pages'] };

    const targetDomain = extractDomain(targetUrl);
    const exactPage = pages.find(p => p.url === targetUrl);
    const domainPage = pages.find(p => p.url && extractDomain(p.url) === targetDomain);
    const targetPage = exactPage || domainPage;
    if (!targetPage) {
      return { auth_state: 'unknown', signals: ['target_domain_not_found_in_tabs'] };
    }
    const pageUrl = targetPage.url || '';

    const loginPatterns = [
      /\/login/i, /\/signin/i, /\/sign-in/i, /\/auth/i,
      /\/sso/i, /\/oauth/i, /\/cas/i, /\/account\/login/i,
      /\/session\/new/i, /\/users\/sign_in/i,
    ];

    if (siteAuth?.login_url) {
      try {
        const loginPath = new URL(siteAuth.login_url).pathname;
        if (loginPath && loginPath !== '/') {
          loginPatterns.push(new RegExp(loginPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
        }
      } catch {}
    }

    const isLoginUrl = loginPatterns.some(p => p.test(pageUrl));
    if (isLoginUrl) {
      signals.push('on_login_url');
      return { auth_state: 'not_verified', signals };
    }
    signals.push('not_login_url');

    if (siteAuth?.verify?.type === 'dom' && siteAuth.verify.selector) {
      const selectorResult = await evalOnPage(cdpPort, targetPage, `
        !!document.querySelector(${JSON.stringify(siteAuth.verify.selector)})
      `);
      if (selectorResult === true) {
        signals.push('site_selector_found');
        authState = 'verified';
        return { auth_state: authState, signals };
      }
      signals.push('site_selector_missing');
    }

    const genericResult = await evalOnPage(cdpPort, targetPage, `
      (() => {
        const signals = [];
        const loginPrompts = document.querySelectorAll(
          'a[href*="login"], a[href*="signin"], a[href*="sign-in"], ' +
          'button[class*="login"], button[class*="signin"], ' +
          '[data-testid*="login"], [data-testid*="signin"], ' +
          'form[action*="login"], form[action*="signin"]'
        );
        if (loginPrompts.length >= 2) signals.push('login_prompts_present');

        const accountSelectors = [
          '[data-testid*="account"]', '[data-testid*="avatar"]',
          '[data-testid*="profile"]', '[data-testid*="user-menu"]',
          '[class*="avatar"]', '[class*="user-menu"]', '[class*="account-menu"]',
          '[aria-label*="account"]', '[aria-label*="profile"]',
          'a[href*="/dashboard"]', 'a[href*="/settings"]',
          'a[href*="/profile"]', 'a[href*="/account"]',
          'img[alt*="avatar"]', 'img[class*="avatar"]'
        ];
        const accountFound = accountSelectors.some(s => document.querySelector(s));
        if (accountFound) signals.push('account_menu_present');
        return signals;
      })()
    `);

    if (Array.isArray(genericResult)) {
      signals.push(...genericResult);
    }

    if (signals.includes('account_menu_present') && !signals.includes('login_prompts_present')) {
      authState = 'verified';
    } else if (signals.includes('login_prompts_present') && !signals.includes('account_menu_present')) {
      authState = 'not_verified';
    } else {
      authState = 'unknown';
      signals.push('level3_ambiguous');
    }
  } catch {
    signals.push('verification_error');
    authState = 'unknown';
  }

  return { auth_state: authState, signals };
}

// ── CDP 页面 eval 辅助 ──────────────────────────────────────────────

async function evalOnPage(cdpPort, page, expression) {
  if (page?.webSocketDebuggerUrl) {
    try {
      return await evalViaWebSocket(page.webSocketDebuggerUrl, expression);
    } catch {
      return null;
    }
  }
  return null;
}

function evalViaWebSocket(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    if (typeof globalThis.WebSocket === 'undefined') {
      reject(new Error('WebSocket 不可用，需要 Node.js >= 22'));
      return;
    }

    const ws = new WebSocket(wsUrl);
    const id = 1;
    const timeout = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('WebSocket eval 超时'));
    }, 8000);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          clearTimeout(timeout);
          try { ws.close(); } catch {}
          if (msg.result?.exceptionDetails) {
            resolve(null);
          } else if (msg.result?.result?.value !== undefined) {
            resolve(msg.result.result.value);
          } else {
            resolve(null);
          }
        }
      } catch {
        clearTimeout(timeout);
        try { ws.close(); } catch {}
        resolve(null);
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      try { ws.close(); } catch {}
      reject(new Error('WebSocket 连接失败'));
    };
  });
}

// ── 辅助函数 ────────────────────────────────────────────────────────

function normalizeDomain(domain) {
  return String(domain || '').toLowerCase().replace(/^www\./, '');
}

function extractDomain(url) {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return '';
  }
}

function buildVerifyResult(domain, authState, signals, verificationMethod) {
  const method = verificationMethod
    || (signals.includes('site_selector_found') ? 'site_specific'
      : signals.includes('user_skipped') ? 'skipped'
      : 'generic');

  return {
    domain: normalizeDomain(domain),
    auth_state: authState,
    verification_method: method,
    timestamp: new Date().toISOString(),
    signals,
    sensitive_values_printed: false,
  };
}

export {
  verifyAuth,
  parseSiteAuth,
  parseAuthFrontmatter,
  buildVerifyResult,
  normalizeDomain,
  extractDomain,
  evalOnPage,
  evalViaWebSocket,
  SITE_PATTERNS_DIR,
};
