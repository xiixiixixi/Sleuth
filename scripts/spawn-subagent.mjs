#!/usr/bin/env node
/**
 * spawn-subagent.mjs — 生成研究子 Agent 的 prompt 文本。
 *
 * 支持 4 种子 Agent 角色：
 *   - scout            侦察 Agent，广度扫描摸地形
 *   - search（默认）   搜索执行 Agent，自迭代深度研究
 *   - boundary         边界评估 Agent，列未覆盖维度 + terminate_recommended
 *   - review           证据链审计 Agent，按 Tier 分层抽样
 *
 * 用法：
 *   # 搜索 Agent
 *   node spawn-subagent.mjs --role search --goal <text> \
 *     [--must-verify <fact> ...] [--known-clue <clue> ...] \
 *     [--deliverable <text>] [--stop-criteria <text> ...] \
 *     [--task-dir <path>] [--round <int>]
 *
 *   # 边界 Agent
 *   node spawn-subagent.mjs --role boundary --goal <text> --task-dir <path>
 *
 *   # 审查 Agent
 *   node spawn-subagent.mjs --role review --goal <text> \
 *     --task-dir <path> --draft-path <path>
 *
 * 输出：目标导向的 prompt 文本（stdout）。主 Agent 整段复制进子 Agent prompt。
 * 子 Agent 不读 SKILL.md；prompt 内联安全边界 + 指定要读的 references/X.md。
 */

import { parseArgs } from 'node:util';

const VALID_ROLES = new Set(['scout', 'search', 'boundary', 'review']);

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(2);
}

