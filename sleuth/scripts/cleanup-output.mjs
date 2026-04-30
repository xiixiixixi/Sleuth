#!/usr/bin/env node
/**
 * cleanup-output.mjs — 过期输出文件清理
 *
 * 清理 ~/.sleuth/output/ 下超过指定天数的交付文件，避免磁盘空间无限增长。
 * 默认保留 7 天，可配置。
 *
 * 用法：
 *   node cleanup-output.mjs [--days N] [--dry-run]
 *
 *   --days N    保留最近 N 天的输出，默认 7 天
 *   --dry-run   仅列出将删除的目录/文件，不实际删除
 *
 * 清理范围：
 *   ~/.sleuth/output/
 *
 * 清理策略：
 *   - 日期目录（YYYY-MM-DD/）：如果目录内最新文件的修改时间超过 N 天，整个目录删除
 *   - 类型子目录中的扁平文件：修改时间超过 N 天的单独删除
 *   - 空的类型子目录：直接删除（screenshots/ 等残留空目录）
 *
 * 触发时机：
 *   - check-deps.mjs 每次运行时自动调用（非阻塞，静默执行）
 *   - 也可手动运行
 */

import { existsSync, readdirSync, rmSync, statSync, rmdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TYPE_SUBDIR_MAP } from './lib/output.mjs';

// ── 参数解析 ──────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = { days: 7, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') a.days = parseInt(argv[++i], 10);
    else if (argv[i] === '--dry-run') a.dryRun = true;
    else if (argv[i] === '-h' || argv[i] === '--help') {
      const usage = [
        '用法: node cleanup-output.mjs [--days N] [--dry-run]',
        '',
        '  --days N    保留最近 N 天的输出，默认 7 天',
        '  --dry-run   仅列出将删除的目录/文件，不实际删除',
      ];
      console.log(usage.join('\n'));
      process.exit(0);
    }
  }
  if (Number.isNaN(a.days) || a.days < 1) {
    console.error('错误：--days 必须为正整数');
    process.exit(2);
  }
  return a;
}

// ── 目录时间判断 ──────────────────────────────────────────────────

/**
 * 获取目录内最新文件的修改时间。
 * 递归遍历目录中所有文件，取最大的 mtime（毫秒时间戳转 Date）。
 * 用于判断日期目录是否过期：基于目录内最新文件而非目录本身。
 *
 * @param {string} dirPath - 目录路径
 * @returns {Date} 目录内最新文件的修改时间
 */
function dirNewestMtime(dirPath) {
  let newest = 0;
  const walk = (d) => {
    try {
      for (const entry of readdirSync(d)) {
        const full = path.join(d, entry);
        let st;
        try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) {
          walk(full); // 递归子目录
        } else if (st.isFile() && st.mtimeMs > newest) {
          newest = st.mtimeMs; // 更新最新时间
        }
      }
    } catch { /* 权限不足则跳过 */ }
  };
  walk(dirPath);
  // 如果目录为空（newest 仍为 0），使用目录本身的 mtime
  return newest > 0 ? new Date(newest) : statSync(dirPath).mtime;
}

// ── 收集待清理项 ──────────────────────────────────────────────────

/**
 * 收集指定目录下所有日期格式（YYYY-MM-DD）的子目录。
 *
 * @param {string} baseDir - 基础目录路径
 * @returns {Array<{path: string, name: string, mtime: Date}>} 日期目录列表
 */
function collectDateDirs(baseDir) {
  if (!existsSync(baseDir)) return [];
  const result = [];
  try {
    for (const entry of readdirSync(baseDir)) {
      const full = path.join(baseDir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (!st.isDirectory()) continue;
      // 只匹配 YYYY-MM-DD 格式的目录名
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry)) continue;
      result.push({ path: full, name: entry, mtime: dirNewestMtime(full) });
    }
  } catch { /* 权限不足则跳过 */ }
  return result;
}

/**
 * 收集类型子目录（screenshots/、docs/ 等）中修改时间早于截止日期的文件。
 * 跳过日期子目录（YYYY-MM-DD），那些由 collectDateDirs 处理。
 *
 * @param {string} baseDir - 基础目录路径
 * @param {Date} cutoffDate - 截止日期（早于此日期的文件被收集）
 * @returns {Array<string>} 过期文件路径列表
 */
function collectOldFiles(baseDir, cutoffDate) {
  const result = [];
  const subdirs = Object.values(TYPE_SUBDIR_MAP);
  for (const subdir of subdirs) {
    const dirPath = path.join(baseDir, subdir);
    if (!existsSync(dirPath)) continue;
    try { collectFlatFiles(dirPath, cutoffDate, result); } catch { /* 权限不足 */ }
  }
  return result;
}

