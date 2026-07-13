#!/usr/bin/env node
/**
 * normalize.mjs — 归一化器：读 raw/*.jsonl → 清洗 → 合并到 findings.jsonl + 输出 stats-summary.json。
 *
 * 做的事：
 *   1. 读 <task-dir>/raw/*.jsonl（所有文件）
 *   2. 逐行 parse → 清洗 + 字段校验
 *   3. 合并到 <task-dir>/findings.jsonl（append，不覆盖）
 *   4. parse 失败的行写入 <task-dir>/parse_errors.log
 *   5. 按子问题分组统计 → 输出 <task-dir>/stats-summary.json
 *
 * 用法：node scripts/normalize.mjs <task-dir>
 * 输出：stdout 报告（每个 raw 文件的行数 vs 归一化后行数）
 */

import fs from 'node:fs';
import path from 'node:path';

// ── 常量 ────────────────────────────────────────────────────

const VALID_TYPES = new Set(['finding', 'gap', 'red_flag', 'agent_done']);
const CONFIDENCE_ENUMS = ['已验证事实', '高置信推断', '未确认线索', '冲突信息', '覆盖缺口'];
const TIER_MAP = { 1: 'T1', 2: 'T2', 3: 'T3', primary: 'T1', secondary: 'T2', tertiary: 'T3' };
const VALID_TIERS = new Set(['T1', 'T2', 'T3']);

// ── 工具函数 ────────────────────────────────────────────────

function log(msg) { console.log(msg); }
function err(msg) { console.error(msg); }

/** claim 文本归一化——lowercase + 去标点 + 折叠空白。用作 claim_id。 */
function normalizeClaim(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff]/g, '')  // 保留字母数字下划线空白和中日韩
    .replace(/\s+/g, ' ')
    .trim();
}

/** URL 规范化——小写 host + 去尾斜杠 + 去 utm 参数。 */
function normalizeUrl(url) {
  if (!url) return url;
  try {
    // 去 utm_* 参数
    const cleaned = url.replace(/([?&])utm_[^&=&]*=[^&]*/g, '').replace(/[?&]$/, '');
    // 小写 host（协议后、第一个 / 前）
    return cleaned.replace(/^(https?:\/\/)([^/]+)/i, (_, proto, host) => proto + host.toLowerCase());
  } catch {
    return url;
  }
}

/** tier 归一化——整数/英文 → T1/T2/T3 */
function normalizeTier(tier) {
  if (typeof tier === 'number' || (typeof tier === 'string' && /^\d+$/.test(tier))) {
    return TIER_MAP[Number(tier)] || null;
  }
  if (typeof tier === 'string' && TIER_MAP[tier.toLowerCase()]) {
    return TIER_MAP[tier.toLowerCase()];
  }
  if (typeof tier === 'string' && VALID_TIERS.has(tier)) {
    return tier;
  }
  return null;
}

/** confidence 归一化——不在枚举里时按 tier 推断 */
function normalizeConfidence(confidence, tier) {
  if (CONFIDENCE_ENUMS.includes(confidence)) return confidence;
  // 按 tier 推断
  if (tier === 'T1' || tier === 'T2') return '高置信推断';
  if (tier === 'T3') return '未确认线索';
  return '未确认线索';  // 保守 fallback
}

/** dimensions_seen 归一化——字符串数组 → 对象数组 */
function normalizeDimensions(dims) {
  if (!Array.isArray(dims)) return [];
  return dims.map((d) => {
    if (typeof d === 'string') return { dimension: d, observation: '' };
    if (typeof d === 'object' && d !== null) return { dimension: d.dimension || '', observation: d.observation || '' };
    return { dimension: String(d), observation: '' };
  });
}

/**
 * 归一化单行。
 * @returns {{ row: object | null, error: string | null }}
 */
