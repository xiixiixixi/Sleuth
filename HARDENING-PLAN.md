# sleuth 加固方案

> 依据:对 fabuhui 项目两次真实会话(6/1 深度调研 `4cafcb25`、6/3 视频字幕 `394ee4bf`,均 claude-minimax / MiniMax-M3)的三轮调查。
> 落点:主仓 `/Users/weixili/git/sleuth`(已确认与各 profile 副本关键脚本一致)。
> 形态:代码护栏 + 文档强化 + 中文命名修复 全套。

---

## 一、问题总账(调查结论)

把两次会话的全部异常归到一张表,标明**根因层级**与**归属**。

| # | 现象 | 证据 | 归属 | 严重度 |
|---|------|------|------|--------|
| P1 | 6 个子 Agent **零一手页面验证**(全 0 次 WebFetch/reader、0 个真实页面被读),把 web_search 摘要当事实写进 62KB 报告 | #1 search32 #2 s37 #4 s34 #5 s70,fetch 全 0 | 行为+设计 | 🔴 高 |
| P2 | 子 Agent **违规自建 research session**(#2/#3/#6),主流程被切成 4 个 session | 磁盘多出 `171345181`/`171429018`/`171444274` | 行为+设计 | 🔴 高 |
| P3 | 子 Agent **#3 提前 finish 主 session**,outcome 在子任务没跑完时就被标 success | #3 finish `170725093` | 行为+设计 | 🔴 高 |
| P4 | **5/6 子 Agent 没记 subagent_done**,主 session 只有 1 条(本应 6 条) | 主 session operations | 行为 | 🟠 中 |
| P5 | **#6 的 18 份证据 deliver 到自建 SID 目录**,脱离主流程 | `171429018/docs/` 18 个 md | 行为+设计 | 🟠 中 |
| P6 | 主 Agent 派活指令**漏传全部子 Agent 纪律**(读 guide / 不自建 / subagent_done / must_verify 全 0/6) | 6 个 prompt 实测 | **根因·行为** | 🔴 高 |
| P7 | 6/3 `extract-subtitles.sh` 批量 **find 串台 bug**:首个视频就误判,导致整条 skill 链路被放弃 | 脚本 L43/58/74 | **skill bug** | 🔴 高 |
| P8 | 6/3 全程 **0 次 deliver、末 session 没 finish**,成果不入知识库 | 4 个空 operations session | 行为 | 🟠 中 |
| P9 | **中文 query → session ID 乱码**(`22024-2026ai`、`youtube`) | session-logger L107 正则 | skill 设计 | 🟡 中 |

**根因链(一句话):** skill 把子 Agent 治理**全部寄托在"主 Agent 自觉手抄模板 + 子 Agent 自觉读 guide"上,代码层零护栏**。遇到 MiniMax 这类指令遵循较弱的模型,主 Agent 漏抄纪律(P6)→ 子 Agent 裸奔(P1/P2/P3/P4/P5)→ session 显示 success、报告漂亮,但证据空、记录散。叠加两个独立 skill 缺陷:视频脚本 bug(P7)、中文命名(P9)。

---

## 二、修复方案

按"代码护栏 → 文档强化 → 命名修复"分三组,每项标注:改哪个文件、怎么改、为什么、怎么验证。

### A 组:代码护栏(最高优先 — 不依赖模型自觉)

#### A1. session-logger 增加调用方角色控制(治 P2/P3)

**文件:** `scripts/session-logger.mjs`

**改法:**
- `start` / `finish` / `log` 三个子命令增加可选 `--role <main|subagent>`,默认 `main`。
- `--role subagent` 时:
  - 调 `start` → 直接拒绝并报错:`子 Agent 禁止创建 session,请使用主 Agent 提供的 SID`,退出码 2。
  - 调 `finish` → 拒绝:`子 Agent 禁止 finish 主 session,完成时只记 subagent_done`,退出码 2。
  - 调 `log` → 放行(子 Agent 只能 log)。
- 主 Agent 派活时在合同里注入 `--role subagent`(配合 B1 模板)。

**为什么:** P2/P3 的根源是 logger 对任何调用者都放行 start/finish。规矩只写在 .md 里,代码不拦。加 role 后,即使子 Agent 想自建/抢 finish 也被脚本挡掉。

**注意:** `--role` 默认 `main` 保证向后兼容;老的调用(不传 role)行为不变。

**验证:**
```bash
# 子 Agent 角色禁止 start
node scripts/session-logger.mjs --action start --query x --role subagent   # 期望:退出码2 + 报错
# 子 Agent 角色禁止 finish
node scripts/session-logger.mjs --action finish --sid <SID> --outcome success --role subagent  # 期望:拒绝
# 子 Agent 角色允许 log
node scripts/session-logger.mjs --action log --sid <SID> --operation '{"type":"visit"}' --role subagent  # 期望:成功
# 主 Agent 不传 role,一切如旧
node scripts/session-logger.mjs --action start --query x   # 期望:正常建 session
```

#### A2. finish 前检查 subagent_done 完整性(治 P3/P4)

**文件:** `scripts/session-logger.mjs`(`cmdFinish`)

**改法:**
- `finish` 时,若 session operations 里 `deliver` 数 > 0 但 `subagent_done` 数为 0,且未传 `--force`,则给出**显著警告**(不阻断,因为不是所有 session 都用子 Agent):
  `Warning: 检测到 N 个 deliver 但 0 个 subagent_done,主 session 可能在子 Agent 完成前被 finish。如确认请加 --force。`
- outcome 仍写入,但同时在 session 里记一个 `finish_warning: true` 字段,供审计。

**为什么:** P3 让 success 变得不可信。一个轻量的完整性信号,能在事后审计(像这次调查)中一眼看出"这个 success 是不是早产的"。

**验证:** 构造一个有 deliver 无 subagent_done 的 session,finish 时应告警并写入 `finish_warning`。

#### A3. deliver 的 SID 与产物归属告警(治 P5)

**文件:** `scripts/deliver.mjs`(`cmdSave`)

**改法:**
- `save` 时若传入 `--main-sid <主SID>` 且与 `--sid` 不一致,输出告警:
  `Warning: deliver 的 --sid (X) 与主 SID (Y) 不一致,该证据可能脱离主流程,主 Agent 合成时需扫 registry 而非单一 SLEUTH_OUTPUT。`
- 不阻断(子 Agent 偶有独立 session 的合法场景),只留痕。

**为什么:** P5 中 #6 的 18 份证据落到自建 SID 目录,主 Agent 若只读主 `SLEUTH_OUTPUT` 会漏掉。registry.jsonl 是全局的(已确认),所以**配套改 B3:主 Agent 合成时从 registry 按主 SID 关联扫产物**,而不是只 `ls SLEUTH_OUTPUT/docs`。

**验证:** `--sid` ≠ `--main-sid` 时出现告警;相等或不传时无告警。

#### A4. 低验证强度标记(治 P1)

**文件:** `scripts/session-logger.mjs`(记 `subagent_done` 时)

**改法:**
- `subagent_done` operation 支持携带统计字段,约定子 Agent 上报:`{"type":"subagent_done","name":..,"searches":N,"fetches":M,"browser":K,"delivers":D}`。
- logger 在写入时,如果 `fetches + browser == 0 && searches > 0`,自动附加 `low_verification: true`。
- 这是**数据层标记**,不阻断,但让"只搜不验"在 session 里留下硬证据,审查脚本/主 Agent 可据此要求补验。

**为什么:** P1 是最危险的失败(伪装成漂亮报告)。纯靠 guide 里的"自我怀疑提示"拦不住。一个机械的 `low_verification` 标记,把"只搜不读"从主观判断变成客观字段。

**验证:** 上报 fetches=0/browser=0/searches>0 → session 里该 done 记录带 `low_verification:true`。

---

### B 组:文档强化(让主 Agent 不漏传纪律 — 治根因 P6)

#### B1. SKILL.md 子 Agent 模板补全为"完整合同"(治 P6)

**文件:** `SKILL.md`(L99-120 的派活模板)

**改法:** 把模板从"半成品"升级为可直接复制的完整合同,显式包含此前漏传的全部纪律:
```text
你是独立研究子 Agent。

【强制】开始前必须先读:${CLAUDE_SKILL_DIR}/references/subagent-guide.md
【强制纪律】
- 使用下方 SID,禁止自己 start/finish session(脚本会用 --role subagent 拦截)
- 所有 session-logger / deliver 调用带 --role subagent
- 完成时必须记 subagent_done,并上报 searches/fetches/browser/delivers 计数
- must_verify 列出的事实必须回到原始来源(WebFetch/browser),不得用 web_search 摘要充当

SID: ${SID}
SLEUTH_OUTPUT: ${SLEUTH_OUTPUT}
browser_session: ${SID}-<角色名>

goal: ...
enough_when: ...
must_verify:        # ← 强制,不可省略
- ...
known_clues:
- ...

返回:findings、sources、gaps、red_flags、trust_notes。
```

**为什么:** P6 是根因——主 Agent 读了 guide 却没把"先读 guide / 不自建 / subagent_done / must_verify"抄进合同。把模板做成"照抄即合规、缺一行就明显不完整",降低漏传概率。配合 A 组,即使漏传,代码也兜底。

#### B2. SKILL.md 增加"派活前自检清单"(治 P6)

**文件:** `SKILL.md`(子 Agent 章节开头)

**改法:** 加一个主 Agent 派活前必须过的 checklist:
```
派子 Agent 前自检(缺任一项不要派):
□ 合同含"先读 subagent-guide.md"
□ 合同含 must_verify 清单(具体到字段)
□ 合同含"禁止自建 session + --role subagent"
□ 合同含"完成记 subagent_done + 上报计数"
□ 每个子 Agent 有独立 browser_session 名
```

**为什么:** 给指令遵循弱的模型一个显式的"门禁",比埋在散文里的纪律更难漏。

#### B3. SKILL.md 合成阶段改为"扫 registry"(治 P5)

**文件:** `SKILL.md`(交付/合成章节)

**改法:** 把"读 `${SLEUTH_OUTPUT}` 下所有子 Agent 的 deliver"改为:
```bash
# 合成前,按主 SID 关联扫全局 registry,避免漏掉落到其它 SID 的证据
node "${CLAUDE_SKILL_DIR}/scripts/deliver.mjs" --action list --sid "${SID}"
# 若子 Agent 曾用独立 session,补扫 registry.jsonl 中同一会话窗口的产物
```

**为什么:** P5 证明"只扫单一 SLEUTH_OUTPUT"会漏证据。registry.jsonl 全局且有锁,是更可靠的真相源。

#### B4. subagent-guide.md 纪律前置 + 加粗(辅助 P1/P2)

**文件:** `references/subagent-guide.md`

**改法:**
- 把"工作合同"里的第 4/5/6 条(不自建 session、不 finish、记 subagent_done)从第 40-50 行**提到文档最顶部**,作为"❗硬规则"区块,并去掉第 45/47 行重复(现在同一条写了两遍,说明作者也知道重要,但重复≠强调,前置更有效)。
- "只搜不验"列为**首要红线**,呼应 A4 的 `low_verification` 标记。

---

### C 组:命名 + 脚本 bug 修复(独立缺陷)

#### C1. 修中文 session ID 乱码(治 P9)

**文件:** `scripts/session-logger.mjs`(`generateSessionId` L91-118)

**约束(已核实):** `validateSessionId` 只允许 `[a-zA-Z0-9_-]`,是路径遍历的安全前提,**不能为了中文放开**。

**改法(三选一,推荐方案 a):**
- **a) 语义回退 + 序号**:slug 删中文后若为空或过短(<4 有效字符),改用 `query_type` 英文映射 + 短哈希,例如 `产品评测` → `review-a1b2`。可读、唯一、安全。
- b) 引入轻量拼音音译(纯中文 query → 拼音首段)。可读性更好,但要引依赖,违背 skill 零依赖倾向。
- c) query 原文另存到 session JSON 的 `query` 字段(已有),slug 只保证唯一,UI/recall 显示用 `query` 而非 ID。改动最小,但 ID 本身仍不可读。

