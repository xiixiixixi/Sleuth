---
name: sleuth:config
description: 设置 sleuth 插件运行环境。用于 setup、permissions、uninstall：发现可用工具、配置 Claude Code 权限、清理安装数据。不管理搜索路由开关，不创建运行时配置文件。
argument-hint: [setup|permissions|uninstall]
allowed-tools: [Read, Write, Bash, AskUserQuestion]
---

# Sleuth 设置向导

用户输入: `$ARGUMENTS`

这个 skill 只处理安装环境：工具发现、权限写入和卸载清理。搜索/研究意图由 hook 默认注入，不再提供开关，也不再写运行时配置文件。

## 参数路由

| 参数 | 操作 |
|------|------|
| `setup` 或无参数 | 完整设置向导（发现工具 → 配置权限） |
| `permissions` | 重新配置 `settings.local.json` 权限 |
| `uninstall` | 卸载：逆向清理权限和可选数据 |

如果用户询问搜索路由开关，说明该开关已废弃：Sleuth 默认路由搜索/研究意图，不再维护运行时配置文件。

---

## 插件根目录检测

config 是子 skill（位于 `skills/config/`），其 `${CLAUDE_SKILL_DIR}` 解析到 `skills/config/` 而非插件根目录。脚本位于插件根目录的 `scripts/` 下，因此先检测插件根目录绝对路径。

检测方法（从 `installed_plugins.json` 读取唯一确定路径）：

1. 用 `Bash` 运行：
   ```bash
   cat ~/.claude/plugins/installed_plugins.json | python3 -c "import sys,json; d=json.load(sys.stdin); plugins=d.get('plugins',{}); [print(v[0]['installPath']) for k,v in plugins.items() if 'sleuth' in k and isinstance(v,list)]"
   ```
2. 将返回路径保存到变量 `PLUGIN_ROOT`，后续所有涉及脚本路径的操作都使用此变量。

写入 `settings.local.json` 的 allow 规则必须是**绝对路径字面量**，版本号目录用 `*` 通配符（例如 `Bash(node /Users/xxx/.claude/plugins/cache/sleuth/sleuth/*/scripts/*.mjs *)`），这样插件更新后权限不会失效。

## Profile 路径检测

setup 和 uninstall 需要读写 `settings.local.json`。每个 Claude Code profile 有自己的 `settings.local.json`。

检测流程：

1. 用 `Bash` 计算默认 profile 路径：
   ```bash
   echo $HOME/.claude
   ```
2. 用 `AskUserQuestion` 让用户确认：
   - 默认路径（标注“默认”）
   - `其他`（用户手动输入路径）
3. 将确认结果保存到变量 `PROFILE_DIR`。

---

## 操作一：setup

### 阶段 1 — 发现可用工具

1. 搜索 MCP 配置文件（以下位置逐一检查，存在就读取）：
   - 项目：`.mcp.json`
   - 全局：`{PROFILE_DIR}/settings.json`
2. 从配置中提取所有 MCP 服务器名称（`mcpServers` 对象的 key）。
3. 对每个 MCP 服务器，列出该服务器下的所有 tool；如果无法枚举具体 tool 名，则至少保留服务器名分组。
4. 添加内置工具：`WebSearch`、`WebFetch`、`Fetch`。
5. 把工具做成能力分组，而不是敌我分组：
   - **discovery scouts**：search / browse / discover / tavily / exa / serp 等
   - **readers / extractors**：fetch / reader / crawl / scrape / firecrawl / jina 等
   - **browser / action tools**：agent-browser、playwright 类
   - **其他工具**：代码、数据库、图像等

发现结果只用于告诉用户当前环境能提供哪些入口；Sleuth 不根据这里的结果写工具策略，也不改变工具权限。

### 阶段 2 — 配置权限

1. 读取 `{PROFILE_DIR}/settings.local.json`（如不存在则创建空结构）。
2. 按“插件根目录检测”获取 `PLUGIN_ROOT`。
3. 计算需要添加的 allow 规则，版本目录用 `*` 通配：
   ```text
   Bash(agent-browser *)
   Bash(node {PLUGIN_ROOT}/scripts/*.mjs *)
   ```
4. 已存在则跳过。
5. 用 `AskUserQuestion` 展示即将写入的规则，请求用户确认。
6. 用户确认后，用 `Write` 写回更新后的 `settings.local.json`。
7. 提示：权限变更需要重启 Claude Code 生效。

---

## 操作二：permissions

重跑“阶段 2 — 配置权限”。

---

## 操作三：uninstall

逆向清理 sleuth 添加的权限和可选数据。

### 步骤 1 — 清理 settings 文件

1. 按“Profile 路径检测”让用户确认 profile 目录，得到 `PROFILE_DIR`。
2. 读取 `{PROFILE_DIR}/settings.local.json`。
3. 按“插件根目录检测”获取 `PLUGIN_ROOT`。
4. 从 `permissions.allow` 中删除 sleuth 添加的规则：
   - `Bash(agent-browser *)`
   - `Bash(node {PLUGIN_ROOT}/scripts/*.mjs *)`
5. 用 `AskUserQuestion` 展示即将删除的规则，请求用户确认。
6. 确认后用 `Write` 写回 `settings.local.json`。

### 步骤 2 — 清理数据（可选）

用 `AskUserQuestion` 询问是否删除 `~/.sleuth/` 数据目录：

```text
是否删除 sleuth 数据？（包含会话日志、输出 artifact 和站点经验）

选项:
- 保留数据 — 只清理权限，~/.sleuth/ 保留
- 删除数据 — 完全清除 ~/.sleuth/ 目录
- 取消 — 不做任何操作
```

如果用户选择“删除数据”：

1. `rm -rf ~/.sleuth/`
2. 输出确认信息

### 步骤 3 — 卸载插件

提示用户运行：

```text
claude plugin uninstall sleuth
```
