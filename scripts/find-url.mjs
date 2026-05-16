#!/usr/bin/env node
/**
 * find-url.mjs — 从本地 Chrome 书签/历史中检索 URL
 *
 * 用途：定位公网搜索覆盖不到的目标，如组织内部系统、SSO 后台、内网域名等。
 * Chrome 的书签和历史数据库存储在本地，直接读取 SQLite 数据库查询。
 *
 * 用法：
 *   node find-url.mjs [关键词...] [--only bookmarks|history] [--limit N] [--since 1d|7h|YYYY-MM-DD]
 *
 * 参数说明：
 *   [关键词]              空格分词，多词 AND 逻辑（全部包含才匹配）
 *                         匹配 title + url 字段；可省略（查全部历史）
 *   --only <source>       限定数据源：bookmarks（书签）/ history（历史）
 *                         默认两者都查
 *   --limit N             返回条数上限，默认 20；0 = 不限
 *   --since <window>      时间窗口（仅作用于历史记录）：
 *                         1d（1 天）、7h（7 小时）、30m（30 分钟）
 *                         或 YYYY-MM-DD（具体日期）
 *   --sort recent|visits   历史排序方式：
 *                         recent（最近访问，默认）/ visits（按访问次数）
 *
 * 示例：
 *   node find-url.mjs 财务小智                          # 搜书签+历史
 *   node find-url.mjs github --since 7d --only history   # 最近一周访问过的 github 页面
 *   node find-url.mjs --since 7d --only history --sort visits  # 最近一周高频访问的网站
 *   node find-url.mjs --since 2d --only history --limit 0      # 最近两天所有历史
 *
 * 跨 Profile 支持：
 *   自动检测 Chrome 的所有 Profile（读取 Local State 文件），
 *   逐个搜索书签和历史，结果标注 @ProfileName。
 *
 * 技术细节：
 *   - Chrome 运行时会锁定 History SQLite 数据库，所以先复制到 /tmp 再查询
 *   - Chrome 历史使用 WebKit 时间戳（1601 年起算的微秒数），需转换为 Unix 时间戳
 *   - 书签是 JSON 文件（Bookmarks），无需 SQLite
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

// ── 参数解析 ──────────────────────────────────────────────────────

/**
 * 解析命令行参数。
 *
 * @returns {{keywords: string[], only: string|null, limit: number, since: Date|null, sort: string}}
 */
function parseArgs(argv) {
  const a = { keywords: [], only: null, limit: 20, since: null, sort: 'recent' };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--only')        a.only  = argv[++i];
    else if (v === '--limit')  a.limit = parseInt(argv[++i], 10);
    else if (v === '--since')  a.since = parseSince(argv[++i]);
    else if (v === '--sort')   a.sort  = argv[++i];
    else if (v === '-h' || v === '--help') { printUsage(); process.exit(0); }
    else if (v.startsWith('--')) die(`未知参数: ${v}`);
    else a.keywords.push(v); // 非选项参数 → 关键词
  }
  // 参数校验
  if (a.only && !['bookmarks', 'history'].includes(a.only)) die(`--only 仅支持 bookmarks|history`);
  if (!['recent', 'visits'].includes(a.sort)) die(`--sort 仅支持 recent|visits`);
  if (Number.isNaN(a.limit) || a.limit < 0) die('--limit 需为非负整数');
  return a;
}

/**
 * 解析 --since 参数值。
 * 支持相对时间（1d、7h、30m）和绝对日期（YYYY-MM-DD）。
 *
 * @param {string} s - 时间字符串
 * @returns {Date} 截止日期
 */
function parseSince(s) {
  if (!s) die('--since 需要值');
  // 相对时间：1d → 1天前，7h → 7小时前，30m → 30分钟前
  const m = s.match(/^(\d+)([dhm])$/);
  if (m) {
    const n = parseInt(m[1], 10);
    const ms = { d: 86400000, h: 3600000, m: 60000 }[m[2]];
    return new Date(Date.now() - n * ms);
  }
  // 绝对日期
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) die(`无效 --since 值: ${s}（用 1d / 7h / 30m / YYYY-MM-DD）`);
  return d;
}

function die(msg) { console.error(msg); process.exit(1); }

/** 打印用法说明（从文件头注释中提取） */
function printUsage() {
  console.error(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 19).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
}

// ── Chrome 用户数据目录（跨平台）───────────────────────────────────

/**
 * 获取 Chrome 用户数据目录路径（跨平台）。
 * 书签、历史数据库、Profile 配置都在此目录下。
 */
function getChromeDataDir() {
  const home = os.homedir();
  switch (os.platform()) {
    case 'darwin': return path.join(home, 'Library/Application Support/Google/Chrome');
    case 'linux':  return path.join(home, '.config/google-chrome');
    case 'win32':  return path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/User Data');
    default: return null;
  }
}

// ── Profile 枚举 ──────────────────────────────────────────────────