const { values } = parseArgs({
  options: {
    role:            { type: 'string', default: 'search' },
    goal:            { type: 'string' },
    'must-verify':   { type: 'string', multiple: true },
    'known-clue':    { type: 'string', multiple: true },
    deliverable:     { type: 'string' },
    'stop-criteria': { type: 'string', multiple: true },
    'task-dir':      { type: 'string' },  // search 可选；boundary/review 必填
    'draft-path':    { type: 'string' },  // review 必填
    round:           { type: 'string' },  // search 可选；主 Agent 派发时传入 loop 轮次
    help:            { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(
    'Usage: node spawn-subagent.mjs --role <scout|search|boundary|review> --goal <text> [options]\n\n' +
      'Roles:\n' +
      '  scout               侦察 Agent，广度扫描产出 landscape.json\n' +
      '  search (default)    搜索执行 Agent，返回 JSONL\n' +
      '  boundary            边界评估 Agent，返回 terminate_recommended + 未覆盖维度\n' +
      '  review              证据链审计 Agent，按 Tier 分层抽样\n\n' +
      'Common:\n' +
      '  --goal <text>              任务目标（所有 role 必填）\n\n' +
      'search role:\n' +
      '  --must-verify <fact> ...    必须验证的核心事实\n' +
      '  --known-clue <clue> ...     已知线索\n' +
      '  --deliverable <text>        可验证交付物\n' +
      '  --stop-criteria <text> ...  终止标准\n' +
      '  --task-dir <path>           可选；Round 2+ 必传——子 Agent 读 findings.jsonl 避免重复 + 读 directions.json 避开已试方向\n' +
      '  --round <int>               可选；loop 轮次，主 Agent 派发时传入\n\n' +
      'boundary role:\n' +
      '  --task-dir <path>           任务目录（含 task_spec.md + findings.jsonl）\n\n' +
      'review role:\n' +
      '  --task-dir <path>           任务目录（含 findings.jsonl）\n' +
      '  --draft-path <path>         草稿位置（主 Agent 合成的报告草稿）\n\n' +
      '输出：目标导向的 prompt 文本（stdout）。主 Agent 整段复制进子 Agent prompt。\n' +
      '子 Agent 不读 SKILL.md；prompt 内联安全边界 + 指定要读的 references/X.md。'
  );
  process.exit(0);
}

const role = values.role;
if (!VALID_ROLES.has(role)) {
  fail(`Invalid --role: ${role}. Valid: search, boundary, review`);
}

// --- search role ---
function buildSearchContract(v) {
  if (!v.goal) fail('search role requires --goal');

  const mustVerify = v['must-verify'] || [];
  const knownClues = v['known-clue'] || [];
  const stopCriteria = v['stop-criteria'] || [];

  const mustVerifyBlock = mustVerify.length
    ? mustVerify.map((m) => `- ${m}`).join('\n')
    : '- （按目标自行判断需要验证什么）';

  const knownCluesBlock = knownClues.length
    ? knownClues.map((c) => `- ${c}`).join('\n')
    : '- （未提供，按最保守方式解释任务范围）';

  const deliverableBlock = v.deliverable || '（按 goal 推断需要交付什么）';

  const stopCriteriaBlock = stopCriteria.length
    ? stopCriteria.map((s) => `- ${s}`).join('\n')
    : '- （按 search.md §5 终止信号判断）';

  const roundBlock = v.round
    ? `**当前 loop 轮次：Round ${v.round}**`
    : '';

  const taskDirBlock = v['task-dir']
    ? `${v['task-dir']}\n（读 findings.jsonl 避免重做已验证的 claim；读 directions.json 避开已试方向；读 task_spec.md 看完成标准）`
    : '（未指定——按 goal 独立研究）';

  return `你是 sleuth 研究子 Agent（搜索执行）。

**环境变量**（主 Agent 已设置）：
- \`CLAUDE_SKILL_DIR\`：skill 根目录——文档在 \`\${CLAUDE_SKILL_DIR}/references/\`
- \`SLEUTH_CDP_PORT\`：Chrome 调试端口——agent-browser 命令带 \`--cdp $SLEUTH_CDP_PORT\`

**必读文档**：\`\${CLAUDE_SKILL_DIR}/references/search.md\`（搜索逻辑、查询规则、工具选择、失败兜底、搜索循环、JSONL 返回格式、dimensions_seen schema、directions.json 格式）

**安全边界**（必须遵守）：
- 不提取 cookie / 密码 / 敏感凭据
- 不对敏感页面截图
- 不绕付费墙
- 🔴 产生状态变更的操作（提交表单 / 下单 / 发帖 / 改配置 / 点“确认/删除”）执行前必须先停下问——只读浏览无需确认

${roundBlock}

【目标】
${v.goal}

【必须验证的核心事实】
${mustVerifyBlock}

【已知线索】
${knownCluesBlock}

【任务目录】
${taskDirBlock}

【可验证交付物】
${deliverableBlock}

【终止标准】
${stopCriteriaBlock}

【返回格式】
按 search.md §4.3 定义的 JSONL 格式返回。你只返回 type/claim/url/confidence/tier/dimensions_seen 字段；ts/round/agent/claim_id 由主 Agent 补，不要返回。

【完成标准】
- 核心事实已验证（回原始来源）
- 关闭你自己创建的浏览器 tab（\`agent-browser close --all\` 兜底也行）`;
}

// --- boundary role ---
function buildBoundaryContract(v) {
  if (!v.goal) fail('boundary role requires --goal');
  if (!v['task-dir']) fail('boundary role requires --task-dir');

  return `你是 sleuth 研究子 Agent（边界评估）。

**环境变量**（主 Agent 已设置）：
- \`CLAUDE_SKILL_DIR\`：skill 根目录——文档在 \`\${CLAUDE_SKILL_DIR}/references/\`

**必读文档**：\`\${CLAUDE_SKILL_DIR}/references/boundary.md\`（4 固定维度、terminate_recommended 判定规则、输出 schema、不做清单）

**安全边界**：只读已有 findings，不产生任何浏览器操作或网络请求。

【目标】
${v.goal}

【任务目录】
${v['task-dir']}\n（读 task_spec.md 看完成标准；读 findings.jsonl 看已有发现 + dimensions_seen）

【返回格式】
按 boundary.md 定义的 YAML schema 返回。

【完成标准】
terminate_recommended + uncovered_dimensions 已输出。`;
}

// --- review role ---
function buildReviewContract(v) {
  if (!v.goal) fail('review role requires --goal');
  if (!v['task-dir']) fail('review role requires --task-dir');
  if (!v['draft-path']) fail('review role requires --draft-path');

  return `你是 sleuth 研究子 Agent（证据链审计）。

**环境变量**（主 Agent 已设置）：
- \`CLAUDE_SKILL_DIR\`：skill 根目录——文档在 \`\${CLAUDE_SKILL_DIR}/references/\`

**必读文档**：\`\${CLAUDE_SKILL_DIR}/references/review.md\`（4 项审计、分层抽样策略、Tier 分级、5 级可信度、输出 schema、不做清单）

**安全边界**：允许 WebFetch 验证已有 URL（验证 ≠ 重做研究）；不产生状态变更操作。

【目标】
${v.goal}

【任务目录】
${v['task-dir']}（findings.jsonl 在该目录下）

【草稿位置】
${v['draft-path']}

【返回格式】
按 review.md 定义的 YAML schema 返回（含 sampled_stats）。

【完成标准】
audit_findings + sampled_stats 已输出。`;
}
// --- scout role ---
function buildScoutContract(v) {
  if (!v.goal) fail('scout role requires --goal');

  return `你是 sleuth 研究子 Agent（侦察 / Scout）。

**环境变量**（主 Agent 已设置）：
- \`CLAUDE_SKILL_DIR\`：skill 根目录——文档在 \`\${CLAUDE_SKILL_DIR}/references/\`
- \`SLEUTH_CDP_PORT\`：Chrome 调试端口——agent-browser 命令带 \`--cdp $SLEUTH_CDP_PORT\`

**必读文档**：\`\${CLAUDE_SKILL_DIR}/references/search.md\` §2（查询规则）+ §3（工具选择）

**安全边界**（必须遵守）：
- 不提取 cookie / 密码 / 敏感凭据
- 不对敏感页面截图
- 不绕付费墙
- 🔴 产生状态变更的操作执行前必须先停下问——只读浏览无需确认

**你的角色**：侦察。你是先遣部队，只负责摸清地形，不做深度研究。

【目标】
${v.goal}

【你的任务】
做系统性广度扫描（Systematic Breadth Scan），回答 3 个问题：
1. **关键实体**（Entities）：这个领域有哪些玩家 / 产品 / 概念？
2. **多元视角**（Perspectives）：从哪些角度切入这个主题？
3. **一手来源**（Source Hints）：官方文档、API reference、开发者指南在哪？

搜索策略——3 类查询各发 1-2 条：
- 实体发现：\`<领域> platforms OR tools OR products 2026\`
- 结构对比：\`<领域> comparison OR landscape OR Gartner OR Forrester\`
- 技术维度：\`<核心技术概念> in <领域>\`

**不做的事**：不做深度研究、不提取 claim、不写 findings、不截图。只画地图。

【返回格式】
返回一个 JSON 对象（landscape.json），格式：

    {
      "entities": [
        {"name": "实体名", "domain": "example.com", "category": "分类"}
      ],
      "perspectives": ["技术架构", "商业模式", "用户体验", "安全合规"],
      "source_hints": [
        {"entity": "实体名", "url": "https://...", "type": "官方开发者文档"}
      ]
    }

**硬上限**：最多 8 次 tool call。广度扫描不是深度研究，快速摸完就返回。

【完成标准】
landscape.json 已输出，包含至少 3 个实体 + 2 个视角 + 2 个来源。`;
}

const builders = {
  scout: buildScoutContract,
  search: buildSearchContract,
  boundary: buildBoundaryContract,
  review: buildReviewContract,
};

console.log(builders[role](values));
