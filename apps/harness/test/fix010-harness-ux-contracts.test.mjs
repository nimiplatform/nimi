import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { transform } from 'esbuild';
import { NimiElectronLocalAppHostError } from '@nimiplatform/kit/shell/electron/main';
import { openHarness } from '../dist-electron/harness.js';
import { copyMaterial, listWorkspace } from '../dist-electron/workspace-files.js';
import { localizeDefaultSessionTitle, translate } from '../src/i18n.ts';
import { errorText } from '../src/product/harness-types.ts';

function createSymbiosisHarnessEnv(partnersRef) {
  const documents = new Map([['harness-namespace.json', randomUUID()]]);
  const services = {
    storage: {
      async readJson(key) {
        if (!documents.has(key)) throw new NimiElectronLocalAppHostError('not-found', false);
        return { value: structuredClone(documents.get(key)) };
      },
      async writeJson(key, value) {
        documents.set(key, structuredClone(value));
        return { value };
      },
    },
    agents: {
      async listReferences() {
        return structuredClone(partnersRef.current);
      },
    },
    agentWork: {
      async listReferences() {
        return structuredClone(partnersRef.current);
      },
    },
    aiConfig: {
      async get() {
        throw new Error('aiConfig.get must not run in requireSymbiosis mode');
      },
    },
    ai: { text: { streamTurn() { throw new Error('unexpected non-symbiosis streamTurn'); } } },
  };
  const symbiosis = {
    isRunning: () => true,
    isReadyForProjections: () => false,
    getEffectiveContextBudgetTokens: () => 64000,
    getAgentSessionClient: () => ({
      async routeAndSubmitInput() {
        throw new Error('routeAndSubmitInput should not run without an authorized partner');
      },
    }),
  };
  return { services, symbiosis };
}

async function loadWorkspaceFileDisplayHelpers() {
  const source = await readFile(new URL('../src/product/workspace-files.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('const INTERNAL_MATERIAL_DIR_RE');
  const end = source.indexOf('function formatSize');
  assert.ok(start >= 0 && end > start, 'expected material display helpers in workspace-files.tsx');
  const snippet = source.slice(start, end);
  const { code } = await transform(snippet, { loader: 'ts', format: 'esm' });
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
  return import(dataUrl);
}

test('OBS-018: requireSymbiosis with 0 partners returns model=undefined instead of fabricating Nimi Partner, and recovers once a partner is added', async t => {
  const root = await mkdtemp(join(tmpdir(), 'harness-zero-partner-'));
  const partnersRef = { current: [] };
  const { services, symbiosis } = createSymbiosisHarnessEnv(partnersRef);
  const harness = await openHarness(services, new AbortController().signal, undefined, {
    dataRoot: root,
    requireSymbiosis: true,
    symbiosis,
  });
  t.after(async () => {
    await harness.close();
    await rm(root, { recursive: true, force: true });
  });

  await harness.attachSymbiosis(symbiosis, undefined, undefined, undefined);
  const zeroPartnerSnap = await harness.snapshot();
  assert.equal(zeroPartnerSnap.model, undefined);

  await assert.rejects(
    harness.submit('main', 'Summarize this workspace', randomUUID(), false),
    /No authorized Nimi Partner/,
  );

  // User creates a local partner in Nimi Home and returns to Harness.
  partnersRef.current = [{
    agentHandle: 'agent_ref_mina',
    agentBinding: 'agent_binding_mina',
    displayName: 'Mina',
  }];
  const readySnap = await harness.snapshot();
  assert.equal(readySnap.model, 'Mina');

  // Purging the partner resets cached partner binding so fresh unbound sessions do not fabricate readiness.
  await harness.handleBodyPurgeAgent('agent_binding_mina');
  partnersRef.current = [];
  await harness.create();
  const afterPurgeSnap = await harness.snapshot();
  assert.equal(afterPurgeSnap.model, undefined);
});

test('OBS-018: IPC error sanitization strips Electron remote method prefix and conversations surfaces missing-partner CTA', async () => {
  const rawIpc = new Error("Error invoking remote method 'harness:submit': Error: No authorized Nimi Partner is available yet.");
  const sanitized = errorText(rawIpc);
  assert.equal(sanitized, 'No authorized Nimi Partner is available yet.');
  assert.doesNotMatch(sanitized, /Error invoking remote method|harness:submit/);

  const composerSrc = await readFile(new URL('../src/product/task-composer.tsx', import.meta.url), 'utf8');
  assert.match(composerSrc, /import\s*\{[^}]*\berrorText\b[^}]*\}\s*from\s*'\.\/harness-types\.js'/);
  assert.match(composerSrc, /formatComposerError/);
  assert.match(composerSrc, /onSubmitError=\{showError\}/);

  const conversationsSrc = await readFile(new URL('../src/product/conversations.tsx', import.meta.url), 'utf8');
  assert.match(conversationsSrc, /openDesktopIntent\(\{\s*intent:\s*\{\s*kind:\s*'open-partners'\s*\}\s*\}\)/);
  assert.match(conversationsSrc, /partner\.missingTitle/);
  assert.match(conversationsSrc, /partner\.missingMessage/);
  assert.match(conversationsSrc, /partner\.manageInHome/);
});

