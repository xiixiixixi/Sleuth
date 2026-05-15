#!/usr/bin/env python3
"""
UserPromptSubmit hook：检测用户输入中的搜索/研究/网页验证意图，路由到 sleuth skill。

触发时机：用户每次在 Claude Code 输入框提交消息后、Agent 处理前。
工作原理：
  1. 扫描用户输入是否包含搜索/研究/网页验证关键词
  2. 检测到搜索意图 → 注入 system message，要求 Agent 加载 sleuth skill 做研究判断与证据边界选择
  3. 未检测到 → 静默放行

关键词覆盖中英文常见搜索、研究、网页访问、验证、最新信息、动态页面与登录态表达。

输入：Claude Code 通过 stdin 或环境变量 INPUT_JSON 传入 JSON payload，格式如：
  {"user_prompt": "帮我搜索一下最新的 AI 新闻"}

输出：JSON 格式的 hook 响应，可选择性地注入 systemMessage。
"""

import json
import os
import re
import sys

# ── 第一步：解析 Claude Code 传入的 payload ──────────────────────
# payload 包含用户刚输入的文本
try:
    payload = json.loads(os.environ.get("INPUT_JSON", "") or sys.stdin.read())
except Exception:
    # 解析失败 → 无法判断意图，安全起见放行
    json.dump({"continue": True, "suppressOutput": True}, sys.stdout)
    sys.exit(0)

# 提取用户输入文本（兼容不同的字段名）
prompt = payload.get("user_prompt") or payload.get("prompt") or ""
if not isinstance(prompt, str):
    prompt = ""
text = prompt.strip()

# ── 第二步：搜索意图关键词匹配 ────────────────────────────────────
# 中英文常见的搜索意图表达
# 每个元素是一个正则表达式，匹配到任意一个即判定为搜索意图
SEARCH_PATTERNS = [
    # ── 中文搜索意图 ──
    r"搜索",       # "帮我搜索一下"
    r"搜一下",     # "搜一下这个词"
    r"查一下",     # "帮我查一下汇率"
    r"查一查",     # "查一查这个公司"
    r"帮我查",     # "帮我查个东西"
    r"联网搜索",   # "请联网搜索"
    r"联网查",     # "联网查一下"
    r"网上查",     # "网上查一下"
    r"调研",       # "调研这个产品"
    r"研究一下",   # "研究一下竞品"
    r"查资料",     # "帮我查资料"
    r"找资料",     # "找资料"
    r"最新",       # "最新定价"
    r"官网",       # "看官网"
    r"网页",       # "打开网页"
    r"网站",       # "看这个网站"
    r"浏览器",     # "用浏览器看看"
    r"登录态",     # "需要登录态"
    r"验证.*(?:页面|网页|官网|来源|资料|事实)",
    # ── 英文搜索意图 ──
    r"look\s+up",          # "look up this topic"
    r"\bsearch\b",         # "search for AI news"
    r"\bgoogle\b",         # "google it"
    r"\bfind\s+latest\b",  # "find latest updates"
    r"\blatest\s+(?:news|updates|info|information)\b",  # "latest news about..."
    r"\bresearch\b",
    r"\binvestigate\b",
    r"\bverify\b.*\b(?:source|website|page|claim|fact)\b",
    r"\bopen\b.*\b(?:website|webpage|page|url)\b",
    r"\bbrowse\b",
    r"\bwebsite\b",
    r"\bwebpage\b",
    r"\bofficial\s+(?:site|website|docs|documentation)\b",
    r"\bpricing\b",
    r"\blogin\b",
]

# ── 第三步：判断是否匹配 ──────────────────────────────────────────
# 逐个正则匹配，任一命中即判定为搜索意图
system_message = None
if any(re.search(p, text, re.IGNORECASE) for p in SEARCH_PATTERNS):
    # 注入系统消息，告诉 Agent：
    #   1. 检测到搜索/研究/网页验证意图
    #   2. 必须加载 sleuth skill，而不是跳过研究判断层
    #   3. Sleuth 不拦截工具；它决定工具证据边界和交付方式
    system_message = (
        "[SLEUTH ROUTE: MANDATORY] The user request contains web search, research, webpage access, "
        "latest-information, source-verification, dynamic-page, or logged-in-browser intent. "
        "Before answering or using web tools, load the sleuth skill now with the Skill tool (name='sleuth') "
        "and follow it as the research judgment layer. Do not bypass sleuth merely because another search, "
        "fetch, browser, or MCP tool is available. Sleuth does not block tools; it decides which tools can "
        "prove which claims, when browser verification is required, how to reuse prior session artifacts, "
        "and where the final user-facing report should be delivered."
    )

# ── 第四步：输出 hook 响应 ────────────────────────────────────────
# 默认响应：放行 + 不显示输出
response = {"continue": True, "suppressOutput": True}
if system_message:
    # 检测到搜索意图时附加 systemMessage
    # systemMessage 会作为系统级消息注入给 Agent，影响其后续行为
    response["systemMessage"] = system_message

json.dump(response, sys.stdout, ensure_ascii=False)
