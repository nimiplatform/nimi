import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeAvatarPackageHandoff,
} from '../../src/runtime/index.js';
import {
  createRuntimeAvatarPackageModule,
} from '../../src/runtime/runtime-avatar-package.js';

function live2dProjection(overrides: object = {}) {
  return {
    avatar_package_ref: 'am.package/avatar-live2d-hiyori',
    package_kind: 'avatar',
    package_id: 'pkg-avatar-live2d-hiyori',
    bundle_id: 'bundle-avatar-live2d-hiyori',
    bundle_member_asset_ids: [
      'asset-live2d-model3',
      'asset-live2d-texture-1',
      'asset-live2d-motion-idle',
    ],
    backend_kind: 'live2d',
    backend_capability_profile_ref: 'avatar.backend_profile/live2d/basic',
    avatar_model_layout: {
      layout_version: 1,
      backend_kind: 'live2d',
      entry_asset_id: 'asset-live2d-model3',
      runtime_root: 'runtime',
      required_asset_ids: [
        'asset-live2d-model3',
        'asset-live2d-texture-1',
      ],
      live2d: {
        model3_json_asset_id: 'asset-live2d-model3',
        model3_json_path: 'runtime/hiyori.model3.json',
      },
    },
    provenance: {
      source_type: 'first_party_curated',
      source_fingerprint: 'sha256:live2d-fixture',
      admitted_at: '2026-05-16T00:00:00Z',
      validator: 'asset-market/avatar-package-kind',
    },
    compatibility_diagnostics: [
      {
        code: 'AVATAR_PACKAGE_COMPAT_OK',
        severity: 'info',
      },
    ],
    status: 'published',
    is_ready: true,
    readiness_issues: [],
    version: 1,
    materialization_ref: 'avatar.materialization/live2d-hiyori',
    observed_at: '2026-05-16T00:00:01Z',
    ...overrides,
  };
}

test('decodeAvatarPackageHandoff normalizes a launch-eligible Live2D avatar package without exposing layout truth', () => {
  const handoff = decodeAvatarPackageHandoff(live2dProjection());

  assert.deepEqual(handoff, {
    avatarPackageRef: 'am.package/avatar-live2d-hiyori',
    backendKind: 'live2d',
    backendCapabilityProfileRef: 'avatar.backend_profile/live2d/basic',
    readiness: 'launch_eligible',
    diagnosticIds: ['AVATAR_PACKAGE_COMPAT_OK'],
    materializationRef: 'avatar.materialization/live2d-hiyori',
  });
  assert.equal('avatarModelLayout' in handoff, false);
  assert.equal('avatar_model_layout' in handoff, false);
  assert.equal('provenance' in handoff, false);
  assert.equal('packageId' in handoff, false);
  assert.equal('packageDescriptor' in handoff, false);
});

test('decodeAvatarPackageHandoff accepts generated proto Live2D field casing', () => {
  const generatedShape = live2dProjection({
    avatarModelLayout: {
      layoutVersion: 1,
      backendKind: 'live2d',
      entryAssetId: 'asset-live2d-model3',
      runtimeRoot: 'runtime',
      requiredAssetIds: ['asset-live2d-model3', 'asset-live2d-texture-1'],
      live2D: {
        model3JsonAssetId: 'asset-live2d-model3',
        model3JsonPath: 'runtime/hiyori.model3.json',
      },
    },
    avatar_model_layout: undefined,
    avatarPackageRef: 'am.package/avatar-live2d-hiyori',
    packageKind: 'avatar',
    packageId: 'pkg-avatar-live2d-hiyori',
    bundleId: 'bundle-avatar-live2d-hiyori',
    bundleMemberAssetIds: [
      'asset-live2d-model3',
      'asset-live2d-texture-1',
      'asset-live2d-motion-idle',
    ],
    backendKind: 'live2d',
    backendCapabilityProfileRef: 'avatar.backend_profile/live2d/basic',
    compatibilityDiagnostics: [
      {
        code: 'AVATAR_PACKAGE_COMPAT_OK',
        severity: 'info',
      },
    ],
    isReady: true,
    readinessIssues: [],
    materializationRef: 'avatar.materialization/live2d-hiyori',
  });

  assert.deepEqual(decodeAvatarPackageHandoff(generatedShape), {
    avatarPackageRef: 'am.package/avatar-live2d-hiyori',
    backendKind: 'live2d',
    backendCapabilityProfileRef: 'avatar.backend_profile/live2d/basic',
    readiness: 'launch_eligible',
    diagnosticIds: ['AVATAR_PACKAGE_COMPAT_OK'],
    materializationRef: 'avatar.materialization/live2d-hiyori',
  });
});

