import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readFeature(relativePath: string): Promise<string> {
  return readFile(new URL(
    `../src/shell/renderer/features/${relativePath}`,
    import.meta.url,
  ), 'utf8');
}

test('the in-task connector creation and the Cloud page share one form implementation', async () => {
  const [cloudPage, cloudPanel, createForm] = await Promise.all([
    readFeature('runtime-config/runtime-config-page-cloud.tsx'),
    readFeature('runtime-config/runtime-config-setup-task-cloud.tsx'),
    readFeature('runtime-config/runtime-config-connector-create-form.tsx'),
  ]);
  assert.match(cloudPage, /RuntimeConfigConnectorCreateDialog/);
  assert.match(cloudPanel, /RuntimeConfigConnectorCreateForm/);
  // Both surfaces run managed OAuth through the shared generation/snapshot
  // session; neither reimplements the acquisition lifecycle.
  assert.match(cloudPage, /useConnectorOAuthAcquisition/);
  assert.match(createForm, /useConnectorOAuthAcquisition/);
  assert.doesNotMatch(cloudPage, /codexOAuthGenerationRef/);
  assert.doesNotMatch(cloudPage, /codexOAuthAbortRef/);
  // The task surface never creates a second connector management system.
  assert.doesNotMatch(cloudPanel, /sdkCreateConnector|sdkUpdateConnector|sdkDeleteConnector/);
});

test('consumer entries open the shared setup task instead of the legacy pages', async () => {
  const [appsSection, chatSettings, agentSettings, chatPage] = await Promise.all([
    readFeature('apps/apps-ai-config-section.tsx'),
    readFeature('chat/chat-shared-settings-panel.tsx'),
    readFeature('chat/chat-agent-shell-presentation-settings.tsx'),
    readFeature('chat/chat-page.tsx'),
  ]);
  for (const [name, source] of [
    ['apps-ai-config-section', appsSection],
    ['chat-shared-settings-panel', chatSettings],
    ['chat-agent-shell-presentation-settings', agentSettings],
    ['chat-page', chatPage],
  ] as const) {
    assert.match(source, /openOrCreateRuntimeSetupTask/u, `${name} must route through the setup task helper`);
    assert.match(source, /runtimeConfigNavigation\.openSetupTask/u, `${name} must open the task via the navigation intent`);
    assert.doesNotMatch(source, /runtime-config-action-focus\.loadouts/u, `${name} must not deep-link the legacy loadouts page`);
  }
  // The Apps entry carries the exact owner identity and a return handle.
  assert.match(appsSection, /ownerAppId: appId/u);
  assert.match(appsSection, /returnFocus: `apps:\$\{appId\}`/u);
  // The Chat settings entry owns the Nimi first-party app identity.
  assert.match(chatSettings, /ownerAppId: DESKTOP_NIMI_APP_ID/u);
  // The agent shell entry uses the shared LocalAgent owner.
  assert.match(agentSettings, /kind: 'local-agent'/u);
});

test('the AI settings page navigates back to the recorded source on return', async () => {
  const [page, open] = await Promise.all([
    readFeature('runtime-config/runtime-config-page-ai-settings.tsx'),
    readFeature('runtime-config/runtime-setup-task-open.ts'),
  ]);
  assert.match(page, /resolveRuntimeSetupReturnTarget/u);
  assert.match(page, /onReturnToSource=\{onReturnToSource\}/u);
  assert.match(page, /setActiveTab\(target\.tab\)/u);
  assert.match(open, /return \{ kind: 'tab', tab: 'apps' \}/u);
  assert.match(open, /return \{ kind: 'tab', tab: 'chat' \}/u);
});

test('the AI settings page notice leaves recorded failures to the task view and does not outlive navigation', async () => {
  const page = await readFeature('runtime-config/runtime-config-page-ai-settings.tsx');
  // A failure the opened task recorded is shown by the task view, not repeated above it.
  assert.match(page, /if \(!store\.getTask\(taskId\)\?\.failure\) setError\(failure\);/u);
  assert.doesNotMatch(page, /setError\((?:result|created)\.failure\.message\)/u);
  // The notice renders through the shared failure presentation, never as raw text.
  assert.match(page, /<InlineAlert tone="danger">\s*<RuntimeSetupFailureMessage failure=\{error\} \/>/u);
  // Home, closing the task view and returning to the source each drop the notice.
  const between = (start: string, end: string) => page.slice(page.indexOf(start), page.indexOf(end, page.indexOf(start)));
  assert.match(between('const onHome = () => {', '};'), /setError\(null\)/u);
  assert.match(between('const onReturnToSource = () => {', '};'), /setError\(null\)/u);
  assert.match(between('<RuntimeConfigSetupTaskView', 'onReturnToSource='), /props\.onCloseSetupTask\(\);\s*setError\(null\);/u);
});

test('the AI settings page hosts the profile library section with all five entries', async () => {
  const [page, section] = await Promise.all([
    readFeature('runtime-config/runtime-config-page-ai-settings.tsx'),
    readFeature('runtime-config/runtime-config-ai-settings-profiles.tsx'),
  ]);
  assert.match(page, /RuntimeConfigAiSettingsProfilesSection/u);
  assert.match(section, /ProfileRecommendationsPage/u);
  assert.match(section, /ProfileImportWizard/u);
  assert.match(section, /ProfileExportPanel/u);
  assert.match(section, /AIProfileAuthoringPage/u);
  assert.match(section, /planRuntimeSetupProfileUse/u);
});

test('the app-owner profile use defers route saves to the per-task commit', async () => {
  const [section, appsSection, runner, navPort] = await Promise.all([
    readFeature('runtime-config/runtime-config-ai-settings-profiles.tsx'),
    readFeature('apps/apps-ai-config-section.tsx'),
    readFeature('runtime-config/runtime-setup-task-runner.ts'),
    readFile(new URL('../src/shell/renderer/renderer/runtime-config-navigation-port.ts', import.meta.url), 'utf8'),
  ]);
  // The Apps entry opens the profile library in the exact app owner context.
  assert.match(appsSection, /runtimeConfigNavigation\.openProfileUse/u);
  assert.match(appsSection, /ownerAppId: appId/u);
  // Starting preparation never rewrites the owner routes up front; the
  // aggregated-save mechanism stays available in the runner for coordinated
  // sequences. Concurrency and already-local behavior are tested in the runner.
  assert.doesNotMatch(section, /saveRuntimeSetupOwnerIntents/u);
  assert.doesNotMatch(section, /buildRuntimeSetupLocalOwnerIntent/u);
  assert.match(runner, /export async function saveRuntimeSetupOwnerIntents/u);
  assert.match(navPort, /openProfileUse/u);
});

test('AI capabilities use a master-detail workspace without the retired four-tab shell', async () => {
  const [panel, workspace] = await Promise.all([
    readFeature('runtime-config/runtime-config-panel-view.tsx'),
    readFeature('runtime-config/runtime-config-page-ai-settings.tsx'),
  ]);
  assert.doesNotMatch(panel, /RUNTIME_NAV_DESTINATIONS/);
  assert.match(workspace, /SidebarShell/);
  assert.match(workspace, /ai-capabilities-home/);
});
