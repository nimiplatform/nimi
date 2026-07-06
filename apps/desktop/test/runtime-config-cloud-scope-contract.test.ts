import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const cloudPageSource = readWorkspaceFile('src/shell/renderer/features/runtime-config/runtime-config-page-cloud.tsx');
const cloudDetailPanelSource = readWorkspaceFile('src/shell/renderer/features/runtime-config/runtime-config-page-cloud-detail-panel.tsx');
const cloudPageSurfaceSource = `${cloudPageSource}\n${cloudDetailPanelSource}`;
const cloudConnectorListSource = readWorkspaceFile('src/shell/renderer/features/runtime-config/runtime-config-page-cloud-connector-list.tsx');
const cloudPrimitivesSource = readWorkspaceFile('src/shell/renderer/features/runtime-config/runtime-config-page-cloud-primitives.tsx');
const runtimeConfigPrimitivesSource = readWorkspaceFile('src/shell/renderer/features/runtime-config/runtime-config-primitives.tsx');
const e2eIdsSource = readWorkspaceFile('src/shell/renderer/testability/e2e-ids.ts');
const e2eSelectorsSource = readWorkspaceFile('e2e/helpers/selectors.mjs');

test('runtime config cloud scope contract: anonymous drafts default to machine-global connectors', () => {
  assert.match(
    cloudPageSource,
    /scope: authStatus === 'authenticated' \? 'user' as const : 'machine-global' as const,/,
  );
});

test('runtime config cloud scope contract: runtime-system connectors stay read-only while machine-global remains editable', () => {
  assert.match(cloudPageSource, /const isRuntimeSystem = connectorScope === 'runtime-system';/);
  assert.match(cloudPageSource, /const isMachineGlobal = connectorScope === 'machine-global';/);
  assert.match(cloudPageSource, /const isSystemOwned = isRuntimeSystem;/);
  assert.match(cloudPageSurfaceSource, /disabled=\{isRuntimeSystem\}/);
  assert.match(
    cloudPageSurfaceSource,
    /managedMachineGlobal', \{ defaultValue: 'Shared across accounts on this machine' \}\)/,
  );
});

test('runtime config cloud scope contract: connector scope badges expose stable test ids', () => {
  assert.match(
    e2eIdsSource,
    /runtimeConnectorScopeBadge: \(connectorId: string\) => `runtime-connector-scope-badge:\$\{connectorId\}`,/,
  );
  assert.match(
    e2eSelectorsSource,
    /runtimeConnectorScopeBadge: \(connectorId\) => `runtime-connector-scope-badge:\$\{connectorId\}`,/,
  );
  assert.match(cloudConnectorListSource, /data-testid=\{E2E_IDS\.runtimeConnectorScopeBadge\(connector\.id\)\}/);
  assert.match(cloudConnectorListSource, /runtimeConfig\.cloud\.machineGlobal/);
  assert.match(cloudConnectorListSource, /runtimeConfig\.cloud\.runtimeSystem/);
});

