/**
 * output.mjs — sleuth 输出目录管理的共享工具模块
 *
 * 被 check-deps.mjs（环境检查）和 deliver.mjs（文件交付）共同引用，
 * 避免两个脚本重复实现目录定位和创建逻辑。
 *
 * 核心功能：
 *   1. resolveOutputDir(sessionId?) — 定位输出目录的绝对路径
 *   2. ensureOutputDir(outDir) — 创建输出目录及其所有子目录（screenshots/、docs/ 等）
 *   3. TYPE_SUBDIR_MAP — 文件类型 → 子目录名的映射表
 *
 * 输出目录定位规则（优先级从高到低）：
 *   - 当前工作目录可写 → {cwd}/sleuth-output/<YYYY-MM-DD>/<sessionId>/
 *   - 当前工作目录不可写 → ~/.sleuth/output/<YYYY-MM-DD>/<sessionId>/
 *   - 工作目录是根目录 / → 同上，回退到 ~/.sleuth/output/
 */

import { accessSync, mkdirSync } from 'node:fs';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * 文件类型 → 子目录名映射。
 *
 * deliver.mjs 保存文件时根据 --type 参数查此表决定放到哪个子目录。
 * 例如 --type screenshot → screenshots/，--type doc → docs/
 */
const TYPE_SUBDIR_MAP = {
  screenshot: 'screenshots',   // 截图（调试证据、页面快照）
  image: 'images',             // 下载的图片资源
  doc: 'docs',                 // PDF、文档（调研报告等）
  transcript: 'transcripts',   // 字幕/转录（视频、播客）
  data: 'data',                // 结构化数据（JSON、CSV）
  page: 'pages',               // 页面 PDF 存档
  trace: 'traces',             // HAR 网络追踪
  recording: 'recordings',     // 录屏文件
};

/**
 * 定位输出目录的绝对路径。
 *
 * 目录结构：
 *   {base}/sleuth-output/YYYY-MM-DD/             ← 无 sessionId 时
 *   {base}/sleuth-output/YYYY-MM-DD/<sessionId>/  ← 有 sessionId 时
 *
 * base 的决定逻辑：
 *   1. 当前 cwd 可写 → 用 cwd 作为 base
 *   2. cwd 不可写（权限不足）或 cwd 是根目录 → 回退到 ~/.sleuth/output/
 *
 * cleanup-output.mjs 会按日期目录清理超过 N 天的过期输出。
 *
 * @param {string} [sessionId] - 可选的会话 ID，提供时在日期目录下再建一级隔离
 * @returns {string} 输出目录的绝对路径
 */
export function resolveOutputDir(sessionId) {
  // 取当前日期作为目录名（如 2026-04-29），按日隔离方便清理
  const datePart = new Date().toISOString().slice(0, 10);

  const cwd = process.cwd();
  let base;
  if (cwd === '/' || cwd === path.resolve('/')) {
    // 工作目录是根目录 → 不应该在 / 下创建 sleuth-output，回退到用户目录
    base = path.join(homedir(), '.sleuth', 'output');
  } else {
    try {
      // 测试当前目录是否有写权限
      accessSync(cwd, constants.W_OK);
      base = path.join(cwd, 'sleuth-output');
    } catch {
      // 当前目录不可写 → 回退到 ~/.sleuth/output/
      base = path.join(homedir(), '.sleuth', 'output');
    }
  }

  // 有 sessionId 时在日期目录下再建一级子目录（每次调研任务独立）
  return sessionId
    ? path.join(base, datePart, sessionId)
    : path.join(base, datePart);
}

/**
 * 创建输出目录及其所有类型子目录。
 *
 * 调用时机：check-deps.mjs 初始化时、deliver.mjs 保存文件前。
 * 使用 { recursive: true } 确保中间目录也会被创建，已存在时不报错。
 *
 * 创建的子目录：
 *   screenshots/ images/ docs/ transcripts/ data/ pages/ traces/ recordings/
 *
 * @param {string} outDir - 输出目录的绝对路径（由 resolveOutputDir 返回）
 */
export function ensureOutputDir(outDir) {
  // 创建主输出目录（如 sleuth-output/2026-04-29/abc123/）
  mkdirSync(outDir, { recursive: true });
  // 创建所有类型子目录（screenshots/、docs/ 等）
  for (const subdir of Object.values(TYPE_SUBDIR_MAP)) {
    mkdirSync(path.join(outDir, subdir), { recursive: true });
  }
}

// 导出类型映射，供 deliver.mjs、cleanup-output.mjs 引用
export { TYPE_SUBDIR_MAP };
