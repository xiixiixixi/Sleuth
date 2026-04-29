// Shared output-directory resolution for sleuth scripts.
// Used by both check-deps.mjs and deliver.mjs to avoid duplication.

import { accessSync, mkdirSync } from 'node:fs';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const TYPE_SUBDIR_MAP = {
  screenshot: 'screenshots',
  image: 'images',
  doc: 'docs',
  transcript: 'transcripts',
  data: 'data',
  page: 'pages',
  trace: 'traces',
  recording: 'recordings',
};

/**
 * Resolve the output directory for deliverables.
 *
 * With sessionId: {base}/sleuth-output/<YYYY-MM-DD>/<sessionId>/
 * Without:        {base}/sleuth-output/<YYYY-MM-DD>/
 *
 * Falls back to ~/.sleuth/output/... if CWD is not writable.
 * cleanup-output.mjs prunes date directories older than N days.
 *
 * @param {string} [sessionId] - Optional session ID for per-session isolation.
 * @returns {string} Absolute path to the output directory.
 */
export function resolveOutputDir(sessionId) {
  const datePart = new Date().toISOString().slice(0, 10);

  const cwd = process.cwd();
  let base;
  if (cwd === '/' || cwd === path.resolve('/')) {
    base = path.join(homedir(), '.sleuth', 'output');
  } else {
    try {
      accessSync(cwd, constants.W_OK);
      base = path.join(cwd, 'sleuth-output');
    } catch {
      base = path.join(homedir(), '.sleuth', 'output');
    }
  }

  return sessionId
    ? path.join(base, datePart, sessionId)
    : path.join(base, datePart);
}

/**
 * Create the output directory and all subdirectories.
 *
 * @param {string} outDir - Absolute path to the output directory.
 */
export function ensureOutputDir(outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const subdir of Object.values(TYPE_SUBDIR_MAP)) {
    mkdirSync(path.join(outDir, subdir), { recursive: true });
  }
}

export { TYPE_SUBDIR_MAP };
