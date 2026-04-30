/**
 * output.mjs — sleuth 输出目录管理的共享工具模块
 *
 * 被 check-deps.mjs（环境检查）和 deliver.mjs（文件交付）共同引用。
 *
 * 核心功能：
 *   1. resolveOutputDir(sessionId?) — 定位输出目录的绝对路径
 *   2. ensureOutputDir(outDir) — 创建输出目录及其所有子目录
 *   3. TYPE_SUBDIR_MAP — 文件类型 → 子目录名的映射表
 *
 * 所有输出统一存放在 ~/.sleuth/output/<YYYY-MM-DD>/<sessionId>/
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const TYPE_SUBDIR_MAP = {
  screenshot: 'screenshots',
  image: 'images',
  doc: 'docs',
  transcript: 'transcripts',
  data: 'data',
  page: 'pages',
  trace: 'traces',
  recording: 'recordings',
};

/**
 * 定位输出目录的绝对路径。
 *
 * 目录结构：
 *   ~/.sleuth/output/YYYY-MM-DD/             ← 无 sessionId 时
 *   ~/.sleuth/output/YYYY-MM-DD/<sessionId>/  ← 有 sessionId 时
 */
export function resolveOutputDir(sessionId) {
  const datePart = new Date().toISOString().slice(0, 10);
  const base = path.join(homedir(), '.sleuth', 'output');

  return sessionId
    ? path.join(base, datePart, sessionId)
    : path.join(base, datePart);
}

/**
 * 创建输出目录及其所有类型子目录。
 */
export function ensureOutputDir(outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const subdir of Object.values(TYPE_SUBDIR_MAP)) {
    mkdirSync(path.join(outDir, subdir), { recursive: true });
  }
}

export { TYPE_SUBDIR_MAP };
