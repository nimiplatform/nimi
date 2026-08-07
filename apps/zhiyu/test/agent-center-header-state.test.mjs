import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { build, transform } from 'esbuild';

const appRoot = path.resolve(import.meta.dirname, '..');

test('Agent Center header state chips hide unconfigured and missing projections', async () => {
  const labels = await importTypescriptModule('src/shell/agent-chat/ZhiyuAgentChatLabels.ts');

  assert.equal(typeof labels.agentCenterHeaderStateLabel, 'function');

  for (const missingValue of [
    null,
    undefined,
    '',
    '   ',
    'not_projected',
    'not_projected_in_rla0b_harness',
    'not_configured',
    'unknown',
    'ready',
  ]) {
    assert.equal(labels.agentCenterHeaderStateLabel(missingValue), null, `${String(missingValue)} must not render a header chip`);
  }

  assert.equal(labels.agentCenterHeaderStateLabel('focused'), '专注');
  assert.equal(labels.agentCenterHeaderStateLabel('chat-active'), '对话中');
});

test('Agent Center world metadata stays absent from the bounded local-app inventory projection', async () => {
  const labels = await importTypescriptModule('src/shell/agent-chat/ZhiyuAgentChatLabels.ts');
  const evidence = {
    localAgent: {
      localAgentRef: 'local-agent:world-character',
    },
    inventory: {
      localAgents: [{
        localAgentRef: 'local-agent:world-character',
        displayName: '颜真卿',
        ownerUserId: 'user-a',
        runtimeSourceRef: 'source-a',
      }],
    },
  };

  assert.equal(labels.agentCenterWorldLabel(evidence), null);
});

test('Zhiyu Agent Center panel renders the Manager Session without caller posture', async () => {
  const { renderPanel } = await importRightPanelModule();
  let html = '';
  assert.doesNotThrow(() => {
    html = renderPanel({
      mode: 'agent',
      evidence: {
        companion: { currentEmotion: null, executionState: null },
        localAgent: { agentHandle: 'opaque-agent' },
        inventory: {
          localAgents: [{
            agentHandle: 'opaque-agent',
            displayName: '伙伴',
            avatarUrl: 'https://assets.example.test/agent.png',
          }],
        },
      },
      currentPartnerName: '伙伴',
      activeTab: 'overview',
      onActiveTabChange() {},
      onClose() {},
      onOpenDesktopAgentConfig() {},
      session: { getSnapshot: () => ({ availability: { updateModelSettings: { state: 'unavailable', reason: 'reserved-not-admitted' } } }) },
    });
  });
  assert.match(html, /data-test-action-reason="reserved-not-admitted"/);
  assert.match(html, /data-test-chrome="standalone"/);
  assert.match(html, /data-test-identity="伙伴"/);
  assert.match(html, /data-test-avatar-url="https:\/\/assets\.example\.test\/agent\.png"/);
});

