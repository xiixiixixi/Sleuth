#!/usr/bin/env python3
"""UserPromptSubmit hook: 搜索意图路由（可配置开关）"""
import json
import os
import re
import sys

def load_config():
    try:
        with open(os.path.expanduser("~/.sleuth/config.json"), "r") as f:
            return json.load(f)
    except Exception:
        return {"blockWebTools": True, "routeSearchIntent": True}

config = load_config()
if not config.get("routeSearchIntent", True):
    json.dump({"continue": True, "suppressOutput": True}, sys.stdout)
    sys.exit(0)

try:
    payload = json.loads(os.environ.get("INPUT_JSON", "") or sys.stdin.read())
except Exception:
    json.dump({"continue": True, "suppressOutput": True}, sys.stdout)
    sys.exit(0)
prompt = payload.get("user_prompt") or payload.get("prompt") or ""
if not isinstance(prompt, str):
    prompt = ""
text = prompt.strip()

SEARCH_PATTERNS = [
    r"搜索", r"搜一下", r"查一下", r"查一查", r"帮我查", r"联网搜索",
    r"look\s+up", r"\bsearch\b", r"\bgoogle\b",
    r"\bfind\s+latest\b", r"\blatest\s+(?:news|updates|info|information)\b",
]

system_message = None
if any(re.search(p, text, re.IGNORECASE) for p in SEARCH_PATTERNS):
    system_message = (
        "Web search intent detected. "
        "Do not use WebSearch, WebFetch, Fetch, or MCP web tools. "
        "Use `/sleuth` skill."
    )

response = {"continue": True, "suppressOutput": True}
if system_message:
    response["systemMessage"] = system_message

json.dump(response, sys.stdout, ensure_ascii=False)
