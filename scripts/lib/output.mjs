/**
 * output.mjs — sleuth 输出目录管理
 *
 * 输出统一存放在：
 *   ~/.sleuth/output/YYYY-MM-DD/<sessionId>/main/<type>/
 *   ~/.sleuth/output/YYYY-MM-DD/<sessionId>/agents/<agent>/<type>/
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const TYPE_SUBDIR_MAP = {
  screenshot: 'screenshots',
  image: 'images',
  doc: 'docs',
  transcript: 'transcripts',
  data: 'data',
  page: 'pages',
  trace: 'traces',
  recording: 'recordings',
};

function sanitizeAgentName(agent = 'main') {
  const clean = String(agent || 'main')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return clean || 'main';
}

export function resolveSessionRoot(sessionId) {
  const datePart = (sessionId && /^\d{4}-\d{2}-\d{2}/.test(sessionId))
    ? sessionId.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const base = path.join(homedir(), '.sleuth', 'output');
  return sessionId ? path.join(base, datePart, sessionId) : path.join(base, datePart);
}

export function resolveAgentOutputDir(sessionId, agent = 'main') {
  const root = resolveSessionRoot(sessionId);
  const safeAgent = sanitizeAgentName(agent);
  if (!sessionId) return root;
  return safeAgent === 'main'
    ? path.join(root, 'main')
    : path.join(root, 'agents', safeAgent);
}

/**
 * Backward-compatible alias. Now resolves to the agent-scoped output dir.
 */
export function resolveOutputDir(sessionId, agent = 'main') {
  return resolveAgentOutputDir(sessionId, agent);
}

export function ensureOutputDir(outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const subdir of Object.values(TYPE_SUBDIR_MAP)) {
    mkdirSync(path.join(outDir, subdir), { recursive: true });
  }
}

export { TYPE_SUBDIR_MAP, sanitizeAgentName };
