#!/usr/bin/env node
// cleanup-output — 清理过期的 sleuth-output 交付文件
//
// 用法：
//   node cleanup-output.mjs [--days N] [--dry-run]
//
//   --days N    保留最近 N 天的输出，默认 7 天
//   --dry-run   仅列出将删除的目录/文件，不实际删除
//
// 清理范围：
//   - ./sleuth-output/<date-subdirs>/
//   - ./sleuth-output/<type-subdirs>/ (扁平文件)
//   - ~/.sleuth/output/<date-subdirs>/
//
// 由 check-deps.mjs 前置检查自动调用，也可手动运行。

import { existsSync, readdirSync, rmSync, statSync, rmdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TYPE_SUBDIR_MAP } from './lib/output.mjs';

// --- 参数解析 ---
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

// --- 获取目录的有效 mtime（目录内最新文件的 mtime）---
function dirNewestMtime(dirPath) {
  let newest = 0;
  const walk = (d) => {
    try {
      for (const entry of readdirSync(d)) {
        const full = path.join(d, entry);
        let st;
        try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) {
          walk(full);
        } else if (st.isFile() && st.mtimeMs > newest) {
          newest = st.mtimeMs;
        }
      }
    } catch { /* 权限不足则跳过 */ }
  };
  walk(dirPath);
  return newest > 0 ? new Date(newest) : statSync(dirPath).mtime;
}

// --- 清理逻辑 ---
function collectDateDirs(baseDir) {
  if (!existsSync(baseDir)) return [];
  const result = [];
  try {
    for (const entry of readdirSync(baseDir)) {
      const full = path.join(baseDir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (!st.isDirectory()) continue;
      // 匹配 YYYY-MM-DD 格式的目录名
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry)) continue;
      result.push({ path: full, name: entry, mtime: dirNewestMtime(full) });
    }
  } catch { /* 权限不足则跳过 */ }
  return result;
}

// --- 收集扁平类型子目录中的过期文件 ---
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

function collectFlatFiles(dirPath, cutoffDate, result) {
  let entries;
  try { entries = readdirSync(dirPath); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dirPath, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      // 跳过日期目录（由 collectDateDirs 处理）
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

function cleanup(baseDir, cutoffDate, dryRun) {
  let deleted = 0;
  let kept = 0;

  // 1. 清理日期目录
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

  // 2. 清理扁平类型子目录中的过期文件
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

  // 3. 清理根级空的类型子目录（screenshots/, images/ 等残留）
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

// --- 主流程 ---
function main(options = {}) {
  const args = Object.keys(options).length > 0
    ? { days: 7, dryRun: false, ...options }
    : parseArgs(process.argv.slice(2));
  const cutoffDate = new Date(Date.now() - args.days * 86400000);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  const baseDirs = [
    path.join(process.cwd(), 'sleuth-output'),
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

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}

export { main, collectDateDirs, collectOldFiles, cleanup };
