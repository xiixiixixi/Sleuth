#!/usr/bin/env node
/**
 * deliver.mjs — 文件交付工具
 *
 * 统一管理 sleuth 调研产物的文件保存、列表和目录初始化。
 * 所有交付文件按 日期/session/类型 三级目录组织。
 *
 * 三个子命令：
 *
 *   save — 保存文件到输出目录
 *     用法：node deliver.mjs --action save --source <源文件> --type <类型> --name <文件名> --sid <session-id>
 *     功能：
 *       1. 根据类型（screenshot/doc/data 等）定位目标子目录
 *       2. 处理文件名冲突（同名文件加时间戳精确到毫秒）
 *       3. 复制文件到目标位置
 *       4. 如果提供了 sid，自动调用 session-logger.mjs 记录这次交付操作
 *     输出：目标文件的绝对路径（stdout）
 *
 *   list — 列出某个 session 的所有交付文件
 *     用法：node deliver.mjs --action list --sid <session-id>
 *     输出：相对路径列表，每行一个
 *
 *   init — 初始化输出目录结构
 *     用法：node deliver.mjs --action init --sid <session-id>
 *     输出：输出目录的绝对路径
 *
 * 文件类型与子目录映射（来自 lib/output.mjs）：
 *   screenshot → screenshots/    image → images/    doc → docs/
 *   transcript → transcripts/    data → data/       page → pages/
 *   trace → traces/              recording → recordings/
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { resolveOutputDir, ensureOutputDir, TYPE_SUBDIR_MAP } from './lib/output.mjs';

// 项目根目录
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// session-logger.mjs 的路径（用于记录交付操作到 session 日志）
const SESSION_LOGGER = path.join(ROOT, 'scripts', 'session-logger.mjs');

// ── 工具函数 ──────────────────────────────────────────────────────

/**
 * 根据 type 参数返回对应的子目录名。
 * 例如 type="screenshot" → "screenshots"
 * 未知类型返回 null（文件将保存到输出根目录）。
 */
function getTypeSubdir(type) {
  return TYPE_SUBDIR_MAP[type] || null;
}

/**
 * 根据源文件和用户指定名称推导最终文件名。
 *
 * 规则：
 *   - 用户提供了 --name → 用 name + 源文件扩展名
 *   - 用户未提供 → 用源文件原始文件名
 *
 * @param {string} sourcePath - 源文件路径
 * @param {string} [name] - 用户指定的文件名（不含扩展名）
 * @returns {string} 最终文件名
 */
function deriveFilename(sourcePath, name) {
  const ext = path.extname(sourcePath);
  if (name) {
    return name + ext; // 用户指定名称 + 保留原扩展名
  }
  return path.basename(sourcePath); // 直接用原始文件名
}

/**
 * 文件名冲突处理：如果目标路径已存在同名文件，在文件名后追加时间戳。
 *
 * 例如：report.pdf → report-143052123.pdf
 * 时间戳精确到毫秒，几乎不可能再冲突。
 *
 * @param {string} targetPath - 目标文件完整路径
 * @returns {string} 不冲突的文件路径
 */
function avoidCollision(targetPath) {
  if (!existsSync(targetPath)) return targetPath; // 无冲突，直接用

  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const baseWithoutExt = path.basename(targetPath, ext);

  // 构造毫秒级时间戳：HHmmssSSS
  const now = new Date();
  const ts =
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0') +
    String(now.getMilliseconds()).padStart(3, '0');

  return path.join(dir, `${baseWithoutExt}-${ts}${ext}`);
}

/**
 * 从文件路径中提取域名形式的路径段。
 * 用于 session 日志记录，标记交付文件与哪个网站相关。
 *
 * 例如路径中包含 "example.com" 段 → 返回 "example.com"
 */
function extractDomainFromPath(filePath) {
  const parts = filePath.split(path.sep);
  for (const part of parts) {
    // 匹配域名模式：xx.yy 或 xx.yy.zz
    if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(part)) {
      return part;
    }
  }
  return null;
}

// ── 子命令：save ──────────────────────────────────────────────────

/**
 * save 命令：将源文件复制到输出目录，并可选记录到 session 日志。
 *
 * 流程：
 *   1. 验证源文件存在
 *   2. 定位输出目录（日期/session-id/类型子目录）
 *   3. 推导文件名，处理冲突
 *   4. 复制文件
 *   5. 输出目标路径到 stdout
 *   6. 如果有 sid → 调用 session-logger.mjs 记录 type=deliver 操作
 */
