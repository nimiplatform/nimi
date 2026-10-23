import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { PNG } from 'pngjs';
import { encodeMacIcon, encodeWindowsIcon, prepareElectronIcons, readAppIcon } from '../lib/app-icons.mjs';
import { buildAppScaffoldSnapshot } from '../lib/app-scaffold.mjs';

const versions = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).nimiScaffoldVersions;
function artwork(size = 256) {
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    png.data[i] = x < size / 2 ? 240 : 20;
    png.data[i + 1] = y < size / 2 ? 80 : 200;
    png.data[i + 2] = 60;
    png.data[i + 3] = x < size / 2 ? 255 : 0;
  }
  return PNG.sync.write(png);
}

test('native icon containers carry decodable artwork at each declared resolution', () => {
  const bytes = artwork();
  const ico = encodeWindowsIcon(bytes);
  assert.equal(ico.readUInt16LE(2), 1);
  const count = ico.readUInt16LE(4);
  assert.equal(count, 9);
  let end = 6 + count * 16;
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    const size = ico[entry] || 256;
    assert.equal(ico.readUInt32LE(entry + 12), end);
    const length = ico.readUInt32LE(entry + 8);
    const png = PNG.sync.read(ico.subarray(end, end + length), { checkCRC: true });
    assert.equal(png.width, size);
    assert.equal(png.height, size);
    assert.deepEqual([...png.data.subarray(0, 4)], [240, 80, 60, 255]);
    assert.equal(png.data[(size - 1) * 4 + 3], 0);
    end += length;
  }
  assert.equal(end, ico.length);
  assert.deepEqual(encodeWindowsIcon(bytes), ico, 'conversion is deterministic');
  const icns = encodeMacIcon(bytes);
  assert.equal(icns.toString('ascii', 0, 4), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  let offset = 8;
  for (const [type, size] of [['ic07', 128], ['ic08', 256]]) {
    assert.equal(icns.toString('ascii', offset, offset + 4), type);
    const length = icns.readUInt32BE(offset + 4);
    const png = PNG.sync.read(icns.subarray(offset + 8, offset + length), { checkCRC: true });
    assert.equal(png.width, size);
    assert.deepEqual([...png.data.subarray(0, 4)], [240, 80, 60, 255]);
    offset += length;
  }
  assert.equal(offset, icns.length);
});