test('OBS-019: narrow responsive layout auto-collapses desktop sidebar, keeps empty thread top-safe, and prevents composer Send collision', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.harness-empty-thread\s*\{[^}]*justify-content:\s*safe center;/s);
  assert.match(css, /\.harness-composer-card\s+\[data-chat-composer-toolbar-leading="true"\]\s*>\s*div\s*\{[^}]*flex-shrink:\s*1;[^}]*max-width:\s*100%;/s);
  assert.match(css, /@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.harness-workbench\[data-sidebar-visible="false"\]\s+\.harness-sidebar\s*\{\s*display:\s*none;\s*\}/);
  assert.match(css, /@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.harness-topbar\s*\{[^}]*flex-wrap:\s*wrap;/);
  assert.match(css, /@media\s*\(max-width:\s*560px\)\s*\{[\s\S]*?\.harness-inspector-toggle-btn\s*>\s*span\s*\{\s*display:\s*none;\s*\}/);

  const conversationsSrc = await readFile(new URL('../src/product/conversations.tsx', import.meta.url), 'utf8');
  assert.match(conversationsSrc, /matchMedia\('\(max-width:\s*768px\)'\)/);
  assert.match(conversationsSrc, /data-testid="harness-sidebar-drawer-toggle"/);
  assert.match(conversationsSrc, /scroller\.scrollTop\s*=\s*0/);
});

test('OBS-019 (460x580 hotfix): conflict banner stacks cleanly at <=560px without crushing copy or collapsing thread / overlapping topbar', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

  const media768Start = css.indexOf('@media (max-width: 768px)');
  const media560Start = css.indexOf('@media (max-width: 560px)');
  const mediaHeight700Start = css.indexOf('@media (max-height: 700px)');
  assert.ok(media768Start >= 0 && media560Start > media768Start && mediaHeight700Start > media560Start);

  const media768Block = css.slice(media768Start, media560Start);
  const media560Block = css.slice(media560Start, mediaHeight700Start);

  // <=768px must not undo desktop min-width with min-width: 0 while still in row layout.
  assert.doesNotMatch(
    media768Block,
    /\.harness-conflict-banner__copy\s*\{[^}]*min-width:\s*0\s*;/s,
  );
  assert.match(
    media768Block,
    /\.harness-conflict-banner__copy\s*\{[^}]*min-width:\s*min\(180px,\s*100%\);/s,
  );

  // <=560px stacks the conflict banner vertically so copy takes full width and never crushes into a tall ribbon.
  assert.match(
    media560Block,
    /\.harness-conflict-banner\s*\{[^}]*flex-direction:\s*column;[^}]*align-items:\s*stretch;[^}]*gap:\s*8px;[^}]*padding:\s*10px 12px;/s,
  );
  assert.match(
    media560Block,
    /\.harness-conflict-banner__copy\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s,
  );
  assert.match(
    media560Block,
    /\.harness-conflict-banner__actions\s*\{[^}]*width:\s*100%;[^}]*flex-wrap:\s*wrap;/s,
  );

  // Thread container clips overflow and hides Jump to latest on empty threads so it never overlaps topbar.
  assert.match(css, /\.harness-thread\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.harness-thread:has\(\.harness-empty-thread\)\s+\.harness-jump\s*\{\s*display:\s*none;\s*\}/);
});

test('OBS-021: Integrations panel Manage in Nimi Home opens Home Integrations instead of open-apps', async () => {
  const src = await readFile(new URL('../src/product/integrations-panel.tsx', import.meta.url), 'utf8');
  assert.match(src, /openDesktopIntent\(\{\s*intent:\s*\{\s*kind:\s*'open-integrations'\s*\}\s*\}\)/);
  assert.doesNotMatch(src, /kind:\s*'open-apps'/);
});

