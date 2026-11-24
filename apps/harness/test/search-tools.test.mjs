import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { globToRegExp, searchTools } from '../dist-electron/search-tools.js';

test('glob finds matching files, ignores .git/node_modules/dist*, and blocks path escape', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-search-glob-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'src', 'nested'), { recursive: true });
  await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
  await mkdir(join(dir, '.git', 'objects'), { recursive: true });
  await mkdir(join(dir, 'dist-web'), { recursive: true });
  await writeFile(join(dir, 'src', 'index.ts'), 'export const a = 1;\n');
  await writeFile(join(dir, 'src', 'nested', 'helper.tsx'), 'export const B = () => null;\n');
  await writeFile(join(dir, 'README.md'), '# Demo\n');
  await writeFile(join(dir, 'node_modules', 'pkg', 'ignored.ts'), 'export {};\n');
  await writeFile(join(dir, '.git', 'objects', 'ignored.ts'), 'export {};\n');
  await writeFile(join(dir, 'dist-web', 'ignored.ts'), 'export {};\n');

  const tools = searchTools(dir, new AbortController().signal).tools;
  const run = (name, input) => tools.find(tool => tool.name === name).execute(input, {}, {});

  const res = await run('glob', { pattern: '**/*.{ts,tsx}' });
  assert.deepEqual(res.details.matches, ['src/index.ts', 'src/nested/helper.tsx']);
  assert.equal(res.details.truncated, false);

  const sub = await run('glob', { pattern: '*.tsx', path: 'src/nested' });
  assert.deepEqual(sub.details.matches, ['src/nested/helper.tsx']);

  await assert.rejects(run('glob', { pattern: '**/*', path: '../outside' }), /workspace/);
  if (process.platform !== 'win32') {
    await symlink(tmpdir(), join(dir, 'escape-link'));
    await assert.rejects(run('glob', { pattern: '*', path: 'escape-link' }), /symbolic links/);
  }
  assert.equal(globToRegExp('**/*.ts').test('a/b/c.ts'), true);
  assert.equal(globToRegExp('src/*.ts').test('src/a/b.ts'), false);
});

test('grep searches text/regex with line numbers, supports literal & glob filters, and skips binaries', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-search-grep-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, 'node_modules'), { recursive: true });
  await writeFile(join(dir, 'src', 'app.ts'), 'const alpha = 1;\nconst beta = "hello [world]";\nconst ALPHA = 2;\n');
  await writeFile(join(dir, 'src', 'notes.md'), 'alpha in markdown\n');
  await writeFile(join(dir, 'node_modules', 'dep.ts'), 'alpha in node_modules\n');
  await writeFile(join(dir, 'src', 'binary.bin'), Buffer.from([0x61, 0x6c, 0x70, 0x68, 0x61, 0x00, 0x01]));

  const tools = searchTools(dir, new AbortController().signal).tools;
  const grep = input => tools.find(tool => tool.name === 'grep').execute(input, {}, {});

  const regexHit = await grep({ pattern: 'alpha', ignoreCase: true, glob: '**/*.ts' });
  assert.equal(regexHit.details.count, 2);
  assert.match(regexHit.output[0].text, /src\/app\.ts:1: const alpha = 1;/);
  assert.match(regexHit.output[0].text, /src\/app\.ts:3: const ALPHA = 2;/);
  assert.ok(!regexHit.output[0].text.includes('node_modules'));
  assert.ok(!regexHit.output[0].text.includes('binary.bin'));

  const literalHit = await grep({ pattern: '[world]', literal: true });
  assert.equal(literalHit.details.count, 1);
  assert.match(literalHit.output[0].text, /src\/app\.ts:2:/);

  await assert.rejects(grep({ pattern: '[unterminated' }), /Invalid search pattern/);
});

test('web_fetch enforces protocol, private host blocks, and byte caps', async () => {
  const seen = [];
  const fetchImpl = async url => {
    seen.push(url);
    const body = new TextEncoder().encode('Hello '.repeat(500));
    return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });
  };
  const tools = searchTools(tmpdir(), new AbortController().signal, { fetchImpl }).tools;
  const webFetch = input => tools.find(tool => tool.name === 'web_fetch').execute(input, {}, {});

  await assert.rejects(webFetch({ url: 'file:///etc/passwd' }), /http:\/\/ and https:\/\//);
  await assert.rejects(webFetch({ url: 'https://user:pass@example.com/' }), /credentials/);
  await assert.rejects(webFetch({ url: 'http://127.0.0.1:8080/secret' }), /local or private/);
  await assert.rejects(webFetch({ url: 'http://169.254.169.254/latest/meta-data/' }), /local or private/);

  const res = await webFetch({ url: 'https://example.com/doc.txt', maxBytes: 1024 });
  const parsed = JSON.parse(res.output[0].text);
  assert.equal(parsed.status, 200);
  assert.equal(parsed.bytesRead, 1024);
  assert.equal(parsed.truncated, true);
  assert.equal(seen[0], 'https://example.com/doc.txt');
});
