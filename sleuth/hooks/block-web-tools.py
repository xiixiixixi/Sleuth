#!/usr/bin/env python3
"""
PreToolUse hook：拦截封禁列表中的工具调用。

触发时机：Claude Code 每次调用工具前（如 WebSearch、MCP 工具等）会触发此 hook。
工作原理：
  1. 从 ~/.sleuth/config.json 读取用户配置的封禁工具列表
  2. 检查当前工具名是否在封禁列表中
  3. 如果命中 → 返回 deny 决策 + system message 提示 Agent 改用 /sleuth
  4. 如果未命中 → 放行

封禁列表来源（优先级从高到低）：
  - 用户通过 /sleuth:config setup 配置的自定义列表 → config.json 的 blockedTools 字段
  - 无自定义列表时 → 默认只封禁 Claude Code 内置 Web 工具（WebSearch/WebFetch/Fetch）
  - MCP 工具的发现和封禁由 /sleuth:config 向导完成，不在脚本中硬编码

输入：Claude Code 通过 stdin 或环境变量 INPUT_JSON 传入 JSON payload，格式如：
  {"tool_name": "WebSearch", "tool_input": {...}}

输出：JSON 格式的 hook 响应，控制工具是否继续执行。
"""

import json
import os
import sys

# sleuth 全局配置文件路径（存储用户选择的封禁列表等配置）
CONFIG_PATH = os.path.expanduser("~/.sleuth/config.json")


def load_config():
    """读取 sleuth 配置文件。文件不存在或损坏时返回安全默认值。"""
    try:
        with open(CONFIG_PATH, "r") as f:
            return json.load(f)
    except Exception:
        return {"blockWebTools": True, "routeSearchIntent": True, "blockedTools": None}


# 加载配置（脚本每次被调用时执行一次）
config = load_config()

# ── 第一步：检查总开关 ──────────────────────────────────────────
# 如果用户通过 /sleuth:config block-web off 关闭了拦截，直接放行所有工具
if not config.get("blockWebTools", True):
    # continue: true → 放行工具调用
    # suppressOutput: true → 不在 Claude Code 界面显示 hook 输出
    json.dump({"continue": True, "suppressOutput": True}, sys.stdout)
    sys.exit(0)

# ── 第二步：构建封禁工具集合 ──────────────────────────────────────
# 根据配置决定用哪个封禁列表
if "blockedTools" in config:
    # 用户通过向导配置过 → 使用自定义列表
    # 注意：空列表 [] 意味着"不封禁任何工具"（用户主动选择全部取消勾选）
    blocked = set(config["blockedTools"] or [])
else:
    # 从未运行过向导 → 仅封禁 Claude Code 内置 Web 工具
    # 这三个是 Claude Code 自带的联网工具，所有用户都有
    # MCP 工具（如 tavily、brave-search 等）需用户运行 /sleuth:config setup 发现并选择
    blocked = {"WebSearch", "WebFetch", "Fetch"}

# ── 第三步：解析 Claude Code 传入的 payload ──────────────────────
# Claude Code 通过两种方式传入数据：
#   1. 环境变量 INPUT_JSON（部分版本）
#   2. stdin（标准输入）
# 优先读环境变量，为空则回退读 stdin
try:
    payload = json.loads(os.environ.get("INPUT_JSON", "") or sys.stdin.read())
except Exception:
    # JSON 解析失败 → 无法判断工具名，安全起见放行
    json.dump({"continue": True, "suppressOutput": True}, sys.stdout)
    sys.exit(0)

# 提取工具名（如 "WebSearch"、"mcp__tavily__tavily_search"）
tool_name = str(payload.get("tool_name", "") or "")

# ── 第四步：判断是否封禁 ─────────────────────────────────────────
if tool_name not in blocked:
    # 不在封禁列表中 → 放行
    json.dump({"continue": True, "suppressOutput": True}, sys.stdout)
    sys.exit(0)

# ── 第五步：封禁该工具调用 ────────────────────────────────────────
# 构造拒绝原因（英文，因为 systemMessage 会注入给 Agent）
reason = (
    f"{tool_name} is blocked by sleuth. Use `/sleuth` skill for web tasks. "
    "Run `/sleuth:config` to change settings."
)

# 返回 hook 响应：
#   continue: true → 对话继续（不会中断整个对话）
#   suppressOutput: true → 不显示 hook 自身的输出
#   hookSpecificOutput.permissionDecision: "deny" → 拒绝这次工具调用
#   systemMessage → 注入系统消息，告诉 Agent 为什么被拦截以及替代方案
json.dump({
    "continue": True,
    "suppressOutput": True,
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
    },
    "systemMessage": reason,
}, sys.stdout, ensure_ascii=False)
