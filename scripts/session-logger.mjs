#!/usr/bin/env node
/**
 * session-logger.mjs — 会话生命周期管理
 *
 * 每次调研任务对应一个 session，记录从开始到结束的完整过程。
 * session 数据存储在 ~/.sleuth/sessions/<session-id>.json。
 *
 * 三个子命令：
 *
 *   start  — 创建新 session
 *     用法：node session-logger.mjs --action start --query "搜索关键词" [--type "技术文档"]
 *     输出：session ID（如 2026-04-29-143052123-搜索关键词）
 *     会话文件初始结构：
 *       {
 *         "session_id": "...",
 *         "query": "搜索关键词",       ← 用户原始问题
 *         "query_type": "技术文档",     ← 问题分类
 *         "started": "2026-04-29T...",  ← 开始时间（ISO 格式）
 *         "finished": null,             ← 结束时间（完成后由 finish 填写）
 *         "outcome": null,              ← 结果：success / partial / fail
 *         "operations": []              ← 操作记录数组（由 log 追加）
 *       }
 *
 *   log    — 追加操作记录
 *     用法：node session-logger.mjs --action log --sid <id> --operation '{"type":"visit",...}'
 *     将一条操作记录（如访问页面、遇到 CAPTCHA、交付文件）追加到 session 的 operations 数组
 *
 *   finish — 结束 session
 *     用法：node session-logger.mjs --action finish --sid <id> --outcome success|partial|fail
 *     填写 finished 时间戳和 outcome 结果
 *
 * 安全措施：
 *   - session ID 通过正则校验，防止路径遍历攻击（只允许字母、数字、连字符、下划线）
 *   - operation 必须是 JSON 对象，不接受原始类型或数组
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';

// ── 常量定义 ──────────────────────────────────────────────────────

// session 文件存储目录
const SESSIONS_DIR = join(homedir(), '.sleuth', 'sessions');

// 合法的问题分类（供 start 命令使用）
const VALID_QUERY_TYPES = [
  '技术文档',    // API 文档、技术规格
  '学术论文',    // 论文、期刊
  '产品评测',    // 产品对比、评测文章
  '政策法规',    // 法律条文、政策文件
  '实时热点',    // 新闻、时事
  '生活消费',    // 购物、旅游、生活服务
  '其他',        // 不属于以上分类
];

// 合法的结束结果（供 finish 命令使用）
const VALID_OUTCOMES = ['success', 'partial', 'fail'];

// ── 工具函数 ──────────────────────────────────────────────────────

/** 确保 sessions 目录存在 */
function createSessionDir() {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

/**
 * 根据 query 文本生成唯一的 session ID。
 *
 * 格式：YYYY-MM-DD-HHmmssSSS-<slug>
 * 例如：2026-04-29-143052123-搜索AI新闻
 *
 * slug 生成规则：
 *   - 去掉所有非字母数字字符
 *   - 空格替换为连字符
 *   - 截断到 20 字符
 *   - 全小写
 *   - 无有效字符时用 "session" 替代
 *
 * @param {string} query - 用户输入的查询文本
 * @returns {string} session ID
 */
function generateSessionId(query) {
  const now = new Date();
  // 日期 + 精确到毫秒的时间戳，确保唯一性
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

  // 从 query 生成 URL-safe slug
  let slug = query
    .replace(/[^a-zA-Z0-9\s\-]/g, '') // 只保留字母数字和连字符
    .trim()
    .replace(/\s+/g, '-')              // 空格变连字符
    .slice(0, 20)                       // 截断
    .toLowerCase()
    .replace(/^-+|-+$/g, '');          // 去掉首尾连字符

  if (!slug) slug = 'session'; // 纯中文/特殊字符 query 的兜底

  return datePart + '-' + slug;
}

/**
 * 校验 session ID，防止路径遍历攻击。
 * 只允许：字母、数字、连字符、下划线。
 *
 * @param {string} sessionId - 待校验的 session ID
 * @throws {Error} ID 不合法时抛出错误
 */
function validateSessionId(sessionId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw new Error(`Invalid session ID: ${sessionId}`);
  }
}

