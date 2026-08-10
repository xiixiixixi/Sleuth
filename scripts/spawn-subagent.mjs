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
 *     --task-dir <path> --agent-name <name> --round <int>
 *     --subquestion-id <id> [--subquestion-id <id> ...]
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
const CDP_WS = process.env.SLEUTH_CDP_WS || '';

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
    'subquestion-id': { type: 'string', multiple: true },
    'visual-required': { type: 'boolean' },
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
      '  --task-dir <path>           必填；任务目录\n' +
      '  --agent-name <name>         必填；本轮唯一 Agent 名\n' +
      '  --round <int>               必填；loop 轮次\n' +
      '  --subquestion-id <id> ...   必填；负责的子问题编号\n\n' +
      '  --visual-required           可选；该任务必须产出可呈现的视觉证据\n\n' +
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

function resolveCdpTarget() {
  if (!CDP_PORT && !CDP_WS) return null;
  if (!CDP_PORT || !CDP_WS) fail('浏览器使用权必须同时提供 SLEUTH_CDP_PORT 和 SLEUTH_CDP_WS');
  if (!/^\d+$/.test(CDP_PORT) || Number(CDP_PORT) < 1 || Number(CDP_PORT) > 65535) {
    fail('SLEUTH_CDP_PORT 必须是有效端口');
  }

  let parsed;
  try { parsed = new URL(CDP_WS); }
  catch { fail('SLEUTH_CDP_WS 必须是本机完整调试地址'); }
  if (
    parsed.protocol !== 'ws:'
    || parsed.hostname !== '127.0.0.1'
    || parsed.port !== CDP_PORT
    || parsed.username
    || parsed.password
    || !/^\/devtools\/browser\/[A-Za-z0-9._-]+$/.test(parsed.pathname)
    || parsed.search
    || parsed.hash
  ) fail('SLEUTH_CDP_WS 必须是端口一致的本机浏览器级调试地址');

  return { port: CDP_PORT, wsUrl: CDP_WS, commandTarget: `'${CDP_WS}'` };
}

function cdpSection(agentName, cdpTarget) {
  if (!cdpTarget) {
    return `【浏览器兜底尚未就绪】如果网络搜索或 WebFetch / reader 失败，不要继续等待，也不要把它静默写成最终 gap。保留已经写入的 raw，不写 \`agent_done\`，立即向主 Agent 返回一行：\`BROWSER_CONTROL_REQUIRED: <目标 URL + 失败原因>\`。主 Agent 会安装或升级 agent-browser CLI，并引导用户在现有登录态 Chrome 开启控制；恢复后你用同一 Agent 名续跑。禁止裸跑 \`agent-browser open\`、\`agent-browser install\`、\`--profile\` 或自行启动 Chrome。`;
  }
  const prefix = `agent-browser --cdp ${cdpTarget.commandTarget} --idle-timeout 1h`;
  return `【agent-browser 完整调试地址】full 检查已确认这是用户现有的登录态 Chrome，且主 Agent 已把本时段的独占浏览器操作权交给你。所有命令使用 \`${prefix} <command>\` 并复用默认后台服务，**不要**用 \`\$SLEUTH_CDP_WS\` shell 变量——你的运行时可能没有这个环境变量。禁止把完整地址改回仅端口模式；agent-browser 0.33.2 的 Chrome 144+ 端口发现只有约 2 秒授权等待。禁止使用 \`--session\` 或 \`--namespace\` 创建额外后台服务，禁止启动或复用其他常驻 CDP 代理；同一个 CDP 连接会共享“当前标签页”，不要依赖 \`--session\` 隔离；发现别的 Agent 也在操作时立即交回主 Agent，不要并发抢标签。先执行 \`tab new --label ${agentName}\`，再执行 \`tab ${agentName}\`，最后单独 \`open <url>\` 并用 \`get url\` 或 \`get title\` 核验；不要把 URL 直接跟在 \`tab new --label\` 后面，0.28.0 实测可能仍停在 about:blank。Chrome 重启或完整地址失效时，保留 raw、不写 \`agent_done\`，返回 \`BROWSER_CONTROL_REQUIRED\` 让主 Agent 重新运行 full 检查；禁止猜测新地址。禁止裸跑 \`agent-browser open\`，禁止 \`--profile\`，禁止 \`agent-browser install\`，禁止关闭任何任务开始前已经存在的标签页。`;
}