/** 递归收集目录中的过期文件（跳过日期目录） */
function collectFlatFiles(dirPath, cutoffDate, result) {
  let entries;
  try { entries = readdirSync(dirPath); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dirPath, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      // 日期目录由 collectDateDirs 处理，这里跳过
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry)) {
        collectFlatFiles(full, cutoffDate, result);
      }
      continue;
    }
    if (st.mtime < cutoffDate) {
      result.push(full);
    }
  }
}

// ── 执行清理 ──────────────────────────────────────────────────────

/**
 * 执行单个目录的清理。
 *
 * 清理三步：
 *   1. 删除过期的日期目录（整个目录递归删除）
 *   2. 删除类型子目录中的过期文件
 *   3. 删除空的类型子目录（残留的无用空目录）
 *
 * @param {string} baseDir - 基础目录路径
 * @param {Date} cutoffDate - 截止日期
 * @param {boolean} dryRun - true 时只列出不删除
 * @returns {{deleted: number, kept: number}} 删除和保留的数量
 */
function cleanup(baseDir, cutoffDate, dryRun) {
  let deleted = 0;
  let kept = 0;

  // 第 1 步：清理过期的日期目录
  const dateDirs = collectDateDirs(baseDir);
  if (dateDirs.length > 0) {
    const toDelete = dateDirs.filter(d => d.mtime < cutoffDate);
    const toKeep = dateDirs.filter(d => d.mtime >= cutoffDate);
    kept += toKeep.length;

    for (const d of toDelete) {
      if (dryRun) {
        console.log(`[dry-run] 将删除目录: ${d.path}`);
      } else {
        try {
          rmSync(d.path, { recursive: true, force: true });
          console.log(`已删除目录: ${d.path}`);
        } catch (err) {
          console.error(`删除目录失败: ${d.path} — ${err.message}`);
        }
      }
      deleted++;
    }
  }

  // 第 2 步：清理类型子目录中的过期文件
  const oldFiles = collectOldFiles(baseDir, cutoffDate);
  for (const f of oldFiles) {
    if (dryRun) {
      console.log(`[dry-run] 将删除文件: ${f}`);
    } else {
      try {
        rmSync(f, { force: true });
        console.log(`已删除文件: ${f}`);
      } catch (err) {
        console.error(`删除文件失败: ${f} — ${err.message}`);
      }
    }
    deleted++;
  }

  // 第 3 步：清理空的类型子目录（如 screenshots/ 是空的）
  for (const subdir of Object.values(TYPE_SUBDIR_MAP)) {
    const dirPath = path.join(baseDir, subdir);
    if (!existsSync(dirPath)) continue;
    try {
      const entries = readdirSync(dirPath);
      if (entries.length === 0) {
        if (dryRun) {
          console.log(`[dry-run] 将删除空目录: ${dirPath}`);
        } else {
          rmdirSync(dirPath);
          console.log(`已删除空目录: ${dirPath}`);
        }
        deleted++;
      }
    } catch { /* 权限不足则跳过 */ }
  }

  return { deleted, kept };
}

// ── 主流程 ────────────────────────────────────────────────────────

/**
 * 主函数。支持两种调用方式：
 *   1. 直接运行：从命令行参数读取配置
 *   2. 编程调用：传入 options 对象（如 check-deps.mjs 的调用）
 *
 * @param {object} [options] - 可选配置
 * @param {number} [options.days=7] - 保留天数
 * @param {boolean} [options.dryRun=false] - 是否只预览
 */
function main(options = {}) {
  // 如果有 options 传入（编程调用），用 options；否则解析命令行参数
  const args = Object.keys(options).length > 0
    ? { days: 7, dryRun: false, ...options }
    : parseArgs(process.argv.slice(2));

  // 计算截止日期：当前时间 - days 天
  const cutoffDate = new Date(Date.now() - args.days * 86400000);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  // 两个输出目录都处理
  const baseDirs = [
    path.join(homedir(), '.sleuth', 'output'),
  ];

  let totalDeleted = 0;
  let totalKept = 0;
  const action = args.dryRun ? '预览（dry-run）' : '清理';

  console.log(`${action}过期输出（保留最近 ${args.days} 天，截止 ${cutoffStr}）...`);

  for (const baseDir of baseDirs) {
    if (!existsSync(baseDir)) continue;
    const { deleted, kept } = cleanup(baseDir, cutoffDate, args.dryRun);
    totalDeleted += deleted;
    totalKept += kept;
  }

  if (totalDeleted === 0 && totalKept === 0) {
    console.log('无输出需要清理。');
  } else {
    const dryLabel = args.dryRun ? '（dry-run，未实际删除）' : '';
    console.log(`完成：删除 ${totalDeleted} 个过期项，保留 ${totalKept} 个日期目录${dryLabel}`);
  }
}

// 判断是否直接运行（还是被 import）
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}

// 导出供 check-deps.mjs 编程调用
export { main, collectDateDirs, collectOldFiles, cleanup };
