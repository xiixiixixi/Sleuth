#!/usr/bin/env node
/**
 * spawn-subagent.mjs — 生成研究子 Agent 的完整合同文本。
 *
 * 主 Agent 不再手抄 SKILL.md 里的模板（漏抄会导致子 Agent 自建 session、
 * 只搜不验）。改为调用本脚本，把 stdout 整段贴进子 Agent prompt。
 *
 * 用法：
 *   node spawn-subagent.mjs --sid <id> --goal <text> --enough-when <text> \
 *     --browser-session <name> [--must-verify <fact> ...] [--known-clue <clue> ...]
 *
 * 输出：填好变量的完整合同文本（stdout）。
 */

import { parseArgs } from 'node:util';

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(2);
}

const { values } = parseArgs({
  options: {
    sid:               { type: 'string' },
    goal:              { type: 'string' },
    'enough-when':     { type: 'string' },
    'must-verify':     { type: 'string', multiple: true },
    'known-clue':      { type: 'string', multiple: true },
    'browser-session': { type: 'string' },
    review:            { type: 'boolean' },
    help:              { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(
    'Usage: node spawn-subagent.mjs --sid <id> --goal <text> --enough-when <text> \\\n' +
      '  --browser-session <name> [--must-verify <fact> ...] [--known-clue <clue> ...]\n' +
      '       node spawn-subagent.mjs --review --sid <id>   # 生成独立审查合同\n\n' +
      '输出：填好变量的完整子 Agent 合同文本（stdout）。主 Agent 整段复制进子 Agent prompt。'
  );
  process.exit(0);
}

const sid = values.sid;

if (values.review) {
  if (!sid) fail('--sid is required');
  const reviewContract = `你是独立审查子 Agent。

【强制】开始前必须先读：\${CLAUDE_SKILL_DIR}/references/subagent-guide.md

【强制纪律】
- 复用下方 SID，禁止自己 start / finish session（脚本会用 --role subagent 拦截）
- 不再派子 Agent，不加载 sleuth 主 skill
- 完成时记 review_done（不是 subagent_done）：
  {"type":"review_done","is_enough":true/false}

SID: ${sid}

goal: 审查已有研究结论是否足够可信，是否有未暴露的关键缺口。
enough_when: 完成对所有核心结论的质疑，给出 is_enough 判断。
审查对象: \${SLEUTH_OUTPUT} 下的交付文件（用 deliver --action list --sid "${sid}" 汇总）

审查重点：
- 目标覆盖：用户的问题答了没有
- 来源强度：核心结论是否过度依赖单一来源、低级来源或营销页
- 一手验证：价格、版本、融资等关键事实是否回到了原始来源
- 冲突处理：冲突是明确写出了，还是被强行抹平
- 时效性：旧数据有没有冒充新结论
- 视角覆盖：是否只有官方视角

返回：is_enough、coverage、weak_claims、missing_perspectives、red_flags、conflicts、next_actions。`;
  console.log(reviewContract);
  process.exit(0);
}

const goal = values.goal;
const enoughWhen = values['enough-when'];
const browserSession = values['browser-session'];
const mustVerify = values['must-verify'] || [];
const knownClues = values['known-clue'] || [];

if (!sid) fail('--sid is required');
if (!goal) fail('--goal is required');
if (!enoughWhen) fail('--enough-when is required');
if (!browserSession) fail('--browser-session is required');
if (mustVerify.length === 0) fail('--must-verify is required (至少一条)');

const mustVerifyBlock = mustVerify.map((m) => `- ${m}`).join('\n');
const knownCluesBlock = knownClues.length
  ? knownClues.map((c) => `- ${c}`).join('\n')
  : '- （主 Agent 未提供，按最保守方式解释任务范围，不要自行扩题）';

// 注意：${CLAUDE_SKILL_DIR} 必须作为字面量输出，由子 Agent 自己展开，
// 因此在本模板里转义为 \${CLAUDE_SKILL_DIR}。
const contract = `你是独立研究子 Agent。

【强制】开始前必须先读：\${CLAUDE_SKILL_DIR}/references/subagent-guide.md

【强制纪律】
- 使用下方 SID，禁止自己 start / finish session（脚本会用 --role subagent 拦截）
- 所有 session-logger 调用带 --role subagent；所有 deliver save 带 --main-sid "${sid}"
- must_verify 列出的事实必须回到原始来源（WebFetch / 浏览器）验证，
  不得用 WebSearch / web_search 摘要直接充当结论
- 完成时记 subagent_done，并上报检索计数：
  {"type":"subagent_done","name":"${browserSession}","searches":N,"fetches":M,"browser":K,"delivers":D}
- 所有 agent-browser 命令带 --cdp 9222 --session "${browserSession}"
  （该端口背后是 sleuth 的持久登录 profile；不要用 --profile，它与 --cdp 互斥）

SID: ${sid}
browser_session: ${browserSession}

goal: ${goal}
enough_when: ${enoughWhen}
must_verify:
${mustVerifyBlock}
known_clues:
${knownCluesBlock}

返回：findings、sources、gaps、red_flags、trust_notes。`;

console.log(contract);