test('decodeAvatarPackageHandoff accepts a VRM avatar package layout and emits only safe refs', () => {
  const handoff = decodeAvatarPackageHandoff({
    avatarPackageRef: 'am.package/avatar-vrm-sample',
    packageKind: 'avatar',
    packageId: 'pkg-avatar-vrm-sample',
    bundleId: 'bundle-avatar-vrm-sample',
    bundleMemberAssetIds: ['asset-vrm-file'],
    backendKind: 'vrm',
    backendCapabilityProfileRef: 'avatar.backend_profile/vrm/basic',
    avatarModelLayout: {
      layoutVersion: 1,
      backendKind: 'vrm',
      entryAssetId: 'asset-vrm-file',
      runtimeRoot: 'runtime',
      requiredAssetIds: ['asset-vrm-file'],
      vrm: {
        vrmAssetId: 'asset-vrm-file',
        vrmFilePath: 'runtime/sample.vrm',
      },
    },
    provenance: {
      sourceType: 'imported_local_materialization',
      sourceFingerprint: 'sha256:vrm-fixture',
      admittedAt: '2026-05-16T00:00:00Z',
      validator: 'asset-market/avatar-package-kind',
    },
    compatibilityDiagnostics: [],
    status: 'published',
    isReady: true,
    readinessIssues: [],
    materializationRef: 'avatar.materialization/vrm-sample',
  });

  assert.deepEqual(handoff, {
    avatarPackageRef: 'am.package/avatar-vrm-sample',
    backendKind: 'vrm',
    backendCapabilityProfileRef: 'avatar.backend_profile/vrm/basic',
    readiness: 'launch_eligible',
    diagnosticIds: [],
    materializationRef: 'avatar.materialization/vrm-sample',
  });
  assert.equal('avatarModelLayout' in handoff, false);
});

test('decodeAvatarPackageHandoff rejects non-launched backend kinds and preview package kinds', () => {
  assert.throws(
    () => decodeAvatarPackageHandoff(live2dProjection({ backend_kind: 'sprite2d' })),
    /unsupported backend_kind: sprite2d/,
  );
  assert.throws(
    () => decodeAvatarPackageHandoff(live2dProjection({ package_kind: 'avatar-sprite2d-preview' })),
    /package_kind must be avatar/,
  );
});

test('decodeAvatarPackageHandoff rejects unsafe layout paths and missing bundle members before handoff', () => {
  assert.throws(
    () => decodeAvatarPackageHandoff(live2dProjection({
      avatar_model_layout: {
        ...live2dProjection().avatar_model_layout,
        runtime_root: '/tmp/avatar',
      },
    })),
    /runtime_root must be a relative path/,
  );
  assert.throws(
    () => decodeAvatarPackageHandoff(live2dProjection({
      avatar_model_layout: {
        ...live2dProjection().avatar_model_layout,
        required_asset_ids: ['asset-live2d-model3', 'asset-not-in-bundle'],
      },
    })),
    /required_asset_ids must belong to bundleMemberAssetIds/,
  );
  assert.throws(
    () => decodeAvatarPackageHandoff(live2dProjection({
      avatar_model_layout: {
        ...live2dProjection().avatar_model_layout,
        live2d: {
          model3_json_asset_id: 'asset-live2d-model3',
          model3_json_path: 'https://example.test/hiyori.model3.json',
        },
      },
    })),
    /model3_json_path must not be absolute or URL/,
  );
});