function normalizeRow(rawLine, agentName, round) {
  let parsed;
  try {
    parsed = JSON.parse(rawLine);
  } catch (e) {
    return { row: null, error: `JSON parse error: ${e.message}` };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { row: null, error: 'Not a JSON object' };
  }

  // agent_done sentinel——不进 findings，单独处理
  if (parsed.type === 'agent_done') {
    return { row: null, error: null, sentinel: parsed };
  }

  // type 归一化
  let type = parsed.type;
  if (!VALID_TYPES.has(type)) {
    type = 'finding';  // 强制改 finding
  }

  const now = new Date().toISOString();
  const base = { ts: parsed.ts || now, round: parsed.round || round || 1, agent: parsed.agent || agentName };

  if (type === 'finding') {
    // 必填字段校验
    if (!parsed.claim || !parsed.url) {
      return { row: null, error: `finding 缺必填字段: ${!parsed.claim ? 'claim ' : ''}${!parsed.url ? 'url' : ''}` };
    }
    const tier = normalizeTier(parsed.tier);
    if (!tier) {
      return { row: null, error: `finding tier 无效: ${parsed.tier}` };
    }
    const confidence = normalizeConfidence(parsed.confidence, tier);
    const claimId = normalizeClaim(parsed.claim);
    return {
      row: {
        ...base,
        type: 'finding',
        claim: parsed.claim,
        claim_id: claimId,
        url: normalizeUrl(parsed.url),
        confidence,
        tier,
        dimensions_seen: normalizeDimensions(parsed.dimensions_seen),
        ...(parsed.follow_up_questions ? { follow_up_questions: parsed.follow_up_questions } : {}),
        ...(parsed.screenshot_path ? { screenshot_path: parsed.screenshot_path } : {}),
      },
      error: null,
    };
  }

  if (type === 'gap') {
    if (!parsed.what || !parsed.reason) {
      return { row: null, error: `gap 缺必填字段: ${!parsed.what ? 'what ' : ''}${!parsed.reason ? 'reason' : ''}` };
    }
    return { row: { ...base, type: 'gap', what: parsed.what, reason: parsed.reason }, error: null };
  }

  if (type === 'red_flag') {
    if (!parsed.claim || !parsed.reason) {
      return { row: null, error: `red_flag 缺必填字段: ${!parsed.claim ? 'claim ' : ''}${!parsed.reason ? 'reason' : ''}` };
    }
    return { row: { ...base, type: 'red_flag', claim: parsed.claim, reason: parsed.reason }, error: null };
  }

  return { row: null, error: `未知 type: ${type}` };
}

// ── 解析 task_spec 提取完成标准 ────────────────────────────

/**
 * 从 task_spec.md 提取每个子问题的完成标准。
 * 返回 { "1": { min_sources, min_t1, required_fields, max_age_days, title }, ... }
 */
