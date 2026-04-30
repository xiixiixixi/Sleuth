# 内容提取指南

sleuth 覆盖所有内容类型。文本提取优先（效率最高，token 成本最低）。

## 文本提取

```bash
agent-browser --auto-connect get text @ref                        # 定向提取
agent-browser --auto-connect eval "document.body.innerText"       # 全页文本（首选）
agent-browser --auto-connect eval --stdin <<'EOF'                 # 复杂提取
const rows = document.querySelectorAll("table tbody tr");
Array.from(rows).map(r => ({ name: r.cells[0].innerText, price: r.cells[1].innerText }));
EOF
```

结构化数据 >10 行或用户要求保存时写入 `~/.sleuth/output/data/`。

## 截图

绝大部分场景不需要截图。仅用于：用户要求、内容在图片中无法文字提取、调试。`screenshot --annotate` 标注 @ref。

## 图片

1. DOM 提取：`eval "Array.from(document.querySelectorAll('img')).map(i => i.src)"` 拿 URL 后下载
2. 直接截图：`screenshot --full`

## 视频

- **字幕优先**：YouTube 用 `download_subtitles.sh` + `srt_to_transcript.py`
- **帧采样**（无字幕时）：操控 `<video>` + screenshot 采帧。短视频 5-8 帧，中等 10-15 帧
- **平台内搜索**：B站、YouTube 站内搜索

## 音频/播客

优先提取已有字幕和 shownotes。搜索 `"播客名" transcript`。均失败告知用户无公开字幕。

## PDF

```bash
agent-browser --auto-connect eval "Array.from(document.querySelectorAll('a[href$=\".pdf\"]')).map(a => a.href)"
```

下载后用 Read 工具读取。arXiv 论文直接 `arxiv.org/pdf/论文ID`。

## 技术事实

- 折叠区块、懒加载内容已在 DOM 中，eval 可直接提取
- Shadow DOM 和 iframe 在 snapshot 中展开一级，eval 可递归穿透
- `scroll down` 触发懒加载后再提取图片 URL
- 公开媒体资源直接下载；需登录态的在浏览器内截图
