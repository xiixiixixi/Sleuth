#!/usr/bin/env python3
"""
srt_to_transcript.py — SRT/VTT 字幕文件清洗为纯文本

功能：
  将 SRT 或 VTT 格式的字幕文件转换为干净的纯文本 transcript。
  去除时间戳、序号、HTML 标签、重复行，输出可直接阅读的段落文本。

  典型用途：配合 download_subtitles.sh / extract-subtitles.sh 使用，
  将下载的字幕文件转为可阅读的文本供 Agent 分析。

处理流程：
  1. 自动检测文件编码（UTF-8 → GBK → Latin-1 依次尝试）
  2. 根据文件扩展名或内容判断格式（SRT / VTT）
  3. 去除序号行、时间戳行、HTML 标签、VTT 位置标记
  4. 去除连续重复行（自动字幕常有此问题）
  5. 合并为段落：累积文本到一定长度或遇到句末标点时换行

用法：
  python3 srt_to_transcript.py input.srt [output.txt]
  python3 srt_to_transcript.py input.vtt [output.txt]

  不指定输出文件时，默认输出到 input_transcript.txt
"""

import sys
import html
import re
from pathlib import Path


def clean_srt(content: str) -> str:
    """
    清洗 SRT 格式字幕为纯文本。

    SRT 格式结构（每个字幕块）：
      1               ← 序号行
      00:01:23,456 --> 00:01:25,789   ← 时间戳行
      Hello world     ← 字幕文本

    处理步骤：
      1. 跳过纯数字行（序号）
      2. 跳过时间戳行（HH:MM:SS,millis --> HH:MM:SS,millis）
      3. 去除 HTML 标签（如 <i>、<b>、<font color="...">）
      4. 解码 HTML 实体（如 &amp; → &）
      5. 去除 VTT 的对齐标记（如 align:center position:50%）
      6. 去除连续重复行
      7. 合并为段落

    @param content: SRT 文件的完整文本内容
    @return: 清洗后的纯文本，段落间用空行分隔
    """
    lines = content.strip().split('\n')
    texts = []

    for line in lines:
        line = line.strip()
        # 跳过序号行（纯数字）
        if re.match(r'^\d+$', line):
            continue
        # 跳过时间戳行
        # SRT 格式: 00:01:23,456 --> 00:01:25,789
        # VTT 格式: 01:23.456 --> 01:25.789
        if re.match(r'(\d{2}:){1,2}\d{2}[.,]\d{2,3}', line):
            continue
        # 跳过空行
        if not line:
            continue
        # 去除 HTML 标签（字幕中常见 <i>、<b>、<font> 等）
        line = re.sub(r'<[^>]+>', '', line)
        # 解码 HTML 实体（如 &amp; → &，&#39; → '）
        line = html.unescape(line)
        # 去除 VTT 位置/对齐标记
        line = re.sub(r'align:.*$|position:.*$', '', line).strip()
        if line:
            texts.append(line)

    # 去除连续重复行（自动生成的字幕常有此问题）
    # 例如连续两行都是 "Hello world"，只保留一个
    deduped = []
    for text in texts:
        if not deduped or text != deduped[-1]:
            deduped.append(text)

    # 合并为段落
    # 累积短句，满足以下条件之一时形成一个段落：
    #   - 累积文本超过 200 字符
    #   - 当前行以句末标点结尾（。！？.!?）
    result = []
    current = []

    for text in deduped:
        current.append(text)
        joined = ' '.join(current)
        if len(joined) > 200 or re.search(r'[。！？.!?]$', text):
            result.append(joined)
            current = []

    # 处理剩余未闭合的段落
    if current:
        result.append(' '.join(current))

    return '\n\n'.join(result)


def clean_vtt(content: str) -> str:
    """
    清洗 VTT (WebVTT) 格式字幕。

    VTT 与 SRT 类似，但有额外的头部和注释块需要处理。
    处理方式：先去掉 VTT 特有的头部（WEBVTT 标识和 NOTE 注释块），
    然后复用 SRT 的清洗逻辑。

    @param content: VTT 文件的完整文本内容
    @return: 清洗后的纯文本
    """
    # 去掉 WEBVTT 头部（如 "WEBVTT\n\nKind: captions\n\n"）
    content = re.sub(r'^WEBVTT.*?\n\n', '', content, flags=re.DOTALL)
    # 去掉 NOTE 注释块（如 "NOTE\nThis is a comment\n\n"）
    content = re.sub(r'NOTE.*?\n\n', '', content, flags=re.DOTALL)
    # 复用 SRT 清洗逻辑
    return clean_srt(content)


def main():
    if len(sys.argv) < 2:
        print("用法: python3 srt_to_transcript.py <input.srt|input.vtt> [output.txt]")
        sys.exit(1)

    input_path = Path(sys.argv[1])
    if not input_path.exists():
        print(f"文件不存在: {input_path}")
        sys.exit(1)

    # 确定输出文件路径
    if len(sys.argv) >= 3:
        output_path = Path(sys.argv[2])
    else:
        # 默认：与输入同目录，文件名加 _transcript 后缀
        output_path = input_path.parent / f"{input_path.stem}_transcript.txt"

    # 读取文件内容（自动检测编码）
    # 按优先级尝试：UTF-8 → UTF-8 BOM → GBK → GB2312 → Latin-1
    encodings = ['utf-8', 'utf-8-sig', 'gbk', 'gb2312', 'latin-1']
    content = None
    for enc in encodings:
        try:
            content = input_path.read_text(encoding=enc)
            break
        except (UnicodeDecodeError, UnicodeError):
            continue
    if content is None:
        print(f"无法识别文件编码: {input_path}")
        sys.exit(1)

    # 根据扩展名或内容判断格式
    if input_path.suffix.lower() == '.vtt' or content.startswith('WEBVTT'):
        transcript = clean_vtt(content)
    else:
        transcript = clean_srt(content)

    # 写入输出文件
    output_path.write_text(transcript, encoding='utf-8')

    # 打印统计信息
    char_count = len(transcript)
    line_count = transcript.count('\n') + 1
    print(f"转换完成: {output_path}")
    print(f"   字符数: {char_count}  段落数: {line_count}")


if __name__ == '__main__':
    main()