**为什么:** 当前规则对中文 profile(minimax/glm/kimi/deepseek)产生 `youtube`/`22024-2026ai` 这种无法区分的 ID。

**验证:** `"翻译22个视频字幕"` 等纯中文 query → 生成可读且唯一的 slug,且通过 `validateSessionId`。

#### C2. 修 extract-subtitles.sh 批量 find 串台(治 P7)

**文件:** `scripts/extract-subtitles.sh`(L43/58/74)

**改法:**
- 当前 `find "$OUTDIR" -name "*.srt" | head -1` 在整个目录找,批量时捞到旧文件。
- 改为**只认本次 yt-dlp 实际写出的文件**:用 yt-dlp 的 `--print after_move:filepath` 或下载前后 diff 目录,或给每次调用一个唯一子目录 / 按 video id 过滤(`find ... -name "*${VIDEO_ID}*"`)。
- 同时把 `(Bash completed with no output)` 改成有明确成功/失败回显,避免静默。

**为什么:** P7 是 6/3 整条 skill 链路被放弃的导火索。脚本对单个 URL 可用,只是批量串台——修掉后批量处理才可靠。

**验证:** 连续对 3 个不同 video id 调用,各自只返回自己的字幕,不串台;无字幕时明确报"无",不误判成功。

---

