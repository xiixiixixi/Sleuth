---
name: sleuth:config
description: 配置 sleuth 插件 — 发现可用工具、选择封禁项、配置权限、卸载
argument-hint: [setup|show|block-web on|off|list|route-search on|off|permissions|uninstall]
allowed-tools: [Read, Write, Bash, AskUserQuestion]
---

# Sleuth 配置向导

管理 sleuth 插件的所有可配置项。配置存储在 `~/.sleuth/config.json`。

用户输入: `$ARGUMENTS`

## 参数路由

根据 `$ARGUMENTS` 执行对应操作：

| 参数 | 操作 |
|------|------|
| `setup` 或无参数 | 完整设置向导（发现工具 → 选择封禁 → 配置权限） |
| `show` | 显示当前配置 |
| `block-web on` | 开启 Web 工具拦截 |
| `block-web off` | 关闭 Web 工具拦截 |
| `block-web list` | 重新选择要封禁的工具 |
| `route-search on` | 开启搜索意图路由 |
| `route-search off` | 关闭搜索意图路由 |
| `permissions` | 配置 settings.local.json 权限 |
| `uninstall` | 卸载：逆向清理所有配置和数据 |

---

## Profile 路径检测

多个操作需要读写当前 profile 的 `settings.local.json`。按以下优先级检测 profile 路径：

1. 检查 `~/.sleuth/config.json` 中的 `profileDir` 字段（之前保存过的路径）
2. 检查环境变量 `CLAUDE_CONFIG_DIR`
3. 检查 `~/.claude/settings.local.json` 是否存在
4. 用 `Bash` 运行 `ls -d ~/.claude*/settings.local.json 2>/dev/null` 列出所有可能的 profile
5. 以上都失败时，用 `AskUserQuestion` 询问用户，提供以下选项：
   - `~/.claude/`（默认 profile）
   - `~/.claude-deepseek/`（如检测到存在）
   - `其他`（用户手动输入）

检测到路径后，将其保存到 `~/.sleuth/config.json` 的 `profileDir` 字段，后续操作直接使用，不再重复检测。

---

## 操作一：完整设置向导（setup）

### 阶段 1 — 发现可用工具

1. 搜索 MCP 配置文件（以下位置逐一检查，存在就读取）：
   - 项目: `.mcp.json`
   - 全局: `{profileDir}/settings.json`（从 profileDir 拼接）
2. 从配置中提取所有 MCP 服务器名称（`mcpServers` 对象的 key）
3. 对每个 MCP 服务器，工具名格式为 `mcp__<server>__<tool>`，列出该服务器下的所有 tool
4. 如果无法枚举具体 tool 名，则使用服务器名作为分组提示
5. 添加内置 Web 工具: `WebSearch`、`WebFetch`、`Fetch`
6. 将工具分为两组：
   - **Web/搜索类**（建议封禁）：工具名或描述包含 search、fetch、web、browse、scrape、crawl、reader、tavily、extract 等关键词的
   - **其他工具**（不封禁）：图像分析、代码工具、数据库等

### 阶段 2 — 选择封禁项

1. 读取当前 `~/.sleuth/config.json`（如不存在则创建默认配置）
2. 用 `AskUserQuestion` 展示工具列表，`multiSelect: true`，默认选中 web/搜索类工具
3. 用户的实际选择写入 `blockedTools` 字段

### 阶段 3 — 配置权限

1. 按"Profile 路径检测"流程确认 profile 目录
2. 读取 `{profileDir}/settings.local.json`（如不存在则创建空结构）
3. 计算需要添加的 allow 规则：
   ```
   Bash(agent-browser *)
   Bash(curl http://127.0.0.1:9*)
   ```
4. 如规则已存在则跳过
5. 用 `AskUserQuestion` 展示将要写入的规则，请求用户确认
6. 用户确认后，用 `Write` 工具写入更新后的 `settings.local.json`
7. 提示：权限变更需要重启 Claude Code 生效

### 保存配置

最终写入 `~/.sleuth/config.json`：
```json
{
  "profileDir": "/Users/xxx/.claude-deepseek",
  "blockWebTools": true,
  "routeSearchIntent": true,
  "blockedTools": ["WebSearch", "WebFetch", ...]
}
```

---

## 操作二：显示配置（show）

1. 读取 `~/.sleuth/config.json`，如不存在则显示默认值
2. 格式化输出：

```
sleuth 配置:

  Profile 目录:     ~/.claude-deepseek/
  拦截 Web 工具:    ✓ 开启
  搜索意图路由:     ✓ 开启

  封禁工具列表 (3):
    • WebSearch
    • WebFetch
    • mcp__tavily__tavily_search

  配置文件: ~/.sleuth/config.json

使用 /sleuth:config <选项> 修改配置。
```

---

## 操作三：block-web on/off

1. 读取 `~/.sleuth/config.json`（如不存在则创建）
2. 更新 `blockWebTools` 字段
3. 写回文件
4. 输出结果

---

## 操作四：block-web list

同"阶段 1 + 阶段 2"（只重新选择封禁工具列表，不改权限）。

---

## 操作五：route-search on/off

1. 读取 `~/.sleuth/config.json`
2. 更新 `routeSearchIntent` 字段
3. 写回文件
4. 输出结果

---

## 操作六：permissions

同"阶段 3"（只配置权限）。

---

## 操作七：卸载（uninstall）

逆向清理 sleuth 的所有配置和数据。分两步：

### 步骤 1 — 清理 settings 文件

1. 按"Profile 路径检测"流程确认 profile 目录
2. 读取 `{profileDir}/settings.local.json`
3. 从 `permissions.allow` 中删除 sleuth 添加的规则：
   - `Bash(agent-browser *)`
   - `Bash(curl http://127.0.0.1:9*)`
4. 从 `permissions.deny` 中删除 sleuth 添加的规则（如有）：
   - `WebSearch`、`WebFetch`、`Fetch`
5. 用 `AskUserQuestion` 展示将要删除的规则，请求用户确认
6. 确认后用 `Write` 写回 `settings.local.json`

### 步骤 2 — 清理数据（可选）

用 `AskUserQuestion` 询问是否删除 `~/.sleuth/` 数据目录：

```
是否删除 sleuth 数据？（包含会话日志和站点经验）

选项:
- 保留数据 — 只清理配置，~/.sleuth/ 保留
- 删除数据 — 完全清除 ~/.sleuth/ 目录
- 取消 — 不做任何操作
```

如果用户选择"删除数据"：
1. `rm -rf ~/.sleuth/`
2. 输出确认信息

### 步骤 3 — 卸载插件

提示用户运行以下命令完成插件卸载：
```
claude plugin uninstall sleuth
```

输出最终确认：
```
sleuth 已卸载:

  ✓ 已清理 settings.local.json 权限规则
  ✓ 已删除 ~/.sleuth/ 数据（或：已保留 ~/.sleuth/ 数据）
  → 请运行: claude plugin uninstall sleuth

重启 Claude Code 后生效。
```

---

## 默认配置

首次使用（无 config.json）时的默认值：

```json
{
  "blockWebTools": true,
  "routeSearchIntent": true
}
```

注意：默认不包含 `blockedTools` 字段 — 此时 hook 使用内置的默认封禁列表（WebSearch、WebFetch、Fetch + 常见 MCP web 工具）。用户运行 `/sleuth:config setup` 或 `/sleuth:config block-web list` 后才会生成自定义的 `blockedTools` 列表。