test('OBS-022(b): default session titles localize cleanly and Runtime connected copy uses plain Nimi wording without Nimi Partner fabrication', async () => {
  assert.equal(translate('en', 'app.runtimeStatus.connected'), 'Connected to Nimi');
  assert.equal(translate('zh', 'app.runtimeStatus.connected'), '已连接到 Nimi');
  assert.notEqual(translate('zh', 'app.runtimeStatus.connected'), 'Runtime 已连接');

  const tZh = (key, vars) => translate('zh', key, vars);
  const tEn = (key, vars) => translate('en', key, vars);
  assert.equal(localizeDefaultSessionTitle('First session', tZh), '首次会话');
  assert.equal(localizeDefaultSessionTitle('New session', tZh), '新建会话');
  assert.equal(localizeDefaultSessionTitle('First session', tEn), 'First session');
  assert.equal(localizeDefaultSessionTitle('New session', tEn), 'New session');
  assert.equal(localizeDefaultSessionTitle('Release checklist', tZh), 'Release checklist');

  const harnessSrc = await readFile(new URL('../src-electron/harness.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(harnessSrc, /['"]Nimi Partner['"]/);
});

test('OBS-023: attachment disk isolation stays material-<uuid>/<name> while UI helpers flatten and strip the internal prefix', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-attachment-display-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const signal = new AbortController().signal;
  const imported = await copyMaterial(dir, 'README.md', new TextEncoder().encode('# Hello\n'), signal);
  assert.match(imported.ref, /^material-[^/]+\/README\.md$/);

  const rootListed = await listWorkspace(dir, '', 0, signal);
  assert.equal(rootListed.items.length, 1);
  assert.equal(rootListed.items[0].directory, true);
  assert.match(rootListed.items[0].name, /^material-/);

  const {
    isInternalMaterialDir,
    formatWorkspaceDisplayPath,
    parentWorkspaceFolder,
    flattenMaterialDirectories,
  } = await loadWorkspaceFileDisplayHelpers();

  assert.equal(isInternalMaterialDir(rootListed.items[0].name), true);
  assert.equal(isInternalMaterialDir('materials'), false);
  assert.equal(formatWorkspaceDisplayPath(imported.ref), 'README.md');
  assert.equal(formatWorkspaceDisplayPath('docs/README.md'), 'docs/README.md');
  assert.equal(parentWorkspaceFolder(imported.ref), '');
  assert.equal(parentWorkspaceFolder('docs/README.md'), 'docs');

  const flattened = await flattenMaterialDirectories(
    rootListed.items,
    dirRef => listWorkspace(dir, dirRef, 0, signal),
  );
  assert.equal(flattened.length, 1);
  assert.equal(flattened[0].name, 'README.md');
  assert.equal(flattened[0].ref, imported.ref);
  assert.equal(flattened[0].directory, false);
  assert.doesNotMatch(flattened[0].name, /^material-/);

  const projectFolder = 'material-archives';
  const matchingFolder = 'material-images';
  await mkdir(join(dir, projectFolder));
  await mkdir(join(dir, matchingFolder));
  await writeFile(join(dir, matchingFolder, 'first.txt'), 'first');
  await writeFile(join(dir, matchingFolder, 'second.txt'), 'second');
  const workspace = await listWorkspace(dir, '', 0, signal);
  const visible = await flattenMaterialDirectories(workspace.items, ref => listWorkspace(dir, ref, 0, signal));
  assert.deepEqual(visible.map(({ ref }) => ref), [projectFolder, matchingFolder, imported.ref]);
});

test('OBS-024 + W0-05 Option A: NIMI_APP.md aligns with current UI labels and Auto-Edit copy includes control-plane approval boundary', async () => {
  const doc = await readFile(new URL('../NIMI_APP.md', import.meta.url), 'utf8');
  assert.match(doc, /Tasks & deliverables/);
  assert.match(doc, /Project workspace/);
  assert.match(doc, /Auto-Edit/);
  assert.match(doc, /Plan Only/);
  assert.match(doc, /AI Capabilities/);
  assert.doesNotMatch(doc, /LocalAgent/);
  assert.doesNotMatch(doc, /AI models/);
  assert.doesNotMatch(doc, /Matters & Deliverables/);
  assert.doesNotMatch(doc, /Workspace Edit/);
  assert.doesNotMatch(doc, /Plan Read-Only/);

  const enDesc = translate('en', 'permission.workspaceEditDesc');
  const zhDesc = translate('zh', 'permission.workspaceEditDesc');
  assert.match(enDesc, /control-plane/i);
  assert.match(enDesc, /\.git\/\*\*/);
  assert.match(enDesc, /package\.json/);
  assert.match(zhDesc, /控制面文件/);
  assert.match(zhDesc, /\.git\/\*\*/);
  assert.match(zhDesc, /package\.json/);
});
