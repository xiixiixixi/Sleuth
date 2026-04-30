#!/bin/bash
# download_subtitles.sh — 从 YouTube 视频下载字幕
#
# 功能：使用 yt-dlp 从 YouTube 视频下载字幕文件（SRT 格式）。
#       按优先级尝试：人工中文字幕 → 人工英文字幕 → 自动生成字幕。
#
# 用法：
#   ./download_subtitles.sh <YouTube_URL> [输出目录]
#
# 参数：
#   YouTube_URL  - 视频链接（必填）
#   输出目录     - 字幕文件保存位置（可选，默认当前目录）
#
# 字幕下载策略（按优先级）：
#   1. 人工中文字幕（简体/繁体/通用）
#   2. 人工英文字幕
#   3. 自动生成字幕（中文优先，英文兜底）
#
# 依赖：yt-dlp（pip install yt-dlp）
#
# 示例：
#   ./download_subtitles.sh "https://www.youtube.com/watch?v=xxx"
#   ./download_subtitles.sh "https://www.youtube.com/watch?v=xxx" ./output

set -e

URL="$1"
OUTPUT_DIR="${2:-.}"

if [ -z "$URL" ]; then
    echo "用法: ./download_subtitles.sh <YouTube_URL> [输出目录]"
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

# 先列出可用字幕，方便调试
echo ">>> 检查可用字幕..."
yt-dlp --list-subs --no-download "$URL" 2>/dev/null | tail -20

echo ""

# ─── 策略 1：人工中文字幕 ────────────────────────────────────────
# 中文语言代码：zh-Hans（简体）、zh-Hant（繁体）、zh（通用）、zh-CN、zh-TW
echo ">>> 尝试下载人工字幕（中文优先）..."

# 用 mktemp 创建标记文件，用于检测 yt-dlp 是否实际下载了新文件
# macOS 和 GNU/Linux 兼容的写法
MARKER=$(mktemp "${TMPDIR:-/tmp}/ytdlp_marker.XXXXXX")
trap 'rm -f "$MARKER"' EXIT  # 脚本退出时清理临时文件

touch "$MARKER"
if yt-dlp --write-subs --sub-langs "zh-Hans,zh-Hant,zh,zh-CN,zh-TW" --sub-format srt --skip-download -o "$OUTPUT_DIR/%(title)s" "$URL" 2>/dev/null; then
    # 查找比标记文件更新的 SRT 文件（即刚下载的）
    FOUND=$(find "$OUTPUT_DIR" -name "*.srt" -newer "$MARKER" 2>/dev/null | head -1)
    if [ -n "$FOUND" ]; then
        echo "✅ 下载成功: $FOUND"
        exit 0
    fi
fi

# ─── 策略 2：人工英文字幕 ────────────────────────────────────────
echo ">>> 无中文人工字幕，尝试英文..."
if yt-dlp --write-subs --sub-langs "en,en-US,en-GB" --sub-format srt --skip-download -o "$OUTPUT_DIR/%(title)s" "$URL" 2>/dev/null; then
    # 用 -mmin -1 查找最近 1 分钟内修改的文件
    FOUND=$(find "$OUTPUT_DIR" -name "*.srt" -mmin -1 2>/dev/null | head -1)
    if [ -n "$FOUND" ]; then
        echo "✅ 下载成功: $FOUND"
        exit 0
    fi
fi

# ─── 策略 3：自动生成字幕 ────────────────────────────────────────
# --write-auto-subs 下载 YouTube 自动生成的字幕（准确度较低，但聊胜于无）
echo ">>> 无人工字幕，尝试自动生成字幕..."
if yt-dlp --write-auto-subs --sub-langs "zh-Hans,zh,en" --sub-format srt --skip-download -o "$OUTPUT_DIR/%(title)s" "$URL" 2>/dev/null; then
    FOUND=$(find "$OUTPUT_DIR" \( -name "*.srt" -o -name "*.vtt" \) -mmin -1 2>/dev/null | head -1)
    if [ -n "$FOUND" ]; then
        echo "✅ 自动字幕下载成功: $FOUND"
        exit 0
    fi
fi

echo "❌ 未找到任何可用字幕"
exit 1
