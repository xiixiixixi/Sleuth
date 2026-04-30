#!/usr/bin/env python3
"""
UserPromptSubmit hook：检测用户输入中的搜索意图，路由到 sleuth skill。

触发时机：用户每次在 Claude Code 输入框提交消息后、Agent 处理前。
工作原理：
  1. 检查 ~/.sleuth/config.json 中的 routeSearchIntent 开关
  2. 如果开关关闭 → 静默放行（不注入任何消息）
  3. 如果开关开启 → 扫描用户输入是否包含搜索关键词
  4. 检测到搜索意图 → 注入 system message 提示 Agent 用 /sleuth 而非原生 Web 工具
  5. 未检测到 → 静默放行

关键词覆盖中英文常见搜索表达：搜索、搜一下、查一下、search、google 等。

输入：Claude Code 通过 stdin 或环境变量 INPUT_JSON 传入 JSON payload，格式如：
  {"user_prompt": "帮我搜索一下最新的 AI 新闻"}

输出：JSON 格式的 hook 响应，可选择性地注入 systemMessage。
"""

import json
import os
import re
import sys


def load_config():
    """读取 sleuth 配置文件。文件不存在或损坏时返回安全默认值。"""
    try:
        with open(os.path.expanduser("~/.sleuth/config.json"), "r") as f:
            return json.load(f)
    except Exception:
        # 默认值：开启拦截和搜索路由
        return {"blockWebTools": True, "routeSearchIntent": True}


# 加载配置
config = load_config()

# ── 第一步：检查搜索路由开关 ──────────────────────────────────────
# 如果用户通过 /sleuth:config route-search off 关闭了搜索路由，静默放行
if not config.get("routeSearchIntent", True):
    json.dump({"continue": True, "suppressOutput": True}, sys.stdout)
    sys.exit(0)

# ── 第二步：解析 Claude Code 传入的 payload ──────────────────────
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

# ── 第三步：搜索意图关键词匹配 ────────────────────────────────────
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
    # ── 英文搜索意图 ──
    r"look\s+up",          # "look up this topic"
    r"\bsearch\b",         # "search for AI news"
    r"\bgoogle\b",         # "google it"
    r"\bfind\s+latest\b",  # "find latest updates"
    r"\blatest\s+(?:news|updates|info|information)\b",  # "latest news about..."
]

# ── 第四步：判断是否匹配 ──────────────────────────────────────────
# 逐个正则匹配，任一命中即判定为搜索意图
system_message = None
if any(re.search(p, text, re.IGNORECASE) for p in SEARCH_PATTERNS):
    # 注入系统消息，告诉 Agent：
    #   1. 检测到搜索意图
    #   2. 不要使用原生 Web 工具（WebSearch/WebFetch/Fetch）和 MCP web 工具
    #   3. 改用 /sleuth skill（会通过浏览器完成搜索）
    system_message = (
        "Web search intent detected. "
        "Do not use WebSearch, WebFetch, Fetch, or MCP web tools. "
        "Use `/sleuth` skill."
    )

# ── 第五步：输出 hook 响应 ────────────────────────────────────────
# 默认响应：放行 + 不显示输出
response = {"continue": True, "suppressOutput": True}
if system_message:
    # 检测到搜索意图时附加 systemMessage
    # systemMessage 会作为系统级消息注入给 Agent，影响其后续行为
    response["systemMessage"] = system_message

json.dump(response, sys.stdout, ensure_ascii=False)
