#!/usr/bin/env node
/** classify-task.mjs — 用用户问题中的明确表达给出 task_type 初判。 */

import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { goal: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
if (values.help || !values.goal) {
  console.log('用法：node scripts/classify-task.mjs --goal "<用户问题>"');
  process.exit(values.help ? 0 : 2);
}

const rules = [
  ['deep_dive', /深度调研|深入研究|深挖|实现原理|怎么实现|底层机制|全面研究/i],
  ['comparison', /对比|比较|区别|差异|\bvs\b|哪(?:个|家|种).*好/i],
  ['timeline', /历程|演变|时间线|发展史|从.+到.+(?:发生|变化|演进)/i],
  ['causal', /为什么|原因|成因|如何导致|因果|背后机制/i],
  ['debate', /值得吗|会不会|好不好|是否应该|争议|正反/i],
  ['enumeration', /列出所有|全部列出|有哪些|完整清单|穷举/i],
  ['problem_solving', /怎么做|怎么部署|怎么排查|如何解决|修复|解决方案|实施方案/i],
];

const matched = rules.find(([, pattern]) => pattern.test(values.goal));
console.log(JSON.stringify({
  task_type: matched?.[0] || 'general',
  matched_signal: matched ? values.goal.match(matched[1])?.[0] || null : null,
  confidence: matched ? 'rule_match' : 'needs_judgment',
}, null, 2));
