#!/usr/bin/env node
/**
 * on-stop.mjs — session 收尾脚本
 *
 * 默认只做保守收尾：
 *   1. 关闭指定 session，或兜底关闭 orphan session
 *   2. 为本轮涉及的复杂/高频域名创建可选 site-pattern stub
 *   3. 为新建 stub 刷新统计
 *   4. 可选清理旧版 chrome-debug 残留
 *
 * 不再默认全局清理 agent-browser 进程，避免误伤其他 Agent/任务。
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSIONS_DIR = path.join(os.homedir(), '.sleuth', 'sessions');
const PATTERNS_DIR = path.join(os.homedir(), '.sleuth', 'site-patterns');
const RESEARCH_INDEX = path.join(ROOT, 'scripts', 'research-index.mjs');

const SEARCH_ENGINES = new Set([
  'google.com', 'google.com.hk', 'bing.com',
  'baidu.com', 'duckduckgo.com', 'yahoo.com',
]);

const COMPLEX_OP_TYPES = new Set(['captcha', 'login_wall', 'paywall', 'anti_bot']);
const DOMAIN_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
const DOMAIN_FREQUENCY_THRESHOLD = 3;

const args = process.argv.slice(2);
function getValue(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const SID = getValue('sid');
const OUTCOME = getValue('outcome') || 'partial';
const CLEANUP_LEGACY = hasFlag('cleanup-legacy');
const CLEANUP_AGENT_BROWSER = hasFlag('cleanup-agent-browser'); // explicit opt-in only

function safeSessionPath(sid) {
  if (!/^[a-zA-Z0-9_-]+$/.test(sid)) throw new Error(`Invalid session id: ${sid}`);
  return path.join(SESSIONS_DIR, `${sid}.json`);
}

function loadSessionFile(filePath) {
  try { return JSON.parse(readFileSync(filePath, 'utf-8')); }
  catch { return null; }
}

function finishSessionFile(filePath, outcome = 'partial') {
  const session = loadSessionFile(filePath);
  if (!session) return null;
  if (session.finished === null || session.finished === undefined) {
    session.finished = new Date().toISOString();
    session.outcome = session.outcome || outcome;
    try { writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8'); }
    catch { return null; }
  }
  return session;
}

function finishTargetSession() {
  if (!SID) return [];
  try {
    const filePath = safeSessionPath(SID);
    if (!existsSync(filePath)) return [];
    const session = finishSessionFile(filePath, OUTCOME);
    return session ? [session] : [];
  } catch {
    return [];
  }
}

function finishOrphanSessions() {
  if (!existsSync(SESSIONS_DIR)) return [];
  const finished = [];
  for (const entry of readdirSync(SESSIONS_DIR).filter(e => e.endsWith('.json'))) {
    const filePath = path.join(SESSIONS_DIR, entry);
    const session = loadSessionFile(filePath);
    if (!session) continue;
    if (session.finished === null || session.finished === undefined) {
      const closed = finishSessionFile(filePath, 'partial');
      if (closed) finished.push(closed);
    }
  }
  return finished;
}

function indexSessions(sessions) {
  for (const session of sessions) {
    const sid = session?.session_id;
    if (!sid) continue;
    try {
      execFileSync(process.execPath, [RESEARCH_INDEX, '--action', 'index', '--sid', sid], {
        timeout: 30000,
        stdio: 'ignore',
      });
    } catch (err) {
      console.error(`Warning: index failed for ${sid}: ${err.message}`);
    }
  }
}

function extractDomain(str) {
  if (!str || typeof str !== 'string') return null;
  const match = str.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)/);
  const candidate = match ? match[1].toLowerCase() : null;
  if (!candidate) return null;
  if (!DOMAIN_REGEX.test(candidate)) return null;
  const fileExts = new Set(['json', 'md', 'txt', 'csv', 'html', 'xml', 'yaml', 'yml', 'log', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'mp4', 'mp3', 'zip', 'gz', 'js', 'ts', 'css', 'py', 'rb', 'go']);
  const parts = candidate.split('.');
  if (parts.length === 2 && fileExts.has(parts[1])) return null;
  return candidate;
}

function getComplexDomainsFromSession(session) {
  const domains = new Set();
  for (const op of session.operations || []) {
    if (COMPLEX_OP_TYPES.has(op.type) || COMPLEX_OP_TYPES.has(op.content_type)) {
      if (op.domain) domains.add(op.domain);
      if (op.url) {
        const d = extractDomain(op.url);
        if (d) domains.add(d);
      }
    }
  }
  return domains;
}

function getDomainsFromSession(session) {
  const domains = new Set();
  for (const op of session.operations || []) {
    if (op.domain) domains.add(op.domain);
    for (const field of ['url', 'source', 'file']) {
      if (op[field]) {
        const d = extractDomain(op[field]);
        if (d) domains.add(d);
      }
    }
  }
  return domains;
}

function countDomainFrequency() {
  const freq = {};
  if (!existsSync(SESSIONS_DIR)) return freq;
  for (const entry of readdirSync(SESSIONS_DIR).filter(e => e.endsWith('.json'))) {
    const session = loadSessionFile(path.join(SESSIONS_DIR, entry));
    if (!session) continue;
    for (const d of getDomainsFromSession(session)) freq[d] = (freq[d] || 0) + 1;
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
      'aliases: []',
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
    } catch {}
  }
  return created;
}

function cleanupLegacyChromeDebug() {
  if (!CLEANUP_LEGACY) return;
  try {
    if (os.platform() === 'win32') return;
    const ps = execSync('ps aux', { encoding: 'utf-8', timeout: 3000 });
    for (const line of ps.split('\n')) {
      if (line.includes('grep')) continue;
      if (line.includes('chrome-debug') && /chrome/i.test(line) && !line.includes('cdp-profile')) {
        const m = line.match(/^\S+\s+(\d+)/);
        if (m) { try { process.kill(parseInt(m[1])); } catch {} }
      }
    }
  } catch {}
}

function cleanupAgentBrowserExplicit() {
  if (!CLEANUP_AGENT_BROWSER) return;
  try {
    execSync('agent-browser --auto-connect --session sleuth-cleanup close --all', { timeout: 5000, stdio: 'ignore' });
  } catch {}
}

async function main() {
  const finished = SID ? finishTargetSession() : finishOrphanSessions();
  indexSessions(finished);

  const candidateDomains = new Set();
  const freq = countDomainFrequency();

  for (const session of finished) {
    for (const d of getComplexDomainsFromSession(session)) {
      if (!SEARCH_ENGINES.has(d)) candidateDomains.add(d);
    }
    for (const d of getDomainsFromSession(session)) {
      if (!SEARCH_ENGINES.has(d) && (freq[d] || 0) >= DOMAIN_FREQUENCY_THRESHOLD) {
        candidateDomains.add(d);
      }
    }
  }

  const created = createSitePatternStubs(candidateDomains);
  for (const domain of created) {
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'update-site-stats.mjs'), '--domain', domain], {
        timeout: 10000,
        stdio: 'ignore',
      });
    } catch {}
  }

  cleanupLegacyChromeDebug();
  cleanupAgentBrowserExplicit();
}

main().catch((err) => {
  console.error('on-stop error:', err.message || err);
  process.exit(0);
});
