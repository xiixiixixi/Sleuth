#!/usr/bin/env node
/**
 * deliver.mjs — 文件交付工具
 *
 * 所有中间产物写入 session/agent output。
 * final 长文档可通过 --final 同步复制到当前执行目录 cwd。
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { resolveOutputDir, ensureOutputDir, TYPE_SUBDIR_MAP, sanitizeAgentName } from './lib/output.mjs';
import { registerArtifact } from './lib/registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_LOGGER = path.join(ROOT, 'scripts', 'session-logger.mjs');

function getTypeSubdir(type) { return TYPE_SUBDIR_MAP[type] || null; }

function deriveFilename(sourcePath, name, type) {
  const typeExtMap = { doc: '.md', screenshot: '.png', image: '.png', transcript: '.srt', data: '.json', page: '.html' };
  let ext = path.extname(sourcePath);
  if (!ext && type && typeExtMap[type]) ext = typeExtMap[type];
  if (name) return path.extname(name) ? name : name + ext;
  const baseName = path.basename(sourcePath);
  return !path.extname(baseName) && ext ? baseName + ext : baseName;
}

function avoidCollision(targetPath) {
  if (!existsSync(targetPath)) return targetPath;
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);
  const now = new Date();
  const ts = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + String(now.getSeconds()).padStart(2, '0') + String(now.getMilliseconds()).padStart(3, '0');
  return path.join(dir, `${base}-${ts}${ext}`);
}

function extractDomainFromPath(filePath) {
  for (const part of filePath.split(path.sep)) {
    if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(part)) return part;
  }
  return null;
}

function registerDeliveryArtifact({ sid, filePath, type, name, source, url, agent, finalPath }) {
  try {
    registerArtifact({ sid, filePath, type, name, source, url, agent, finalPath, timestamp: new Date().toISOString() });
  } catch (err) {
    console.warn(`Warning: registry update failed: ${err.message}`);
  }
}

function logDelivery({ sid, agent, type, targetPath, source, url, finalPath, extra = {} }) {
  if (!sid) return;
  let domain;
  if (url) { try { domain = new URL(url).hostname; } catch {} }
  if (!domain) domain = extractDomainFromPath(source || targetPath);
  const op = JSON.stringify({
    type: 'deliver',
    agent,
    content_type: type,
    file: targetPath,
    source,
    ...(url && { url }),
    ...(domain && { domain }),
    ...(finalPath && { final_path: finalPath }),
    ...extra,
  });
  try {
    execFileSync(process.execPath, [SESSION_LOGGER, '--action', 'log', '--sid', sid, '--operation', op], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 });
  } catch (err) {
    console.warn(`Warning: session logging failed: ${err.message}`);
  }
}

function copyFinalToCwd(targetPath, filename) {
  const finalPath = avoidCollision(path.join(process.cwd(), filename));
  copyFileSync(targetPath, finalPath);
  return finalPath;
}

async function cmdSave({ source, type, name, sid, url, agent = 'main', final = false }) {
  if (!source) {
    console.error('Error: --source is required for action "save"');
    process.exit(2);
  }
  if (!existsSync(source)) {
    console.error(`Error: source file not found: ${source}`);
    process.exit(1);
  }

  const safeAgent = sanitizeAgentName(agent);
  const outDir = resolveOutputDir(sid, safeAgent);
  ensureOutputDir(outDir);
  const typeSubdir = getTypeSubdir(type);
  if (!typeSubdir && type) console.warn(`Warning: unknown type "${type}", saving to output root`);
  const targetDir = typeSubdir ? path.join(outDir, typeSubdir) : outDir;
  mkdirSync(targetDir, { recursive: true });

  const filename = deriveFilename(source, name, type);
  const targetPath = avoidCollision(path.join(targetDir, filename));

  try {
    if (source === '/dev/stdin') {
      const chunks = [];
      let totalBytes = 0;
      const MAX_STDIN_BYTES = 100 * 1024 * 1024;
      process.stdin.setEncoding('utf-8');
      for await (const chunk of process.stdin) {
        totalBytes += Buffer.byteLength(chunk, 'utf-8');
        if (totalBytes > MAX_STDIN_BYTES) {
          console.error(`Error: stdin input exceeds ${MAX_STDIN_BYTES / 1024 / 1024}MB limit`);
          process.exit(1);
        }
        chunks.push(chunk);
      }
      writeFileSync(targetPath, chunks.join(''), 'utf-8');
    } else {
      copyFileSync(source, targetPath);
    }
  } catch (err) {
    console.error(`Error: failed to copy file: ${err.message}`);
    process.exit(1);
  }

  let finalPath = null;
  if (final) finalPath = copyFinalToCwd(targetPath, filename);

  console.log(finalPath ? `${targetPath}\n${finalPath}` : targetPath);

  registerDeliveryArtifact({ sid, filePath: targetPath, type, name: filename, source, url, agent: safeAgent, finalPath });
  logDelivery({ sid, agent: safeAgent, type, targetPath, source, url, finalPath });
}

function walk(baseDir, currentDir, result) {
  let entries;
  try { entries = readdirSync(currentDir); } catch { return; }
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry);
    let st;
    try { st = statSync(fullPath); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(baseDir, fullPath, result);
    else if (st.isFile()) result.push(path.relative(baseDir, fullPath));
  }
}

function cmdList(sid, agent = 'main') {
  const outDir = resolveOutputDir(sid, sanitizeAgentName(agent));
  if (!existsSync(outDir)) { console.log('(empty)'); return; }
  const files = [];
  walk(outDir, outDir, files);
  console.log(files.length ? files.join('\n') : '(empty)');
}

function cmdMerge({ sid, name, agent = 'main', final = false }) {
  const safeAgent = sanitizeAgentName(agent);
  const outDir = resolveOutputDir(sid, safeAgent);
  const docsDir = path.join(outDir, 'docs');
  if (!existsSync(docsDir)) {
    console.error('Error: docs/ directory not found');
    process.exit(1);
  }
  const mergedName = name || 'merged-report.md';
  const files = readdirSync(docsDir).filter(f => f.endsWith('.md') && f !== mergedName && statSync(path.join(docsDir, f)).isFile()).sort();
  if (files.length === 0) {
    console.error('Error: no .md files found in docs/');
    process.exit(1);
  }
  const mergedContent = files.map(file => `## 来源: ${file}\n\n${readFileSync(path.join(docsDir, file), 'utf-8')}`).join('\n\n---\n\n');
  const mergedPath = path.join(docsDir, mergedName);
  writeFileSync(mergedPath, mergedContent, 'utf-8');
  let finalPath = null;
  if (final) finalPath = copyFinalToCwd(mergedPath, mergedName);
  console.log(finalPath ? `${mergedPath}\n${finalPath}` : mergedPath);

  registerDeliveryArtifact({ sid, filePath: mergedPath, type: 'doc', name: mergedName, source: files.join(', '), agent: safeAgent, finalPath });
  logDelivery({ sid, agent: safeAgent, type: 'doc', targetPath: mergedPath, source: files.join(', '), finalPath, extra: { merged_from: files.length } });
}

function cmdInit(sid, agent = 'main') {
  const outDir = resolveOutputDir(sid, sanitizeAgentName(agent));
  ensureOutputDir(outDir);
  console.log(outDir);
}

async function main() {
  const { values } = parseArgs({
    options: {
      action: { type: 'string' },
      type: { type: 'string' },
      source: { type: 'string' },
      name: { type: 'string' },
      sid: { type: 'string' },
      agent: { type: 'string' },
      url: { type: 'string' },
      final: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log('Usage: node deliver.mjs --action <save|list|init|merge> [options]');
    console.log('  --action save   --source <path> [--type <type>] [--name <name>] [--url <URL>] [--sid <id>] [--agent <name>] [--final]');
    console.log('  --action list   [--sid <id>] [--agent <name>]');
    console.log('  --action init   [--sid <id>] [--agent <name>]');
    console.log('  --action merge  --sid <id> [--agent <name>] [--name <filename>] [--final]');
    console.log('Content types: ' + Object.keys(TYPE_SUBDIR_MAP).join(', '));
    return;
  }

  if (!values.action) {
    console.error('Error: --action is required. Must be save, list, init, or merge.');
    process.exit(2);
  }

  switch (values.action) {
    case 'save':
      await cmdSave({ source: values.source, type: values.type, name: values.name, sid: values.sid, url: values.url, agent: values.agent || 'main', final: Boolean(values.final) });
      break;
    case 'list':
      cmdList(values.sid, values.agent || 'main');
      break;
    case 'init':
      cmdInit(values.sid, values.agent || 'main');
      break;
    case 'merge':
      cmdMerge({ sid: values.sid, name: values.name, agent: values.agent || 'main', final: Boolean(values.final) });
      break;
    default:
      console.error(`Error: unknown action "${values.action}". Must be save, list, init, or merge.`);
      process.exit(2);
  }
}

main();
