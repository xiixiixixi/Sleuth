#!/usr/bin/env node
/**
 * research-index.mjs — 跨 session 知识库
 *
 * 从 session 交付文件中提取实体，存入知识库；支持按关键词查询历史知识。
 * 知识库存储在 ~/.sleuth/knowledge/entities.json。
 *
 * 两个子命令：
 *
 *   index — 从 session 交付文件中提取实体，存入知识库
 *     用法：node research-index.mjs --action index --sid <session-id>
 *     流程：
 *       1. 读取 session 文件（~/.sleuth/sessions/<sid>.json）
 *       2. 找到 type=deliver 的操作记录
 *       3. 读取交付文件内容，提取实体
 *       4. 更新 entities.json（合并去重）
 *
 *   query — 查询知识库，返回与关键词相关的历史知识
 *     用法：node research-index.mjs --action query --query "Decagon AI"
 *     输出：JSON 格式的匹配结果（含 sessions 和交付文件路径）
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';

// ── 常量定义 ──────────────────────────────────────────────────────

const KNOWLEDGE_DIR = join(homedir(), '.sleuth', 'knowledge');
const ENTITIES_FILE = join(KNOWLEDGE_DIR, 'entities.json');
const SESSIONS_DIR = join(homedir(), '.sleuth', 'sessions');

// ── 工具函数 ──────────────────────────────────────────────────────

/** 确保知识库目录存在 */
function ensureKnowledgeDir() {
  if (!existsSync(KNOWLEDGE_DIR)) {
    mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  }
}