/**
 * 列出 Chrome 中所有 Profile。
 * 读取 Chrome 的 Local State JSON 文件获取 Profile 列表。
 * 如果读取失败，回退到默认的 "Default" Profile。
 *
 * @param {string} dataDir - Chrome 用户数据目录
 * @returns {Array<{dir: string, name: string}>} Profile 目录名和显示名
 */
function listProfiles(dataDir) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(dataDir, 'Local State'), 'utf-8'));
    const info = state?.profile?.info_cache || {};
    const list = Object.keys(info).map(dir => ({ dir, name: info[dir].name || dir }));
    if (list.length) return list;
  } catch { /* 回退 */ }
  return [{ dir: 'Default', name: 'Default' }];
}

// ── 书签检索 ──────────────────────────────────────────────────────

/**
 * 在指定 Profile 的书签中搜索关键词。
 * 递归遍历书签树的所有节点，匹配 title 和 url。
 *
 * @param {string} profileDir - Profile 目录路径
 * @param {string} profileName - Profile 显示名
 * @param {string[]} keywords - 关键词列表（全部匹配才算命中）
 * @returns {Array<{profile, name, url, folder}>} 匹配的书签列表
 */
function searchBookmarks(profileDir, profileName, keywords) {
  const file = path.join(profileDir, 'Bookmarks');
  if (!fs.existsSync(file)) return [];
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return []; }
  // 书签无时间维度，无关键词时返回空（避免返回全部书签）
  if (!keywords.length) return [];

  const needles = keywords.map(k => k.toLowerCase());
  const out = [];

  /**
   * 递归遍历书签节点树。
   * @param {object} node - 书签节点
   * @param {string[]} trail - 当前文件夹路径（用于显示书签所在位置）
   */
  function walk(node, trail) {
    if (!node) return;
    if (node.type === 'url') {
      // URL 节点：检查 title 和 url 是否包含所有关键词
      const hay = `${node.name || ''} ${node.url || ''}`.toLowerCase();
      if (needles.every(n => hay.includes(n))) {
        out.push({
          profile: profileName,
          name: node.name || '',
          url: node.url || '',
          folder: trail.join(' / '), // 书签文件夹路径
        });
      }
    }
    if (Array.isArray(node.children)) {
      const sub = node.name ? [...trail, node.name] : trail;
      for (const c of node.children) walk(c, sub);
    }
  }

  // 遍历书签根节点（bookmark_bar、other、synced 等）
  for (const root of Object.values(data.roots || {})) walk(root, []);
  return out;
}

// ── 历史检索（SQLite）─────────────────────────────────────────────

// Chrome/WebKit 时间戳起始点：1601-01-01 00:00:00 UTC（以微秒计）
// 需要减去这个偏移量才能转换为 Unix 时间戳（1970年起算的秒数）
const WEBKIT_EPOCH_DIFF_US = 11644473600000000n;

/**
 * 在指定 Profile 的浏览历史中搜索。
 *
 * 技术要点：
 *   - Chrome 运行时会锁定 History 数据库 → 先复制到 /tmp 再查询
 *   - Chrome 使用 WebKit 时间戳（1601 年起算的微秒数）
 *   - 转换公式：unix_seconds = (webkit_us - 11644473600000000) / 1000000
 *
 * @param {string} profileDir - Profile 目录路径
 * @param {string} profileName - Profile 显示名
 * @param {string[]} keywords - 关键词列表
 * @param {Date|null} since - 截止日期
 * @param {number} limit - 条数上限（0 = 不限）
 * @param {string} sort - 排序方式（recent / visits）
 * @returns {Array<{profile, title, url, visit, visit_count}>} 历史记录列表
 */