test('runtime config cloud connector actions stay on their owning surfaces', () => {
  assert.match(cloudDetailPanelSource, /rightAccessory=\{\(/);
  assert.match(cloudDetailPanelSource, /model\.setShowCloudApiKey\(\(v\) => !v\)/);
  assert.doesNotMatch(cloudDetailPanelSource, /onRemoveSelectedConnector|TrashIcon/);
  assert.match(cloudConnectorListSource, /TrashIcon/);
  assert.match(cloudConnectorListSource, /props\.onDeleteConnector\(connector\.id\)/);
  assert.match(cloudPageSource, /sdkDeleteConnector\(connectorId\)/);
  assert.match(cloudPageSource, /removeConnectorFromState\(prev, connectorId\)/);
});

test('runtime config cloud connector selection stays quiet like the runtime sidebar', () => {
  assert.match(
    cloudConnectorListSource,
    /active\s*\?\s*'border-transparent bg-\[var\(--nimi-sidebar-item-active\)\] text-\[var\(--nimi-text-primary\)\]'/,
  );
  assert.doesNotMatch(cloudConnectorListSource, /ring-1|ring-mint|border-\[color-mix\(in_srgb,var\(--nimi-action-primary-bg\)_32%/);
});

test('runtime config cloud connector surface has no hover float motion', () => {
  assert.match(runtimeConfigPrimitivesSource, /hoverMotion\?: boolean;/);
  assert.match(
    runtimeConfigPrimitivesSource,
    /whileHover=\{hoverMotion \? cardMotion\.whileHover : undefined\}/,
  );
  assert.match(
    cloudConnectorListSource,
    /<PrimitiveCard className="h-\[600px\] overflow-hidden" hoverMotion=\{false\}>/,
  );
  assert.match(
    cloudDetailPanelSource,
    /<PrimitiveCard className="h-\[600px\] overflow-hidden" hoverMotion=\{false\}>/,
  );
  assert.doesNotMatch(
    `${cloudPageSource}\n${cloudDetailPanelSource}\n${cloudConnectorListSource}\n${cloudPrimitivesSource}`,
    /hover:(?:-|shadow)|group-hover:translate/,
  );
});

test('runtime config cloud scope contract: vendor options are derived from runtime provider catalog', () => {
  assert.match(cloudPageSource, /sdkListProviderCatalog\(\)/);
  assert.match(cloudPageSource, /const vendorOptions = useMemo\(\(\) => \{/);
  assert.match(cloudPageSource, /\.filter\(\(entry\) => entry\.managedSupported && entry\.provider !== 'local'\)/);
  assert.match(cloudPageSource, /providerToVendor\(entry\.provider\)/);
  assert.doesNotMatch(cloudPageSurfaceSource, /VENDOR_ORDER_V11/);
  assert.match(cloudPageSurfaceSource, /options=\{vendorOptions\}/);
});

test('runtime config cloud scope contract: only draft connectors can change vendor', () => {
  assert.match(cloudPageSource, /const canEditVendor = !isRuntimeSystem && isDraft;/);
  assert.match(cloudPageSource, /if \(!selectedConnector \|\| !canEditVendor\) return;/);
  assert.match(cloudPageSurfaceSource, /disabled=\{!canEditVendor\}/);
  assert.doesNotMatch(cloudPageSurfaceSource, /Vendor is fixed after connector creation\./);
  assert.doesNotMatch(cloudPageSurfaceSource, /Credential type is fixed after connector creation\./);
});

test('runtime config cloud connector name typing stays local until commit', () => {
  assert.match(cloudPageSource, /const \[connectorLabelDraft, setConnectorLabelDraft\] = useState\(''\);/);
  assert.match(cloudPageSource, /const commitConnectorLabelDraft = useCallback\(\(\) => \{/);
  assert.match(cloudPageSource, /onConnectorLabelDraftChange=\{setConnectorLabelDraft\}/);
  assert.match(cloudPageSource, /onCommitConnectorLabelDraft=\{commitConnectorLabelDraft\}/);
  assert.match(cloudPageSource, /label: connectorLabelDraft,/);
  assert.doesNotMatch(cloudDetailPanelSource, /onChange=\{props\.onRenameSelectedConnector\}/);
  assert.match(cloudDetailPanelSource, /value=\{connectorLabelDraft\}/);
  assert.match(cloudDetailPanelSource, /onChange=\{props\.onConnectorLabelDraftChange\}/);
  assert.match(cloudDetailPanelSource, /onBlur=\{props\.onCommitConnectorLabelDraft\}/);
});

test('runtime config cloud vendor dropdown supports searching many providers', () => {
  assert.match(cloudDetailPanelSource, /searchable/);
  assert.match(cloudDetailPanelSource, /searchPlaceholder=\{t\('runtimeConfig\.cloud\.searchVendors'/);
  assert.match(cloudDetailPanelSource, /defaultValue: 'Search vendors\.\.\.'/);
  assert.match(runtimeConfigPrimitivesSource, /searchable\?: boolean;/);
  assert.match(runtimeConfigPrimitivesSource, /const filteredOptions = useMemo\(\(\) => \{/);
  assert.match(runtimeConfigPrimitivesSource, /option\.label\.toLowerCase\(\)\.includes\(query\)/);
  assert.match(runtimeConfigPrimitivesSource, /<ScrollArea className="h-72[^"]*"/);
  assert.doesNotMatch(runtimeConfigPrimitivesSource, /<ScrollArea className="max-h-72"/);
});
