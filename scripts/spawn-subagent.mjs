#!/usr/bin/env node
/**
 * spawn-subagent.mjs — 生成研究子 Agent 的 prompt 文本。
 *
 * 学 web-access 的目标导向写法：
 *   - 子 Agent 必须加载 sleuth skill 并遵循指引（不是读孤立合同）
 *   - 主 Agent 只说目标，不指定步骤
 *   - 子 Agent 自主判断用什么工具、怎么走流程
 *
 * 用法：
 *   node spawn-subagent.mjs --goal <text> [--must-verify <fact> ...] [--known-clue <clue> ...]
 *
 * 输出：目标导向的 prompt 文本（stdout）。主 Agent 整段复制进子 Agent prompt。
 */

import { parseArgs } from 'node:util';

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(2);
}

const { values } = parseArgs({
  options: {
    goal:              { type: 'string' },
    'must-verify':     { type: 'string', multiple: true },
    'known-clue':      { type: 'string', multiple: true },
    help:              { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(
    'Usage: node spawn-subagent.mjs --goal <text> \\\n' +
      '  [--must-verify <fact> ...] [--known-clue <clue> ...]\n\n' +
      '输出：目标导向的子 Agent prompt 文本（stdout）。主 Agent 整段复制进子 Agent prompt。\n' +
      '子 Agent 会自动加载 sleuth skill，无需在 prompt 中复制 skill 内容。'
  );
  process.exit(0);
}

const goal = values.goal;
const mustVerify = values['must-verify'] || [];
const knownClues = values['known-clue'] || [];

if (!goal) fail('--goal is required');

const mustVerifyBlock = mustVerify.length
  ? mustVerify.map((m) => `- ${m}`).join('\n')
  : '- （主 Agent 未指定，按目标自行判断需要验证什么）';

const knownCluesBlock = knownClues.length
  ? knownClues.map((c) => `- ${c}`).join('\n')
  : '- （主 Agent 未提供，按最保守方式解释任务范围，不要自行扩题）';

// 注意：${CLAUDE_SKILL_DIR} 必须作为字面量输出，由子 Agent 自己展开。
const contract = `必须加载 sleuth skill 并遵循指引。

你是独立研究子 Agent。sleuth skill 的所有检索纪律（先轻后重 / reader 是线索不是证据 / 关键页用浏览器验证 / 失败按兜底表处理）对你全部生效。

【目标】
${goal}

【必须验证的核心事实】
${mustVerifyBlock}

【已知线索】
${knownCluesBlock}

【完成标准】
- 核心事实已验证（回原始来源，不拿搜索摘要当证据）
- 返回：findings（已验证结论 + 内联来源 URL）、gaps（未取得的）、red_flags（可疑信息）
- 关闭你自己创建的浏览器 tab（\`agent-browser close --all\` 兜底也行）`;

console.log(contract);
