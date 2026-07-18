#!/usr/bin/env node
/** check-docs.mjs — 检查仓库文档引用和过时当前文件名。 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['.git', 'node_modules', 'docs/local']);
const markdown = [];

function walk(relative = '') {
  const absolute = path.join(root, relative);
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (![...ignored].some((value) => child === value || child.startsWith(`${value}/`))) walk(child);
    } else if (entry.name.endsWith('.md')) markdown.push(child);
  }
}
walk();

const errors = [];
const staleNames = ['boundary-report' + '.yaml', 'audit_report' + '.yaml'];
for (const file of markdown) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  for (const stale of staleNames) {
    if (text.includes(stale)) errors.push(`${file} 仍出现过时文件名 ${stale}`);
  }
  for (const match of text.matchAll(/`((?:docs|scripts|references)\/[A-Za-z0-9_./-]+\.(?:md|mjs|sh|py))`/g)) {
    if (!fs.existsSync(path.join(root, match[1]))) errors.push(`${file} 引用了不存在的 ${match[1]}`);
  }
}

if (errors.length) {
  console.error('✗ 文档检查失败：');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`✓ 文档检查通过：${markdown.length} 个 Markdown 文件`);
