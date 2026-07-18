#!/usr/bin/env node
/**
 * normalize.mjs — 从 raw/ 确定性重建 findings.jsonl 与 stats-summary.json。
 *
 * raw/ 是唯一原始账本；findings.jsonl 是派生文件，绝不追加旧结果。
 * 同一批 raw 重跑多少次，findings.jsonl 都必须完全一致。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VALID_TYPES = new Set(['finding', 'gap', 'red_flag', 'agent_done']);
const VALID_TIERS = new Set(['T1', 'T2', 'T3']);
const TIER_MAP = { 1: 'T1', 2: 'T2', 3: 'T3', primary: 'T1', secondary: 'T2', tertiary: 'T3' };

function log(message) { console.log(message); }
function err(message) { console.error(message); }

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\w\s\u3400-\u9fff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableId(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function normalizeUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^utm_/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/$/, '');
    return parsed.toString().replace(/\?$/, '');
  } catch {
    return String(url).trim();
  }
}

function normalizeTier(tier) {
  if (VALID_TIERS.has(tier)) return tier;
  if (typeof tier === 'number' || /^\d+$/.test(String(tier || ''))) return TIER_MAP[Number(tier)] || null;
  return TIER_MAP[String(tier || '').toLowerCase()] || null;
}

function strongestTier(sources) {
  if (sources.some((source) => source.tier === 'T1')) return 'T1';
  if (sources.some((source) => source.tier === 'T2')) return 'T2';
  return 'T3';
}

function sourceDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return url; }
}

function deriveConfidence(sources) {
  const supporting = sources.filter((source) => source.stance !== 'contradicts');
  const contradicting = sources.filter((source) => source.stance === 'contradicts');
  if (supporting.length > 0 && contradicting.length > 0) return '冲突信息';
  const domains = new Set(supporting.map((source) => sourceDomain(source.url)));
  if (domains.size >= 2 && supporting.some((source) => source.tier === 'T1')) return '已验证事实';
  if (supporting.some((source) => source.tier === 'T1' || source.tier === 'T2')) return '高置信推断';
  return '未确认线索';
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeDimensions(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  for (const item of value) {
    const normalized = typeof item === 'string'
      ? { dimension: item.trim(), observation: '' }
      : { dimension: String(item?.dimension || '').trim(), observation: String(item?.observation || '').trim() };
    if (!normalized.dimension) continue;
    const key = `${normalized.dimension}\u0000${normalized.observation}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

function normalizeContextLinks(value) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(['compares', 'extends', 'follows', 'causes', 'contradicts', 'complements', 'bounds']);
  const result = [];
  const seen = new Set();
  for (const item of value) {
    const claimKey = String(item?.claim_key || '').trim();
    const relationship = String(item?.relationship || '').trim();
    if (!claimKey || !allowed.has(relationship)) continue;
    const key = `${claimKey}\u0000${relationship}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ claim_key: claimKey, relationship });
    }
  }
  return result;
}

function inferFileIdentity(fileName) {
  const current = fileName.match(/^search-r(\d+)-(.+)\.jsonl$/);
  if (current) return { round: Number(current[1]), agent: current[2], legacy: false };
  const legacy = fileName.match(/^search-(.+)\.jsonl$/);
  return { round: null, agent: legacy?.[1] || 'unknown', legacy: true };
}

function normalizeSources(parsed, fallbackObservedAt) {
  const input = Array.isArray(parsed.sources) && parsed.sources.length > 0
    ? parsed.sources
    : [{
        url: parsed.url,
        tier: parsed.tier,
        source_date: parsed.source_date,
        observed_at: parsed.observed_at || parsed.ts,
        stance: parsed.stance,
      }];

  const result = [];
  const seen = new Set();
  for (const item of input) {
    const url = normalizeUrl(item?.url);
    const tier = normalizeTier(item?.tier ?? parsed.tier);
    if (!url || !tier) continue;
    const stance = item?.stance === 'contradicts' ? 'contradicts' : 'supports';
    const key = `${url}\u0000${stance}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      url,
      tier,
      stance,
      observed_at: item?.observed_at || parsed.observed_at || parsed.ts || fallbackObservedAt,
      ...(item?.source_date || parsed.source_date ? { source_date: item?.source_date || parsed.source_date } : {}),
    });
  }
  return result.sort((a, b) => `${a.url}:${a.stance}`.localeCompare(`${b.url}:${b.stance}`));
}

function normalizeRow(rawLine, identity, fallbackObservedAt) {
  let parsed;
  try { parsed = JSON.parse(rawLine); } catch (error) {
    return { error: `JSON parse error: ${error.message}` };
  }
  if (!parsed || typeof parsed !== 'object') return { error: 'Not a JSON object' };
  if (parsed.type === 'agent_done') return { sentinel: parsed };

  const type = VALID_TYPES.has(parsed.type) ? parsed.type : null;
  if (!type) return { error: `type 无效: ${parsed.type}` };
  const explicitRound = Number(parsed.round);
  const round = Number.isInteger(explicitRound) && explicitRound > 0 ? explicitRound : identity.round;
  const base = {
    schema_version: 2,
    ts: parsed.ts || parsed.observed_at || fallbackObservedAt,
    round,
    ...(round === null ? { legacy_round_unknown: true } : {}),
    agent: parsed.agent || identity.agent,
    subquestion_ids: normalizeStringArray(parsed.subquestion_ids),
  };

  if (type === 'finding') {
    if (!parsed.claim) return { error: 'finding 缺必填字段: claim' };
    const sources = normalizeSources(parsed, fallbackObservedAt);
    if (sources.length === 0) return { error: 'finding 缺有效 sources（至少 1 个 url + tier）' };
    const fieldsCovered = normalizeStringArray(parsed.fields_covered);
    const fallbackKey = `legacy:${normalizeText(parsed.claim)}`;
    const claimKey = String(parsed.claim_key || fallbackKey).trim();
    return {
      row: {
        ...base,
        type,
        claim: String(parsed.claim).trim(),
        claim_key: claimKey,
        claim_id: stableId(normalizeText(claimKey)),
        subquestion_ids: normalizeStringArray(parsed.subquestion_ids),
        fields_covered: fieldsCovered,
        sources,
        url: sources[0].url,
        tier: strongestTier(sources),
        confidence: deriveConfidence(sources),
        dimensions_seen: normalizeDimensions(parsed.dimensions_seen),
        context_links: normalizeContextLinks(parsed.context_links),
        ...(Array.isArray(parsed.follow_up_questions) ? { follow_up_questions: normalizeStringArray(parsed.follow_up_questions) } : {}),
        ...(parsed.screenshot_path ? { screenshot_path: String(parsed.screenshot_path) } : {}),
      },
    };
  }

  if (type === 'gap') {
    if (!parsed.what || !parsed.reason) return { error: 'gap 缺必填字段: what/reason' };
    return { row: { ...base, type, what: String(parsed.what), reason: String(parsed.reason) } };
  }

  if (!parsed.claim || !parsed.reason) return { error: 'red_flag 缺必填字段: claim/reason' };
  const sources = normalizeSources(parsed, fallbackObservedAt);
  if (sources.length === 0) return { error: 'red_flag 缺有效 sources（至少 1 个 url + tier）' };
  return { row: { ...base, type, claim: String(parsed.claim), reason: String(parsed.reason), sources } };
}

function mergeFindings(rows) {
  const findings = new Map();
  const otherRows = new Map();

  for (const row of rows) {
    if (row.type !== 'finding') {
      const content = row.type === 'gap' ? `${row.what}:${row.reason}` : `${row.claim}:${row.reason}`;
      const key = `${row.type}:${normalizeText(content)}:${row.subquestion_ids.join(',')}`;
      if (!otherRows.has(key)) otherRows.set(key, row);
      else if (row.type === 'red_flag') {
        const existing = otherRows.get(key);
        existing.sources = normalizeSources({ sources: [...(existing.sources || []), ...(row.sources || [])] }, existing.ts);
      }
      continue;
    }

    const key = normalizeText(row.claim_key);
    if (!findings.has(key)) {
      findings.set(key, {
        ...row,
        agents: [row.agent],
        rounds_seen: row.round === null ? [] : [row.round],
      });
      continue;
    }

    const existing = findings.get(key);
    if (row.claim.length > existing.claim.length) existing.claim = row.claim;
    existing.agents = [...new Set([...existing.agents, row.agent])].sort();
    existing.rounds_seen = [...new Set([...existing.rounds_seen, ...(row.round === null ? [] : [row.round])])].sort((a, b) => a - b);
    existing.round = existing.rounds_seen[0] ?? null;
    existing.subquestion_ids = [...new Set([...existing.subquestion_ids, ...row.subquestion_ids])].sort();
    existing.fields_covered = [...new Set([...existing.fields_covered, ...row.fields_covered])].sort();
    existing.follow_up_questions = [...new Set([...(existing.follow_up_questions || []), ...(row.follow_up_questions || [])])].sort();
    existing.dimensions_seen = normalizeDimensions([...existing.dimensions_seen, ...row.dimensions_seen]);
    existing.context_links = normalizeContextLinks([...existing.context_links, ...row.context_links]);
    existing.sources = normalizeSources({ sources: [...existing.sources, ...row.sources] }, existing.ts);
    existing.url = existing.sources[0].url;
    existing.tier = strongestTier(existing.sources);
    existing.confidence = deriveConfidence(existing.sources);
    if (!existing.screenshot_path && row.screenshot_path) existing.screenshot_path = row.screenshot_path;
  }

  const merged = [...findings.values()].map((row) => {
    if (!row.follow_up_questions?.length) delete row.follow_up_questions;
    return row;
  });
  return [...merged, ...otherRows.values()].sort((a, b) => {
    const typeOrder = { finding: 0, gap: 1, red_flag: 2 };
    const typeDiff = typeOrder[a.type] - typeOrder[b.type];
    if (typeDiff !== 0) return typeDiff;
    const aKey = a.claim_key || a.what || a.claim;
    const bKey = b.claim_key || b.what || b.claim;
    return String(aKey).localeCompare(String(bKey));
  });
}

function parseTaskSpec(taskDir) {
  const specPath = path.join(taskDir, 'task_spec.md');
  if (!fs.existsSync(specPath)) return { task_type: 'general', criteria: {} };
  const content = fs.readFileSync(specPath, 'utf8');
  const taskType = content.match(/task_type\s*[:：]\s*`?([a-z_]+)/i)?.[1] || 'general';
  const criteria = {};
  let currentId = null;

  for (const line of content.split('\n')) {
    const question = line.match(/^- \[[ xX]\] (\d+(?:\.\d+)*)\.\s*(.+)/);
    if (question) {
      currentId = question[1];
      criteria[currentId] = {
        title: question[2].trim().replace(/\s*✅.*$/, ''),
        min_sources: 2,
        min_t1: 1,
        required_fields: [],
        max_age_days: 365,
        known_limit: '',
      };
      continue;
    }
    if (/^##\s/.test(line)) currentId = null;
    if (!currentId) continue;
    const minSources = line.match(/min_sources\s*:\s*(\d+)/);
    const minT1 = line.match(/min_t1\s*:\s*(\d+)/);
    const requiredFields = line.match(/required_fields\s*:\s*\[([^\]]*)\]/);
    const maxAge = line.match(/max_age_days\s*:\s*(\d+)/);
    const knownLimit = line.match(/known_limit\s*:\s*(.+)/);
    if (minSources) criteria[currentId].min_sources = Number(minSources[1]);
    if (minT1) criteria[currentId].min_t1 = Number(minT1[1]);
    if (requiredFields) criteria[currentId].required_fields = requiredFields[1].split(',').map((value) => value.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    if (maxAge) criteria[currentId].max_age_days = Number(maxAge[1]);
    if (knownLimit) criteria[currentId].known_limit = knownLimit[1].trim();
  }
  return { task_type: taskType, criteria };
}

function sourceIsFresh(source, maxAgeDays, now) {
  const timestamp = Date.parse(source.source_date || source.observed_at || '');
  if (!Number.isFinite(timestamp)) return false;
  const ageDays = Math.max(0, (now.getTime() - timestamp) / 86_400_000);
  return ageDays <= maxAgeDays;
}

function generateStatsSummary(rows, taskSpec) {
  const now = new Date();
  const byType = { finding: 0, gap: 0, red_flag: 0 };
  const byTier = { T1: 0, T2: 0, T3: 0 };
  const bySubquestion = {};
  let unassignedFindings = 0;
  const unknownSubquestionIds = new Set();

  for (const [id, criteria] of Object.entries(taskSpec.criteria)) {
    bySubquestion[id] = {
      title: criteria.title,
      findings_count: 0,
      unique_urls: 0,
      t1_count: 0,
      fields_covered: [],
      fields_missing: [...criteria.required_fields],
      stale_sources: 0,
      gaps_to_resolve: [],
      meets_criteria: false,
      accepted_limit: Boolean(criteria.known_limit),
      known_limit: criteria.known_limit || null,
      status: '[ ]',
    };
  }

  for (const row of rows) {
    byType[row.type]++;
    if (row.type === 'finding') byTier[row.tier]++;
  }

  for (const [id, criteria] of Object.entries(taskSpec.criteria)) {
    const related = rows.filter((row) => row.subquestion_ids?.includes(id));
    const findings = related.filter((row) => row.type === 'finding');
    const gaps = related.filter((row) => row.type === 'gap');
    const freshSources = new Map();
    const staleSources = new Set();
    const fields = new Set();

    for (const finding of findings) {
      const findingHasFreshSource = finding.sources.some((source) => sourceIsFresh(source, criteria.max_age_days, now));
      for (const source of finding.sources) {
        if (sourceIsFresh(source, criteria.max_age_days, now)) freshSources.set(source.url, source);
        else staleSources.add(source.url);
      }
      if (findingHasFreshSource) for (const field of finding.fields_covered) fields.add(field);
    }

    const stats = bySubquestion[id];
    stats.findings_count = findings.length;
    stats.unique_urls = freshSources.size;
    stats.t1_count = [...freshSources.values()].filter((source) => source.tier === 'T1').length;
    stats.fields_covered = [...fields].sort();
    stats.fields_missing = criteria.required_fields.filter((field) => !fields.has(field));
    stats.stale_sources = staleSources.size;
    stats.gaps_to_resolve = [...new Set([
      ...gaps.map((gap) => gap.what),
      ...findings.flatMap((finding) => finding.follow_up_questions || []),
    ])];
    stats.meets_criteria = stats.unique_urls >= criteria.min_sources
      && stats.t1_count >= criteria.min_t1
      && stats.fields_missing.length === 0;
    stats.status = stats.meets_criteria ? '[x]' : '[ ]';
  }

  for (const row of rows) {
    if (row.type !== 'finding') continue;
    if (row.subquestion_ids.length === 0) unassignedFindings++;
    for (const id of row.subquestion_ids) {
      if (!Object.hasOwn(taskSpec.criteria, id)) unknownSubquestionIds.add(id);
    }
  }

  const numericRounds = rows.flatMap((row) => row.rounds_seen || (row.round ? [row.round] : []));
  return {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    task_type: taskSpec.task_type,
    round: numericRounds.length ? Math.max(...numericRounds) : null,
    total_records: rows.length,
    total_findings: byType.finding,
    total_t1: byTier.T1,
    unassigned_findings: unassignedFindings,
    unknown_subquestion_ids: [...unknownSubquestionIds].sort(),
    by_subquestion: bySubquestion,
    by_type: byType,
    by_tier: byTier,
  };
}

function atomicWrite(filePath, content) {
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, 'utf8');
  fs.renameSync(temporary, filePath);
}

const taskDir = process.argv[2];
if (!taskDir || taskDir === '--help' || taskDir === '-h') {
  log('用法：node scripts/normalize.mjs <task-dir>');
  log('功能：从 raw/*.jsonl 确定性重建 findings.jsonl + stats-summary.json');
  process.exit(taskDir ? 0 : 2);
}

const resolvedDir = taskDir.replace(/^~/, process.env.HOME || '');
const rawDir = path.join(resolvedDir, 'raw');
if (!fs.existsSync(rawDir)) {
  err(`✗ raw/ 目录不存在: ${rawDir}`);
  process.exit(1);
}

const rawFiles = fs.readdirSync(rawDir)
  .filter((file) => file.startsWith('search-') && file.endsWith('.jsonl'))
  .sort();
if (rawFiles.length === 0) {
  err('✗ raw/ 目录下没有 search-*.jsonl 文件');
  process.exit(1);
}

const parsedRows = [];
const parseErrors = [];
let failedAgents = 0;
log(`归一化器：从 ${rawFiles.length} 个 raw 文件重建结果`);

for (const fileName of rawFiles) {
  const filePath = path.join(rawDir, fileName);
  const identity = inferFileIdentity(fileName);
  const fallbackObservedAt = fs.statSync(filePath).mtime.toISOString();
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter((line) => line.trim());
  let accepted = 0;
  let rejected = 0;
  let sentinel = null;

  for (const line of lines) {
    const result = normalizeRow(line, identity, fallbackObservedAt);
    if (result.error) {
      rejected++;
      parseErrors.push(`${fileName} | ${result.error} | ${line.slice(0, 160)}`);
    } else if (result.sentinel) {
      sentinel = result.sentinel;
    } else if (result.row) {
      accepted++;
      parsedRows.push(result.row);
    }
  }

  if (sentinel?.lines_written !== undefined && Number(sentinel.lines_written) !== lines.length - 1) {
    parseErrors.push(`${fileName} | agent_done 行数不符: 声明 ${sentinel.lines_written}，实际 ${lines.length - 1}`);
  }
  if (!sentinel) parseErrors.push(`${fileName} | 缺 agent_done 结束标记`);
  const dataLines = Math.max(1, lines.length - (sentinel ? 1 : 0));
  if (rejected / dataLines > 0.5) failedAgents++;
  log(`  ${fileName}: ${accepted} 接受, ${rejected} 拒绝${identity.legacy ? ', 轮次未知（旧文件名）' : ''}`);
}

const rows = mergeFindings(parsedRows);
const findingsPath = path.join(resolvedDir, 'findings.jsonl');
const findingsText = rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '';
atomicWrite(findingsPath, findingsText);

const errorPath = path.join(resolvedDir, 'parse_errors.log');
if (parseErrors.length) atomicWrite(errorPath, `${parseErrors.join('\n')}\n`);
else if (fs.existsSync(errorPath)) fs.unlinkSync(errorPath);

const taskSpec = parseTaskSpec(resolvedDir);
const summary = generateStatsSummary(rows, taskSpec);
atomicWrite(path.join(resolvedDir, 'stats-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

log(`findings.jsonl: ${parsedRows.length} 条原始记录 → ${rows.length} 条去重记录（确定性重建）`);
log(`stats-summary.json: ${Object.keys(taskSpec.criteria).length} 个子问题, ${summary.total_findings} findings, ${summary.total_t1} T1`);
if (parseErrors.length) log(`parse_errors.log: ${parseErrors.length} 条提醒或错误`);
if (failedAgents > 0) {
  err(`✗ ${failedAgents} 个 Agent 超过一半数据无法解析，必须重派`);
  process.exit(1);
}
log('✓ 归一化完成');
