# references/

| 文档 | 内容 |
|---|---|
| scout.md | 侦察执行：广度扫描策略、工具选择、landscape.json 返回格式 |
| search.md | 搜索执行：必搜/必不搜、查询规则、工具选择、失败兜底、搜索循环、多模态提取、JSONL 返回、dimensions_seen、directions.json 格式 |
| boundary.md | 边界评估：覆盖度 + 方向偏移 + 实体准确 + follow-ups 状态、terminate_recommended 判定、输出 schema |
| review.md | 证据链审计：4 项审计、critical/non_critical 分级、分层抽样、Tier 分级、输出 schema |
| tool-guide.md | agent-browser 命令速查、反爬降级、特殊内容类型 |

## 每份文档的边界

- **scout.md** 只讲侦察广度扫描。不做深度研究、不提取 claim、不开浏览器
- **search.md** 只讲搜索执行。不塞 agent-browser 命令细节（那是 tool-guide.md 的家）
- **boundary.md** 只讲边界评估。自包含——不引用其他文档
- **review.md** 只讲证据链审计。自包含——Tier 分级和 5 级可信度都内联（因为审计需要对照）
- **tool-guide.md** 只讲命令参数。独立——不引用其他文档的逻辑

## CONVENTIONS

- **中文硬规则用 强势动词**：必须 / 绝不 / 不要 / 禁止 / 不允许
- **每份文档独立可读**
- **跟 SKILL.md 的硬规则对齐**：SKILL.md 是根，references/ 是各子 Agent 的展开
- **引用调研结论时附 URL**：`[结论](https://来源URL)`，单源最多 15 词直引

## ANTI-PATTERNS

- **不要把工具命令塞进 search.md / boundary.md / review.md**
- **不要在 references/ 提别的 skill 名字**（如 web-access）
- **不要加 hard cap**（数字上限）
- **不要把 system-layer framework 细节塞进来**（心跳看门狗 / cron / stall 阈值）

## NOTES

- **文档拆分历史**：原 research.md（363 行）逐步拆为现在的 search.md + boundary.md + review.md + tool-guide.md 四份独立文档；合成规则移入 SKILL.md §7
- **每份子 Agent 文档自包含**：子 Agent 只读被指定的那一份 references，不跨文档跳转