function cmdSave(source, type, name, sid) {
  if (!source) {
    console.error('Error: --source is required for action "save"');
    process.exit(2);
  }

  // 验证源文件存在
  if (!existsSync(source)) {
    console.error(`Error: source file not found: ${source}`);
    process.exit(1);
  }

  // 定位输出目录（如 sleuth-output/2026-04-29/abc123/）
  const outDir = resolveOutputDir(sid);
  const typeSubdir = getTypeSubdir(type);

  if (!typeSubdir && type) {
    // 未知类型 → 保存到输出根目录，给出警告
    console.warn(`Warning: unknown type "${type}", saving to output root`);
  }

  // 确定目标目录
  let targetDir = outDir;
  if (typeSubdir) {
    targetDir = path.join(outDir, typeSubdir); // 如 sleuth-output/.../screenshots/
  }

  // 确保目录存在
  mkdirSync(targetDir, { recursive: true });

  // 推导文件名并处理冲突
  const filename = deriveFilename(source, name);
  const targetPath = avoidCollision(path.join(targetDir, filename));

  // 复制文件（保留源文件不变）
  try {
    copyFileSync(source, targetPath);
  } catch (err) {
    console.error(`Error: failed to copy file: ${err.message}`);
    process.exit(1);
  }

  // 输出目标路径（供 Agent 获取文件位置）
  console.log(targetPath);

  // 可选：记录交付操作到 session 日志
  if (sid) {
    const domain = extractDomainFromPath(source);
    // 构造 operation 记录
    const op = JSON.stringify({
      type: 'deliver',
      content_type: type,
      file: targetPath,
      source: source,
      ...(domain && { domain }), // 如果能提取到域名则附带
    });
    try {
      // 调用 session-logger.mjs --action log 记录
      execFileSync(
        'node',
        [SESSION_LOGGER, '--action', 'log', '--sid', sid, '--operation', op],
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }
      );
    } catch (err) {
      // session 日志记录失败不影响文件保存
      console.warn(`Warning: session logging failed: ${err.message}`);
    }
  }
}

// ── 子命令：list ──────────────────────────────────────────────────

/**
 * list 命令：递归列出输出目录下的所有文件。
 * 输出相对于输出根目录的路径。
 */
function cmdList(sid) {
  const outDir = resolveOutputDir(sid);

  if (!existsSync(outDir)) {
    console.log('(empty)');
    return;
  }

  const files = [];
  walk(outDir, outDir, files);

  if (files.length === 0) {
    console.log('(empty)');
  } else {
    for (const f of files) {
      console.log(f);
    }
  }
}

/** 递归遍历目录，收集所有文件的相对路径 */
function walk(baseDir, currentDir, result) {
  let entries;
  try {
    entries = readdirSync(currentDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry);
    let st;
    try {
      st = statSync(fullPath);
    } catch {
      continue;
    }

    // 跳过符号链接（避免循环引用）
    if (st.isSymbolicLink()) continue;

    if (st.isDirectory()) {
      walk(baseDir, fullPath, result); // 递归子目录
    } else if (st.isFile()) {
      result.push(path.relative(baseDir, fullPath)); // 输出相对路径
    }
  }
}

// ── 子命令：init ──────────────────────────────────────────────────

/** init 命令：初始化输出目录结构（创建所有子目录），输出路径。 */
function cmdInit(sid) {
  const outDir = resolveOutputDir(sid);
  ensureOutputDir(outDir); // 创建目录及所有类型子目录
  console.log(outDir);
}

// ── 参数解析与主流程 ──────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    options: {
      action: { type: 'string' },  // 子命令：save / list / init
      type:   { type: 'string' },  // save 时的文件类型
      source: { type: 'string' },  // save 时的源文件路径
      name:   { type: 'string' },  // save 时的目标文件名（可选）
      sid:    { type: 'string' },  // session ID
      help:   { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log('Usage: node deliver.mjs --action <save|list|init> [options]');
    console.log('  --action save   --source <path> [--type <type>] [--name <name>] [--sid <id>]');
    console.log('  --action list   [--sid <id>]');
    console.log('  --action init   [--sid <id>]');
    console.log('');
    console.log('Content types: ' + Object.keys(TYPE_SUBDIR_MAP).join(', '));
    return;
  }

  if (!values.action) {
    console.error('Error: --action is required. Must be save, list, or init.');
    process.exit(2);
  }

  switch (values.action) {
    case 'save':
      cmdSave(values.source, values.type, values.name, values.sid);
      break;
    case 'list':
      cmdList(values.sid);
      break;
    case 'init':
      cmdInit(values.sid);
      break;
    default:
      console.error(`Error: unknown action "${values.action}". Must be save, list, or init.`);
      process.exit(2);
  }
}

main();