// --- search role ---
function buildSearchContract(v) {
  if (!v.goal) fail('search role requires --goal');
  if (!v['task-dir']) fail('search role requires --task-dir');
  if (!v['agent-name']) fail('search role requires --agent-name');
  if (!/^\d+$/.test(v.round || '') || Number(v.round) < 1) fail('search role requires positive --round');
  if (!v['subquestion-id']?.length) fail('search role requires --subquestion-id');

  const cdpTarget = resolveCdpTarget();
  const agentName = v['agent-name'];
  const rawFileName = `search-r${v.round}-${agentName}`;
  const rawFilePath = `${v['task-dir']}/raw/${rawFileName}.jsonl`;
  const subquestionIds = v['subquestion-id'];

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

  const roundBlock = `**当前 loop 轮次：Round ${v.round}**`;
  const taskDirBlock = `${v['task-dir']}\n（读 directions.json 避开已试方向；读 task_spec.md 看完成标准。不要读 findings.jsonl。）`;
  const visualBlock = v['visual-required']
    ? `【视觉证据——本任务必需】\n每个 Agent 必须至少保存 1 张与目标直接相关的非敏感原图或页面截图，并在对应 finding 的 visuals[] 登记。找不到可用视觉证据时写 gap，禁止用装饰图充数。`
    : `【视觉证据——默认自动检查】\n每个被采用的一手页面都要检查图片候选。遇到定价表、对比表、架构图、流程图、UI、信息图或 benchmark 图，只要能帮助读者理解，就必须写入 finding.visuals[]；可以保留网页原图 image_url，不必为了留图强行截图。纯装饰图、头像、logo 和广告不要记录。`;

  return `你是 sleuth 研究子 Agent（搜索执行）。

**本 skill 根目录**：
- \`${SKILL_ROOT}\`
- 文档在 \`${SKILL_ROOT}/references/\` 子目录下
${cdpTarget ? `- Chrome 完整调试地址：\`${cdpTarget.wsUrl}\`（端口 \`${cdpTarget.port}\`；命令前缀为 \`agent-browser --cdp ${cdpTarget.commandTarget} --idle-timeout 1h\`）` : '- Chrome 调试目标：**未设置**——agent-browser 命令不可用'}
- 文档里的相对路径（如 \`references/tool-guide.md\`）都相对于本 skill 根目录，用 Read 工具时拼上根目录路径
- 文档中的工具名是**能力描述**——使用你运行时对应的工具。浏览器操控命令参考见 \`references/tool-guide.md\`

**必读文档**：\`\${CLAUDE_SKILL_DIR}/references/search.md\`（搜索逻辑、查询规则、工具选择、失败兜底、搜索循环、JSONL 返回格式、dimensions_seen schema、directions.json 格式）

**安全边界**（必须遵守）：
- 不提取 cookie / 密码 / 敏感凭据
- 不对敏感 / 登录后页面截图；**每个采用的一手页面都必须扫描视觉候选**。有用原图写 image_url，需要保留页面状态时才截图到 screenshots/；两者都写进 finding.visuals[]
- 不绕付费墙
- 🔴 产生状态变更的操作（提交表单 / 下单 / 发帖 / 改配置 / 点"确认/删除"）执行前必须先停下问——只读浏览无需确认

**网络失败处理**（避免无谓重试和无限卡死）：
- WebSearch 返回空、受限或超时 → 只允许一次有实质变化的查询改写，不固定等待；仍失败就立即升级 agent-browser
- WebFetch / reader 返回空、登录墙、脚本空壳或超时 → 不对同一 URL 做 2s / 5s / 10s 定时重试，立即升级 agent-browser
- 有完整 CDP 地址时，只用提示中经过校验的 \`agent-browser --cdp '<本机完整地址>' --idle-timeout 1h <command>\` 连接用户现有登录态 Chrome；禁止改回仅端口模式；没有完整地址时按下方 \`BROWSER_CONTROL_REQUIRED\` 交接，不能自行新开浏览器
- agent-browser 超时 → 只做一次 eval / network 诊断，然后换同一 Chrome 内的入口或一手来源；仍失败才写 gap，明示"该来源未能验证"，不伪装成已验证
- 整体退出条件（必须满足第 1 条，或第 2+3 条同时成立）：
  1. 所有 must-verify 项已验证（回原始来源确认，不是 WebSearch snippet）
  2. 连续 2 次搜索返回类似信息（无新 claim 产出）
  3. **每个 must-verify 维度至少有 2 条 ≥200 字符的 finding**（深度要求——浅断言不算数）

⚠️ **深度优先于数量**：宁可 5 条深度 finding（每条 300-600 字符，含上下文+限定条件+场景影响），不要 15 条浅断言（每条 100 字只有结论）。每条 finding 要回答"是什么 + 为什么 + 有什么限制 + 对比/场景影响"，不是只写一个结论。

${roundBlock}

【目标】
${v.goal}

【必须验证的核心事实】
${mustVerifyBlock}

【负责的子问题】
${subquestionIds.map((id) => `- ${id}`).join('\n')}

【已知线索】
${knownCluesBlock}

【任务目录】
${taskDirBlock}

【可验证交付物】
${deliverableBlock}

【终止标准】
${stopCriteriaBlock}

${visualBlock}

【返回格式——直接写文件，不返回 stdout】
每搜到一条 finding/gap/red_flag，**立刻用 Write 工具 append 到 \`${rawFilePath}\`**。

具体做法（Write 工具是覆盖不是追加，所以你要先 Read 再拼接再 Write）：
1. Read 你的 raw 文件（\`${rawFilePath}\`，不存在则视为空）
2. 把新行追加到末尾
3. Write 全量覆盖回去

每行一个 JSON 对象，格式必须满足：
- \`finding\`：\`type\` / \`claim\` / \`claim_key\` / \`subquestion_ids\` / \`fields_covered\` / \`sources\` / \`dimensions_seen\` / \`visuals\`
- \`gap\`：\`type\` / \`what\` / \`reason\` / \`subquestion_ids\`
- \`red_flag\`：\`type\` / \`claim\` / \`reason\` / \`subquestion_ids\` / \`sources\`

finding 示例：
\`{"type":"finding","claim":"含上下文、限制与影响的证据结论","claim_key":"1:intercom:pricing_model","subquestion_ids":["1"],"fields_covered":["定价模型"],"sources":[{"url":"https://example.com/pricing","tier":"T1","stance":"supports","observed_at":"2026-07-18T00:00:00Z","source_date":"2026-07-01"}],"dimensions_seen":[{"dimension":"定价","observation":"按席位计费"}],"context_links":[{"claim_key":"1:salesforce:pricing_model","relationship":"compares"}],"visuals":[{"kind":"table","image_url":"https://example.com/pricing-table.png","source_page_url":"https://example.com/pricing","caption":"官方套餐表，直观看出三个档位差异","observed_at":"2026-07-18T00:00:00Z"}]}\`

- 同一事实的多个独立来源放在同一条 finding 的 \`sources\` 数组，禁止丢掉次要来源。
- red_flag 也必须把导致“过期、矛盾或不可靠”判断的页面写进结构化 \`sources\`，禁止只把 URL 塞进 reason 文本。
- \`claim_key\` 使用“子问题:实体:字段”稳定命名；同一事实换种说法时仍用同一个 key。
- \`fields_covered\` 只能填写这条证据真正覆盖的 task_spec 必需字段。
- \`source_date\` 是来源发布日期（知道时写）；\`observed_at\` 是本次核验时间，必须写。
- \`stance\` 只允许 \`supports\` 或 \`contradicts\`。
- Round 2+ 收到带 \`source_claim_keys\` 的已知线索时，相关 finding 必须用 \`context_links\` 指明与前序结论的关系；relationship 只允许 compares / extends / follows / causes / contradicts / complements / bounds。
- \`visuals\` 只登记对读者有帮助的图片，每条 finding 最多 3 张。每张必须有 kind、caption、source_page_url、observed_at，并且只能二选一：网页原图 \`image_url\` 或本地 \`screenshot_path\`。
- 可附带 \`follow_up_questions\`；旧的单值 \`screenshot_path\` 不再用于新任务。
- ts / round / agent / claim_id / confidence 由归一化器补，不要写。

**退出前必做**：用 Write append 最后一行到你的 raw 文件：
\`{"type":"agent_done","agent":"${agentName}","lines_written":<agent_done 之前的 finding/gap/red_flag 行数>,"ts":"<当前 ISO 时间>","visual_scan":{"status":"captured 或 none_useful","candidates_seen":<各页候选合计>,"useful_saved":<visuals 总数>,"reason":"全部没有保存时说明总原因","pages":[{"url":"<被采用的来源页>","candidates_seen":<该页候选数>,"useful_saved":<该页保存数>,"reason":"该页没有保存时说明原因"}]}}\`
- \`lines_written\` 不包含 \`agent_done\` 本身。例如 4 条 finding + 1 条 agent_done，必须写 4，不是 5。
- \`visual_scan.pages\` 必须覆盖每个 finding 的每个来源 URL；即使某页没有图片，也要写 candidates_seen: 0 和具体 reason。总数必须等于 pages 合计。
不写这行 = 主 Agent 会认为你被杀了，重派你。

**不要返回 stdout 给主 Agent**——你的所有正常产出在 raw 文件里。唯一例外是浏览器控制未就绪时返回 \`BROWSER_CONTROL_REQUIRED\`；此时保留部分 raw 且不写 \`agent_done\`。

【完成标准】
- 核心事实已验证（回原始来源）
- 只关闭你在本任务中新建且能明确识别的标签页；绝不使用 \`close --all\`，绝不关闭用户原有标签页

${cdpSection(agentName, cdpTarget)}

【启动检查清单——收到任务后，先按序完成，不跳过】：
1. Read \`${SKILL_ROOT}/references/search.md\`（搜索逻辑 + 返回格式）
2. Read \`${SKILL_ROOT}/references/tool-guide.md\`（agent-browser 命令）
3. Read \`${v['task-dir']}/directions.json\`（不存在视为空；已试方向，避免重复）
4. 确认每条记录都带负责的 subquestion_ids 后开始执行`;
}

