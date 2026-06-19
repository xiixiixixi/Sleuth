# references/

agent 按需读的展开文档。SKILL.md 是主入口（声明触发条件和硬规则），references/ 是具体方法论的展开。

## STRUCTURE

```
references/
├── search-guide.md      单次搜索方法论（206 行）
├── deep-research.md     单 Agent 深度研究工作流（184 行）
├── multi-agent.md       多 Agent 协同（169 行）
└── tool-guide.md        agent-browser CLI 命令参考（206 行）
```

## WHERE TO LOOK

| agent 场景 | 读哪份 |
|------|------|
| 做单次搜索 / WebSearch 调用 | `search-guide.md`（必搜/必不搜清单、query 改写、何时停、证据层级） |
| 用户要"完整报告"、"深度调研"、"全面对比" | `deep-research.md`（5 阶段：clarify→plan→research→compress→synthesize） |
| 有多个独立目标可并行，要派子 Agent | `multi-agent.md`（分治判断、目标导向 prompt、合成阶段） |
| 实际调用 agent-browser（snapshot/click/eval/...） | `tool-guide.md`（命令速查、反爬降级、特殊内容类型） |

## CONVENTIONS

- **每份文档单一主题**：search-guide 只讲单次搜索；deep-research 只讲多轮迭代；multi-agent 只讲并行分工。不要混。
- **中文硬规则用 强势动词**：必须 / 绝不 / 不要 / 禁止 / 不允许。不要用英文 DO NOT/NEVER。
- **每份文档独立可读**：agent 可能只读一份就回去干活，不要让 A 文档依赖 B 文档才能理解。
- **跟 SKILL.md 的硬规则对齐**：SKILL.md 是根，references/ 是展开。展开时不要发明新规则，只能详细化已有规则。
- **引用调研结论时附 URL**：`[结论](https://来源URL)`，单源最多 15 词直引。

## ANTI-PATTERNS

- **不要把工具命令塞进方法论文档**：`search-guide.md` 不写 `agent-browser` 命令；`tool-guide.md` 不讲搜索策略。
- **不要重新发明流程**：deep-research 的 5 阶段是定型的；multi-agent 的 supervisor-researcher 分工是定型的。要改先改 SKILL.md 的根规则。
- **不要在 references/ 提"学 web-access"/"参考 Perplexity"**：sleuth 是独立设计，文档里禁止出现别的 skill 名字（commit `9096a05` 的教训）。
- **不要加 hard cap（数字上限）**：之前 search-guide.md 有"4 轮/20 query/180 秒"的硬 cap，已删（commit `6a176e7`）。让 agent 用判断标准决定何时停。

## NOTES

- **`tool-guide.md` 里 `deliver` 引用已清干净**：曾经有 `deliver save --type image` 命令，deliver 系统砍后改成 curl 下载（commit `0b16d8f`）
- **`tool-guide.md` 的 AppleScript 段已删**：commit `c54d49c`，只剩 approval mode + agent-browser CLI
- **README 目录树未更新**：README 只提 `tool-guide.md` + `search-guide.md`，没列 `deep-research.md` 和 `multi-agent.md`——这是已知文档债
- **`search-guide.md` 的引用纪律段跟 SKILL.md 交付段重复**：故意重复，因为这是 sleuth 最容易违反的硬规则
- **`multi-agent.md` 的"目标导向 prompt 写法"是核心**：主 Agent 写 goal 时"说要什么，不说怎么做"——这条比所有 spawn-subagent.mjs 的 flag 都重要