test('avatar package launch eligibility fails closed on blocking diagnostics and missing materialization', () => {
  assert.throws(
    () => decodeAvatarPackageHandoff(live2dProjection({
      compatibility_diagnostics: [
        {
          code: 'AVATAR_PACKAGE_COMPAT_BLOCKED',
          severity: 'blocking',
        },
      ],
    })),
    /blocking diagnostics: AVATAR_PACKAGE_COMPAT_BLOCKED/,
  );
  assert.throws(
    () => decodeAvatarPackageHandoff(live2dProjection({ materialization_ref: '' })),
    /local materialization ref is missing/,
  );
});

test('decodeAvatarPackageHandoff rejects future UGC and authority-leaking payload fields', () => {
  assert.throws(
    () => decodeAvatarPackageHandoff(live2dProjection({
      provenance: {
        source_type: 'future_reviewed_ugc',
        source_fingerprint: 'sha256:ugc',
        admitted_at: '2026-05-16T00:00:00Z',
        validator: 'asset-market/avatar-package-kind',
      },
    })),
    /future_reviewed_ugc requires AM-MOD admission/,
  );
  assert.throws(
    () => decodeAvatarPackageHandoff(live2dProjection({
      packageDescriptor: { runtimeRoot: '/tmp/descriptor' },
    })),
    /must not include package.packageDescriptor/,
  );
});

test('Runtime avatar package module calls the locked RuntimeAgentService method with protected read scope', async () => {
  const observed: Array<{
    request: unknown;
    options: unknown;
  }> = [];
  const module = createRuntimeAvatarPackageModule({
    appId: 'nimi.avatar',
    agent: {
      resolveAvatarPackageLaunchProjection: async (request: unknown, options: unknown) => {
        observed.push({ request, options });
        return live2dProjection();
      },
    } as never,
    protectedAccess: {
      async getCallOptions(scopes) {
        assert.deepEqual(scopes, ['runtime.agent.avatar_package.read']);
        return { metadata: { traceId: 'avatar-package-projection-test' } };
      },
    },
    resolveSubjectUserId: async (explicit) => explicit || 'user-1',
  });

  const result = await module.resolveLaunchProjection({
    accountId: 'user-1',
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    avatarInstanceId: 'avatar-instance-1',
  });

  assert.deepEqual(result, live2dProjection());
  assert.deepEqual(observed, [
    {
      request: {
        context: {
          appId: 'nimi.avatar',
          subjectUserId: 'user-1',
          ownerUserId: 'user-1',
          realmAgentId: 'agent-1',
          localAgentRef: 'local-agent:user-1:agent-1',
        },
        avatarInstanceId: 'avatar-instance-1',
      },
      options: { metadata: { traceId: 'avatar-package-projection-test' } },
    },
  ]);
});

test('Runtime avatar package module fails closed when the Runtime RPC is not available', async () => {
  const module = createRuntimeAvatarPackageModule({
    appId: 'nimi.avatar',
    agent: {} as never,
    protectedAccess: {
      async getCallOptions() {
        return {};
      },
    },
    resolveSubjectUserId: async (explicit) => explicit || 'user-1',
  });

  await assert.rejects(
    () => module.resolveLaunchProjection({
      accountId: 'user-1',
      ownerUserId: 'user-1',
      realmAgentId: 'agent-1',
      localAgentRef: 'local-agent:user-1:agent-1',
      avatarInstanceId: 'avatar-instance-1',
    }),
    /ResolveAvatarPackageLaunchProjection/,
  );
});
