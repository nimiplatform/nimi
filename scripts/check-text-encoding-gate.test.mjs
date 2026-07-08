import assert from 'node:assert/strict';
import test from 'node:test';

import {
  scanBuffer,
  scanFileRecords,
  shouldScanRepoPath,
} from './lib/text-encoding-gate.mjs';

function utf8(text) {
  return Buffer.from(text, 'utf8');
}

function ruleIds(result) {
  return result.violations.map((violation) => violation.ruleId);
}

test('normal Chinese UTF-8 text passes', () => {
  const result = scanBuffer({
    relativePath: 'docs/zh/sample.md',
    buffer: utf8('\u4e2d\u6587\u5185\u5bb9\u6b63\u5e38\uff0c\u4e0d\u5e94\u8be5\u89e6\u53d1\u4e71\u7801\u95e8\u7981\u3002'),
  });

  assert.deepEqual(result.violations, []);
});

test('invalid UTF-8 byte sequences fail closed', () => {
  const result = scanBuffer({
    relativePath: 'apps/desktop/src/broken.ts',
    buffer: Buffer.from([0xe4, 0xb8]),
  });

  assert.deepEqual(ruleIds(result), ['invalid_utf8']);
});

test('common mojibake and replacement patterns fail closed', () => {
  const cases = [
    { text: 'bad \uFFFD text', ruleId: 'replacement_character' },
    { text: 'bad \u951f\u65a4\u62f7 text', ruleId: 'mojibake_gbk_replacement' },
    { text: 'bad \u9225? dash', ruleId: 'mojibake_windows_punctuation' },
    { text: 'bad \u7f01\u56e9\u7a98 title', ruleId: 'mojibake_utf8_as_gbk' },
  ];

  for (const entry of cases) {
    const result = scanBuffer({
      relativePath: `apps/desktop/src/${entry.ruleId}.ts`,
      buffer: utf8(entry.text),
    });
    assert.deepEqual(ruleIds(result), [entry.ruleId], entry.ruleId);
  }
});

test('allowlist only exempts the specified path, rule, value, and line shape', () => {
  const allowlist = [{
    path: 'apps/zhiyu/test/e2e/electron-acceptance.test.mjs',
    ruleId: 'mojibake_utf8_as_gbk',
    value: '\u7f01\u56e9\u7a98',
    lineIncludes: 'assert.doesNotMatch',
    reason: 'Negative acceptance assertion intentionally includes mojibake token.',
  }];

  const allowed = scanBuffer({
    relativePath: 'apps/zhiyu/test/e2e/electron-acceptance.test.mjs',
    buffer: utf8('assert.doesNotMatch(unavailableText, /\u7f01\u56e9\u7a98/);'),
    allowlist,
  });
  assert.deepEqual(allowed.violations, []);

  const sameFileDifferentToken = scanBuffer({
    relativePath: 'apps/zhiyu/test/e2e/electron-acceptance.test.mjs',
    buffer: utf8('assert.doesNotMatch(unavailableText, /\u7f02\u4f78\u6d28/);'),
    allowlist,
  });
  assert.deepEqual(ruleIds(sameFileDifferentToken), ['mojibake_utf8_as_gbk']);

  const sameTokenDifferentLineShape = scanBuffer({
    relativePath: 'apps/zhiyu/test/e2e/electron-acceptance.test.mjs',
    buffer: utf8('const leaked = "\u7f01\u56e9\u7a98";'),
    allowlist,
  });
  assert.deepEqual(ruleIds(sameTokenDifferentLineShape), ['mojibake_utf8_as_gbk']);
});

test('stale allowlist entries fail in full-scan validation', () => {
  const result = scanFileRecords([{
    relativePath: 'apps/zhiyu/test/e2e/electron-acceptance.test.mjs',
    buffer: utf8('assert.equal(text, "clean");'),
  }], {
    allowlist: [{
      path: 'apps/zhiyu/test/e2e/electron-acceptance.test.mjs',
      ruleId: 'mojibake_utf8_as_gbk',
      value: '\u7f01\u56e9\u7a98',
      lineIncludes: 'assert.doesNotMatch',
      reason: 'Negative acceptance assertion intentionally includes mojibake token.',
    }],
    enforceAllowlistCoverage: true,
  });

  assert.deepEqual(ruleIds(result), ['stale_allowlist']);
});

test('scan scope skips generated, archive, lockfile, and binary-shaped paths', () => {
  assert.equal(shouldScanRepoPath('apps/desktop/src/App.tsx'), true);
  assert.equal(shouldScanRepoPath('docs/zh/index.md'), true);
  assert.equal(shouldScanRepoPath('archive/old.md'), false);
  assert.equal(shouldScanRepoPath('apps/desktop/src/generated/client.ts'), false);
  assert.equal(shouldScanRepoPath('pnpm-lock.yaml'), false);
  assert.equal(shouldScanRepoPath('apps/desktop/src-tauri/icons/icon.png'), false);
});
