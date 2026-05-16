#!/usr/bin/env node
/**
 * route-task.mjs — 搜索模式路由 CLI
 *
 * 根据目标域名和 site-pattern 配置，判断搜索策略并执行站内搜索。
 *
 * 用法：
 *   node scripts/route-task.mjs --domain <domain> --query <query> [--json] [--scroll]
 *
 * 选项：
 *   --domain <domain>   目标域名（必需）
 *   --query <query>     搜索关键词（必需）
 *   --json              JSON 输出模式
 *   --scroll            启用无限滚动采集
 *   --max-results <n>   最大结果数（默认 100）
 *   --max-rounds <n>    最大滚动轮次（默认 10）
 *   --filter <k=v>      筛选条件（可多次使用）
 *   --cdp-port <port>   CDP 端口（默认自动检测）
 */

import {
  parseSiteSearch,
  buildSearchUrl,
  extractSearchResults,
  collectWithScroll,
  routeSearchMode,
  expandQuery,
  SCROLL_LIMITS,
} from './lib/site-search.mjs';
import { detectManagedCDPPort } from './lib/check-deps-core.mjs';

// ─── 参数解析 ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getFlag(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1;
}

function getValue(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function getMultiValue(name) {
  const values = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` && i + 1 < args.length) {
      values.push(args[++i]);
    }
  }
  return values;
}

const domain = getValue('domain');
const query = getValue('query');
const jsonMode = getFlag('json');
const scrollMode = getFlag('scroll');
const maxResults = parseInt(getValue('max-results') || SCROLL_LIMITS.MAX_RESULTS, 10);
const maxRounds = parseInt(getValue('max-rounds') || SCROLL_LIMITS.MAX_SCROLL_ROUNDS, 10);
const filters = Object.fromEntries(getMultiValue('filter').map(f => { const [k, ...v] = f.split('='); return [k, v.join('=')]; }));
const cdpPortOverride = getValue('cdp-port');

// 严格正整数校验辅助函数
function isStrictPositiveInt(val) {
  return /^[1-9]\d*$/.test(String(val));
}

// 输入校验：数值参数必须为正整数
if (!isStrictPositiveInt(maxResults)) {
  console.error('错误: --max-results 必须为正整数');
  process.exit(1);
}
if (!isStrictPositiveInt(maxRounds)) {
  console.error('错误: --max-rounds 必须为正整数');
  process.exit(1);
}
if (cdpPortOverride) {
  const port = parseInt(cdpPortOverride, 10);
  if (!isStrictPositiveInt(cdpPortOverride) || port > 65535) {
    console.error('错误: --cdp-port 必须为 1-65535 之间的正整数');
    process.exit(1);
  }
}

// ─── 参数验证 ────────────────────────────────────────────────────────────────

if (!domain || !query) {
  console.error('用法: node scripts/route-task.mjs --domain <domain> --query <query> [--json] [--scroll]');
  console.error('');
  console.error('必需参数:');
  console.error('  --domain <domain>   目标域名');
  console.error('  --query <query>     搜索关键词');
  console.error('');
  console.error('可选参数:');
  console.error('  --json              JSON 输出');
  console.error('  --scroll            启用无限滚动');
  console.error('  --max-results <n>   最大结果数');
  console.error('  --max-rounds <n>    最大滚动轮次');
  console.error('  --filter <k=v>      筛选条件');
  console.error('  --cdp-port <port>   CDP 端口');
  process.exit(1);
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  // 1. 解析 site-pattern search schema
  const searchSchema = parseSiteSearch(domain);

  // 2. 判断 auth 状态（检查 cdp-state.json 中的 auth_state）
  let hasAuth = false;
  try {
    const os = await import('os');
    const fs = await import('fs');
    const path = await import('path');
    const statePath = path.join(os.default.homedir(), '.sleuth', 'cdp-state.json');
    if (fs.default.existsSync(statePath)) {
      const state = JSON.parse(fs.default.readFileSync(statePath, 'utf-8'));
      // 缓存 hint：仅表示曾经验证过，不保证当前仍有效（cookie 可能过期）
      // 路由决策时视为可能有 auth，但执行时仍需实时验证
      hasAuth = state.auth_verified_domains?.includes(domain) || false;
    }
  } catch { /* 读取失败视为未验证 */ }

  const routing = routeSearchMode({ domain, query, hasAuth, searchSchema });

  if (jsonMode) {
    // JSON 模式：输出路由结果 + 搜索结果（如有）
    const output = {
      domain,
      query,
      routing,
      search_schema: searchSchema || null,
      search_url: null,
      results: null,
      provenance: null,
    };

    if (routing.mode === 'site' || routing.mode === 'both') {
      output.search_url = buildSearchUrl(searchSchema, query, filters);

      // 尝试执行搜索（需要 CDP）
      const cdpResult = cdpPortOverride ? { port: parseInt(cdpPortOverride) } : await detectManagedCDPPort();
      const cdpPort = cdpResult?.port || null;
      if (cdpPort && searchSchema?.result_selector) {
        const searchUrl = output.search_url;
        if (scrollMode && searchSchema.pagination === 'infinite-scroll') {
          const collected = await collectWithScroll(cdpPort, searchUrl, searchSchema.result_selector, {
            MAX_RESULTS: maxResults,
            MAX_SCROLL_ROUNDS: maxRounds,
            filterValues: filters,
            loginRequired: hasAuth,
            author: 'sleuth-agent',
          });
          output.results = collected.results;
          output.provenance = collected.provenance;
        } else {
          const extracted = await extractSearchResults(cdpPort, searchUrl, searchSchema.result_selector, {
            maxResults,
            filterValues: filters,
            loginRequired: hasAuth,
            author: 'sleuth-agent',
          });
          output.results = extracted.results;
          output.provenance = extracted.provenance;
          if (extracted.error) output.error = extracted.error;
        }
      } else if (!cdpPort) {
        output.error = '无可用 CDP 端口，无法执行站内搜索';
      }
    }

    console.log(JSON.stringify(output, null, 2));
  } else {
    // 人类可读模式
    console.log(`域名: ${domain}`);
    console.log(`查询: ${query}`);
    console.log(`搜索模式: ${routing.mode}`);
    console.log(`  原因: ${routing.reason}`);

    if (searchSchema) {
      console.log(`\n站点搜索配置:`);
      if (searchSchema.url_template) console.log(`  URL 模板: ${searchSchema.url_template}`);
      if (searchSchema.result_selector) console.log(`  结果选择器: ${searchSchema.result_selector}`);
      if (searchSchema.pagination) console.log(`  分页模式: ${searchSchema.pagination}`);
      if (searchSchema.filters) console.log(`  可用筛选: ${JSON.stringify(searchSchema.filters)}`);
    } else {
      console.log(`\n未找到 ${domain} 的站点搜索配置`);
    }

    const searchUrl = buildSearchUrl(searchSchema, query, filters);
    if (searchUrl) {
      console.log(`\n搜索 URL: ${searchUrl}`);
    }

    // 查询扩展建议
    const expansions = expandQuery(query, {});
    if (expansions.length > 1) {
      console.log(`\n查询扩展建议:`);
      for (const exp of expansions) {
        console.log(`  - ${exp.query} (${exp.reason})`);
      }
    }

    // 尝试执行搜索
    if (routing.mode !== 'public' && searchSchema?.result_selector) {
      const cdpResult2 = cdpPortOverride ? { port: parseInt(cdpPortOverride) } : await detectManagedCDPPort();
      const cdpPort = cdpResult2?.port || null;
      if (cdpPort) {
        console.log(`\n执行站内搜索（CDP 端口 ${cdpPort}）...`);
        const extracted = await extractSearchResults(cdpPort, searchUrl, searchSchema.result_selector, { maxResults });
        if (extracted.error) {
          console.log(`  ⚠ ${extracted.error}`);
        } else {
          console.log(`  提取到 ${extracted.results.length} 条结果`);
          for (const r of extracted.results.slice(0, 5)) {
            console.log(`    [${r.rank}] ${r.title}`);
            if (r.url) console.log(`        ${r.url}`);
          }
          if (extracted.results.length > 5) {
            console.log(`    ... 还有 ${extracted.results.length - 5} 条`);
          }
        }
      } else {
        console.log(`\n⚠ 无可用 CDP 端口，跳过站内搜索`);
      }
    }
  }
}

main().catch(err => {
  console.error('route-task 错误:', err.message);
  process.exit(1);
});
