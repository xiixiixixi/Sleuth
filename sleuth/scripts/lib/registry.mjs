import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { homedir } from 'node:os';

const SLEUTH_DIR = join(homedir(), '.sleuth');
const OUTPUT_DIR = join(SLEUTH_DIR, 'output');
const SESSIONS_DIR = join(SLEUTH_DIR, 'sessions');
const REGISTRY_FILE = join(OUTPUT_DIR, 'registry.jsonl');
const REGISTRY_LOCK = join(OUTPUT_DIR, 'registry.jsonl.lock');

const TEXT_EXTS = new Set([
  '.md', '.txt', '.json', '.jsonl', '.csv', '.tsv', '.html', '.htm',
  '.srt', '.xml', '.yaml', '.yml',
]);

const ENTITY_STOP_WORDS = new Set([
  'The', 'This', 'That', 'With', 'From', 'For', 'And', 'Or', 'Not',
  'You', 'Your', 'Our', 'Their', 'Report', 'Summary', 'Overview',
  'Analysis', 'Research', 'Data', 'Source', 'Sources',
  'report', 'summary', 'overview', 'analysis', 'research', 'data', 'source', 'sources',
]);

function ensureRegistryDir() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

function withRegistryLock(fn) {
  ensureRegistryDir();
  for (let i = 0; i < 100; i++) {
    try {
      mkdirSync(REGISTRY_LOCK);
      try {
        return fn();
      } finally {
        rmSync(REGISTRY_LOCK, { recursive: true, force: true });
      }
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // 检测过期锁（>30s 视为残留，强制清理）
      try {
        const lockAge = Date.now() - statSync(REGISTRY_LOCK).mtimeMs;
        if (lockAge > 30000) rmSync(REGISTRY_LOCK, { recursive: true, force: true });
      } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    }
  }
  throw new Error(`Could not acquire registry lock: ${REGISTRY_LOCK}`);
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function loadSession(sid) {
  if (!sid || !/^[a-zA-Z0-9_-]+$/.test(sid)) return null;
  const filePath = join(SESSIONS_DIR, sid + '.json');
  if (!existsSync(filePath)) return null;
  return safeReadJson(filePath);
}

function hashFile(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB

function readTextForMetadata(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (!TEXT_EXTS.has(ext)) return '';

  const st = statSync(filePath);
  if (st.size > MAX_FILE_BYTES) return '';
  const maxBytes = 512 * 1024;
  const content = readFileSync(filePath, 'utf-8');
  return st.size > maxBytes ? content.slice(0, maxBytes) : content;
}

function extractUrls(text) {
  const urls = new Set();
  const regex = /https?:\/\/[^\s<>"')\]]+/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    urls.add(match[0].replace(/[.,;:!?，。；：！？]+$/, ''));
    if (urls.size >= 30) break;
  }
  return [...urls];
}

function summarizeText(text) {
  if (!text) return '';
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^[-*_`>]+$/.test(line));

  const heading = lines.find(line => /^#{1,3}\s+/.test(line));
  const body = lines
    .filter(line => !/^#{1,6}\s+/.test(line))
    .filter(line => !/^https?:\/\//.test(line))
    .slice(0, 5)
    .join(' ');

  return [heading ? heading.replace(/^#{1,6}\s+/, '') : '', body]
    .filter(Boolean)
    .join(' — ')
    .replace(/\s+/g, ' ')
    .slice(0, 600);
}

function extractEntities(text, filePath, taskHint) {
  const entities = new Set();
  const add = value => {
    const cleaned = value.trim().replace(/^#+\s*/, '').replace(/[：:，,。.；;!?！？]+$/, '');
    if (cleaned.length < 2 || cleaned.length > 80) return;
    if (ENTITY_STOP_WORDS.has(cleaned) || ENTITY_STOP_WORDS.has(cleaned.toLowerCase())) return;
    entities.add(cleaned);
  };

  for (const seed of [basename(filePath, extname(filePath)), taskHint || '']) {
    for (const part of seed.split(/[-_\s]+/)) add(part);
  }

  const sample = text.slice(0, 20000);
  for (const line of sample.split('\n')) {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) add(heading[1]);
  }

  const engNames = sample.match(/\b[A-Z][A-Za-z0-9]*(?:[ \t]+[A-Z][A-Za-z0-9]*){0,4}\b/g) || [];
  for (const name of engNames.slice(0, 80)) add(name);

  const cnNames = sample.match(/[一-鿿]{2,12}/g) || [];
  for (const name of cnNames.slice(0, 80)) add(name);

  return [...entities].slice(0, 80);
}

function taskHintForSid(sid) {
  const session = loadSession(sid);
  if (!session) return '';
  return [session.query, session.query_type].filter(Boolean).join(' ');
}

export function loadRegistry() {
  if (!existsSync(REGISTRY_FILE)) return [];
  const records = [];
  const content = readFileSync(REGISTRY_FILE, 'utf-8');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record && typeof record === 'object' && record.path) records.push(record);
    } catch {}
  }
  return records;
}

export function saveRegistry(records) {
  ensureRegistryDir();
  const content = records.map(record => JSON.stringify(record)).join('\n');
  writeFileSync(REGISTRY_FILE, content ? content + '\n' : '', 'utf-8');
}

export function buildArtifactRecord({ sid, filePath, type, name, source, url, timestamp, taskHint }) {
  if (!filePath || !existsSync(filePath)) return null;

  const st = statSync(filePath);
  if (!st.isFile()) return null;
  if (st.size > MAX_FILE_BYTES) return null;

  const text = readTextForMetadata(filePath);
  const resolvedTaskHint = taskHint || taskHintForSid(sid);
  const sourceUrls = uniq([url, ...extractUrls(text)]);

  return {
    sid: sid || null,
    createdAt: timestamp || st.mtime.toISOString(),
    type: type || null,
    name: name || basename(filePath),
    path: filePath,
    contentHash: hashFile(filePath),
    summary: summarizeText(text),
    entities: extractEntities(text, filePath, resolvedTaskHint),
    sourceUrls,
    taskHint: resolvedTaskHint || '',
    source: source || null,
  };
}

export function upsertRegistryRecord(record) {
  if (!record) return null;
  return withRegistryLock(() => {
    const records = loadRegistry();
    const idx = records.findIndex(existing => existing.path === record.path);
    if (idx >= 0) {
      records[idx] = { ...records[idx], ...record };
    } else {
      records.push(record);
    }
    saveRegistry(records);
    return record;
  });
}

export function registerArtifact(args) {
  const record = buildArtifactRecord(args);
  if (!record) return null;
  return upsertRegistryRecord(record);
}

export function registerSessionArtifacts(session) {
  const sid = session?.session_id;
  const taskHint = [session?.query, session?.query_type].filter(Boolean).join(' ');
  const registered = [];

  for (const op of session?.operations || []) {
    if (op.type !== 'deliver' || !op.file) continue;
    try {
      const record = registerArtifact({
        sid,
        filePath: op.file,
        type: op.content_type,
        name: basename(op.file),
        source: op.source,
        url: op.url,
        timestamp: op.timestamp,
        taskHint,
      });
      if (record) registered.push(record);
    } catch {}
  }

  return registered;
}

function normalizeQuery(query) {
  return String(query || '').trim().toLowerCase();
}

function queryTokens(query) {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];
  const parts = normalized
    .split(/[\s,，。:：;；"'`!?！？()[\]{}<>《》、/\\|]+/)
    .filter(Boolean);
  return uniq([normalized, ...parts]);
}

function scoreRecord(record, query, tokens) {
  const q = normalizeQuery(query);
  const name = String(record.name || '').toLowerCase();
  const summary = String(record.summary || '').toLowerCase();
  const taskHint = String(record.taskHint || '').toLowerCase();
  const entities = (record.entities || []).map(e => String(e).toLowerCase());
  const urls = (record.sourceUrls || []).map(u => String(u).toLowerCase());
  const pathText = String(record.path || '').toLowerCase();
  const source = String(record.source || '').toLowerCase();

  let score = 0;
  const matched = new Set();
  const add = (amount, label) => {
    score += amount;
    matched.add(label);
  };

  if (q) {
    if (name === q) add(10, 'name');
    else if (name.includes(q)) add(6, 'name');
    if (taskHint.includes(q)) add(5, 'task');
    if (summary.includes(q)) add(4, 'summary');
    if (pathText.includes(q)) add(3, 'path');
    if (source.includes(q)) add(2, 'source');
    if (entities.some(e => e === q)) add(8, 'entity');
    else if (entities.some(e => e.includes(q) || q.includes(e))) add(5, 'entity');
    if (urls.some(u => u.includes(q))) add(2, 'url');
  }

  for (const token of tokens) {
    if (!token || token === q) continue;
    if (name.includes(token)) add(3, `token:${token}`);
    if (taskHint.includes(token)) add(2, `token:${token}`);
    if (summary.includes(token)) add(2, `token:${token}`);
    if (entities.some(e => e.includes(token))) add(3, `token:${token}`);
    if (urls.some(u => u.includes(token))) add(1, `token:${token}`);
  }

  const createdAt = Date.parse(record.createdAt || '');
  if (score > 0 && !Number.isNaN(createdAt)) {
    const ageDays = Math.max(0, (Date.now() - createdAt) / 86400000);
    score += Math.max(0, 2 - ageDays / 30);
  }

  return { score, matched: [...matched] };
}

export function searchRegistry(query, limit = 10) {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];

  return loadRegistry()
    .map(record => {
      const scored = scoreRecord(record, query, tokens);
      return { ...record, score: Number(scored.score.toFixed(3)), matched: scored.matched };
    })
    .filter(record => record.score > 0)
    .sort((a, b) => b.score - a.score || String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit)
    .filter(record => record.path && existsSync(record.path));
}

export function listSessionFiles(days) {
  if (!existsSync(SESSIONS_DIR)) return [];
  const cutoff = days
    ? Date.now() - Number(days) * 86400000
    : null;

  return readdirSync(SESSIONS_DIR)
    .filter(entry => entry.endsWith('.json'))
    .map(entry => join(SESSIONS_DIR, entry))
    .filter(filePath => {
      if (!cutoff) return true;
      try {
        return statSync(filePath).mtimeMs >= cutoff;
      } catch {
        return false;
      }
    });
}

export { REGISTRY_FILE };
