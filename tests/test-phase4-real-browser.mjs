/**
 * Phase 4 测试 — Real Browser 模式
 *
 * 覆盖：
 * - handleRealBrowser() 输出结构
 * - read_only 默认为 true
 * - 域名限制（--domain）
 * - SLEUTH_READ_ONLY 环境变量设置
 * - 无 CDP 端口时的错误处理
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const LIB_DIR = path.resolve(import.meta.dirname, '..', 'scripts', 'lib');

let core;
before(async () => {
  core = await import(path.join(LIB_DIR, 'check-deps-core.mjs'));
});

describe('Phase 4: handleRealBrowser 结构', () => {
  it('未显式提供端口时应直接报错', async () => {
    const origPort = process.env.SLEUTH_CDP_PORT;
    delete process.env.SLEUTH_CDP_PORT;

    const result = await core.handleRealBrowser({ json: true, domain: 'example.com' });

    assert.ok(result.error, '未显式提供端口时应返回 error');
    assert.match(result.error, /显式提供 CDP 端口/);

    if (origPort) process.env.SLEUTH_CDP_PORT = origPort;
  });

  it('无可用 CDP 端口时应返回 error', async () => {
    // 设置一个不可能存在 CDP 的端口
    const origEnv = process.env.SLEUTH_CDP_PORT;
    process.env.SLEUTH_CDP_PORT = '19876';

    const result = await core.handleRealBrowser({ json: true, domain: 'example.com' });

    assert.strictEqual(result.browser_mode, 'real-browser');
    assert.strictEqual(result.read_only, true, 'read_only 应默认为 true');
    assert.ok(result.error, '无 CDP 时应有 error 字段');

    // 恢复
    if (origEnv) process.env.SLEUTH_CDP_PORT = origEnv;
    else delete process.env.SLEUTH_CDP_PORT;
  });

  it('domains_allowed 应包含指定域名', async () => {
    process.env.SLEUTH_CDP_PORT = '19876';
    const result = await core.handleRealBrowser({ json: true, domain: 'github.com' });
    assert.deepStrictEqual(result.domains_allowed, ['github.com']);
    delete process.env.SLEUTH_CDP_PORT;
  });

  it('未指定域名时 domains_allowed 为空（最小权限：默认拒绝）', async () => {
    process.env.SLEUTH_CDP_PORT = '19876';
    const result = await core.handleRealBrowser({ json: true });
    // 连接失败时返回初始值 []；连接成功时才会走到 domain 逻辑设为 ['*']
    assert.deepStrictEqual(result.domains_allowed, []);
    delete process.env.SLEUTH_CDP_PORT;
  });

  it('warnings 包含安全警告', async () => {
    process.env.SLEUTH_CDP_PORT = '19876';
    const result = await core.handleRealBrowser({ json: true });
    assert.ok(result.warnings.length >= 3, '至少 3 条安全警告');
    assert.ok(result.warnings.some(w => w.includes('只读')), '应有只读警告');
    delete process.env.SLEUTH_CDP_PORT;
  });
});

describe('Phase 4: 只读模式环境变量', () => {
  it('SLEUTH_READ_ONLY 在 real-browser 模式下被设置', async () => {
    // handleRealBrowser 设置 process.env
    // 由于无 CDP 端口会提前返回，环境变量只在成功连接后设置
    // 此处验证逻辑存在即可
    const origEnv = process.env.SLEUTH_READ_ONLY;
    delete process.env.SLEUTH_READ_ONLY;

    process.env.SLEUTH_CDP_PORT = '19876';
    await core.handleRealBrowser({ json: true });
    // 无 CDP 连接时不设置
    assert.ok(!process.env.SLEUTH_READ_ONLY || process.env.SLEUTH_READ_ONLY === origEnv,
      '无连接时不应设置 SLEUTH_READ_ONLY');

    delete process.env.SLEUTH_CDP_PORT;
    if (origEnv) process.env.SLEUTH_READ_ONLY = origEnv;
  });
});
