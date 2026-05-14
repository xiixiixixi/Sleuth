#!/usr/bin/env python3
"""
PreToolUse hook：拦截封禁列表中的工具调用，以及 Bash 中的 curl/wget 网络命令。

触发时机：Claude Code 每次调用工具前（如 WebSearch、MCP 工具、Bash 等）会触发此 hook。
工作原理：
  1. 从 ~/.sleuth/config.json 读取用户配置的封禁工具列表
  2. 检查当前工具名是否在封禁列表中
  3. 如果工具是 Bash，额外检查命令中是否包含 curl/wget
  4. 如果命中 → 返回 deny 决策 + 强制 system message 引导使用 /sleuth
  5. 如果未命中 → 放行

输入：Claude Code 通过 stdin 或环境变量 INPUT_JSON 传入 JSON payload，格式如：
  {"tool_name": "WebSearch", "tool_input": {...}}

输出：JSON 格式的 hook 响应，控制工具是否继续执行。
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sleuth_config import load_config

# 加载配置（脚本每次被调用时执行一次）
config = load_config()

# ── 第一步：检查总开关 ──────────────────────────────────────────
if not config.get("blockWebTools", True):
    json.dump({"continue": True, "suppressOutput": True}, sys.stdout)
    sys.exit(0)

# ── 第二步：构建封禁工具集合 ──────────────────────────────────────
if "blockedTools" in config:
    blocked = set(config["blockedTools"] or [])
else:
    blocked = {"WebSearch", "WebFetch", "Fetch"}

# ── 第三步：解析 Claude Code 传入的 payload ──────────────────────
try:
    payload = json.loads(os.environ.get("INPUT_JSON", "") or sys.stdin.read())
except Exception:
    json.dump({"continue": True, "suppressOutput": True}, sys.stdout)
    sys.exit(0)

tool_name = str(payload.get("tool_name", "") or "")

# ── 第四步 A：检查封禁工具 ───────────────────────────────────────
if tool_name in blocked:
    reason = (
        f"[SLEUTH BLOCKED] {tool_name} is not allowed for web access. "
        "You MUST use the sleuth skill for all web search, browsing, and HTTP requests. "
        "Invoke it now: use the Skill tool with skill='sleuth', then follow its instructions to use agent-browser. "
        "Do NOT attempt curl, wget, WebSearch, WebFetch, or any other workaround. "
        "Run `/sleuth:config` to change this setting."
    )
    json.dump({
        "continue": True,
        "suppressOutput": True,
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
        },
        "systemMessage": reason,
    }, sys.stdout, ensure_ascii=False)
    sys.exit(0)

# ── 第四步 B：检查 Bash 中的 curl/wget 命令 ───────────────────────
if tool_name == "Bash":
    tool_input = payload.get("tool_input", {})
    command = str(tool_input.get("command", "") or "")
    if re.search(r'\bcurl\b|\bwget\b', command, re.IGNORECASE):
        reason = (
            "[SLEUTH BLOCKED] curl/wget via Bash is not allowed for web access. "
            "You MUST use the sleuth skill for all web search, browsing, and HTTP requests. "
            "Invoke it now: use the Skill tool with skill='sleuth', then follow its instructions to use agent-browser. "
            "Do NOT attempt any other web access method. "
            "Run `/sleuth:config` to change this setting."
        )
        json.dump({
            "continue": True,
            "suppressOutput": True,
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
            },
            "systemMessage": reason,
        }, sys.stdout, ensure_ascii=False)
        sys.exit(0)

# ── 第五步：放行 ─────────────────────────────────────────────────
json.dump({"continue": True, "suppressOutput": True}, sys.stdout)
