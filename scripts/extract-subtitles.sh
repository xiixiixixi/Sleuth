#!/bin/bash
# 播客/视频字幕提取 — 穷举字幕获取策略
# 用法:
#   bash extract-subtitles.sh <URL> [输出目录]
#
# 策略（按优先级）：
#   1. yt-dlp 提取内嵌人工字幕（中文>英文）
#   2. yt-dlp 提取自动生成字幕
#   3. 检查页面是否有 transcript 链接
#   4. 以上都失败 → 输出诊断信息，告诉用户替代方案
#
# 依赖: yt-dlp, curl (均已在 sleuth 依赖中)
#
# 注意：本脚本不调用付费 API。对无字幕的纯音频，给出用户指引而非自动转录。

set -euo pipefail

URL="${1:?用法: $0 <URL> [输出目录]}"
OUTDIR="${2:-./sleuth-output/transcripts}"

mkdir -p "$OUTDIR"

echo ">>> 尝试提取字幕: $URL"
echo ""

# ─── 策略 1: yt-dlp 人工字幕 ─────────────────────────────
echo "  策略 1: 提取内嵌人工字幕（中文优先）..."
if yt-dlp --write-subs --sub-langs "zh-Hans,zh-Hant,zh,zh-CN,zh-TW" \
    --sub-format srt/vtt --skip-download \
    -o "${OUTDIR}/%(title)s.%(ext)s" \
    --no-playlist "$URL" 2>/dev/null; then
    FOUND=$(find "$OUTDIR" -name "*.srt" -o -name "*.vtt" 2>/dev/null | head -1)
    if [[ -n "$FOUND" ]]; then
        echo "  ✅ 找到人工中文字幕: $FOUND"
        echo "$FOUND"
        exit 0
    fi
fi
echo "  无人工中文字幕"

# ─── 策略 2: yt-dlp 英文字幕 ─────────────────────────────
echo "  策略 2: 提取英文人工字幕..."
if yt-dlp --write-subs --sub-langs "en,en-US,en-GB" \
    --sub-format srt/vtt --skip-download \
    -o "${OUTDIR}/%(title)s.%(ext)s" \
    --no-playlist "$URL" 2>/dev/null; then
    FOUND=$(find "$OUTDIR" -name "*.srt" -o -name "*.vtt" 2>/dev/null | head -1)
    if [[ -n "$FOUND" ]]; then
        echo "  ✅ 找到英文字幕: $FOUND"
        echo "$FOUND"
        exit 0
    fi
fi
echo "  无英文人工字幕"

# ─── 策略 3: yt-dlp 自动生成字幕 ──────────────────────────
echo "  策略 3: 提取自动生成字幕..."
if yt-dlp --write-auto-subs --sub-langs "zh-Hans,zh,en" \
    --sub-format srt/vtt --skip-download \
    -o "${OUTDIR}/%(title)s.%(ext)s" \
    --no-playlist "$URL" 2>/dev/null; then
    FOUND=$(find "$OUTDIR" -name "*.srt" -o -name "*.vtt" 2>/dev/null | head -1)
    if [[ -n "$FOUND" ]]; then
        echo "  ✅ 找到自动生成字幕: $FOUND"
        echo "$FOUND"
        exit 0
    fi
fi
echo "  无自动生成字幕"

# ─── 策略 4: 检查页面 HTML 中的 transcript ────────────────
echo "  策略 4: 检查页面是否有 transcript 链接..."
PAGE_HTML=$(curl -sL -H "User-Agent: Mozilla/5.0" "$URL" 2>/dev/null || echo "")

# 搜索常见的 transcript 模式
TRANS_LINK=$(echo "$PAGE_HTML" | grep -oiE 'href="[^"]*transcript[^"]*"' | head -1 | grep -oE 'http[^"]*' || echo "")

if [[ -n "$TRANS_LINK" ]]; then
    echo "  ✅ 发现 transcript 链接: $TRANS_LINK"
    echo "  ⚠️ 请用 agent-browser 打开该链接获取全文"
    echo "$TRANS_LINK"
    exit 0
fi

# 检查是否页面本身就包含全文 transcript
WORD_COUNT=$(echo "$PAGE_HTML" | sed 's/<[^>]*>//g' | wc -w | tr -d ' ')
if [[ "$WORD_COUNT" -gt 500 ]]; then
    echo "  ⚠️ 页面可能包含全文（${WORD_COUNT} 词），请用 agent-browser 打开检查"
fi
echo "  未发现 transcript 链接"

# ─── 所有策略失败 ─────────────────────────────────────────
echo ""
echo "  ❌ 无法自动提取字幕。该内容可能："
echo "     - 是纯音频文件（无嵌入字幕）"
echo "     - 平台不支持字幕下载"
echo "     - 需要登录才能访问字幕"
echo ""
echo "  替代方案："
echo "     macOS: 用 MacWhisper (App Store 免费) 拖入音频文件转录"
echo "     Linux: whisper-cpp (brew install whisper-cpp) 本地转录"
echo "     在线: https://freesubtitles.ai 上传音频免费转字幕"
echo ""
echo "  如果该 URL 是一个播客，可以尝试："
echo "     - Google 搜索 '[播客名] transcript' 找公开字幕"
echo "     - 打开 Apple Podcasts / 小宇宙 shownotes 页面"
exit 1
