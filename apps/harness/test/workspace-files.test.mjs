import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rename, writeFile, truncate, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { copyMaterial, listWorkspace, previewWorkspaceFile, resultReference } from '../dist-electron/workspace-files.js';

test('image preview returns only the selected original bytes and keeps larger files accessible in their folder', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-picture-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const signal = new AbortController().signal;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ9kAAAAASUVORK5CYII=', 'base64');
  const item = await copyMaterial(dir, 'card.PNG', png, signal);
  const preview = await previewWorkspaceFile(dir, item.ref, signal);
  assert.equal(preview.format, 'image');
  assert.equal(preview.mimeType, 'image/png');
  assert.deepEqual(Buffer.from(preview.bytes), png);
  await truncate(join(dir, item.ref), 32 * 1024 * 1024 + 1);
  const large = await previewWorkspaceFile(dir, item.ref, signal);
  assert.equal(large.format, 'file');
  assert.match(large.message, /32 MiB/);
  assert.ok(!('bytes' in large));
});

test('paged text previews preserve UTF-8 at both boundaries and follow a shortened file', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-preview-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const signal = new AbortController().signal;
  const block = 128 * 1024;
  const content = 'a'.repeat(block - 1) + '春' + 'b'.repeat(block - 3) + '🌿' + '核签';
  const path = join(dir, 'report.md');
  await writeFile(path, content);
  const pages = await Promise.all([0, 1, 2].map(page => previewWorkspaceFile(dir, 'report.md', signal, page)));
  assert.ok(pages.every((p, i) => p.pages === 3 && p.page === i && p.format === 'text'));
  assert.equal(pages.map(p => p.content).join(''), content);
  await writeFile(path, 'a'.repeat(block - 1) + '春');
  assert.equal((await previewWorkspaceFile(dir, 'report.md', signal, 1)).content, '春');
  await writeFile(path, '# 已核签');
  const short = await previewWorkspaceFile(dir, 'report.md', signal, 2);
  assert.equal(short.page, 0);
  assert.equal(short.format, 'markdown');
  assert.equal(short.content, '# 已核签');
  await assert.rejects(previewWorkspaceFile(dir, 'report.md', signal, -1), /Invalid preview page/);
});

test('file references resolve to actual session files; separate imports never replace one another', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-material-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const workspace = join(dir, 'session');
  const signal = new AbortController().signal;
  const [first, second] = await Promise.all(['first', 'second'].map(body => copyMaterial(workspace, 'brief.md', Buffer.from(body), signal)));
  assert.notEqual(first.ref, second.ref);
  assert.equal((await previewWorkspaceFile(workspace, first.ref, signal)).content, 'first');
  assert.equal((await previewWorkspaceFile(workspace, second.ref, signal)).content, 'second');
  await mkdir(join(workspace, 'outputs'));
  const target = join(workspace, 'outputs', '清单.md');
  await writeFile(target, '# draft');
  assert.equal(resultReference(workspace, target), 'outputs/清单.md');
  assert.equal(resultReference(workspace, '../outside'), undefined);
  await writeFile(target, '# revised');
  assert.equal((await previewWorkspaceFile(workspace, 'outputs/清单.md', signal)).content, '# revised');
  assert.ok((await listWorkspace(workspace, 'outputs', 0, signal)).items.some(item => item.ref === 'outputs/清单.md'));
  await assert.rejects(copyMaterial(workspace, '../bad.md', Buffer.from('bad'), signal));
  await assert.rejects(previewWorkspaceFile(workspace, '../other', signal));
  if (process.platform !== 'win32') {
    await symlink(dir, join(workspace, 'shortcut'));
    await assert.rejects(listWorkspace(workspace, 'shortcut', 0, signal));
  }
});

test('Desktop renderer file projection uses the native directory and range-read contracts', { skip: !['win32', 'darwin'].includes(process.platform) }, async t => {
  const { createNimiElectronHarnessSecurityHost } = await import('@nimiplatform/kit/shell/electron/main');
  const library = process.platform === 'darwin' ? 'libnimi_shell_protected_local_node.dylib' : 'nimi_shell_protected_local_node.dll';
  const addon = { exports: {} };
  process.dlopen(addon, fileURLToPath(new URL(`../../../kit/shell/protected-local-node/target/debug/${library}`, import.meta.url)));
  const host = createNimiElectronHarnessSecurityHost({ injectedBinding: addon.exports });
  const root = await mkdtemp(join(tmpdir(), 'nimi-native-preview-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const signal = new AbortController().signal;
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  await writeFile(join(root, 'asset.png'), image);
  await writeFile(join(root, '.env'), 'test fixture');
  const listing = await listWorkspace(root, '', 0, signal, host);
  assert.deepEqual(listing.items.map(item => item.ref), ['asset.png']);
  const preview = await previewWorkspaceFile(root, 'asset.png', signal, 0, host);
  assert.equal(preview.format, 'image');
  assert.deepEqual(Buffer.from(preview.bytes), image);
  // A user can save a same-size replacement between selection and preview.
  const replacingHost = {
    ...host,
    async secureReadFile(input) {
      await rename(join(root, 'asset.png'), join(root, 'previous.png'));
      await writeFile(join(root, 'asset.png'), image);
      return host.secureReadFile(input);
    },
  };
  await assert.rejects(previewWorkspaceFile(root, 'asset.png', signal, 0, replacingHost), /file changed/i);
});
