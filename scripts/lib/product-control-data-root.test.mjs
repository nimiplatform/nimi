import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  deriveNimiDataPaths,
  productControlRecordPath,
  productControlRecordPathForTest,
  resolveProductControlDataRoot,
  resolveProductControlDataRootForTest,
} from './product-control-data-root.mjs';

function withRawProductControl(raw, run) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-product-control-'));
  const controlPath = productControlRecordPathForTest({ verifiedProfileDir: homeDir });
  fs.mkdirSync(path.dirname(controlPath), { recursive: true });
  fs.writeFileSync(controlPath, raw);
  try {
    run({ homeDir, controlPath });
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

function withProductControl(value, run) {
  withRawProductControl(JSON.stringify(value), run);
}

function cloneRecord(value) {
  return structuredClone(value);
}

function renderSharedRawVector(fixture, vector, dataRoot, volumeRoot) {
  if (vector.rawHex) return Buffer.from(vector.rawHex, 'hex');
  if (vector.repeatHex) {
    return Buffer.alloc(vector.repeatCount, Number.parseInt(vector.repeatHex, 16));
  }
  let raw = fixture.baseRaw[vector.base];
  assert.equal(typeof raw, 'string', `shared vector ${vector.name} base`);
  for (const [from, to] of vector.replace ?? []) {
    const first = raw.indexOf(from);
    assert.notEqual(first, -1, `shared vector ${vector.name} replacement source`);
    assert.equal(
      raw.indexOf(from, first + from.length),
      -1,
      `shared vector ${vector.name} replacement must be unique`,
    );
    raw = `${raw.slice(0, first)}${to}${raw.slice(first + from.length)}`;
  }
  const placeholderValue = vector.dataRootLiteral
    ?? (vector.dataRootPlaceholder === 'volumeRoot' ? volumeRoot : dataRoot);
  raw = raw.split('"__DATA_ROOT__"').join(JSON.stringify(placeholderValue));
  const chunks = [];
  if (vector.prefixHex) chunks.push(Buffer.from(vector.prefixHex, 'hex'));
  chunks.push(Buffer.from(raw, 'utf8'));
  if (vector.suffixUtf8) chunks.push(Buffer.from(vector.suffixUtf8, 'utf8'));
  return Buffer.concat(chunks);
}

function assertRecordRejected(value, label) {
  withProductControl(value, ({ homeDir }) => {
    assert.throws(
      () => resolveProductControlDataRootForTest({ verifiedProfileDir: homeDir }),
      /Product Control/u,
      label,
    );
  });
}

function record(dataRoot, overrides = {}) {
  return {
    schemaVersion: 1,
    installId: 'local-test',
    productVersion: '0.0.0-test',
    state: 'data_root_selected',
    dataRoot: {
      path: dataRoot,
      status: 'selected',
      selectedAt: '2026-07-26T00:00:00.000Z',
      verifiedAt: '2026-07-26T00:00:01.000Z',
      selectedAtUnixMs: 1,
      verifiedAtUnixMs: 2,
    },
    firstRun: {
      installLevel: null,
      aiProfileAlias: null,
      completed: false,
      completedAt: null,
    },
    pointers: { factoryProfileIndex: null },
    repair: { required: false, reason: null },
    ...overrides,
  };
}

function readyRecord(dataRoot) {
  return record(dataRoot, {
    state: 'ready_for_use',
    dataRoot: {
      path: dataRoot,
      status: 'ready',
      selectedAt: '2026-07-26T00:00:00.000Z',
      verifiedAt: '2026-07-26T00:00:01.000Z',
      selectedAtUnixMs: 1,
      verifiedAtUnixMs: 2,
    },
    firstRun: {
      installLevel: 'minimal',
      aiProfileAlias: 'local-default',
      completed: true,
      completedAt: '2026-07-26T00:00:02.000Z',
    },
  });
}

test('fixed Product Control path resolves selected and ready dataRoot.path', () => {
  const selectedRoot = path.join(os.tmpdir(), 'NimiDataSelected');
  withProductControl(record(selectedRoot), ({ homeDir }) => {
    assert.equal(resolveProductControlDataRootForTest({ verifiedProfileDir: homeDir }), selectedRoot);
  });

  const readyRoot = path.join(os.tmpdir(), 'NimiDataReady');
  withProductControl(readyRecord(readyRoot), ({ homeDir }) => {
    assert.equal(resolveProductControlDataRootForTest({ verifiedProfileDir: homeDir }), readyRoot);
  });
});

test('resolver fails closed for repair, relative paths, and inconsistent ready state', () => {
  const absolute = path.join(os.tmpdir(), 'NimiData');
  for (const invalid of [
    record(absolute, { state: 'repair_required' }),
    record(absolute, { state: 'data_root_missing' }),
    record(absolute, { state: 'invented_state' }),
    record('relative/NimiData'),
    record(absolute, {
      state: 'ready_for_use',
      dataRoot: {
        path: absolute,
        status: 'selected',
        selectedAt: '2026-07-26T00:00:00.000Z',
        verifiedAt: '2026-07-26T00:00:01.000Z',
        selectedAtUnixMs: 1,
        verifiedAtUnixMs: 2,
      },
    }),
  ]) {
    withProductControl(invalid, ({ homeDir }) => {
      assert.throws(
        () => resolveProductControlDataRootForTest({ verifiedProfileDir: homeDir }),
        /Product Control/u,
      );
    });
  }
});

test('resolver rejects stale Product Control fields and incomplete records', () => {
  const absolute = path.join(os.tmpdir(), 'NimiData');
  for (const invalid of [
    {
      schemaVersion: 1,
      state: 'data_root_selected',
      dataRoot: { path: absolute, status: 'selected' },
    },
    record(absolute, {
      pointers: {
        factoryProfileIndex: null,
        runtimeConfigPath: 'C:\\ProgramData\\Nimi\\Runtime\\Protected\\runtime\\config.json',
      },
    }),
  ]) {
    withProductControl(invalid, ({ homeDir }) => {
      assert.throws(
        () => resolveProductControlDataRootForTest({ verifiedProfileDir: homeDir }),
        /Product Control/u,
      );
    });
  }
});

test('production locator ignores ambient HOME and USERPROFILE poisoning', () => {
  const fakeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-product-control-poison-'));
  const attackerRoot = path.join(fakeProfile, 'attacker-data');
  const controlDir = path.join(fakeProfile, '.nimi');
  fs.mkdirSync(controlDir);
  fs.writeFileSync(
    path.join(controlDir, 'nimi.json'),
    JSON.stringify(record(attackerRoot)),
    'utf8',
  );
  const dotenvPath = path.join(fakeProfile, '.env');
  fs.writeFileSync(
    dotenvPath,
    [
      `HOME=${fakeProfile}`,
      `USERPROFILE=${fakeProfile}`,
      `NIMI_DATA_ROOT=${attackerRoot}`,
      `NIMI_APP_DATA_ROOT=${attackerRoot}`,
    ].join('\n'),
    'utf8',
  );
  const moduleURL = new URL('./product-control-data-root.mjs', import.meta.url).href;
  const probe = [
    "import os from 'node:os';",
    "import path from 'node:path';",
    `import { productControlRecordPath } from ${JSON.stringify(moduleURL)};`,
    "const expectedPath = path.join(os.userInfo().homedir, '.nimi', 'nimi.json');",
    'const actualPath = productControlRecordPath();',
    'if (actualPath !== expectedPath) {',
    '  process.stderr.write(`locator=${actualPath} expected=${expectedPath}`);',
    '  process.exit(42);',
    '}',
  ].join('\n');
  try {
    const child = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      probe,
      '--',
      '--product-root',
      attackerRoot,
      '--development-data-root',
      attackerRoot,
    ], {
      cwd: fakeProfile,
      env: {
        ...process.env,
        HOME: fakeProfile,
        USERPROFILE: fakeProfile,
        NIMI_PRODUCT_CONTROL_ROOT: controlDir,
        NIMI_FIRST_PARTY_PRODUCT_ROOT: attackerRoot,
        NIMI_DATA_ROOT: attackerRoot,
        NIMI_APP_DATA_ROOT: attackerRoot,
        DOTENV_CONFIG_PATH: dotenvPath,
      },
      encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
  } finally {
    fs.rmSync(fakeProfile, { recursive: true, force: true });
  }
});

test('production locator API rejects caller profile injection', () => {
  assert.throws(
    () => productControlRecordPath({ verifiedProfileDir: os.tmpdir() }),
    /does not accept profile overrides/u,
  );
  assert.throws(
    () => resolveProductControlDataRoot({ verifiedProfileDir: os.tmpdir() }),
    /does not accept locator overrides/u,
  );
});

test('shared raw-record vectors reject missing, null, wrong-type, and unknown fields', () => {
  const dataRoot = path.join(os.tmpdir(), 'NimiDataRawVectors');
  const selected = record(dataRoot);
  const malformed = [];
  const addMutation = (name, mutate) => {
    const value = cloneRecord(selected);
    mutate(value);
    malformed.push({ name, value });
  };

  for (const key of [
    'schemaVersion',
    'installId',
    'productVersion',
    'state',
    'dataRoot',
    'firstRun',
    'pointers',
    'repair',
  ]) {
    addMutation(`missing top-level ${key}`, (value) => {
      delete value[key];
    });
  }
  addMutation('missing dataRoot.path', (value) => {
    delete value.dataRoot.path;
  });
  addMutation('missing firstRun.completed', (value) => {
    delete value.firstRun.completed;
  });
  addMutation('missing pointers.factoryProfileIndex', (value) => {
    delete value.pointers.factoryProfileIndex;
  });
  addMutation('missing repair.required', (value) => {
    delete value.repair.required;
  });
  addMutation('one-element dataRoot.path array', (value) => {
    value.dataRoot.path = [dataRoot];
  });
  addMutation('null dataRoot.path', (value) => {
    value.dataRoot.path = null;
  });
  addMutation('object dataRoot.status', (value) => {
    value.dataRoot.status = {};
  });
  addMutation('array dataRoot.selectedAt', (value) => {
    value.dataRoot.selectedAt = [];
  });
  addMutation('string dataRoot.selectedAtUnixMs', (value) => {
    value.dataRoot.selectedAtUnixMs = '1';
  });
  addMutation('null dataRoot.verifiedAtUnixMs', (value) => {
    value.dataRoot.verifiedAtUnixMs = null;
  });
  addMutation('array firstRun.installLevel', (value) => {
    value.firstRun.installLevel = [];
  });
  addMutation('number firstRun.aiProfileAlias', (value) => {
    value.firstRun.aiProfileAlias = 1;
  });
  addMutation('null firstRun.completed', (value) => {
    value.firstRun.completed = null;
  });
  addMutation('object firstRun.completedAt', (value) => {
    value.firstRun.completedAt = {};
  });
  addMutation('number pointers.factoryProfileIndex', (value) => {
    value.pointers.factoryProfileIndex = 1;
  });
  addMutation('null repair.required', (value) => {
    value.repair.required = null;
  });
  addMutation('array repair.reason', (value) => {
    value.repair.reason = [];
  });
  addMutation('unknown top-level field', (value) => {
    value.alternateRoot = dataRoot;
  });
  addMutation('unknown nested field', (value) => {
    value.dataRoot.alternatePath = dataRoot;
  });

  for (const { name, value } of malformed) {
    assertRecordRejected(value, name);
  }
});

test('shared raw-record vectors reject size, UTF-8, BOM, and trailing payload violations', () => {
  const dataRoot = path.join(os.tmpdir(), 'NimiDataRawBytes');
  const raw = Buffer.from(JSON.stringify(record(dataRoot)), 'utf8');
  const malformed = [
    {
      name: 'oversize',
      raw: Buffer.alloc((64 * 1024) + 1, 0x20),
    },
    {
      name: 'invalid UTF-8',
      raw: Buffer.from([0xff]),
    },
    {
      name: 'UTF-8 BOM',
      raw: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), raw]),
    },
    {
      name: 'trailing JSON document',
      raw: Buffer.concat([raw, Buffer.from(' {}', 'utf8')]),
    },
    {
      name: 'trailing non-whitespace',
      raw: Buffer.concat([raw, Buffer.from(' x', 'utf8')]),
    },
  ];
  for (const testCase of malformed) {
    withRawProductControl(testCase.raw, ({ homeDir }) => {
      assert.throws(
        () => resolveProductControlDataRootForTest({ verifiedProfileDir: homeDir }),
        /Product Control/u,
        testCase.name,
      );
    });
  }
});

