/**
 * output.mjs — sleuth 输出目录管理
 *
 * 被 check-deps.mjs 引用，用于告诉 agent 输出目录在哪。
 *
 * 两种模式：
 *   - 默认（不传 taskName）：~/.sleuth/output/YYYY-MM-DD/（向后兼容）
 *   - 任务模式（传 taskName）：~/.sleuth/output/<task-name>/（多 Agent 协作需独立 task 目录）
 *
 * 任务模式从 2026-06-19 重构引入：4 角色（主/搜索/边界/审查）loop 协作时
 * 每个任务需要独立目录，避免 findings.jsonl / directions.json 跨任务串扰。
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Sanitize task name 防止路径注入。
 *
 * 允许字符：字母 / 数字 / 短横线 / 下划线 / 点
 * 拒绝：路径分隔符 / 空字符串 / null / 非法字符
 *
 * 设计原则：task-name 是单层目录名（不能含 /），保持 task 目录扁平化。
 */
export function sanitizeTaskName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('task name required (non-empty string)');
  }
  // 拒绝 `..`、`.`、绝对路径（防 traversal）
  if (name === '.' || name === '..' || path.isAbsolute(name)) {
    throw new Error(`invalid task name: ${name}`);
  }
  // 只允许：[a-zA-Z0-9-_.]
  if (!/^[a-zA-Z0-9-_.]+$/.test(name)) {
    throw new Error(
      `invalid task name (allowed: letters, digits, '-', '_', '.'): ${name}`
    );
  }
  return name;
}

/**
 * 定位输出目录的绝对路径。
 *
 * @param {string} [taskName] - 可选 task name；传入则用 ~/.sleuth/output/<task-name>/，否则按日期
 * @returns {string} 绝对路径
 */
export function resolveOutputDir(taskName) {
  if (taskName !== undefined) {
    const safe = sanitizeTaskName(taskName);
    return path.join(homedir(), '.sleuth', 'output', safe);
  }
  const datePart = new Date().toISOString().slice(0, 10);
  return path.join(homedir(), '.sleuth', 'output', datePart);
}

/**
 * 创建输出目录（含父目录）。
 */
export function ensureOutputDir(outDir) {
  mkdirSync(outDir, { recursive: true });
}
