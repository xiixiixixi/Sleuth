#!/usr/bin/env node
/**
 * spawn-subagent.mjs — 生成研究子 Agent 的 prompt 文本。
 *
 * 支持 5 种子 Agent 角色：
 *   - scout            侦察 Agent，广度扫描摸地形
 *   - search（默认）   搜索执行 Agent，自迭代深度研究，直写 raw/
 *   - boundary         边界评估 Agent，列未覆盖维度 + terminate_recommended
 *   - review           证据链审计 Agent，按 Tier 分层抽样
 *   - synthesize       合成 Agent，读 findings.jsonl + task_spec → 写 draft.md
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
 *   # 合成 Agent
 *   node spawn-subagent.mjs --role synthesize --task-dir <path> \
 *     [--audit-fix <text>]
 *
 * 输出：目标导向的 prompt 文本（stdout）。主 Agent 整段复制进子 Agent prompt。
 * 子 Agent 不读 SKILL.md；prompt 内联安全边界 + 指定要读的 references/X.md。
 */

import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 在 Node.js 运行时自感知 skill 根目录，生成子 Agent prompt 时将
// ${CLAUDE_SKILL_DIR} 替换为绝对路径——消除对运行时变量替换的依赖。
const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CDP_PORT = process.env.SLEUTH_CDP_PORT || '';

const VALID_ROLES = new Set(['scout', 'search', 'boundary', 'review', 'synthesize']);

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
    'task-dir':      { type: 'string' },
    'agent-name':    { type: 'string' },
    'draft-path':    { type: 'string' },
    'audit-fix':     { type: 'string' },
    round:           { type: 'string' },
    help:            { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(
    'Usage: node spawn-subagent.mjs --role <scout|search|boundary|review|synthesize> --goal <text> [options]\n\n' +
      'Roles:\n' +
      '  scout               侦察 Agent，广度扫描产出 landscape.json\n' +
      '  search (default)    搜索执行 Agent，直写 raw/search-*.jsonl\n' +
      '  boundary            边界评估 Agent，返回 terminate_recommended + 未覆盖维度\n' +
      '  review              证据链审计 Agent，按 Tier 分层抽样\n' +
      '  synthesize          合成 Agent，读 findings.jsonl + task_spec → 写 draft.md\n\n' +
      'Common:\n' +
      '  --goal <text>              任务目标（scout/search/boundary/review 必填）\n\n' +
      'search role:\n' +
      '  --must-verify <fact> ...    必须验证的核心事实\n' +
      '  --known-clue <clue> ...     已知线索\n' +
      '  --deliverable <text>        可验证交付物\n' +
      '  --stop-criteria <text> ...  终止标准\n' +
      '  --task-dir <path>           可选；Round 2+ 必传——子 Agent 读 directions.json 避开已试方向 + 写 raw/\n' +
      '  --agent-name <name>         可选；Agent 名（决定 raw/ 文件名 search-<name>.jsonl + sentinel agent 字段）\n' +
      '  --round <int>               可选；loop 轮次，主 Agent 派发时传入\n\n' +
      'boundary role:\n' +
      '  --task-dir <path>           任务目录（含 task_spec.md + findings.jsonl）\n\n' +
      'review role:\n' +
      '  --task-dir <path>           任务目录（含 findings.jsonl）\n' +
      '  --draft-path <path>         草稿位置（合成 Agent 写的报告草稿）\n\n' +
      'synthesize role:\n' +
      '  --task-dir <path>           任务目录（含 findings.jsonl + task_spec.md）\n' +
      '  --audit-fix <text>          可选；审计反馈，合成 Agent 据此修改 draft\n\n' +
      '输出：目标导向的 prompt 文本（stdout）。主 Agent 整段复制进子 Agent prompt。\n' +
      '子 Agent 不读 SKILL.md；prompt 内联安全边界 + 指定要读的 references/X.md。'
  );
  process.exit(0);
}

const role = values.role;
if (!VALID_ROLES.has(role)) {
  fail(`Invalid --role: ${role}. Valid: scout, search, boundary, review, synthesize`);
}

// --- helpers ---

function cdpSection() {
  return CDP_PORT
    ? `【agent-browser 端口】所有 agent-browser 命令用字面值 \`--cdp ${CDP_PORT}\`，**不要**用 \`\$SLEUTH_CDP_PORT\` shell 变量——你的运行时可能没有这个环境变量。references/tool-guide.md 中出现的 \`\$SLEUTH_CDP_PORT\` 是文档写法，执行时替换为 \`${CDP_PORT}\`。`
    : '【agent-browser 端口】Chrome 调试端口未设置——所有 agent-browser 命令不可用，不要尝试。';
}

