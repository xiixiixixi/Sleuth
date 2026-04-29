#!/usr/bin/env node
// on-stop — Claude Code Stop hook: 清理未关闭 session、为复杂站点创建经验 stub、关闭残留 tab
//
// 由 .claude/settings.json 的 Stop hook 自动调用。
// 也可手动运行: node scripts/on-stop.mjs

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSIONS_DIR = path.join(os.homedir(), '.sleuth', 'sessions');
const PATTERNS_DIR = path.join(ROOT, 'references', 'site-patterns');
const SEARCH_ENGINES = new Set(['google.com', 'google.com.hk', 'bing.com', 'baidu.com', 'duckduckgo.com', 'yahoo.com']);
const COMPLEX_OP_TYPES = new Set(['captcha', 'login_wall', 'paywall', 'anti_bot']);
const DOMAIN_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
const DOMAIN_FREQUENCY_THRESHOLD = 3;

// --- ① 关闭未完成的 session ---
function finishOrphanSessions() {
  if (!existsSync(SESSIONS_DIR)) return [];

  const finished = [];
  const entries = readdirSync(SESSIONS_DIR).filter(e => e.endsWith('.json'));

  for (const entry of entries) {
    const filePath = path.join(SESSIONS_DIR, entry);
    let session;
    try {
      session = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch { continue; }

    if (session.finished === null || session.finished === undefined) {
      session.finished = new Date().toISOString();
      session.outcome = session.outcome || 'partial';
      try {
        writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
        finished.push(session);
      } catch { /* 权限不足则跳过 */ }
    }
  }
  return finished;
}

// --- ② 提取域名并判断是否复杂站点 ---
function extractDomain(str) {
  if (!str || typeof str !== 'string') return null;
  const match = str.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)/);
  const candidate = match ? match[1].toLowerCase() : null;
  if (!candidate) return null;
  // Reject obvious non-domains (file extensions, paths)
  if (!DOMAIN_REGEX.test(candidate)) return null;
  // Reject file extensions (file.json, output.md, etc.) — single-label names with known extensions
  const FILE_EXTS = new Set(['json', 'md', 'txt', 'csv', 'html', 'xml', 'yaml', 'yml', 'log', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'mp4', 'mp3', 'zip', 'gz', 'js', 'ts', 'css', 'py', 'rb', 'go']);
  const parts = candidate.split('.');
  if (parts.length === 2 && FILE_EXTS.has(parts[1])) return null;
  return candidate;
}

function getComplexDomainsFromSession(session) {
  const domains = new Set();
  for (const op of session.operations || []) {
    if (COMPLEX_OP_TYPES.has(op.type) || COMPLEX_OP_TYPES.has(op.content_type)) {
      if (op.domain) domains.add(op.domain);
    }
  }
  return domains;
}

function getDomainsFromSession(session) {
  const domains = new Set();
  for (const op of session.operations || []) {
    if (op.domain) domains.add(op.domain);
    if (op.source) {
      const d = extractDomain(op.source);
      if (d) domains.add(d);
    }
    if (op.file) {
      const d = extractDomain(op.file);
      if (d) domains.add(d);
    }
  }
  return domains;
}

function countDomainFrequency() {
  const freq = {};
  if (!existsSync(SESSIONS_DIR)) return freq;
  for (const entry of readdirSync(SESSIONS_DIR).filter(e => e.endsWith('.json'))) {
    try {
      const session = JSON.parse(readFileSync(path.join(SESSIONS_DIR, entry), 'utf-8'));
      for (const d of getDomainsFromSession(session)) {
        freq[d] = (freq[d] || 0) + 1;
      }
    } catch {}
  }
  return freq;
}

function createSitePatternStubs(domains) {
  if (!existsSync(PATTERNS_DIR)) mkdirSync(PATTERNS_DIR, { recursive: true });
  const created = [];
  for (const domain of domains) {
    const filePath = path.join(PATTERNS_DIR, `${domain}.md`);
    if (existsSync(filePath)) continue;
    const today = new Date().toISOString().slice(0, 10);
    const stub = [
      '---',
      `domain: ${domain}`,
      `aliases: []`,
      `updated: ${today}`,
      '---',
      '',
      '## 平台特征',
      '',
      '## 有效模式',
      '',
      '## 已知陷阱',
      '',
    ].join('\n');
    try {
      writeFileSync(filePath, stub, 'utf-8');
      created.push(domain);
    } catch { /* 权限不足则跳过 */ }
  }
  return created;
}

// --- ③ 关闭残留 tab ---
function closeBrowserTabs() {
  try {
    execSync('agent-browser close --all 2>/dev/null', { timeout: 5000, stdio: 'ignore' });
  } catch { /* 无 tab 或 agent-browser 不可用 */ }
}

// --- 主流程 ---
async function main() {
  // ① 关闭未完成的 session
  const finished = finishOrphanSessions();

  // ② 收集需要记录经验的域名
  const candidateDomains = new Set();
  const freq = countDomainFrequency();

  for (const session of finished) {
    // Only domains that themselves had complex operations
    const complexDomains = getComplexDomainsFromSession(session);
    for (const d of complexDomains) {
      if (SEARCH_ENGINES.has(d)) continue;
      candidateDomains.add(d);
    }
    // High-frequency domains (3+ sessions) also qualify
    const domains = getDomainsFromSession(session);
    for (const d of domains) {
      if (SEARCH_ENGINES.has(d)) continue;
      if ((freq[d] || 0) >= DOMAIN_FREQUENCY_THRESHOLD) {
        candidateDomains.add(d);
      }
    }
  }

  const created = createSitePatternStubs(candidateDomains);

  // 为新建 stub 的域名单独刷新统计（不跑全量，避免为所有域名创建 stub）
  for (const domain of created) {
    try {
      execSync(`node "${path.join(ROOT, 'scripts', 'update-site-stats.mjs')}" --domain "${domain}"`, {
        timeout: 10000, stdio: 'ignore',
      });
    } catch {}
  }

  // ③ 关闭残留 tab
  closeBrowserTabs();
}

main().catch(() => process.exit(0));