/** 加载 entities.json，文件不存在或解析失败返回空对象 */
function loadEntities() {
  if (!existsSync(ENTITIES_FILE)) return {};
  try {
    return JSON.parse(readFileSync(ENTITIES_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

/** 保存 entities.json */
function saveEntities(entities) {
  ensureKnowledgeDir();
  writeFileSync(ENTITIES_FILE, JSON.stringify(entities, null, 2), 'utf-8');
}

/**
 * 校验 session ID，防止路径遍历。
 * 只允许字母、数字、连字符、下划线。
 */
function validateSessionId(sid) {
  if (!/^[a-zA-Z0-9_-]+$/.test(sid)) {
    throw new Error(`Invalid session ID: ${sid}`);
  }
}

/**
 * 从 sid 中提取日期部分（前 10 个字符：YYYY-MM-DD）。
 * 如果格式不符，返回当前日期。
 */
function extractDate(sid) {
  const m = sid.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : new Date().toISOString().slice(0, 10);
}

/**
 * 推断实体类型。
 * 基于文件名和上下文关键词做简单判断。
 */
function inferEntityType(text) {
  const lower = text.toLowerCase();
  if (/公司|company|startup|inc|corp|ltd/.test(lower)) return 'company';
  if (/人物|founder|ceo|cto|联合创始人/.test(lower)) return 'person';
  return 'topic';
}

/**
 * 生成小写别名数组。
 * 规则：实体名的小写形式，以及实体名中每个大写开头的英文单词的小写形式。
 */
function generateAliases(name) {
  const aliases = new Set();
  aliases.add(name.toLowerCase());

  // 提取英文单词（大写开头），逐个加入别名
  const words = name.match(/[A-Z][a-zA-Z0-9]+/g);
  if (words) {
    for (const w of words) {
      if (w.length > 1) aliases.add(w.toLowerCase());
    }
  }

  return [...aliases];
}

/** 通用停用词（英文大写开头） */
const STOP_WORDS = new Set([
  'AI', 'The', 'This', 'That', 'What', 'How', 'Why', 'For', 'With',
  'And', 'Or', 'In', 'On', 'At', 'To', 'By', 'From', 'Of', 'A', 'An',
  'Is', 'Are', 'Was', 'Were', 'Be', 'Been', 'Being', 'Have', 'Has',
  'Had', 'Do', 'Does', 'Did', 'Will', 'Would', 'Could', 'Should',
  'Can', 'May', 'Might', 'Must', 'Shall', 'Not', 'No', 'But', 'If',
  'So', 'Up', 'Out', 'As', 'It', 'Its', 'We', 'He', 'She', 'They',
  'My', 'Your', 'His', 'Her', 'Our', 'Their', 'Who', 'Which',
]);

/** 中文停用词 */
const CN_STOP_WORDS = new Set([
  '公司', '产品', '融资', '基本信息', '创始人', '总部', '员工', '官网',
  '产品与战略', '收入与增长', '融资历史', '收并购', '人才战略', '定位',
  '成立', '数据来源', '调研时间', '调研范围', '美国', '欧洲', '中国',
  '总结', '概述', '背景', '介绍', '分析', '比较', '结论', '附录',
]);

/**
 * 从文本块中提取 facts（金额、融资轮次、估值、ARR 等）。
 */
function extractFactsFromBlock(block) {
  const facts = new Set();
  let m;

  const moneyRegex = /\$[\d,.]+\s*(万|亿|million|billion|M|B|万亿|亿)?/gi;
  while ((m = moneyRegex.exec(block)) !== null) facts.add(m[0].trim());

  const rmbRegex = /[\d,.]+\s*(万|亿|百万|千万|万亿)元(人民币)?/g;
  while ((m = rmbRegex.exec(block)) !== null) facts.add(m[0].trim());

  const roundRegex = /(?:Series\s+[A-Z]|A轮|B轮|C轮|D轮|天使轮|种子轮|Pre-[AB]|IPO|上市)/g;
  while ((m = roundRegex.exec(block)) !== null) facts.add(m[0].trim());

  if (/Y\s*Combinator|Y\s*C/i.test(block)) facts.add('Y Combinator');

  const valuationRegex = /估值\s*[：:]\s*[\d,.]+\s*(万|亿|million|billion|美元|元)?/gi;
  while ((m = valuationRegex.exec(block)) !== null) facts.add(m[0].trim());

  const arrRegex = /ARR[：:\s]*\$?[\d,.]+\s*(万|亿|million|billion)?/gi;
  while ((m = arrRegex.exec(block)) !== null) facts.add(m[0].trim());

  return [...facts];
}

/**
 * 从交付文件内容中提取实体。
 *
 * 策略：按 ## 标题分段，每段提取实体名和该段内的 facts。
 * facts 只归属于同一段落内的实体，避免跨实体污染。
 */
function extractEntities(content) {
  const entities = [];
  const seen = new Set();
  const domains = new Set();

  // 按 ## 标题分割内容为段落
  const sections = content.split(/^(#{1,3}\s+.+)$/gm);

  // sections 布局：[前导文本, 标题1, 段落1, 标题2, 段落2, ...]
  // 处理每对 (标题, 段落)
  for (let i = 0; i < sections.length; i++) {
    const heading = sections[i];
    const block = (sections[i + 1] || '') + ' ' + heading; // 段落 + 标题

    // 只处理 ## 级别标题（跳过 # 一级大标题和普通文本）
    if (!/^#{1,3}\s+/.test(heading)) continue;

    const line = heading.replace(/^#{1,3}\s+/, '').trim();
    if (/^\d+$/.test(line)) continue;
    if (/^(一|二|三|四|五|六|七|八|九|十)[、．.\s]/.test(line)) continue;

    // 提取该段内的 facts
    const sectionFacts = extractFactsFromBlock(block);

    // 提取大写英文词组作为实体名
    const engNames = line.match(/(?:[A-Z][a-zA-Z0-9]*\s*)+/g);
    if (engNames) {
      for (const name of engNames) {
        const trimmed = name.trim();
        if (trimmed.length < 2) continue;
        if (STOP_WORDS.has(trimmed)) continue;
        if (!seen.has(trimmed.toLowerCase())) {
          seen.add(trimmed.toLowerCase());
          entities.push({ name: trimmed, facts: sectionFacts });
        }
      }
    }

    // 提取中文实体
    const cnNames = line.match(/[一-鿿]{2,10}/g);
    if (cnNames) {
      for (const name of cnNames) {
        if (CN_STOP_WORDS.has(name)) continue;
        if (!seen.has(name)) {
          seen.add(name);
          entities.push({ name, facts: sectionFacts });
        }
      }
    }

    // 从该段提取 URL 域名
    let m;
    const urlRegex = /https?:\/\/([^/\s]+)/g;
    while ((m = urlRegex.exec(block)) !== null) {
      let host = m[1].replace(/^www\./, '');
      if (host.length > 3) domains.add(host);
    }

    i++; // 跳过已处理的段落内容
  }

  return { entities, domains: [...domains] };
}

// ── 子命令：index ─────────────────────────────────────────────────

/**
 * index 命令：从 session 交付文件中提取实体，更新知识库。
 */
function cmdIndex(sid) {
  validateSessionId(sid);

  // 1. 读取 session 文件
  const sessionFile = join(SESSIONS_DIR, sid + '.json');
  if (!existsSync(sessionFile)) {
    console.error(`Error: session file not found: ${sessionFile}`);
    process.exit(1);
  }

  let session;
  try {
    session = JSON.parse(readFileSync(sessionFile, 'utf-8'));
  } catch (e) {
    console.error(`Error: failed to parse session file: ${e.message}`);
    process.exit(1);
  }

  // 2. 找到 type=deliver 的操作记录
  const delivers = (session.operations || []).filter(op => op.type === 'deliver');
  if (delivers.length === 0) {
    console.log(JSON.stringify({ indexed: 0, message: 'No deliver operations found in session' }));
    return;
  }

  // 3. 读取交付文件，提取实体
  const entities = loadEntities();
  const today = new Date().toISOString().slice(0, 10);
  let newCount = 0;
  let updatedCount = 0;
  const allRelated = new Set();

  for (const deliver of delivers) {
    const filePath = deliver.file;
    if (!filePath || !existsSync(filePath)) continue;

    let content;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const filename = filePath.split('/').pop() || '';
    const extracted = extractEntities(content);

    // 域名作为 related 池
    for (const domain of extracted.domains) {
      allRelated.add(domain);
    }

    // 处理提取到的实体
    for (const ent of extracted.entities) {
      const name = ent.name;
      const type = inferEntityType(filename + ' ' + content.slice(0, 500));
      const aliases = generateAliases(name);
      const date = extractDate(sid);
      const entFacts = ent.facts || [];

      if (entities[name]) {
        // 已存在 → 更新
        const existing = entities[name];
        existing.last_seen = date;
        existing.sessions = [...new Set([...existing.sessions, sid])];
        existing.facts = [...new Set([...existing.facts, ...entFacts])];
        existing.aliases = [...new Set([...existing.aliases, ...aliases])];
        updatedCount++;
      } else {
        // 新建
        entities[name] = {
          type,
          aliases,
          first_seen: date,
          last_seen: date,
          sessions: [sid],
          related: [],
          facts: [...entFacts],
        };
        newCount++;
      }
    }
  }

  // 4. 将域名分配给相关实体（通过 aliases 匹配）
  for (const domain of allRelated) {
    const domainBase = domain.split('.')[0].toLowerCase();
    for (const [name, ent] of Object.entries(entities)) {
      if (ent.aliases.some(a => a.toLowerCase() === domainBase)) {
        ent.related = [...new Set([...ent.related, domain])];
      }
    }
  }

  // 5. 保存
  saveEntities(entities);

  console.log(JSON.stringify({
    indexed: newCount + updatedCount,
    new: newCount,
    updated: updatedCount,
    total_entities: Object.keys(entities).length,
  }));
}

// ── 子命令：query ─────────────────────────────────────────────────

/**
 * query 命令：按关键词查询知识库。
 * 搜索实体的 name、aliases、facts、related 字段。
 */
function cmdQuery(query) {
  const entities = loadEntities();

  if (Object.keys(entities).length === 0) {
    console.log(JSON.stringify({ matches: [], deliver_files: [] }));
    return;
  }

  // 将查询拆分为关键词（空格分隔，去空）
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (keywords.length === 0) {
    console.log(JSON.stringify({ matches: [], deliver_files: [] }));
    return;
  }

  const scored = [];

  for (const [name, ent] of Object.entries(entities)) {
    // 拼接所有可搜索文本
    const searchText = [
      name,
      ...(ent.aliases || []),
      ...(ent.facts || []),
      ...(ent.related || []),
    ].join(' ').toLowerCase();

    // 任一关键词命中即匹配，按命中数排序
    const hitCount = keywords.filter(kw => searchText.includes(kw)).length;
    if (hitCount > 0) {
      scored.push({ name, ent, hitCount });
    }
  }

  // 按命中数降序排列
  scored.sort((a, b) => b.hitCount - a.hitCount);

  const matches = [];
  const matchedSessions = new Set();
  for (const { name, ent } of scored) {
    matches.push({
      name,
      type: ent.type,
      facts: ent.facts || [],
      sessions: ent.sessions || [],
      related: ent.related || [],
    });
    for (const s of (ent.sessions || [])) {
      matchedSessions.add(s);
    }
  }

  // 查找匹配 sessions 的交付文件路径
  const deliverFiles = [];
  for (const sid of matchedSessions) {
    const sessionFile = join(SESSIONS_DIR, sid + '.json');
    if (!existsSync(sessionFile)) continue;
    try {
      const session = JSON.parse(readFileSync(sessionFile, 'utf-8'));
      const delivers = (session.operations || []).filter(op => op.type === 'deliver' && op.file);
      for (const d of delivers) {
        if (existsSync(d.file)) deliverFiles.push(d.file);
      }
    } catch {
      // 跳过无法解析的 session
    }
  }

  console.log(JSON.stringify({ matches, deliver_files: deliverFiles }, null, 2));
}

// ── 参数解析与路由 ────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    options: {
      action: { type: 'string' },   // 子命令：index / query
      sid:    { type: 'string' },   // index 时的 session ID
      query:  { type: 'string' },   // query 时的搜索关键词
      help:   { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log('Usage: node research-index.mjs --action <index|query> [options]');
    console.log('  --action index --sid <id>          Index entities from a session');
    console.log('  --action query --query <keywords>  Query knowledge base');
    return;
  }

  switch (values.action) {
    case 'index': {
      if (!values.sid) {
        console.error('Error: --sid is required for action "index"');
        process.exit(2);
      }
      cmdIndex(values.sid);
      break;
    }
    case 'query': {
      if (!values.query) {
        console.error('Error: --query is required for action "query"');
        process.exit(2);
      }
      cmdQuery(values.query);
      break;
    }
    default:
      console.error(`Error: unknown action "${values.action}". Must be index or query.`);
      process.exit(2);
  }
}

main();