// --- search role ---
function buildSearchContract(v) {
  if (!v.goal) fail('search role requires --goal');

  // agent 名：从 --agent-name 参数取，没有就用 goal 前两个词做 fallback
  const agentName = v['agent-name'] || v.goal.replace(/[^\w\u4e00-\u9fff]/g, '').slice(0, 12) || 'agent';
  const rawFileName = `search-${agentName}`;
  const rawFilePath = v['task-dir']
    ? `${v['task-dir']}/raw/${rawFileName}.jsonl`
    : `<task-dir>/raw/${rawFileName}.jsonl`;

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
    ? `${v['task-dir']}\n（读 directions.json 避开已试方向；读 task_spec.md 看完成标准。**不要读 findings.jsonl**——那是归一化器管的，你只管写 raw/）`
    : '（未指定——按 goal 独立研究）';

  const taskDirChecklist = v['task-dir']
    ? `3. Read \`${v['task-dir']}/directions.json\`（已试方向，避免重复）`
    : '3. 确认理解【返回格式】和【完成标准】后，开始执行——中间不停下问是否需要继续';

  return `你是 sleuth 研究子 Agent（搜索执行）。

**本 skill 根目录**：
- \`${SKILL_ROOT}\`
- 文档在 \`${SKILL_ROOT}/references/\` 子目录下
${CDP_PORT ? `- Chrome 调试端口：\`${CDP_PORT}\`（agent-browser 命令带 \`--cdp ${CDP_PORT}\`）` : '- Chrome 调试端口：**未设置**——agent-browser 命令不可用'}
- 文档里的相对路径（如 \`references/tool-guide.md\`）都相对于本 skill 根目录，用 Read 工具时拼上根目录路径
- 文档中的工具名是**能力描述**——使用你运行时对应的工具。浏览器操控命令参考见 \`references/tool-guide.md\`

**必读文档**：\`\${CLAUDE_SKILL_DIR}/references/search.md\`（搜索逻辑、查询规则、工具选择、失败兜底、搜索循环、JSONL 返回格式、dimensions_seen schema、directions.json 格式）

**安全边界**（必须遵守）：
- 不提取 cookie / 密码 / 敏感凭据
- 不对敏感 / 登录后页面截图；**常规页遇到定价表 / 对比表 / 架构图 / UI / benchmark 图表时主动截图存档**（触发清单见 references/search.md §6.2），截了图对应 finding 必须带 screenshot_path 字段
- 不绕付费墙
- 🔴 产生状态变更的操作（提交表单 / 下单 / 发帖 / 改配置 / 点"确认/删除"）执行前必须先停下问——只读浏览无需确认

**网络失败处理**（避免无谓重试和无限卡死）：
- WebFetch 单 URL 重试上限：3 次（间隔 2s / 5s / 10s）。3 次都失败 → 写 gap 到 raw/，不阻塞
- WebSearch 连续 2 次返回空 → 换关键词或换工具（agent-browser）
- agent-browser 超时 → 写 red_flag 到 raw/，明示"该来源未能验证"，不伪装成已验证
- 整体退出条件（满足任一即可退出）：
  1. 所有 must-verify 项已验证
  2. 连续 2 次搜索返回类似信息
  3. 已产出 ≥ min_sources 个独立 URL（部分接受——即使 must-verify 没全过也可退出，但必须在 raw/ 写 gap 说明未验证项）

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

【返回格式——直接写文件，不返回 stdout】
每搜到一条 finding/gap/red_flag，**立刻用 Write 工具 append 到 \`${rawFilePath}\`**。

具体做法（Write 工具是覆盖不是追加，所以你要先 Read 再拼接再 Write）：
1. Read 你的 raw 文件（\`${rawFilePath}\`，不存在则视为空）
2. 把新行追加到末尾
3. Write 全量覆盖回去

每行一个 JSON 对象，允许三种 type：
- \`finding\`：type / claim / url / confidence / tier / dimensions_seen，可附带 \`follow_up_questions\`（字符串数组）和 \`screenshot_path\`（截了呈现型图片时必填，相对路径如 \`screenshots/xxx.png\`）
- \`gap\`：type / what / reason
- \`red_flag\`：type / claim / reason

ts / round / agent / claim_id 由归一化器补，不要写这些字段。

**退出前必做**：用 Write append 最后一行到你的 raw 文件：
\`{"type":"agent_done","agent":"${agentName}","lines_written":<你写的总行数>,"ts":"<当前 ISO 时间>"}\`
不写这行 = 主 Agent 会认为你被杀了，重派你。

**不要返回 stdout 给主 Agent**——你的所有产出在 raw 文件里。

【完成标准】
- 核心事实已验证（回原始来源）
- 关闭你自己创建的浏览器 tab（\`agent-browser close --all\` 兜底也行）

${cdpSection()}

【启动检查清单——收到任务后，先按序完成，不跳过】：
1. Read \`${SKILL_ROOT}/references/search.md\`（搜索逻辑 + 返回格式）
2. Read \`${SKILL_ROOT}/references/tool-guide.md\`（agent-browser 命令）
${taskDirChecklist}`;
}