// --- boundary role ---
function buildBoundaryContract(v) {
  if (!v.goal) fail('boundary role requires --goal');
  if (!v['task-dir']) fail('boundary role requires --task-dir');

  return `你是 sleuth 研究子 Agent（边界评估）。

**本 skill 根目录**：\`${SKILL_ROOT}\`

- 文档里的相对路径（如 \`references/xxx.md\`）都相对于本 skill 根目录解析。文档中的工具名是能力描述——使用你运行时对应的工具。浏览器操控命令参考见 \`references/tool-guide.md\`

**必读文档**：\`\${CLAUDE_SKILL_DIR}/references/boundary.md\`（4 检查维度、terminate_recommended 判定规则、**跨 Agent 线索提炼**、输出 schema、不做清单）

**安全边界**：只读已有 findings，不产生任何浏览器操作或网络请求。

【目标】
${v.goal}

【任务目录】
${v['task-dir']}\n（读 task_spec.md 看 task_type；读 stats-summary.json 看机械完成结果；读 findings.jsonl 复核语义和 dimensions_seen；读 follow_ups.json / directions.json 看未解决问题和已试方向）

【产出文件】
按 boundary.md 定义的 JSON schema，用 Write 写入 \`${v['task-dir']}/boundary-report.json\`。不要只在回复中返回报告。

**cross_agent_hints 是第二职责**：根据 task_spec 的 task_type，按 boundary.md「跨 Agent 线索提炼」段提炼 3-5 条线索。这些线索会被主 Agent通过 --known-clue 注入下一轮。每条 hint ≤ 80 字符，并必须带 source_claim_keys，让下一轮用 context_links 留下使用证据。

【完成标准】
boundary-report.json 已写入；包含 terminate_recommended、逐子问题证据映射、uncovered_dimensions 和 cross_agent_hints。

【启动检查清单——收到任务后，先按序完成，不跳过】：
1. Read \`${SKILL_ROOT}/references/boundary.md\`（4 检查维度 + 输出 schema）
2. Read \`${v['task-dir']}/task_spec.md\`、\`${v['task-dir']}/stats-summary.json\`、\`${v['task-dir']}/findings.jsonl\`、\`${v['task-dir']}/follow_ups.json\`、\`${v['task-dir']}/directions.json\`
3. 确认理解 JSON schema 和文件位置后开始评估；回复只报告文件已写入`;
}

