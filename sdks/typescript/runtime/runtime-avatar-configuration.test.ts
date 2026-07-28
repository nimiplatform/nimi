import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNimiHostAvatarConfigurationSurface,
  validateAvatarConfigurationRecord,
  type NimiAvatarConfigurationRecord,
  type NimiHostAvatarConfigurationStore,
} from './runtime-avatar-configuration';

function validRecord(overrides: Partial<NimiAvatarConfigurationRecord> = {}): NimiAvatarConfigurationRecord {
  return {
    agentId: 'agent-1',
    conversationAnchorScope: 'current_anchor',
    live2dAdapterManifestSource: 'none',
    avatarInstancePolicy: 'reuse_active_instance',
    backendKind: 'vrm',
    launchMode: 'manual',
    debugProfile: 'standard',
    updatedAt: '2026-06-11T08:00:00Z',
    provenance: { source: 'user_selection', evidenceRef: 'evidence-1' },
    ...overrides,
  };
}

function memoryStore(): { store: NimiHostAvatarConfigurationStore; saved: NimiAvatarConfigurationRecord[] } {
  const records = new Map<string, NimiAvatarConfigurationRecord>();
  const saved: NimiAvatarConfigurationRecord[] = [];
  return {
    saved,
    store: {
      async load(input) {
        return records.get(input.agentId);
      },
      async save(record) {
        records.set(record.agentId, record);
        saved.push(record);
      },
    },
  };
}

test('surface requires an explicit host store adapter', () => {
  assert.throws(
    () => createNimiHostAvatarConfigurationSurface({ store: undefined as never }),
    { code: 'SDK_AVATAR_CONFIGURATION_STORE_REQUIRED' },
  );
});

test('upsert validates and persists, get returns the stored record', async () => {
  const { store, saved } = memoryStore();
  const surface = createNimiHostAvatarConfigurationSurface({ store });
  const record = validRecord();
  const result = await surface.upsert(record);
  assert.deepEqual(result, record);
  assert.equal(saved.length, 1);
  const loaded = await surface.get({ agentId: 'agent-1' });
  assert.deepEqual(loaded, record);
  const missing = await surface.get({ agentId: 'agent-other' });
  assert.equal(missing, undefined);
});

test('get fails closed on missing agentId and unknown scope', async () => {
  const { store } = memoryStore();
  const surface = createNimiHostAvatarConfigurationSurface({ store });
  await assert.rejects(surface.get({ agentId: '' }), { code: 'SDK_AVATAR_CONFIGURATION_RECORD_INVALID' });
  await assert.rejects(
    surface.get({ agentId: 'agent-1', conversationAnchorScope: 'everything' as never }),
    { code: 'SDK_AVATAR_CONFIGURATION_RECORD_INVALID' },
  );
});

test('get fails closed when host state is corrupt instead of projecting it', async () => {
  const corrupt = { ...validRecord(), backendKind: 'hologram' } as unknown as NimiAvatarConfigurationRecord;
  const store: NimiHostAvatarConfigurationStore = {
    async load() {
      return corrupt;
    },
    async save() {},
  };
  const surface = createNimiHostAvatarConfigurationSurface({ store });
  await assert.rejects(surface.get({ agentId: 'agent-1' }), { code: 'SDK_AVATAR_CONFIGURATION_RECORD_INVALID' });
});

test('validation rejects every enum escape and missing required field', () => {
  const cases: Array<Partial<NimiAvatarConfigurationRecord>> = [
    { agentId: '' },
    { conversationAnchorScope: 'global' as never },
    { live2dAdapterManifestSource: 'merged' as never },
    { avatarInstancePolicy: 'always_new' as never },
    { backendKind: 'sprite3d' as never },
    { launchMode: 'auto' as never },
    { debugProfile: 'verbose' as never },
    { generatedMotionProviderPolicy: 'always' as never },
    { updatedAt: 'yesterday' },
    { provenance: undefined as never },
    { provenance: { source: 'guess' as never, evidenceRef: 'e' } },
    { provenance: { source: 'user_selection', evidenceRef: '' } },
  ];
  for (const overrides of cases) {
    assert.throws(
      () => validateAvatarConfigurationRecord(validRecord(overrides)),
      { code: 'SDK_AVATAR_CONFIGURATION_RECORD_INVALID' },
      `expected rejection for ${JSON.stringify(overrides)}`,
    );
  }
});

