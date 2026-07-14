import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  createElectronCapabilityUnavailableError,
  createElectronExternalDaemonRequiredError,
  createNimiElectronStandardApplicationMenuTemplate,
  createNimiElectronFileAIConfigStore,
  getElectronStandardShellCapabilityIds,
  registerNimiElectronRuntimeBridge,
  type ElectronRuntimeBridgeTrustedMetadataProvider,
  type ElectronRuntimeBridgeUnaryRequest,
  type RuntimeGrpcBridgeClient,
} from '../src/main/index.js';
import { installNimiElectronRuntimeBridge } from '../src/preload/index.js';
import {
  NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
  NIMI_STANDARD_SHELL_CAPABILITIES,
  NIMI_STANDARD_SHELL_CAPABILITY_IDS,
  NIMI_STANDARD_SHELL_CAPABILITY_SETS,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '@nimiplatform/kit/shell/capabilities';
import {
  FakeIpcMain,
  STANDARD_COMMANDS,
  STANDARD_EVENT_NAMESPACE,
  createInvokeEvent,
  fetchOkText,
  findFreePort,
  fromBase64,
  invokeBridge,
  toBase64,
  withEnvVars,
  withTempDir,
} from './electron-shell-test-utils.js';

describe('Electron standard shell source boundaries', () => {
  it('keeps the main entry split into capability-owned modules', async () => {
    const srcRoot = path.resolve(process.cwd(), 'shell/electron/src/main');
    const hostSource = await readFile(path.join(srcRoot, 'host.ts'), 'utf8');
    expect(hostSource.split(/\r?\n/u).length).toBeLessThan(500);

    for (const moduleFile of [
      'runtime.ts',
      'runtime-trusted-metadata.ts',
      'runtime-lifecycle.ts',
      'auth.ts',
      'oauth.ts',
      'shell-ui.ts',
      'diagnostics.ts',
      'data-storage.ts',
      'local-assets.ts',
      'local-agent.ts',
      'ai-profile.ts',
      'ai-config.ts',
      'avatar.ts',
      'platform-projection.ts',
      'errors.ts',
      'paths.ts',
    ]) {
      const source = await readFile(path.join(srcRoot, moduleFile), 'utf8');
      expect(source, moduleFile).not.toContain('./host.js');
      expect(source, moduleFile).toMatch(/\bexport\b/u);
    }
  });
});