// --- review role ---
function buildReviewContract(v) {
  if (!v.goal) fail('review role requires --goal');
  if (!v['task-dir']) fail('review role requires --task-dir');
  if (!v['draft-path']) fail('review role requires --draft-path');

  return `你是 sleuth 研究子 Agent（证据链审计）。

**本 skill 根目录**：\`${SKILL_ROOT}\`

- 文档里的相对路径（如 \`references/xxx.md\`）都相对于本 skill 根目录解析。文档中的工具名是能力描述——使用你运行时对应的工具。浏览器操控命令参考见 \`references/tool-guide.md\`

**必读文档**：\`\${CLAUDE_SKILL_DIR}/references/review.md\`（5 项审计、分层抽样策略、视觉证据全查、Tier 分级、5 级可信度、输出 schema、不做清单）

**安全边界**：仅允许 WebFetch 验证草稿中已有的 URL。禁止 WebSearch、agent-browser 及任何形式的网络搜索或新研究。不产生状态变更操作。

【目标】
${v.goal}

【任务目录】
${v['task-dir']}（findings.jsonl 和 stats-summary.json 在该目录下）

【草稿位置】
${v['draft-path']}

【产出文件】
按 review.md 定义的 JSON schema，用 Write 写入 \`${v['task-dir']}/audit-report.json\`。不要只在回复中返回报告。

【完成标准】
audit-report.json 已写入，critical、non_critical、sampled_stats、passed 均已输出；如果 stats-summary.json 的 total_visuals > 0，还必须输出 visual_audit，逐张检查来源、可达性、图注、相关性和是否已经嵌入草稿。

【启动检查清单——收到任务后，先按序完成，不跳过】：
1. Read \`${SKILL_ROOT}/references/review.md\`（5 项审计 + 分层抽样 + 视觉证据全查 + 输出 schema）
2. Read \`${v['task-dir']}/findings.jsonl\`、\`${v['task-dir']}/stats-summary.json\` 和 \`${v['draft-path']}\`
3. 确认理解 JSON schema 和文件位置后开始审计；回复只报告文件已写入`;
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
3. \`${v['task-dir']}/stats-summary.json\`——唯一可信的数量和完成状态

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
7. 数字必须从 stats-summary.json 读取；findings.jsonl 含不同记录类型，禁止用总行数冒充证据数
8. **图文并茂**：把所有 finding.visuals[] 去重后逐张放到对应结论附近。网页原图使用 image_url，本地截图使用 screenshot_path；格式为 \`![有意义的图注](图片地址)\`，紧接一行写“来源页 + 抓取日期 + 这张图说明什么”。visuals[] 里的图禁止静默略过

【结构选择】（按问题类型）
| 问题类型 | 推荐结构 |
|---|---|
| 对比类（A vs B） | 背景 → A 概览 → B 概览 → 对比表 → 结论 |
| 清单类 | 直接列表，每项一段 |
| 调研类 | 概览 → 关键维度 1 → ... → 结论 |
| 时间线类 | 按时间排序，每事件一段 |
| 单一问题 | 直接答案 + 支撑证据 |
| **PRD 类** | 背景与目标 → 用户故事(As a...) → 功能需求(编号+验收标准) → 非功能需求 → 优先级 → 不在范围内。**禁止写技术选型/架构图/API schema/部署方案**（那是架构文档不是 PRD） |

【引用纪律】
- 每个核心结论必须内联 \`[结论](URL)\`——没有 URL 的结论视为编造
- 单源最多 1 句直引不超过 15 词，默认 paraphrase
- 不要用 bullet/numbered list 重现原文章结构（版权问题）

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
draft.md 已写入；每个达到标准或明确标注 known_limit 的子问题都有对应章节；没有证据的实体只能写数据缺口，禁止补写事实；每个核心结论有内联 URL。`;
}

// --- scout role ---
function buildScoutContract(v) {
  if (!v.goal) fail('scout role requires --goal');
  if (!v['task-dir']) fail('scout role requires --task-dir');

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

【产出文件】
把 JSON 对象写入 \`${v['task-dir']}/landscape.json\`，格式：

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
landscape.json 已写入，包含至少 3 个实体 + 2 个视角 + 2 个来源。回复只报告文件已写入。

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