function parseTaskSpec(taskDir) {
  const specPath = path.join(taskDir, 'task_spec.md');
  let content;
  try {
    content = fs.readFileSync(specPath, 'utf8');
  } catch {
    return {};
  }

  const result = {};
  const lines = content.split('\n');
  let currentId = null;
  let currentTitle = null;

  for (const line of lines) {
    // 匹配 "- [ ] 1. 标题" 或 "- [x] 1. 标题"
    const m = line.match(/^- \[[ x]\] (\d+)\.\s*(.+)/);
    if (m) {
      currentId = m[1];
      currentTitle = m[2].trim().replace(/\s*✅.*$/, '');
      result[currentId] = {
        title: currentTitle,
        min_sources: 2,
        min_t1: 1,
        required_fields: [],
        max_age_days: 365,
      };
      continue;
    }
    if (currentId && line.match(/^\s+- \[/)) {
      // 子节点（如 1.1）——不重置 currentId
      continue;
    }
    if (currentId) {
      const ms = line.match(/min_sources:\s*(\d+)/);
      const mt = line.match(/min_t1:\s*(\d+)/);
      const rf = line.match(/required_fields:\s*\[([^\]]*)\]/);
      const ma = line.match(/max_age_days:\s*(\d+)/);
      if (ms) result[currentId].min_sources = Number(ms[1]);
      if (mt) result[currentId].min_t1 = Number(mt[1]);
      if (rf) result[currentId].required_fields = rf[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
      if (ma) result[currentId].max_age_days = Number(ma[1]);
    }
    // 遇到下一个顶级条目重置
    if (line.match(/^## /)) currentId = null;
  }

  return result;
}

// ── 生成 stats-summary.json ────────────────────────────────

/**
 * 按子问题分组统计 findings，生成 stats-summary.json。
 */
function generateStatsSummary(allRows, taskCriteria, round) {
  const bySubquestion = {};
  const byType = { finding: 0, gap: 0, red_flag: 0 };
  const byTier = { T1: 0, T2: 0, T3: 0 };
  let totalFindings = 0;
  let totalT1 = 0;

  // 初始化每个子问题的统计
  for (const [id, criteria] of Object.entries(taskCriteria)) {
    bySubquestion[id] = {
      title: criteria.title,
      findings_count: 0,
      t1_count: 0,
      unique_urls: new Set(),
      meets_criteria: false,
      gaps_to_resolve: [],
      status: '[ ]',
    };
  }

  // 遍历所有行，按关键词匹配归类到子问题
  for (const row of allRows) {
    if (row.type === 'finding') {
      totalFindings++;
      byType.finding++;
      if (byTier[row.tier] !== undefined) byTier[row.tier]++;

      // 按 claim 文本匹配子问题（关键词匹配）
      const claimLower = (row.claim || '').toLowerCase();
      for (const [id, criteria] of Object.entries(taskCriteria)) {
        const titleLower = criteria.title.toLowerCase();
        const fieldsLower = criteria.required_fields.map((f) => f.toLowerCase());
        const titleWords = titleLower.split(/\s+/).filter((w) => w.length > 2);
        const matches = titleWords.some((w) => claimLower.includes(w)) ||
          fieldsLower.some((f) => claimLower.includes(f)) ||
          (row.dimensions_seen || []).some((d) => titleWords.some((w) => (d.dimension || '').toLowerCase().includes(w)));
        if (matches) {
          bySubquestion[id].findings_count++;
          if (row.tier === 'T1') {
            bySubquestion[id].t1_count++;
            totalT1++;
          }
          bySubquestion[id].unique_urls.add(row.url);

          // 提取 follow_up_questions 到 gaps_to_resolve
          if (row.follow_up_questions && Array.isArray(row.follow_up_questions)) {
            for (const q of row.follow_up_questions) {
              if (!bySubquestion[id].gaps_to_resolve.includes(q)) {
                bySubquestion[id].gaps_to_resolve.push(q);
              }
            }
          }
        }
      }
    } else if (row.type === 'gap') {
      byType.gap++;
      // gap 行的 what 归到匹配的子问题
      const whatLower = (row.what || '').toLowerCase();
      for (const [id, criteria] of Object.entries(taskCriteria)) {
        const titleWords = criteria.title.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        if (titleWords.some((w) => whatLower.includes(w))) {
          if (!bySubquestion[id].gaps_to_resolve.includes(row.what)) {
            bySubquestion[id].gaps_to_resolve.push(row.what);
          }
        }
      }
    } else if (row.type === 'red_flag') {
      byType.red_flag++;
    }
  }

  // 判定每个子问题的 meets_criteria
  for (const [id, criteria] of Object.entries(taskCriteria)) {
    const stats = bySubquestion[id];
    const sourcesOk = stats.unique_urls.size >= criteria.min_sources;
    const t1Ok = stats.t1_count >= criteria.min_t1;
    // required_fields 覆盖判定（简化版——实际需要 LLM 语义判断，这里用近似）
    const fieldsOk = criteria.required_fields.length === 0;  // 无 required_fields 默认过
    stats.meets_criteria = sourcesOk && t1Ok && fieldsOk;
    stats.unique_urls = stats.unique_urls.size;  // Set → number
    stats.status = stats.meets_criteria ? '[x]' : '[ ]';
  }

  return {
    round,
    generated_at: new Date().toISOString(),
    total_findings: totalFindings,
    total_t1: totalT1,
    by_subquestion: bySubquestion,
    by_type: byType,
    by_tier: byTier,
  };
}

// ── 主流程 ═════════════════════════════════════════════════

const taskDir = process.argv[2];

if (!taskDir || taskDir === '--help' || taskDir === '-h') {
  log('用法：node scripts/normalize.mjs <task-dir>');
  log('功能：读 raw/*.jsonl → 清洗 → 合并到 findings.jsonl + 输出 stats-summary.json');
  process.exit(taskDir ? 0 : 2);
}

// 解析 task-dir（支持 ~ 展开）
const resolvedDir = taskDir.replace(/^~/, process.env.HOME || '');
const rawDir = path.join(resolvedDir, 'raw');

if (!fs.existsSync(rawDir)) {
  err(`✗ raw/ 目录不存在: ${rawDir}`);
  err('  确保 search 子 Agent 已经直写 raw/search-*.jsonl');
  process.exit(1);
}

// 1. 列出所有 raw 文件
const rawFiles = fs.readdirSync(rawDir)
  .filter((f) => f.endsWith('.jsonl') && f.startsWith('search-'))
  .map((f) => ({ name: f, path: path.join(rawDir, f) }));

if (rawFiles.length === 0) {
  err(`✗ raw/ 目录下没有 search-*.jsonl 文件`);
  process.exit(1);
}

log(`归一化器：读 ${rawFiles.length} 个 raw 文件 → findings.jsonl + stats-summary.json`);
log('');

// 2. 逐文件处理
const allRows = [];
const parseErrors = [];
let hasFailedAgent = false;

for (const { name, path: filePath } of rawFiles) {
  const agentName = name.replace(/^search-/, '').replace(/\.jsonl$/, '');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);
  let accepted = 0;
  let rejected = 0;

  for (const line of lines) {
    const { row, error, sentinel } = normalizeRow(line, agentName);
    if (error) {
      rejected++;
      parseErrors.push(`${new Date().toISOString()} | ${name} | ${error} | ${line.slice(0, 100)}`);
      continue;
    }
    if (sentinel) {
      // agent_done——验证行数
      const actualLines = lines.length - 1;  // 减去 sentinel 本身
      if (sentinel.lines_written !== undefined && sentinel.lines_written !== actualLines) {
        parseErrors.push(`${new Date().toISOString()} | ${name} | 行数不符: sentinel 说 ${sentinel.lines_written} 实际 ${actualLines}`);
      }
      continue;
    }
    if (row) {
      accepted++;
      allRows.push(row);
    }
  }

  const rejectRate = lines.length > 0 ? rejected / lines.length : 0;
  const status = rejectRate > 0.5 ? '⚠ >50% 拒绝' : '✓';
  log(`  ${status} ${name}: ${accepted} 接受, ${rejected} 拒绝 (${Math.round(rejectRate * 100)}%)`);

  if (rejectRate > 0.5) {
    hasFailedAgent = true;
  }
}

log('');

// 3. 写 parse_errors.log
if (parseErrors.length > 0) {
  const errorPath = path.join(resolvedDir, 'parse_errors.log');
  fs.writeFileSync(errorPath, parseErrors.join('\n') + '\n', 'utf8');
  log(`parse_errors.log: ${parseErrors.length} 条错误`);
}

// 4. 读现有 findings.jsonl → append 新行
const findingsPath = path.join(resolvedDir, 'findings.jsonl');
let existingCount = 0;
try {
  const existing = fs.readFileSync(findingsPath, 'utf8');
  existingCount = existing.trim().split('\n').filter(Boolean).length;
} catch { /* 文件不存在——从空开始 */ }

const newLines = allRows.map((r) => JSON.stringify(r)).join('\n');
if (existingCount > 0) {
  fs.appendFileSync(findingsPath, '\n' + newLines + '\n', 'utf8');
} else {
  fs.writeFileSync(findingsPath, newLines + '\n', 'utf8');
}
log(`findings.jsonl: ${existingCount} 已有 + ${allRows.length} 新增 = ${existingCount + allRows.length} 总计`);

// 5. 生成 stats-summary.json
const taskCriteria = parseTaskSpec(resolvedDir);
const maxRound = allRows.reduce((max, r) => Math.max(max, r.round || 1), 1);
const summary = generateStatsSummary(allRows, taskCriteria, maxRound);
const summaryPath = path.join(resolvedDir, 'stats-summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
log(`stats-summary.json: ${Object.keys(taskCriteria).length} 个子问题, ${summary.total_findings} findings, ${summary.total_t1} T1`);

log('');
if (hasFailedAgent) {
  err('⚠ 有 Agent >50% 行被拒绝——按 §3.2 健康监控重派');
  process.exit(1);
}
log('✓ 归一化完成');