## 三、落地顺序与验证

建议按依赖关系分批,每批独立可验证、可提交:

| 批次 | 内容 | 理由 | 验证方式 |
|------|------|------|----------|
| **批 1** | A1 + A2(logger 角色 + finish 检查) | 护栏核心,治 P2/P3,改动集中在一个文件 | 上方 A1/A2 命令逐条跑 |
| **批 2** | A3 + A4 + B3(deliver 归属 + 低验证标记 + 合成扫 registry) | 证据完整性闭环,治 P1/P5 | 构造跨 SID deliver、零 fetch done 验证标记 |
| **批 3** | B1 + B2 + B4(文档纪律) | 治根因 P6,纯文档零风险 | 人工 review 模板可照抄即合规 |
| **批 4** | C1(中文命名) | 独立缺陷 | 纯中文 query 生成可读 ID |
| **批 5** | C2(视频脚本 bug) | 独立缺陷 | 3 视频批量不串台 |

**回归测试(每批后跑):**
- 重放一次"正常主 Agent 单 session"流程,确认 `--role` 默认 main、不传新参数时行为完全不变(向后兼容)。
- 各 profile 副本(`~/.claude-*/skills/sleuth/`)同步策略待定 —— 见下方"开放问题"。

---

## 四、开放问题(需你拍板,不阻塞出方案)

1. **副本同步**:主仓改完后,`~/.claude-minimax`(及 glm/kimi/deepseek)副本要不要一并同步?它们当前是独立拷贝(非软链)。建议:主仓改完验证 → 写个同步脚本一次性 rsync 到各 profile。
2. **C1 命名方案**:a/b/c 三选一,我默认推荐 a(语义回退+序号,零依赖)。
3. **A 组护栏的"阻断 vs 告警"边界**:A1 我设为硬阻断(子 Agent 禁 start/finish),A2/A3/A4 设为告警+留痕。如果你想更严,A2 也可改硬阻断(无 subagent_done 不许 finish),但会牺牲灵活性。

---

## 五、一句话总结

> 这次两个失败本质是**同一个病根的两种表现**:skill 把关键纪律托付给"模型自觉",而没有代码护栏。6/1 是子 Agent 治理失效(自建 session、只搜不验、报告漂亮但证据空),6/3 是脚本 bug 触发链路放弃。方案的核心是**把纪律从 .md 里的劝导,下沉为 scripts/ 里的强制**(A 组),文档(B 组)负责让主 Agent 少犯错、代码负责在它犯错时兜底,再顺手修两个独立缺陷(C 组)。