test('Zhiyu adopts Kit canonical Agent Center chrome and keeps host context outside it', async () => {
  const source = await readFile(path.join(appRoot, 'src/shell/agent-chat/ZhiyuAgentRightPanel.tsx'), 'utf8');

  assert.match(source, /chrome="standalone"/);
  assert.match(source, /identity=\{\{/);
  assert.match(source, /placementActions=\{\{/);
  assert.match(source, /session=\{props\.session\}/);
  assert.match(source, /data-zhiyu-agent-center-host-context="true"/);
  assert.doesNotMatch(source, /data-zhiyu-agent-center-owner|IconToggleAction|onOpenModelConfig/);
  assert.doesNotMatch(source, /runtimeError:/);
});

test('Zhiyu Agent Center panel fails closed with a typed unavailable state when the session is absent', async () => {
  const { renderPanel } = await importRightPanelModule();
  const html = renderPanel({
    mode: 'agent',
    evidence: {
      companion: { currentEmotion: null, executionState: null },
      localAgent: { agentHandle: 'opaque-agent' },
      inventory: { localAgents: [] },
    },
    currentPartnerName: '伙伴',
    activeTab: 'overview',
    onActiveTabChange() {},
    onClose() {},
    onOpenDesktopAgentConfig() {},
    session: null,
  });
  assert.match(html, /data-zhiyu-agent-center-unavailable="protected-app-access-unavailable"/);
  assert.match(html, /data-zhiyu-agent-center-unavailable-close="true"/);
  assert.match(html, /data-zhiyu-desktop-open-action="desktop_open_agent_config"/);
  assert.doesNotMatch(html, /data-test-chrome/);
});

test('Agent Center world metadata fails closed when Runtime does not project a world name', async () => {
  const labels = await importTypescriptModule('src/shell/agent-chat/ZhiyuAgentChatLabels.ts');
  const evidence = {
    localAgent: {
      localAgentRef: 'local-agent:world-character',
    },
    inventory: {
      localAgents: [{
        localAgentRef: 'local-agent:world-character',
        sourceKind: 'worldCharacter',
        sourceWorldName: null,
      }],
    },
  };

  assert.equal(labels.agentCenterWorldLabel(evidence), null);
});

async function importRightPanelModule() {
  const output = (await build({
    stdin: {
      contents: `
        import { createElement } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server.edge';
        import { RightAgentPanel } from './src/shell/agent-chat/ZhiyuAgentRightPanel.tsx';
        export function renderPanel(props) {
          return renderToStaticMarkup(createElement(RightAgentPanel, props));
        }
      `,
      resolveDir: appRoot,
      sourcefile: 'agent-center-panel-test-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'agent-center-panel-stubs',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^react$/, namespace: 'panel-stub' }, () => ({
          path: path.join(appRoot, 'node_modules/react/index.js'),
        }));
        buildApi.onResolve({ filter: /^@nimiplatform\/kit\/features\/agent-center$/ }, () => ({ path: 'agent-center', namespace: 'panel-stub' }));
        buildApi.onLoad({ filter: /^agent-center$/, namespace: 'panel-stub' }, () => ({
          loader: 'jsx',
          contents: `
            import { createElement } from 'react';
            export function createAgentCenterI18n(input = {}) {
              return { language: input.language, t: input.t || ((key) => key) };
            }
            export function AgentCenter(props) {
              return createElement('div', {
                'data-test-chrome': props.chrome,
                'data-test-identity': props.identity?.displayName,
                'data-test-avatar-url': props.identity?.avatarUrl,
                'data-test-action-reason': props.session.getSnapshot().availability.updateModelSettings.reason,
              });
            }
          `,
        }));
        buildApi.onResolve({ filter: /^@nimiplatform\/kit\/ui$/ }, () => ({ path: 'kit-ui', namespace: 'panel-stub' }));
        buildApi.onLoad({ filter: /^kit-ui$/, namespace: 'panel-stub' }, () => ({
          loader: 'jsx',
          contents: `
            import { createElement } from 'react';
            export function AppCardSurface({ children, as: Tag = 'div', ...props }) {
              return createElement(Tag, props, children);
            }
          `,
        }));
        buildApi.onResolve({ filter: /^lucide-react$/ }, () => ({ path: 'lucide', namespace: 'panel-stub' }));
        buildApi.onLoad({ filter: /^lucide$/, namespace: 'panel-stub' }, () => ({
          loader: 'jsx',
          contents: `
            import { createElement } from 'react';
            export function Globe2() { return createElement('svg'); }
            export function X() { return createElement('svg'); }
          `,
        }));
      },
    }],
  })).outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${Math.random()}`);
}

async function importTypescriptModule(relativePath) {
  const source = await readFile(path.join(appRoot, relativePath), 'utf8');
  const result = await transform(source, {
    format: 'esm',
    loader: 'ts',
    sourcemap: false,
    target: 'es2022',
  });
  const encoded = Buffer.from(result.code, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
}
