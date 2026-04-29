#!/usr/bin/env python3
"""PreToolUse hook: 拦截用户选择的工具（从 ~/.sleuth/config.json 读取封禁列表）"""
import json
import os
import sys

CONFIG_PATH = os.path.expanduser("~/.sleuth/config.json")

def load_config():
    try:
        with open(CONFIG_PATH, "r") as f:
            return json.load(f)
    except Exception:
        return {"blockWebTools": True, "routeSearchIntent": True, "blockedTools": None}

config = load_config()

# 如果 blockWebTools 关闭，直接放行
if not config.get("blockWebTools", True):
    json.dump({"continue": True, "suppressOutput": True}, sys.stdout)
    sys.exit(0)

# 构建 blocked tools 集合
if "blockedTools" in config:
    # 用户显式配置（空列表 = 不封禁任何工具）
    blocked = set(config["blockedTools"] or [])
else:
    # 无配置时使用默认封禁列表
    blocked = {
        "WebSearch", "WebFetch", "Fetch",
        "mcp__tavily__tavily_search",
        "mcp__tavily__tavily_extract",
        "mcp__tavily__tavily_crawl",
        "mcp__web_reader__webReader",
        "mcp__web_search_prime__webSearchPrime",
    }

try:
    payload = json.loads(os.environ.get("INPUT_JSON", "") or sys.stdin.read())
except Exception:
    json.dump({"continue": True, "suppressOutput": True}, sys.stdout)
    sys.exit(0)
tool_name = str(payload.get("tool_name", "") or "")

if tool_name not in blocked:
    json.dump({"continue": True, "suppressOutput": True}, sys.stdout)
    sys.exit(0)

reason = (
    f"{tool_name} is blocked by sleuth. Use `/sleuth` skill for web tasks. "
    "Run `/sleuth:config` to change settings."
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