function searchHistory(profileDir, profileName, keywords, since, limit, sort) {
  const src = path.join(profileDir, 'History');
  if (!fs.existsSync(src)) return [];

  // 复制到临时文件（避免数据库锁定）
  const tmp = path.join(os.tmpdir(), `chrome-history-${process.pid}-${Date.now()}.sqlite`);
  try {
    fs.copyFileSync(src, tmp);

    // 构建 SQL WHERE 条件
    const conds = ['last_visit_time > 0'];
    // 关键词匹配（title + url，不区分大小写）
    for (const kw of keywords) {
      const esc = kw.toLowerCase().replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_');
      conds.push(`LOWER(title || ' ' || url) LIKE '%${esc}%' ESCAPE '\\'`);
    }
    // 时间窗口过滤
    if (since) {
      const webkitUs = BigInt(since.getTime()) * 1000n + WEBKIT_EPOCH_DIFF_US;
      conds.push(`last_visit_time >= ${webkitUs}`);
    }

    const limitClause = limit === 0 ? -1 : limit; // -1 = SQLite 不限
    const orderBy = sort === 'visits'
      ? 'visit_count DESC, last_visit_time DESC'  // 按访问次数排序
      : 'last_visit_time DESC';                    // 按最近访问排序

    // SQL 查询：标题、URL、访问时间、访问次数
    const sql = `SELECT title, url,
      datetime((last_visit_time - 11644473600000000)/1000000, 'unixepoch', 'localtime') AS visit,
      visit_count
      FROM urls WHERE ${conds.join(' AND ')}
      ORDER BY ${orderBy} LIMIT ${limitClause};`;

    // 执行 sqlite3 命令行工具查询
    const raw = execFileSync('sqlite3', ['-separator', '\t', tmp, sql], {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024, // 50MB 缓冲（历史记录可能很多）
    });

    // 解析 TSV 输出
    return raw.trim().split('\n').filter(Boolean).map(line => {
      const [title, url, visit, visit_count] = line.split('\t');
      return { profile: profileName, title, url, visit, visit_count: parseInt(visit_count, 10) };
    });
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.error('未找到 sqlite3 命令。macOS/Linux 通常自带；Windows 可用 `winget install sqlite.sqlite` 或从 https://sqlite.org/download.html 下载后加入 PATH。');
      return [];
    }
    console.error('⚠️  历史搜索失败:', e.message || e);
    return [];
  } finally {
    // 清理临时文件
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// ── 输出格式化 ────────────────────────────────────────────────────

// 用 `|` 作字段分隔符；字段内含 `|` 的替换成 `│`（全角竖线）避免歧义
const clean = s => String(s ?? '').replaceAll('|', '│').trim();

/** 打印书签搜索结果 */
function printBookmarks(items, multiProfile) {
  console.log(`[书签] ${items.length} 条`);
  for (const b of items) {
    const segs = [clean(b.name) || '(无标题)', clean(b.url)];
    if (b.folder) segs.push(clean(b.folder));            // 书签文件夹路径
    if (multiProfile) segs.push('@' + clean(b.profile));  // 多 Profile 时标注来源
    console.log('  ' + segs.join(' | '));
  }
}

/** 打印历史搜索结果 */
function printHistory(items, multiProfile, sortLabel) {
  console.log(`[历史] ${items.length} 条（${sortLabel}）`);
  for (const h of items) {
    const segs = [clean(h.title) || '(无标题)', clean(h.url), h.visit];
    if (h.visit_count > 1) segs.push(`visits=${h.visit_count}`); // 多次访问标注
    if (multiProfile) segs.push('@' + clean(h.profile));
    console.log('  ' + segs.join(' | '));
  }
}

// ── 主流程 ────────────────────────────────────────────────────────

// 解析参数
const args = parseArgs(process.argv.slice(2));

// 检测 Chrome 数据目录
const dataDir = getChromeDataDir();
if (!dataDir || !fs.existsSync(dataDir)) die('未找到 Chrome 用户数据目录');

// 枚举所有 Chrome Profile
const profiles = listProfiles(dataDir);
const doBookmarks = args.only !== 'history';
const doHistory   = args.only !== 'bookmarks';

// 逐 Profile 搜索
const bookmarks = [];
const history = [];
for (const p of profiles) {
  const pDir = path.join(dataDir, p.dir);
  if (!fs.existsSync(pDir)) continue;
  if (doBookmarks) bookmarks.push(...searchBookmarks(pDir, p.name, args.keywords));
  // 历史搜索时多取一些（跨 Profile 合并后再截取）
  if (doHistory)   history.push(...searchHistory(pDir, p.name, args.keywords, args.since, args.limit === 0 ? 0 : args.limit * 2, args.sort));
}

// 历史跨 Profile 合并后重新排序 + 截取
if (args.sort === 'visits') {
  history.sort((a, b) => (b.visit_count || 0) - (a.visit_count || 0) || (b.visit || '').localeCompare(a.visit || ''));
} else {
  history.sort((a, b) => (b.visit || '').localeCompare(a.visit || ''));
}
const bookmarksOut = args.limit === 0 ? bookmarks : bookmarks.slice(0, args.limit);
const historyOut   = args.limit === 0 ? history   : history.slice(0, args.limit);

// 仅当结果真的横跨多个 Profile 时，才输出 @profile 标注
const seenProfiles = new Set([...bookmarksOut, ...historyOut].map(x => x.profile));
const showProfile = seenProfiles.size > 1;

// 输出结果
const sortLabel = args.sort === 'visits' ? '按访问次数' : '按最近访问';
if (doBookmarks) printBookmarks(bookmarksOut, showProfile);
if (doBookmarks && doHistory) console.log(); // 书签和历史之间空行分隔
if (doHistory)   printHistory(historyOut, showProfile, sortLabel);

// 无关键词搜书签时的提示（书签无时间维度，结果无意义）
if (!args.keywords.length && doBookmarks && !doHistory) {
  console.error('\n提示：书签无时间维度，无关键词查询无意义。加关键词或切换 --only history。');
}
