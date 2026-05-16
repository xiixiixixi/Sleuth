/**
 * site-search.mjs — 站点搜索智能模块
 *
 * 职责：
 * 1. 解析 site-pattern 中的 search schema（url_template, result_selector, pagination, filters）
 * 2. 通过 CDP 执行站内搜索并提取结果
 * 3. 有界无限滚动采集（bounded infinite-scroll collection）
 * 4. 搜索结果来源捕获（provenance capture）
 * 5. 判断何时使用站内搜索 vs 公共搜索
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ─── 常量 ───────────────────────────────────────────────────────────────────

export const SITE_PATTERNS_DIR = join(homedir(), '.sleuth', 'site-patterns');

/**
 * 无限滚动默认限制
 * - MAX_SCROLL_ROUNDS: 最多滚动轮次
 * - MAX_RESULTS: 最多提取条目数
 * - SCROLL_PAUSE_MS: 每次滚动后等待时间
 * - DEDUP_THRESHOLD: 连续重复批次数达到此值时停止
 */
export const SCROLL_LIMITS = {
  MAX_SCROLL_ROUNDS: 10,
  MAX_RESULTS: 100,
  SCROLL_PAUSE_MS: 1500,
  DEDUP_THRESHOLD: 2,
};

// ─── Schema 解析 ─────────────────────────────────────────────────────────────

/**
 * 从 site-pattern 文件解析 search schema
 * @param {string} domain - 目标域名
 * @returns {{ url_template?: string, result_selector?: string, pagination?: string, filters?: object } | null}
 */
export function parseSiteSearch(domain) {
  if (!existsSync(SITE_PATTERNS_DIR)) return null;

  // 查找匹配的 site-pattern 文件
  const files = readdirSync(SITE_PATTERNS_DIR).filter(f => f.endsWith('.md'));
  const target = files.find(f => {
    const base = f.replace(/\.md$/, '');
    return base === domain || domain.endsWith(`.${base}`);
  });

  if (!target) return null;

  const content = readFileSync(join(SITE_PATTERNS_DIR, target), 'utf-8');
  const frontmatter = extractFrontmatter(content);
  if (!frontmatter || !frontmatter.search) return null;

  return frontmatter.search;
}

/**
 * 从 markdown 文件提取 YAML frontmatter
 * @param {string} content
 * @returns {object|null}
 */
function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  // 简易 YAML 解析（支持 search schema 的嵌套结构）
  return parseSimpleYaml(match[1]);
}

/**
 * 简易 YAML 解析器（仅支持 site-pattern 所需的结构）
 * 支持：字符串、数组、嵌套对象
 */