test('Node dispositions match every shared Product Control raw-byte vector', () => {
  const fixture = JSON.parse(fs.readFileSync(
    new URL('./product-control-raw-record-vectors.json', import.meta.url),
    'utf8',
  ));
  assert.equal(fixture.version, 1);
  const dataRoot = process.platform === 'win32'
    ? 'D:\\NimiSharedVectorData'
    : '/var/lib/nimi-shared-vector-data';
  const volumeRoot = process.platform === 'win32' ? 'D:\\' : '/';
  for (const vector of fixture.vectors) {
    if (vector.platform && vector.platform !== process.platform) continue;
    const raw = renderSharedRawVector(fixture, vector, dataRoot, volumeRoot);
    withRawProductControl(raw, ({ homeDir }) => {
      const resolve = () => resolveProductControlDataRootForTest({
        verifiedProfileDir: homeDir,
      });
      if (vector.disposition === 'accept') {
        assert.equal(
          resolve(),
          path.normalize(vector.dataRootLiteral ?? dataRoot),
          vector.name,
        );
      } else {
        assert.throws(resolve, /Product Control/u, vector.name);
      }
    });
  }
});

test('shared state/status vectors fail closed while selected and ready remain usable', () => {
  const dataRoot = path.join(os.tmpdir(), 'NimiDataStateVectors');
  const selected = record(dataRoot);
  const ready = readyRecord(dataRoot);
  for (const valid of [selected, ready]) {
    withProductControl(valid, ({ homeDir }) => {
      assert.equal(
        resolveProductControlDataRootForTest({ verifiedProfileDir: homeDir }),
        dataRoot,
      );
    });
  }

  const invalid = [
    record(dataRoot, {
      state: 'ready_for_use',
    }),
    record(dataRoot, {
      state: 'repair_required',
      repair: { required: false, reason: null },
    }),
    record(dataRoot, {
      dataRoot: {
        ...selected.dataRoot,
        status: 'repair_required',
      },
    }),
    record(dataRoot, {
      repair: { required: true, reason: 'repair' },
    }),
    record(dataRoot, {
      state: 'data_root_missing',
    }),
  ];
  for (const value of invalid) {
    assertRecordRejected(value);
  }
});