/**
 * 构造 session 文件的完整路径。
 * 内部调用 validateSessionId 做安全校验。
 *
 * @param {string} sessionId - session ID
 * @returns {string} 文件绝对路径
 */
function sessionPath(sessionId) {
  validateSessionId(sessionId);
  return join(SESSIONS_DIR, sessionId + '.json');
}

/**
 * 从磁盘加载 session 数据。
 *
 * @param {string} sid - session ID
 * @returns {object|null} session 数据对象，加载失败返回 null
 */
function loadSession(sid) {
  let filePath;
  try {
    filePath = sessionPath(sid); // 会触发 ID 校验
  } catch (e) {
    console.error(`Error: ${e.message}`);
    return null;
  }
  if (!existsSync(filePath)) {
    console.error(`Warning: session file not found: ${filePath}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (e) {
    console.error(`Warning: failed to parse session file: ${filePath} — ${e.message}`);
    return null;
  }
}

/**
 * 将 session 数据写回磁盘。
 * 格式化为 2 空格缩进的 JSON，方便人工阅读和 git diff。
 *
 * @param {string} sid - session ID
 * @param {object} data - session 数据对象
 */
function saveSession(sid, data) {
  let filePath;
  try {
    filePath = sessionPath(sid);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ── 子命令实现 ────────────────────────────────────────────────────

/**
 * start 命令：创建新的 session 文件。
 * 输出 session ID 到 stdout（供调用者捕获）。
 */
function cmdStart(query, queryType) {
  createSessionDir();
  const sid = generateSessionId(query);
  const now = new Date().toISOString();
  const session = {
    session_id: sid,
    query: query,                           // 用户原始问题
    query_type: queryType || '其他',        // 问题分类
    started: now,                           // 开始时间
    finished: null,                         // 结束时间（未完成）
    outcome: null,                          // 结果（未完成）
    operations: [],                         // 操作记录（空数组）
  };
  saveSession(sid, session);
  console.log(sid); // 输出 ID 供后续 log/finish 使用
}

/**
 * log 命令：追加一条操作记录到 session。
 *
 * operation JSON 示例：
 *   {"type": "visit", "url": "https://...", "extraction_success": true, "dwell_ms": 3500}
 *   {"type": "captcha", "domain": "example.com"}
 *   {"type": "deliver", "content_type": "doc", "file": "/path/to/file.pdf"}
 *
 * 如果 operation 中没有 timestamp，会自动添加当前时间。
 */
function cmdLog(sid, operationJson) {
  const session = loadSession(sid);
  if (!session) return;

  // 解析 operation JSON
  let op;
  try {
    op = JSON.parse(operationJson);
  } catch (e) {
    console.error(`Warning: invalid operation JSON: ${e.message}`);
    return;
  }

  // 安全检查：operation 必须是对象（不接受字符串、数字、数组、null）
  if (typeof op !== 'object' || op === null || Array.isArray(op)) {
    console.error('Warning: operation must be a JSON object');
    return;
  }

  // 自动补充时间戳（如果调用者没提供）
  op.timestamp = op.timestamp || new Date().toISOString();
  session.operations.push(op);
  try {
    saveSession(sid, session);
  } catch (e) {
    console.error(`Warning: failed to save session: ${e.message}`);
  }
}

/**
 * finish 命令：标记 session 结束。
 *
 * @param {string} sid - session ID
 * @param {string} outcome - 结果：success（成功）/ partial（部分完成）/ fail（失败）
 */
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

// ── 参数解析与路由 ────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    options: {
      action:    { type: 'string' },  // 子命令：start / log / finish
      query:     { type: 'string' },  // start 时的查询文本
      type:      { type: 'string' },  // start 时的问题分类
      sid:       { type: 'string' },  // log/finish 时的 session ID
      operation: { type: 'string' },  // log 时的操作 JSON
      outcome:   { type: 'string' },  // finish 时的结果
      help:      { type: 'boolean', short: 'h' },
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

  // 根据子命令分发
  switch (values.action) {
    case 'start': {
      if (!values.query) {
        console.error('Error: --query is required for action "start"');
        process.exit(2);
      }
      // 未知分类不报错，原样使用
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