// --- boundary role ---
function buildBoundaryContract(v) {
  if (!v.goal) fail('boundary role requires --goal');
  if (!v['task-dir']) fail('boundary role requires --task-dir');

  return `你是 sleuth 研究子 Agent（边界评估）。

**本 skill 根目录**：\`${SKILL_ROOT}\`

- 文档里的相对路径（如 \`references/xxx.md\`）都相对于本 skill 根目录解析。文档中的工具名是能力描述——使用你运行时对应的工具。浏览器操控命令参考见 \`references/tool-guide.md\`

**必读文档**：\`\${CLAUDE_SKILL_DIR}/references/boundary.md\`（4 检查维度、terminate_recommended 判定规则、输出 schema、不做清单）

**安全边界**：只读已有 findings，不产生任何浏览器操作或网络请求。

【目标】
${v.goal}

【任务目录】
${v['task-dir']}\n（读 task_spec.md 看完成标准；读 findings.jsonl 看已有发现 + dimensions_seen；读 follow_ups.json 看未解决的追踪问题）

【返回格式】
按 boundary.md 定义的 YAML schema 返回。

【完成标准】
terminate_recommended + uncovered_dimensions 已输出。

【启动检查清单——收到任务后，先按序完成，不跳过】：
1. Read \`${SKILL_ROOT}/references/boundary.md\`（4 检查维度 + 输出 schema）
2. Read \`${v['task-dir']}/task_spec.md\`、\`${v['task-dir']}/findings.jsonl\`、\`${v['task-dir']}/follow_ups.json\`
3. 确认理解【返回格式】（YAML schema）后，开始评估`;
}

// --- review role ---
function buildReviewContract(v) {
  if (!v.goal) fail('review role requires --goal');
  if (!v['task-dir']) fail('review role requires --task-dir');
  if (!v['draft-path']) fail('review role requires --draft-path');

  return `你是 sleuth 研究子 Agent（证据链审计）。

**本 skill 根目录**：\`${SKILL_ROOT}\`

- 文档里的相对路径（如 \`references/xxx.md\`）都相对于本 skill 根目录解析。文档中的工具名是能力描述——使用你运行时对应的工具。浏览器操控命令参考见 \`references/tool-guide.md\`

**必读文档**：\`\${CLAUDE_SKILL_DIR}/references/review.md\`（4 项审计、分层抽样策略、Tier 分级、5 级可信度、输出 schema、不做清单）

**安全边界**：仅允许 WebFetch 验证草稿中已有的 URL。禁止 WebSearch、agent-browser 及任何形式的网络搜索或新研究。不产生状态变更操作。

【目标】
${v.goal}

【任务目录】
${v['task-dir']}（findings.jsonl 在该目录下）

【草稿位置】
${v['draft-path']}

【返回格式】
按 review.md 定义的 YAML schema 返回（含 sampled_stats）。

【完成标准】
critical + non_critical + sampled_stats 已输出。

【启动检查清单——收到任务后，先按序完成，不跳过】：
1. Read \`${SKILL_ROOT}/references/review.md\`（4 项审计 + 分层抽样 + 输出 schema）
2. Read \`${v['task-dir']}/findings.jsonl\` 和 \`${v['draft-path']}\`
3. 确认理解【返回格式】（YAML schema）后，开始审计`;
}