test('volume roots are rejected and ordinary absolute subdirectories are admitted', () => {
  const ordinaryPaths = process.platform === 'win32'
    ? [
        'D:\\DataNimi',
        '\\\\server\\share\\DataNimi',
        '\\\\?\\D:\\DataNimi',
        '\\\\?\\UNC\\server\\share\\DataNimi',
      ]
    : ['/var/lib/nimi-data'];
  for (const dataRoot of ordinaryPaths) {
    withProductControl(record(dataRoot), ({ homeDir }) => {
      assert.equal(
        resolveProductControlDataRootForTest({ verifiedProfileDir: homeDir }),
        path.normalize(dataRoot).replace(/[\\/]+$/u, ''),
      );
    });
  }

  const volumeRoots = process.platform === 'win32'
    ? [
        'D:\\',
        '\\\\server\\share\\',
        '\\\\?\\D:\\',
        '\\\\?\\UNC\\server\\share\\',
        '\\\\?\\Volume{00000000-0000-0000-0000-000000000000}\\',
      ]
    : ['/'];
  for (const dataRoot of volumeRoots) {
    assertRecordRejected(record(dataRoot), dataRoot);
  }
});

test('direct Product Control boundary rejects a .nimi junction', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-product-control-profile-'));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-product-control-junction-target-'));
  const controlDir = path.join(profile, '.nimi');
  fs.writeFileSync(
    path.join(target, 'nimi.json'),
    JSON.stringify(record(path.join(os.tmpdir(), 'NimiDataJunction'))),
    'utf8',
  );
  fs.symlinkSync(target, controlDir, 'junction');
  try {
    assert.throws(
      () => resolveProductControlDataRootForTest({ verifiedProfileDir: profile }),
      /Product Control/u,
    );
  } finally {
    fs.unlinkSync(controlDir);
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('direct Product Control boundary rejects a nimi.json file symlink', (t) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-product-control-profile-'));
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-product-control-link-target-'));
  const controlDir = path.join(profile, '.nimi');
  const controlPath = path.join(controlDir, 'nimi.json');
  const target = path.join(targetDir, 'target.json');
  fs.mkdirSync(controlDir);
  fs.writeFileSync(
    target,
    JSON.stringify(record(path.join(os.tmpdir(), 'NimiDataFileLink'))),
    'utf8',
  );
  try {
    try {
      fs.symlinkSync(target, controlPath, 'file');
    } catch (error) {
      if (process.platform === 'win32' && error?.code === 'EPERM') {
        t.skip('Windows file-symlink creation is unavailable');
        return;
      }
      throw error;
    }
    assert.throws(
      () => resolveProductControlDataRootForTest({ verifiedProfileDir: profile }),
      /Product Control/u,
    );
  } finally {
    if (fs.existsSync(controlPath)) fs.unlinkSync(controlPath);
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test('direct Product Control boundary rejects non-directory and non-file nodes', () => {
  const profileWithFile = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-product-control-profile-'));
  fs.writeFileSync(path.join(profileWithFile, '.nimi'), 'not-a-directory', 'utf8');
  try {
    assert.throws(
      () => resolveProductControlDataRootForTest({ verifiedProfileDir: profileWithFile }),
      /Product Control/u,
    );
  } finally {
    fs.rmSync(profileWithFile, { recursive: true, force: true });
  }

  const profileWithDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'nimi-product-control-profile-'),
  );
  fs.mkdirSync(path.join(profileWithDirectory, '.nimi', 'nimi.json'), { recursive: true });
  try {
    assert.throws(
      () => resolveProductControlDataRootForTest({
        verifiedProfileDir: profileWithDirectory,
      }),
      /Product Control/u,
    );
  } finally {
    fs.rmSync(profileWithDirectory, { recursive: true, force: true });
  }
});

test('data paths derive only from the recorded root', () => {
  const dataRoot = path.join(os.tmpdir(), 'NimiData');
  assert.deepEqual(deriveNimiDataPaths(dataRoot), {
    dataRoot,
    models: path.join(dataRoot, 'models'),
    dependencies: path.join(dataRoot, 'dependencies'),
    environments: path.join(dataRoot, 'environments'),
    apps: path.join(dataRoot, 'apps'),
    accounts: path.join(dataRoot, 'accounts'),
    logs: path.join(dataRoot, 'logs'),
    audit: path.join(dataRoot, 'audit'),
  });
});
