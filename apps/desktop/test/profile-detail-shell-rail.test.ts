import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', '..', '..', relativePath), 'utf8');
}

const storeTypesSource = readWorkspaceFile('src/shell/renderer/app-shell/providers/store-types.ts');
const uiSliceSource = readWorkspaceFile('src/shell/renderer/app-shell/providers/ui-slice.ts');
const mainLayoutSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-view.tsx');
const profilePanelSource = readWorkspaceFile('src/shell/renderer/features/profile/profile-panel.tsx');
const contactDetailProfileModalSource = readWorkspaceFile('src/shell/renderer/features/contacts/contact-detail-profile-modal.tsx');
const e2eIdsSource = readWorkspaceFile('src/shell/renderer/testability/e2e-ids.ts');
const stateContractSource = readRepoFile('spec/desktop/kernel/state-contract.md');
const storeSlicesSource = readRepoFile('spec/desktop/kernel/tables/store-slices.yaml');

test('profile detail shell rail: ui slice tracks shared profile overlay state', () => {
  assert.match(storeTypesSource, /profileDetailOverlayOpen: boolean;/);
  assert.match(storeTypesSource, /setProfileDetailOverlayOpen: \(open: boolean\) => void;/);
  assert.match(uiSliceSource, /profileDetailOverlayOpen: false,/);
  assert.match(uiSliceSource, /setProfileDetailOverlayOpen: \(open\) => set\(\{ profileDetailOverlayOpen: open \}\),/);
});

test('profile detail shell rail: main layout hides primary rail for external profile detail and overlay modals', () => {
  assert.match(mainLayoutSource, /const selectedProfileId = useAppStore\(\(state\) => state\.selectedProfileId\);/);
  assert.match(mainLayoutSource, /const profileDetailOverlayOpen = useAppStore\(\(state\) => state\.profileDetailOverlayOpen\);/);
  assert.match(mainLayoutSource, /const hidePrimaryRail = immersiveRoute/);
  assert.match(mainLayoutSource, /\|\| \(props\.activeTab === 'profile' && Boolean\(selectedProfileId\)\)/);
  assert.match(mainLayoutSource, /\|\| profileDetailOverlayOpen;/);
});

test('profile detail shell rail: main layout exposes a stable sidebar rail test id', () => {
  assert.match(mainLayoutSource, /data-testid=\{E2E_IDS\.shellSidebarRail\}/);
  assert.match(e2eIdsSource, /shellSidebarRail: 'shell-sidebar-rail',/);
});

test('profile detail shell rail: modal toggles shell overlay state while open', () => {
  assert.match(contactDetailProfileModalSource, /const setProfileDetailOverlayOpen = useAppStore\(\(state\) => state\.setProfileDetailOverlayOpen\);/);
  assert.match(
    contactDetailProfileModalSource,
    /useEffect\(\(\) => \{\s*if \(!props\.open\) \{\s*return undefined;\s*\}\s*setProfileDetailOverlayOpen\(true\);\s*return \(\) => \{\s*setProfileDetailOverlayOpen\(false\);\s*\};\s*\}, \[props\.open, setProfileDetailOverlayOpen\]\);/s,
  );
});

test('profile detail shell rail: own profile remains keyed off selectedProfileId absence', () => {
  assert.match(profilePanelSource, /const isOwnProfile = !selectedProfileId;/);
});

test('profile detail shell rail: desktop state spec documents the overlay state', () => {
  assert.match(stateContractSource, /profileDetailOverlayOpen/u);
  assert.match(storeSlicesSource, /profile detail overlay state/u);
});
