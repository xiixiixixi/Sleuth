import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DELIVER = fileURLToPath(new URL('../deliver.mjs', import.meta.url));
const SID = 'test-deliver-download-0001';
// 1x1 透明 PNG（data: URL，Node fetch 原生支持，无需联网）
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

function dayDir() {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return join(homedir(), '.sleuth', 'output', day, SID);
}

afterEach(() => {
  try { rmSync(dayDir(), { recursive: true, force: true }); } catch {}
});

test('deliver --download fetches an image URL and archives it under images/', () => {
  const out = execFileSync(
    'node',
    [DELIVER, '--action', 'save', '--type', 'image', '--download', '--url', PNG, '--name', 'shot', '--sid', SID],
    { encoding: 'utf8' }
  ).trim();
  assert.ok(existsSync(out), `saved file should exist: ${out}`);
  const imagesDir = join(dayDir(), 'images');
  assert.ok(
    existsSync(imagesDir) && readdirSync(imagesDir).some((f) => f.startsWith('shot')),
    'image should be archived under images/'
  );
});
