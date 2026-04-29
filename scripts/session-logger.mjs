#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';

const SESSIONS_DIR = join(homedir(), '.sleuth', 'sessions');

function createSessionDir() {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function generateSessionId(query) {
  const now = new Date();
  const datePart =
    now.getFullYear() +
    '-' +
    String(now.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(now.getDate()).padStart(2, '0') +
    '-' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0') +
    String(now.getMilliseconds()).padStart(3, '0');

  let slug = query
    .replace(/[^a-zA-Z0-9\s\-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 20)
    .toLowerCase()
    .replace(/^-+|-+$/g, '');

  if (!slug) slug = 'session';

  return datePart + '-' + slug;
}

/**
 * Validate a session ID to prevent path traversal.
 * Session IDs must consist only of alphanumeric characters, hyphens, and underscores.
 */
function validateSessionId(sessionId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw new Error(`Invalid session ID: ${sessionId}`);
  }
}

function sessionPath(sessionId) {
  validateSessionId(sessionId);
  return join(SESSIONS_DIR, sessionId + '.json');
}

function loadSession(sid) {
  let path;
  try {
    path = sessionPath(sid);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    return null;
  }
  if (!existsSync(path)) {
    console.error(`Warning: session file not found: ${path}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    console.error(`Warning: failed to parse session file: ${path} — ${e.message}`);
    return null;
  }
}

function saveSession(sid, data) {
  let path;
  try {
    path = sessionPath(sid);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

const VALID_QUERY_TYPES = [
  '技术文档',
  '学术论文',
  '产品评测',
  '政策法规',
  '实时热点',
  '生活消费',
  '其他',
];

const VALID_OUTCOMES = ['success', 'partial', 'fail'];

function cmdStart(query, queryType) {
  createSessionDir();
  const sid = generateSessionId(query);
  const now = new Date().toISOString();
  const session = {
    session_id: sid,
    query: query,
    query_type: queryType || '其他',
    started: now,
    finished: null,
    outcome: null,
    operations: [],
  };
  saveSession(sid, session);
  console.log(sid);
}

function cmdLog(sid, operationJson) {
  const session = loadSession(sid);
  if (!session) return;

  let op;
  try {
    op = JSON.parse(operationJson);
  } catch (e) {
    console.error(`Warning: invalid operation JSON: ${e.message}`);
    return;
  }

  // Guard against JSON primitives and arrays — operations must be objects
  if (typeof op !== 'object' || op === null || Array.isArray(op)) {
    console.error('Warning: operation must be a JSON object');
    return;
  }

  op.timestamp = op.timestamp || new Date().toISOString();
  session.operations.push(op);
  try {
    saveSession(sid, session);
  } catch (e) {
    console.error(`Warning: failed to save session: ${e.message}`);
  }
}

function cmdFinish(sid, outcome) {
  if (!VALID_OUTCOMES.includes(outcome)) {
    console.error(
      `Warning: invalid outcome "${outcome}". Must be one of: ${VALID_OUTCOMES.join(', ')}`
    );
    return;
  }

  const session = loadSession(sid);
  if (!session) return;

  session.finished = new Date().toISOString();
  session.outcome = outcome;
  try {
    saveSession(sid, session);
  } catch (e) {
    console.error(`Warning: failed to save session: ${e.message}`);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      action: { type: 'string' },
      query: { type: 'string' },
      type: { type: 'string' },
      sid: { type: 'string' },
      operation: { type: 'string' },
      outcome: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log('Usage: node session-logger.mjs --action <start|log|finish> [options]');
    console.log('  --action start  --query <text> [--type <type>]   Start a new session');
    console.log('  --action log    --sid <id> --operation \'<json>\'   Log an operation');
    console.log('  --action finish --sid <id> --outcome <outcome>    Finish a session');
    console.log('');
    console.log('Query types: ' + VALID_QUERY_TYPES.join(', '));
    console.log('Outcomes: ' + VALID_OUTCOMES.join(', '));
    return;
  }

  switch (values.action) {
    case 'start': {
      if (!values.query) {
        console.error('Error: --query is required for action "start"');
        process.exit(2);
      }
      if (values.type && !VALID_QUERY_TYPES.includes(values.type)) {
        console.error(`Warning: unknown query type "${values.type}". Using as-is.`);
      }
      cmdStart(values.query, values.type);
      break;
    }
    case 'log': {
      if (!values.sid) {
        console.error('Error: --sid is required for action "log"');
        process.exit(2);
      }
      if (!values.operation) {
        console.error('Error: --operation is required for action "log"');
        process.exit(2);
      }
      cmdLog(values.sid, values.operation);
      break;
    }
    case 'finish': {
      if (!values.sid) {
        console.error('Error: --sid is required for action "finish"');
        process.exit(2);
      }
      if (!values.outcome) {
        console.error('Error: --outcome is required for action "finish"');
        process.exit(2);
      }
      cmdFinish(values.sid, values.outcome);
      break;
    }
    default:
      console.error(`Error: unknown action "${values.action}". Must be start, log, or finish.`);
      process.exit(2);
  }
}

main();
