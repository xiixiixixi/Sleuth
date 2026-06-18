/**
 * output.mjs — sleuth 输出目录管理
 *
 * 被 check-deps.mjs 引用，用于告诉 agent 输出目录在哪。
 * 砍掉 session 系统后，不再按 session 分子目录，只按日期。
 *
 * 输出目录：~/.sleuth/output/YYYY-MM-DD/
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * 定位输出目录的绝对路径：~/.sleuth/output/YYYY-MM-DD/
 */
export function resolveOutputDir() {
  const datePart = new Date().toISOString().slice(0, 10);
  return path.join(homedir(), '.sleuth', 'output', datePart);
}

/**
 * 创建输出目录。
 */
export function ensureOutputDir(outDir) {
  mkdirSync(outDir, { recursive: true });
}