test('custom metadata paths drive all outputs; removed and invalid artwork cannot reuse stale icons', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nimi-icons-'));
  try {
    mkdirSync(path.join(root, 'artwork'));
    writeFileSync(path.join(root, 'nimi.app.yaml'), 'metadata:\n  icon: artwork/自定义 mark.png\n');
    const file = path.join(root, 'artwork', '自定义 mark.png');
    writeFileSync(file, artwork(200));
    const icons = prepareElectronIcons(root, { required: true });
    assert.deepEqual(readFileSync(icons.png), readFileSync(file));
    assert.ok(existsSync(icons.ico) && existsSync(icons.icns));
    writeFileSync(file, 'not PNG');
    assert.throws(() => prepareElectronIcons(root), /PNG/);
    for (const icon of Object.values(icons)) assert.equal(existsSync(icon), false);
    rmSync(file);
    assert.equal(prepareElectronIcons(root), null);
    assert.throws(() => prepareElectronIcons(root, { required: true }), /metadata.icon resource is missing/);
    for (const relative of ['../escape.png', '/absolute.png', 'C:/escape.png', 'artwork\\mark.png']) {
      writeFileSync(path.join(root, 'nimi.app.yaml'), `metadata:\n  icon: '${relative}'\n`);
      assert.throws(() => readAppIcon(root), /App-relative/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

async function runGeneratedHost(appId, production, platform, hasIcon = true) {
  const snapshot = buildAppScaffoldSnapshot({ profile: 'standalone', versions, appId, appTitle: appId, packageName: appId.replaceAll('.', '-') });
  const source = stripTypeScriptTypes(snapshot.filesByPath.get('src-electron/main.ts').content, { mode: 'strip' })
    .replace(/^import .+ from '[^']+';$/gm, '')
    .replace("await import('@nimiplatform/kit/shell/electron/main')", 'kitMain')
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(os.tmpdir(), appId, 'dist-electron', 'main.js')).href));
  const output = { identities: [], windows: [], dock: [] };
  class Window {
    constructor(options) { output.windows.push(options); this.webContents = { setWindowOpenHandler() {}, on() {} }; }
    async loadURL() {}
  }
  await vm.runInNewContext(`(async () => {${source}})()`, {
    __NIMI_ELECTRON_PRODUCTION__: production,
    path, pathToFileURL, fileURLToPath, existsSync: () => hasIcon,
    app: { setName() {}, setAppUserModelId(id) { output.identities.push(id); }, whenReady: async () => {}, on() {},
      ...(platform === 'darwin' ? { dock: { setIcon(icon) { output.dock.push(icon); } } } : {}) },
    BrowserWindow: Window, ipcMain: {}, Menu: {}, protocol: {}, session: { defaultSession: { webRequest: {} } }, webContents: {},
    configureNimiElectronAppHostProfile() {}, process: { platform, argv: [] },
    kitMain: {
      createNimiElectronAppChromeHost() { return { bindWindow() {} }; }, createNimiElectronAppChromeWindowOptions() { return {}; },
      registerNimiElectronAppAssetProtocolScheme() {}, registerNimiElectronAppBridge() {}, isAllowedElectronRendererUrl() {},
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  return output;
}

test('generated Hosts isolate App and development identities while selecting packaged native icons', async () => {
  const identities = new Set();
  for (const appId of ['test.icon-one', 'test.icon-one.dev']) for (const production of [false, true]) {
    const result = await runGeneratedHost(appId, production, 'win32');
    const id = `ai.nimi.${production ? '' : 'dev.'}apps.${appId}`;
    assert.deepEqual(result.identities, [id]);
    identities.add(id);
    assert.equal(result.windows.length, 1);
    assert.equal(result.windows[0].icon, path.join(os.tmpdir(), appId, 'dist-electron', 'app-icon.ico'));
  }
  assert.equal(identities.size, 4);
  for (const production of [false, true]) {
    const mac = await runGeneratedHost('test.icon-one', production, 'darwin');
    assert.equal(mac.identities.length, 0);
    assert.deepEqual(mac.dock, [path.join(os.tmpdir(), 'test.icon-one', 'dist-electron', 'app-icon.png')]);
  }
  assert.equal((await runGeneratedHost('test.icon-one', false, 'win32', false)).windows[0].icon, undefined);
  await assert.rejects(runGeneratedHost('test.icon-one', true, 'win32', false), /Packaged App icon is missing/);
});

test('scaffold owns the icon pipeline and production packaging includes its resources', () => {
  const snapshot = buildAppScaffoldSnapshot({ profile: 'standalone', versions, appId: 'test.icons', appTitle: 'Icons', packageName: 'test-icons' });
  assert.equal(snapshot.filesByPath.get('scripts/app-icons.mjs').content, readFileSync(new URL('../lib/app-icons.mjs', import.meta.url), 'utf8'));
  const pkg = JSON.parse(snapshot.filesByPath.get('package.json').content);
  assert.equal(pkg.devDependencies.pngjs, versions.pngjsVersion);
  const bundler = snapshot.filesByPath.get('scripts/bundle-electron-preload.mjs').content;
  assert.match(bundler, /prepareElectronIcons\(appRoot\)/);
  const packager = snapshot.filesByPath.get('scripts/package-electron-production.mjs').content;
  assert.match(packager, /prepareElectronIcons\(appRoot, \{ required: true \}\)/);
  assert.match(packager, /copyFile\(icons.png, path.join\(productionSourceRoot, 'dist-electron', 'app-icon.png'\)\)/);
  assert.match(packager, /copyFile\(icons.ico, path.join\(productionSourceRoot, 'dist-electron', 'app-icon.ico'\)\)/);
  assert.match(packager, /icon: MACOS_BUILD \? icons.icns : icons.ico/);
});