// --- synthesize role ---
function buildSynthesizeContract(v) {
  if (!v['task-dir']) fail('synthesize role requires --task-dir');

  const auditFixBlock = v['audit-fix']
    ? `\n【审计反馈——据此修改 draft】\n${v['audit-fix']}`
    : '';

  return `你是 sleuth 合成子 Agent（synthesize）。

**本 skill 根目录**：\`${SKILL_ROOT}\`
- 文档里的相对路径都相对于本 skill 根目录解析。

**安全边界**：不产生任何浏览器操作或网络搜索。只读文件 + 写 draft.md。

【任务目录】
${v['task-dir']}

【必读文件】
1. \`${v['task-dir']}/findings.jsonl\`——最终证据库（每行一个 JSON 对象）
2. \`${v['task-dir']}/task_spec.md\`——子问题清单 + 完成标准 + 交付格式要求

【你的产出】
Write 到 \`${v['task-dir']}/draft.md\`
${auditFixBlock}

【合成规则】
1. 按 task_spec 的子问题结构组织报告
2. 每个核心结论必须内联 \`[结论](https://来源URL)\`——没有 URL 的结论视为编造
3. 按 T1/T2/T3 证据分层标注可信度
4. 冲突的 findings 必须明示（不抹平分歧）
5. 单源最多 1 句直引不超过 15 词，默认 paraphrase
6. 报告格式遵循 task_spec 的交付要求（对比表/PRD/调研报告/时间线/单一回答）
7. 数字必须从 findings.jsonl 机械统计（用 Bash 跑 \`wc -l\` / \`grep -c\`），不许凭印象写
8. **图文并茂**：如果 finding 带 \`screenshot_path\` 字段，在对应结论处内嵌 \`![图注：来源+抓取日期](screenshot_path)\`。没带截图的不要硬凑——纯事实类不强求图文

【结构选择】（按问题类型）
| 问题类型 | 推荐结构 |
|---|---|
| 对比类（A vs B） | 背景 → A 概览 → B 概览 → 对比表 → 结论 |
| 清单类 | 直接列表，每项一段 |
| 调研类 | 概览 → 关键维度 1 → ... → 结论 |
| 时间线类 | 按时间排序，每事件一段 |
| 单一问题 | 直接答案 + 支撑证据 |

【证据分层】
| Tier | 来源 | 用法 |
|---|---|---|
| T1 | 官方文档、官方博客、监管文件 | 核心事实首选 |
| T2 | 行业分析、第三方评测、GitHub | 补强、对照 |
| T3 | 搜索摘要、SEO 文、未署名 | 发现线索，不单独支撑结论 |

【5 级可信度】
- 已验证事实：多源一致 + T1
- 高置信推断：单源 + T1/T2
- 未确认线索：单源 + T3
- 冲突信息：源之间矛盾
- 覆盖缺口：所有 gaps 汇总

【禁止】
- 不许读 raw/ 目录
- 不许改 task_spec / findings.jsonl / 其他任何文件
- 不许写 draft.md 之外的任何文件
- 不许用 bullet list 重现原文章结构（版权问题）

【完成标准】
draft.md 已写入，包含所有 task_spec 中 [x] 子问题对应的章节，每个核心结论有内联 URL。`;
}

// --- scout role ---
function buildScoutContract(v) {
  if (!v.goal) fail('scout role requires --goal');

  return `你是 sleuth 研究子 Agent（侦察 / Scout）。

**本 skill 根目录**：\`${SKILL_ROOT}\`
- 文档在 \`${SKILL_ROOT}/references/\` 子目录下

- 文档里的相对路径（如 \`references/xxx.md\`）都相对于本 skill 根目录解析。文档中的工具名是能力描述——使用你运行时对应的工具。浏览器操控命令参考见 \`references/tool-guide.md\`

**必读文档**：\`\${CLAUDE_SKILL_DIR}/references/scout.md\`（广度扫描策略、工具选择、landscape.json 返回格式）

**安全边界**（必须遵守）：
- 不提取 cookie / 密码 / 敏感凭据
- 不对敏感页面截图
- 不绕付费墙
- 🔴 产生状态变更的操作执行前必须先停下问——只读浏览无需确认
- **不使用 agent-browser 或任何浏览器操作**——侦察阶段仅限 WebSearch + WebFetch

**你的角色**：侦察。你是先遣部队，只负责摸清地形，不做深度研究。

【目标】
${v.goal}

【你的任务】
做系统性广度扫描（Systematic Breadth Scan），回答 3 个问题：
1. **关键实体**（Entities）：这个领域有哪些玩家 / 产品 / 概念？
2. **多元视角**（Perspectives）：从哪些角度切入这个主题？
3. **一手来源**（Source Hints）：官方文档、API reference、开发者指南在哪？

具体搜索策略看 \`\${CLAUDE_SKILL_DIR}/references/scout.md\` 的「广度扫描策略」段——按问题类型自适应，不固定查询模板。

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

【完成标准】
landscape.json 已输出，包含至少 3 个实体 + 2 个视角 + 2 个来源。

【启动检查清单——收到任务后，先按序完成，不跳过】：
1. Read \`${SKILL_ROOT}/references/scout.md\`（广度扫描策略 + 返回格式）
2. 确认理解【返回格式】（landscape.json JSON schema）和【你的任务】后，开始执行
3. **禁止使用 agent-browser**——侦察阶段仅限 WebSearch + WebFetch`;
}

const builders = {
  scout: buildScoutContract,
  search: buildSearchContract,
  boundary: buildBoundaryContract,
  review: buildReviewContract,
  synthesize: buildSynthesizeContract,
};

const prompt = builders[role](values);
console.log(prompt.replaceAll('${CLAUDE_SKILL_DIR}', SKILL_ROOT));
