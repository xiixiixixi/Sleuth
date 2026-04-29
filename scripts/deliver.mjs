#!/usr/bin/env node
// Unified file delivery script for sleuth.
// Provides a single consistent interface for saving deliverable files to the output
// directory and recording deliveries in the session log.

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { resolveOutputDir, ensureOutputDir, TYPE_SUBDIR_MAP } from './lib/output.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_LOGGER = path.join(ROOT, 'scripts', 'session-logger.mjs');

// --- Utility functions ---

function getTypeSubdir(type) {
  return TYPE_SUBDIR_MAP[type] || null;
}

function deriveFilename(sourcePath, name) {
  const ext = path.extname(sourcePath);
  if (name) {
    return name + ext;
  }
  return path.basename(sourcePath);
}

function avoidCollision(targetPath) {
  if (!existsSync(targetPath)) return targetPath;

  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const baseWithoutExt = path.basename(targetPath, ext);

  const now = new Date();
  const ts =
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0') +
    String(now.getMilliseconds()).padStart(3, '0');

  return path.join(dir, `${baseWithoutExt}-${ts}${ext}`);
}

/**
 * Extract a domain-like hostname from a file path.
 * Looks for path segments matching hostname patterns (e.g. "example.com").
 */
function extractDomainFromPath(filePath) {
  const parts = filePath.split(path.sep);
  for (const part of parts) {
    if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(part)) {
      return part;
    }
  }
  return null;
}

// --- Action: save ---

function cmdSave(source, type, name, sid) {
  if (!source) {
    console.error('Error: --source is required for action "save"');
    process.exit(2);
  }

  // Validate source file exists
  if (!existsSync(source)) {
    console.error(`Error: source file not found: ${source}`);
    process.exit(1);
  }

  const outDir = resolveOutputDir(sid);
  const typeSubdir = getTypeSubdir(type);

  if (!typeSubdir && type) {
    console.warn(`Warning: unknown type "${type}", saving to output root`);
  }

  // Determine target directory
  let targetDir = outDir;
  if (typeSubdir) {
    targetDir = path.join(outDir, typeSubdir);
  }

  // Ensure target directory exists
  mkdirSync(targetDir, { recursive: true });

  // Derive filename and resolve collision
  const filename = deriveFilename(source, name);
  const targetPath = avoidCollision(path.join(targetDir, filename));

  // Copy file
  try {
    copyFileSync(source, targetPath);
  } catch (err) {
    console.error(`Error: failed to copy file: ${err.message}`);
    process.exit(1);
  }

  // Print absolute target path to stdout
  console.log(targetPath);

  // Optionally log delivery to session
  if (sid) {
    const domain = extractDomainFromPath(source);
    const op = JSON.stringify({
      type: 'deliver',
      content_type: type,
      file: targetPath,
      source: source,
      ...(domain && { domain }),
    });
    try {
      execFileSync(
        'node',
        [SESSION_LOGGER, '--action', 'log', '--sid', sid, '--operation', op],
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }
      );
    } catch (err) {
      console.warn(`Warning: session logging failed: ${err.message}`);
    }
  }
}

// --- Action: list ---

function cmdList(sid) {
  const outDir = resolveOutputDir(sid);

  if (!existsSync(outDir)) {
    console.log('(empty)');
    return;
  }

  const files = [];
  walk(outDir, outDir, files);

  if (files.length === 0) {
    console.log('(empty)');
  } else {
    for (const f of files) {
      console.log(f);
    }
  }
}

function walk(baseDir, currentDir, result) {
  let entries;
  try {
    entries = readdirSync(currentDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry);
    let st;
    try {
      st = statSync(fullPath);
    } catch {
      continue;
    }

    if (st.isSymbolicLink()) continue;

    if (st.isDirectory()) {
      walk(baseDir, fullPath, result);
    } else if (st.isFile()) {
      result.push(path.relative(baseDir, fullPath));
    }
  }
}

// --- Action: init ---

function cmdInit(sid) {
  const outDir = resolveOutputDir(sid);
  ensureOutputDir(outDir);
  console.log(outDir);
}

// --- Main ---

async function main() {
  const { values } = parseArgs({
    options: {
      action: { type: 'string' },
      type: { type: 'string' },
      source: { type: 'string' },
      name: { type: 'string' },
      sid: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log('Usage: node deliver.mjs --action <save|list|init> [options]');
    console.log('  --action save   --source <path> [--type <type>] [--name <name>] [--sid <id>]');
    console.log('  --action list   [--sid <id>]');
    console.log('  --action init   [--sid <id>]');
    console.log('');
    console.log('Content types: ' + Object.keys(TYPE_SUBDIR_MAP).join(', '));
    return;
  }

  if (!values.action) {
    console.error('Error: --action is required. Must be save, list, or init.');
    process.exit(2);
  }

  switch (values.action) {
    case 'save':
      cmdSave(values.source, values.type, values.name, values.sid);
      break;
    case 'list':
      cmdList(values.sid);
      break;
    case 'init':
      cmdInit(values.sid);
      break;
    default:
      console.error(`Error: unknown action "${values.action}". Must be save, list, or init.`);
      process.exit(2);
  }
}

main();