test('external sidecar manifest source requires the opaque manifest ref pattern', () => {
  assert.throws(
    () => validateAvatarConfigurationRecord(validRecord({ live2dAdapterManifestSource: 'external_sidecar_manifest' })),
    (error: unknown) => {
      const nimiError = error as {
        readonly code?: string;
        readonly reasonCode?: string;
        readonly actionHint?: string;
      };
      assert.equal(nimiError.code, 'SDK_AVATAR_CONFIGURATION_RECORD_INVALID');
      assert.equal(nimiError.reasonCode, 'SDK_AVATAR_CONFIGURATION_RECORD_INVALID');
      assert.equal(nimiError.actionHint, 'provide_live2d_adapter_manifest_ref');
      return true;
    },
  );
  assert.throws(
    () =>
      validateAvatarConfigurationRecord(
        validRecord({
          live2dAdapterManifestSource: 'external_sidecar_manifest',
          live2dAdapterManifestRef: '/abs/path/manifest.json',
        }),
      ),
    (error: unknown) => {
      const nimiError = error as {
        readonly code?: string;
        readonly reasonCode?: string;
        readonly actionHint?: string;
      };
      assert.equal(nimiError.code, 'SDK_AVATAR_CONFIGURATION_RECORD_INVALID');
      assert.equal(nimiError.reasonCode, 'SDK_AVATAR_CONFIGURATION_RECORD_INVALID');
      assert.equal(nimiError.actionHint, 'use_opaque_live2d_adapter_manifest_ref');
      return true;
    },
  );
  validateAvatarConfigurationRecord(
    validRecord({
      live2dAdapterManifestSource: 'external_sidecar_manifest',
      live2dAdapterManifestRef: 'live2d_adapter_0123456789ab',
    }),
  );
});

test('record closure rejects unadmitted fields not on the forbidden list', () => {
  const polluted = { ...validRecord(), apiKey: 'sk-x', modelPath: '/x' } as unknown as NimiAvatarConfigurationRecord;
  assert.throws(
    () => validateAvatarConfigurationRecord(polluted),
    { code: 'SDK_AVATAR_CONFIGURATION_RECORD_INVALID' },
  );
});

test('optional refs must be strings when present, and manifest-ref pattern holds regardless of source', () => {
  assert.throws(
    () => validateAvatarConfigurationRecord(validRecord({ localAvatarAssetRef: 12345 as never })),
    { code: 'SDK_AVATAR_CONFIGURATION_RECORD_INVALID' },
  );
  assert.throws(
    () => validateAvatarConfigurationRecord(validRecord({ backendCapabilityProfileRef: { evil: true } as never })),
    { code: 'SDK_AVATAR_CONFIGURATION_RECORD_INVALID' },
  );
  // A present manifest ref with source 'none' must still satisfy the opaque pattern.
  assert.throws(
    () => validateAvatarConfigurationRecord(validRecord({ live2dAdapterManifestRef: '/abs/path/manifest.json' })),
    (error: unknown) => {
      const nimiError = error as {
        readonly code?: string;
        readonly reasonCode?: string;
        readonly actionHint?: string;
      };
      assert.equal(nimiError.code, 'SDK_AVATAR_CONFIGURATION_RECORD_INVALID');
      assert.equal(nimiError.reasonCode, 'SDK_AVATAR_CONFIGURATION_RECORD_INVALID');
      assert.equal(nimiError.actionHint, 'use_opaque_live2d_adapter_manifest_ref');
      return true;
    },
  );
  // A valid opaque ref with source 'none' is accepted.
  validateAvatarConfigurationRecord(validRecord({ live2dAdapterManifestRef: 'live2d_adapter_0123456789ab' }));
});

test('every D-LLM-079 forbidden field fails closed instead of being dropped', () => {
  const forbidden = [
    'package_descriptor',
    'packagePath',
    'launch_local_asset_id',
    'live2dAdapterManifestPayload',
    'live2d_adapter_manifest_path',
    'live2dAdapterManifestAbsolutePath',
    'compatibility_tier',
    'avatarCompatibilityDiagnostics',
    'carrier_registry_id',
    'scopedAvatarBindingId',
    'account_id',
    'userId',
    'realm_url',
    'token',
    'refreshToken',
    'jwt',
    'auth_payload',
    'raw_apml',
    'rawMcp',
    'raw_a2a',
    'rawProviderOutput',
    'backend_command',
  ];
  for (const field of forbidden) {
    const polluted = { ...validRecord(), [field]: 'x' } as NimiAvatarConfigurationRecord;
    assert.throws(
      () => validateAvatarConfigurationRecord(polluted),
      { code: 'SDK_AVATAR_CONFIGURATION_FORBIDDEN_FIELD' },
      `expected forbidden-field rejection for ${field}`,
    );
  }
});
