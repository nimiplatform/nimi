import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopDir = path.resolve(import.meta.dirname, '..');

function readDesktopFile(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

test('settings account deletion opens a confirmation gate before DataSync mutation', () => {
  const source = readDesktopFile('src/shell/renderer/features/settings/settings-data-management-page.tsx');
  const dangerZoneButtonIndex = source.indexOf('setDeleteConfirmationOpen(true)');
  const mutationIndex = source.indexOf('requestAccountDeletion(');
  const confirmationCheckIndex = source.indexOf('if (!deleteConfirmationMatches)');
  const confirmationInputIndex = source.indexOf('data-testid="settings-delete-account-confirmation-input"');
  const submitButtonIndex = source.indexOf('void handleDeleteAccount();');

  assert.ok(dangerZoneButtonIndex > -1, 'danger-zone button must open the local confirmation gate');
  assert.ok(confirmationCheckIndex > -1, 'delete handler must enforce local confirmation');
  assert.ok(confirmationInputIndex > dangerZoneButtonIndex, 'confirmation UI must render after the danger-zone opener');
  assert.ok(submitButtonIndex > confirmationInputIndex, 'delete handler trigger must live behind the confirmation UI');
  assert.ok(mutationIndex > confirmationCheckIndex, 'Realm account deletion request must be after the local confirmation check');
});

test('settings account deletion confirmation requires typed acknowledgement', () => {
  const source = readDesktopFile('src/shell/renderer/features/settings/settings-data-management-page.tsx');

  assert.match(source, /DELETE_ACCOUNT_CONFIRMATION_TEXT = 'DELETE'/);
  assert.match(source, /deleteConfirmationText\.trim\(\) === DELETE_ACCOUNT_CONFIRMATION_TEXT/);
  assert.match(source, /data-testid="settings-delete-account-confirmation-input"/);
  assert.match(source, /disabled=\{deleting \|\| !deleteConfirmationMatches\}/);
});

test('settings account deletion consumes SDK Realm account-data helper directly', () => {
  const source = readDesktopFile('src/shell/renderer/features/settings/settings-data-management-page.tsx');
  const facadeSource = readDesktopFile('src/runtime/data-sync/facade.ts');
  const actionSource = readDesktopFile('src/runtime/data-sync/facade-actions.ts');

  assert.match(source, /requestAccountDeletion/);
  assert.match(source, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(source, /getPlatformClient\(\)\.realm/);
  assert.doesNotMatch(source, /@runtime\/data-sync|dataSync\.requestAccountDeletion/);
  assert.doesNotMatch(facadeSource, /requestAccountDeletion\(payload|requestDataExport\(payload/);
  assert.doesNotMatch(actionSource, /requestAccountDeletion: async|requestDataExport: async/);
});

test('ordinary settings data management cannot invoke nimi_data relocation', () => {
  const source = readDesktopFile('src/shell/renderer/features/settings/settings-data-management-page.tsx');

  assert.doesNotMatch(source, /previewNimiDataMigration/);
  assert.doesNotMatch(source, /runNimiDataMigration/);
  assert.doesNotMatch(source, /settings-data-root-preview-button/);
  assert.doesNotMatch(source, /settings-data-root-migration-confirm-button/);
});
