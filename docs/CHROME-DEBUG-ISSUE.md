# Chrome 远程调试弹窗问题记录

> 本文件随仓维护。它记录环境问题；“代码路径安全”和“重启后许可是否持久”必须分开判断。

## 问题

重启电脑后，Chrome 144+ 反复弹「要允许远程调试吗?」许可框——即使之前跑过 `scripts/fix-chrome-debug-permission.mjs` 装了策略，重启后又弹。

## 环境

- macOS 26.5.1（Tahoe）
- Chrome 150.0.7871.115
- commit `73e4c8c`（修复版）

---

## 根因（两层夹击）

### 第 1 层：旧方案的 plist 文件被系统清理

旧脚本（commit `73e4c8c` 之前）往 `/Library/Managed Preferences/com.google.Chrome.plist` 写企业策略文件。macOS 26 的守护进程 `cfprefsd`（偏好设置守护进程）看管这个目录——**只认通过 MDM 企业管理或正规描述文件装的策略，手动 cp 进去的文件重启后被清理**。

诊断证据（2026-07-14）：
```
/Library/Managed Preferences/com.google.Chrome.plist  → ❌ 不在（被清了）
目录 /Library/Managed Preferences/                    → 存在但空了
目录修改时间                                          → Jul 14 21:34（重启前被清）
defaults read com.google.Chrome RemoteDebuggingAllowed → 1（用户级缓存还在，但 Chrome 144+ 弹窗不认用户级）
```

### 第 2 层：macOS 26 禁了命令行装描述文件

尝试改用 `.mobileconfig` 描述文件走正规渠道（`profiles install`），但 macOS 26 的 `profiles` 命令报错：

```
profiles tool no longer supports installs.
Use System Settings Profiles to add configuration profiles.
```

`profiles help` 确认：命令行只剩 `status / list / show / remove / sync`，**install 被删了**。只能通过系统设置 GUI 手动装——脚本做不到自动化。

---

## 修法（commit `73e4c8c`）

### 新方案：Chrome 用户级 Local State

改设置 Chrome 自己的用户配置文件里的开关：

- **文件**：`~/Library/Application Support/Google/Chrome/Local State`
- **key**：`devtools.remote_debugging.user-enabled`
- **值**：`true`

这个文件在个人目录，**不受 cfprefsd 管，重启不丢，不需要 sudo**。

### 脚本改动（仅 macOS 分支）

| 函数 | 旧方案（已废） | 新方案 |
|------|--------------|--------|
| `checkInstalled` | 查 `/Library/Managed Preferences/` plist 文件 | 读 Local State JSON 的 `user-enabled` 值 |
| `installMacOS` | osascript 弹密码框 + cp plist 到系统目录 | 检测 Chrome 关闭 → JSON 读写设 true + 备份原文件 |
| `uninstallMacOS` | osascript 弹密码框 + rm 系统目录文件 | 检测 Chrome 关闭 → JSON 设 false |

**关键前提**：改 Local State 时 Chrome 必须关闭（在跑时改会被 Chrome 覆盖回去）。脚本检测 Chrome 在跑就拦住，提示先 Cmd+Q。

### 用法

```bash
# 检测当前状态
node scripts/fix-chrome-debug-permission.mjs --check

# 安装（macOS 需先关 Chrome：Cmd+Q）
node scripts/fix-chrome-debug-permission.mjs

# 卸载（macOS 需先关 Chrome）
node scripts/fix-chrome-debug-permission.mjs --uninstall
```

---

## 验证状态

| 检查项 | 结果 |
|--------|------|
| `--check` 检测逻辑 | ✅ 正确（读到 `user-enabled = true` 报已安装） |
| 安装时 Chrome 在跑拦截 | ✅ 正确（exit 1 + 提示关 Chrome） |
| 卸载时 Chrome 在跑拦截 | ✅ 正确 |
| 自动测试 | ✅ 以 `node --test scripts/__tests__/*.mjs` 的实时结果为准 |
| **重启后是否还弹** | ⏳ **待验证**——下次重启电脑后确认 |

### 待验证事项

下次重启电脑后：

1. **Chrome 不弹** → 修复成功，用户级 `user-enabled` 足够压住 Chrome 150 弹窗
2. **Chrome 又弹** → 说明 Chrome 150 弹窗优先级是「企业策略 > 用户授权」，用户级值压不住。需要换方案：
   - 方案 A：脚本生成 `.mobileconfig` 文件，用户双击 → 系统设置 → 手动装（一次性的，不能自动化，但持久）
   - 方案 B：每次 Chrome 启动后跑 launchd 守护进程自动重设 Local State（重，不推荐）
   - 方案 C：用户明确选择后，用 `launch-chrome.mjs --confirm-close-browser` 启动调试 Chrome；先保存浏览器内容，脚本不会强制结束未正常退出的日常 Chrome

---

## 为什么不能完全自动化（macOS 26 限制）

| 方法 | 命令行能做？ | 持久？ | 备注 |
|------|------------|--------|------|
| 写 `/Library/Managed Preferences/` plist | ✅（需 sudo） | ❌ | cfprefsd 重启清掉 |
| `profiles install` 装 .mobileconfig | ❌ | — | macOS 26 禁了该命令 |
| 手动装 .mobileconfig（GUI） | ❌（要双击） | ✅ | 不能脚本自动化 |
| 改 Chrome Local State（当前方案） | ✅（不需 sudo） | ✅ | **待重启验证是否压住弹窗** |

当前方案是 macOS 26 命令行能做的最可靠的。如果验证后发现压不住弹窗，走方案 A（生成文件让用户手动装）。

---

## 相关文件

- 脚本：`scripts/fix-chrome-debug-permission.mjs`（commit `73e4c8c`）
- 测试：无独立测试（该脚本是环境工具，不在 `__tests__/` 覆盖范围）
- 依赖：`launch-chrome.mjs` 只能由用户主动运行；Sleuth 主流程不会因为环境检查失败而自动调用它