function parseSimpleYaml(yaml) {
  const result = {};
  const lines = yaml.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const topMatch = line.match(/^(\w+):\s*(.*)/);

    if (!topMatch) { i++; continue; }

    const key = topMatch[1];
    const inlineValue = topMatch[2].trim();

    if (inlineValue && !inlineValue.startsWith('[')) {
      // 简单字符串值（去引号）
      result[key] = inlineValue.replace(/^["']|["']$/g, '');
      i++;
    } else if (inlineValue.startsWith('[')) {
      // 内联数组 [a, b, c]
      const items = inlineValue.replace(/^\[|\]$/g, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
      result[key] = items;
      i++;
    } else {
      // 嵌套对象或数组
      const nested = {};
      i++;
      while (i < lines.length) {
        const sub = lines[i];
        if (!sub.match(/^\s/)) break; // 回到顶层
        const subMatch = sub.match(/^\s+(\w+):\s*(.*)/);
        if (subMatch) {
          const subKey = subMatch[1];
          const subVal = subMatch[2].trim();
          if (subVal.startsWith('[')) {
            nested[subKey] = subVal.replace(/^\[|\]$/g, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
          } else if (subVal.startsWith('"') || subVal.startsWith("'")) {
            nested[subKey] = subVal.replace(/^["']|["']$/g, '');
          } else if (subVal) {
            nested[subKey] = subVal;
          } else {
            // 可能是更深层嵌套（如 verify.type / verify.selector）
            const deeper = {};
            i++;
            while (i < lines.length) {
              const deep = lines[i];
              if (!deep.match(/^\s{4,}/)) break;
              const deepMatch = deep.match(/^\s+(\w+):\s*(.*)/);
              if (deepMatch) {
                deeper[deepMatch[1]] = deepMatch[2].trim().replace(/^["']|["']$/g, '');
              }
              i++;
            }
            nested[subKey] = Object.keys(deeper).length ? deeper : subVal;
            continue;
          }
        } else if (sub.match(/^\s+-\s/)) {
          // YAML 列表项
          if (!Array.isArray(nested._list)) nested._list = [];
          nested._list.push(sub.replace(/^\s+-\s*/, '').trim());
        }
        i++;
      }
      result[key] = nested._list || nested;
    }
  }
  return result;
}

// ─── 搜索 URL 构建 ──────────────────────────────────────────────────────────

/**
 * 根据 search schema 构建搜索 URL
 * @param {object} searchSchema - parseSiteSearch 返回的 schema
 * @param {string} query - 搜索词
 * @param {object} [filterValues] - 可选筛选条件
 * @returns {string|null}
 */
export function buildSearchUrl(searchSchema, query, filterValues = {}) {
  if (!searchSchema?.url_template) return null;

  let url = searchSchema.url_template.replace('{query}', encodeURIComponent(query));

  // 替换 filter 占位符
  if (searchSchema.filters && filterValues) {
    for (const [key, value] of Object.entries(filterValues)) {
      url = url.replace(`{${key}}`, encodeURIComponent(value));
    }
  }

  return url;
}

// ─── CDP 搜索结果提取 ────────────────────────────────────────────────────────

/**
 * 通过 CDP 在页面上提取搜索结果
 * @param {number} cdpPort - CDP 端口
 * @param {string} pageUrl - 当前页面 URL（用于定位 tab）
 * @param {string} resultSelector - 结果卡片 CSS 选择器
 * @param {object} [options]
 * @returns {Promise<Array<{title: string, url: string, snippet: string, rank: number}>>}
 */
export async function extractSearchResults(cdpPort, pageUrl, resultSelector, options = {}) {
  const { maxResults = SCROLL_LIMITS.MAX_RESULTS } = options;

  // 查找目标页面
  const targetWsUrl = await findPageByUrl(cdpPort, pageUrl);
  if (!targetWsUrl) {
    return { results: [], error: '未找到目标页面', provenance: null };
  }

  // 在页面上执行提取脚本
  const extractScript = buildExtractScript(resultSelector, maxResults);
  const results = await evalViaCDP(targetWsUrl, extractScript, { pageUrl });

  if (!results || results.error) {
    return { results: [], error: results?.error || '提取失败', provenance: null };
  }

  // 为每条结果附加 per-result 元数据（文档要求：filter_state, required_login）
  const enrichedResults = results.map((item, idx) => ({
    ...item,
    rank: item.rank || idx + 1,
    filter_state: options.filterValues || null,
    required_login: options.requiredLogin || false,
  }));

  // 构建来源信息（provenance）— 包含完整元数据
  const provenance = {
    source_url: pageUrl,
    extraction_time: new Date().toISOString(),
    selector_used: resultSelector,
    total_extracted: results.length,
    method: 'dom_extraction',
    // Phase 3 元数据：作者、日期、过滤状态、登录要求
    author: options.author || 'sleuth-agent',
    filter_state: options.filterValues || null,
    required_login: options.requiredLogin || false,
  };

  return { results: enrichedResults, error: null, provenance };
}

/**
 * 有界无限滚动采集
 * @param {number} cdpPort
 * @param {string} pageUrl
 * @param {string} resultSelector
 * @param {object} [limits] - 覆盖默认滚动限制
 * @returns {Promise<{results: Array, provenance: object, scroll_rounds: number}>}
 */
export async function collectWithScroll(cdpPort, pageUrl, resultSelector, limits = {}) {
  const config = { ...SCROLL_LIMITS, ...limits };
  const targetWsUrl = await findPageByUrl(cdpPort, pageUrl);

  if (!targetWsUrl) {
    return { results: [], error: '未找到目标页面', provenance: null, scroll_rounds: 0 };
  }

  let allResults = [];
  let scrollRound = 0;
  let consecutiveDupes = 0;
  const seenUrls = new Set();

  while (scrollRound < config.MAX_SCROLL_ROUNDS && allResults.length < config.MAX_RESULTS) {
    // 提取当前可见结果
    const extractScript = buildExtractScript(resultSelector, config.MAX_RESULTS);
    const batch = await evalViaCDP(targetWsUrl, extractScript, { pageUrl });

    if (!batch || batch.error) break;

    // 去重
    let newCount = 0;
    for (const item of batch) {
      const key = item.url || item.title;
      if (!seenUrls.has(key)) {
        seenUrls.add(key);
        allResults.push({
          ...item,
          rank: allResults.length + 1,
          filter_state: limits.filterValues || null,
          required_login: limits.requiredLogin || false,
        });
        newCount++;
      }
    }

    // 连续无新结果检测
    if (newCount === 0) {
      consecutiveDupes++;
      if (consecutiveDupes >= config.DEDUP_THRESHOLD) break;
    } else {
      consecutiveDupes = 0;
    }

    // 滚动到底部
    await evalViaCDP(targetWsUrl, 'window.scrollTo(0, document.body.scrollHeight)', { pageUrl });
    await sleep(config.SCROLL_PAUSE_MS);
    scrollRound++;
  }

  // 截断到 MAX_RESULTS
  allResults = allResults.slice(0, config.MAX_RESULTS);

  const provenance = {
    source_url: pageUrl,
    extraction_time: new Date().toISOString(),
    selector_used: resultSelector,
    total_extracted: allResults.length,
    scroll_rounds: scrollRound,
    method: 'infinite_scroll',
    stopped_reason: consecutiveDupes >= config.DEDUP_THRESHOLD ? 'duplicate_threshold' :
      allResults.length >= config.MAX_RESULTS ? 'max_results' :
      scrollRound >= config.MAX_SCROLL_ROUNDS ? 'max_rounds' : 'batch_error',
    // Phase 3 元数据
    author: limits.author || 'sleuth-agent',
    filter_state: limits.filterValues || null,
    required_login: limits.requiredLogin || false,
  };

  return { results: allResults, error: null, provenance, scroll_rounds: scrollRound };
}

// ─── 搜索模式路由 ────────────────────────────────────────────────────────────

/**
 * 判断应使用站内搜索还是公共搜索
 *
 * 规则（来自设计文档 "Site Search Logic"）：
 * - 站内搜索：内容在平台/应用/社交/论坛/文档内、结果受登录状态影响、有平台特有筛选
 * - 公共搜索：跨网发现、权威来源未知、站点无可用搜索、需要外部佐证、公共静态文档
 *
 * @param {object} params
 * @param {string} params.domain - 目标域名
 * @param {string} params.query - 搜索意图描述
 * @param {boolean} params.hasAuth - 是否已验证登录
 * @param {object|null} params.searchSchema - site-pattern 中的 search 配置
 * @returns {{ mode: 'site'|'public'|'both', reason: string }}
 */
export function routeSearchMode({ domain, query, hasAuth, searchSchema }) {
  // 没有可执行的站点搜索入口时，不假设平台搜索可用。
  if (!searchSchema?.url_template) {
    return { mode: 'public', reason: '站点无可用搜索配置，使用公共搜索' };
  }

  // 有 search schema 且已登录 → 优先站内
  if (hasAuth) {
    return { mode: 'site', reason: '站点有搜索配置且已验证登录，优先使用站内搜索' };
  }

  // 有 search schema 但未登录 → 两者兼试
  if (!hasAuth) {
    return { mode: 'both', reason: '站点有搜索配置但未验证登录，建议同时尝试站内和公共搜索' };
  }
}

// ─── 查询扩展 ────────────────────────────────────────────────────────────────

/**
 * 基础查询扩展（生成搜索变体）
 *
 * 设计文档要求：
 * - 官方名称 + 别名
 * - 原生语言变体
 * - 缩写
 * - 产品名/用户名/型号/活动名
 * - 话题标签
 * - 时间限定词
 * - 排除词
 *
 * @param {string} baseQuery - 基础查询
 * @param {object} [context] - 上下文信息
 * @returns {Array<{query: string, reason: string}>}
 */
export function expandQuery(baseQuery, context = {}) {
  const expansions = [{ query: baseQuery, reason: '原始查询' }];

  // 如果提供了别名，生成别名变体
  if (context.aliases?.length) {
    for (const alias of context.aliases) {
      expansions.push({ query: baseQuery.replace(context.primaryName || '', alias), reason: `别名变体: ${alias}` });
    }
  }

  // 时间限定
  if (context.timebound) {
    expansions.push({ query: `${baseQuery} ${context.timebound}`, reason: `时间限定: ${context.timebound}` });
  }

  // 排除词
  if (context.exclude?.length) {
    const negTerms = context.exclude.map(t => `-${t}`).join(' ');
    expansions.push({ query: `${baseQuery} ${negTerms}`, reason: '排除干扰词' });
  }

  return expansions;
}

// ─── CDP 工具函数 ────────────────────────────────────────────────────────────

/**
 * 域名限制检查：real-browser 模式下仅允许访问 domains_allowed 中的域名。
 * 安全策略：
 * - SLEUTH_READ_ONLY 未设置 → 不做限制（非 real-browser 场景）
 * - real-browser 模式下 domains_allowed 未配置或为空 → 默认拒绝（deny-all）
 * - 有配置 → 仅允许列表中的域名
 */
export function checkDomainAllowed(url) {
  // 域名限制在 real-browser 模式下始终生效（不仅依赖 SLEUTH_READ_ONLY）
  if (process.env.SLEUTH_READ_ONLY !== 'true' && process.env.SLEUTH_BROWSER_MODE !== 'real-browser') {
    return { allowed: true };
  }
  try {
    const statePath = join(homedir(), '.sleuth', 'cdp-state.json');
    if (!existsSync(statePath)) {
      return { allowed: false, error: '域名限制：cdp-state.json 不存在，real-browser 模式默认拒绝' };
    }
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    // real-browser 模式下 domains_allowed 为空 → deny-all（需要显式配置域名）
    if (!state.domains_allowed || state.domains_allowed.length === 0) {
      return { allowed: false, error: '域名限制：domains_allowed 未配置，real-browser 模式默认拒绝所有域名' };
    }
    // '*' 表示允许所有域名（未指定 --domain 时的显式标记）
    if (state.domains_allowed.includes('*')) return { allowed: true };
    const hostname = new URL(url).hostname;
    const allowed = state.domains_allowed.some(d => hostname === d || hostname.endsWith('.' + d));
    if (!allowed) return { allowed: false, error: `域名限制：${hostname} 不在 domains_allowed 列表中` };
    return { allowed: true };
  } catch {
    // 解析失败 → 安全侧：拒绝
    return { allowed: false, error: '域名限制：状态读取失败，real-browser 模式默认拒绝' };
  }
}

/**
 * 通过 CDP /json/list 查找匹配 URL 的页面
 */
export async function findPageByUrl(cdpPort, targetUrl, { navigate = true } = {}) {
  // 域名限制检查
  const domainCheck = checkDomainAllowed(targetUrl);
  if (!domainCheck.allowed) return null;

  try {
    const resp = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    const pages = await resp.json();
    const domain = new URL(targetUrl).hostname;

    // 精确匹配优先，否则域名匹配
    const exact = pages.find(p => p.url === targetUrl);
    if (exact?.webSocketDebuggerUrl) return exact.webSocketDebuggerUrl;

    const domainMatch = pages.find(p => {
      try { return new URL(p.url).hostname === domain; } catch { return false; }
    });
    if (domainMatch?.webSocketDebuggerUrl) return domainMatch.webSocketDebuggerUrl;

    // 未找到匹配页面时，通过 CDP 打开新标签页并导航
    if (navigate) {
      const wsUrl = await navigateNewTab(cdpPort, targetUrl);
      return wsUrl;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 通过 CDP 协议打开新标签页并导航到目标 URL
 * @param {number} cdpPort
 * @param {string} url
 * @returns {Promise<string|null>} WebSocket URL
 */
async function navigateNewTab(cdpPort, url) {
  try {
    // 使用 CDP /json/new 创建新标签页
    const resp = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`);
    if (!resp.ok) return null;
    const tab = await resp.json();
    if (!tab?.webSocketDebuggerUrl) return null;

    // 等待页面加载（简单 poll 策略）
    await new Promise(r => setTimeout(r, 2000));
    return tab.webSocketDebuggerUrl;
  } catch {
    return null;
  }
}

/**
 * 只读守卫：检测表达式是否包含写操作
 * 导出以便测试覆盖
 *
 * 黑名单策略的已知局限：字符串拼接、间接引用、eval 包装可绕过
 * 这是 best-effort 防护层，配合 read-only 约定 + 用户审查双重保障
 */
export const WRITE_PATTERNS = new RegExp([
  // DOM 变更方法
  /\.(click|submit|reset|requestSubmit)\(\)/.source,
  /\.(appendChild|insertBefore|replaceChild|removeChild|append|prepend|after|before|replaceWith)\(/.source,
  /\.(insertAdjacentHTML|insertAdjacentElement)\(/.source,
  /\.remove\(\)/.source,
  // DOM 属性赋值
  /\.(value|innerHTML|outerHTML|innerText|textContent)\s*=/.source,
  // document 写入
  /document\.(write|writeln)\(/.source,
  // 事件触发
  /\.dispatchEvent\(/.source,
  // 网络写请求
  /fetch\(.*(POST|PUT|DELETE|PATCH)/.source,
  /XMLHttpRequest/.source,
  /navigator\.sendBeacon\(/.source,
  // 存储修改
  /localStorage\.(setItem|removeItem|clear)\(/.source,
  /sessionStorage\.(setItem|removeItem|clear)\(/.source,
  /document\.cookie\s*=/.source,
].join('|'), 'i');

export function isWriteOperation(expression) {
  // ⚠️ 安全边界说明：此函数基于正则黑名单检测，属于"尽力而为"防护层。
  // 已知局限性：字符串拼接、间接引用、eval 包装等方式可绕过检测。
  // 真正的安全保障依赖于：(1) 域名限制（--domain）(2) CDP 连接本身的只读意图
  // 此检测仅作为额外防线，不能视为完整的安全闭环。
  return WRITE_PATTERNS.test(expression);
}

/**
 * 通过 WebSocket 在页面上执行 JS 表达式
 *
 * 安全约束（纵深防御）：
 * - 域名限制：如提供 pageUrl，在 real-browser 模式下强制校验 checkDomainAllowed
 * - 只读模式下阻止写操作（WRITE_PATTERNS 检测，best-effort 黑名单）
 * - 无 WebSocket 能力时 fail-closed
 *
 * @param {string} wsUrl - WebSocket debugger URL
 * @param {string} expression - 要执行的 JS 表达式
 * @param {object} [options]
 * @param {string} [options.pageUrl] - 页面 URL，用于域名限制二次校验（纵深防御）
 */
export async function evalViaCDP(wsUrl, expression, options = {}) {
  // 纵深防御：在受限模式下强制要求 pageUrl；未提供时默认拒绝（防止调用者省略绕过）
  if (process.env.SLEUTH_READ_ONLY === 'true' || process.env.SLEUTH_BROWSER_MODE === 'real-browser') {
    if (!options.pageUrl) {
      return { error: '域名限制（evalViaCDP 纵深防御）：受限模式下必须提供 options.pageUrl' };
    }
    const domainCheck = checkDomainAllowed(options.pageUrl);
    if (!domainCheck.allowed) {
      return { error: `域名限制（evalViaCDP 纵深防御）：${domainCheck.error}` };
    }
  }

  // 只读模式下阻止写操作（real-browser 安全约束）
  if (process.env.SLEUTH_READ_ONLY === 'true') {
    if (isWriteOperation(expression)) {
      return { error: '只读模式：禁止执行写操作（real-browser 安全约束）' };
    }
  }

  // 使用 Node 22+ 原生 WebSocket
  if (typeof WebSocket === 'undefined') {
    // fail-closed：无 WebSocket 能力时不回退到无目标绑定的 agent-browser eval
    return { error: 'WebSocket 不可用，无法执行 CDP eval（需要 Node 22+）' };
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = 1;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          ws.close();
          if (msg.result?.result?.value !== undefined) {
            resolve(msg.result.result.value);
          } else if (msg.result?.exceptionDetails) {
            resolve({ error: msg.result.exceptionDetails.text || '执行异常' });
          } else {
            resolve(null);
          }
        }
      } catch (e) {
        ws.close();
        resolve({ error: e.message });
      }
    };

    ws.onerror = () => { ws.close(); resolve({ error: 'WebSocket 连接失败' }); };
    setTimeout(() => { ws.close(); resolve({ error: '超时' }); }, 10000);
  });
}


/**
 * 构建提取搜索结果的 DOM 脚本
 */
function buildExtractScript(selector, maxResults) {
  return `
    (() => {
      const pickText = (root, selectors) => {
        for (const selector of selectors) {
          const node = root.querySelector(selector);
          const text = node?.textContent?.trim();
          if (text) return text.slice(0, 120);
        }
        return '';
      };

      const pickDate = (root) => {
        const timeNode = root.querySelector('time, [datetime], [data-time], [data-date], .date, .time, .timestamp');
        const dateText = timeNode?.getAttribute?.('datetime')
          || timeNode?.getAttribute?.('data-time')
          || timeNode?.getAttribute?.('data-date')
          || timeNode?.textContent?.trim();
        return dateText ? dateText.slice(0, 80) : '';
      };

      const cards = document.querySelectorAll(${JSON.stringify(selector)});
      const results = [];
      for (let i = 0; i < Math.min(cards.length, ${maxResults}); i++) {
        const card = cards[i];
        const link = card.querySelector('a[href]') || card.closest('a[href]');
        const author = pickText(card, [
          '.author',
          '.source',
          '.byline',
          '[rel="author"]',
          '[itemprop="author"]',
          '[data-author]',
          '[data-source]'
        ]);
        const date = pickDate(card);
        results.push({
          title: (card.querySelector('h1,h2,h3,h4,a') || card).textContent?.trim()?.slice(0, 200) || '',
          url: link?.href || '',
          snippet: card.textContent?.trim()?.slice(0, 300) || '',
          rank: i + 1,
          ...(author ? { author } : {}),
          ...(date ? { date } : {}),
        });
      }
      return results;
    })()
  `;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
