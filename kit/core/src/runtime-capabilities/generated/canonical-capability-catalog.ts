// GENERATED FILE — DO NOT EDIT.
// Source: config/platform-canonical-capability-catalog.yaml
// Emitter: scripts/gen-canonical-capability-catalog.mjs
// Authority: P-CAPCAT-001 / P-CAPCAT-002 / P-CAPCAT-003 / P-CAPCAT-004

export type CanonicalCapabilitySectionId =
  | 'chat'
  | 'tts'
  | 'stt'
  | 'image'
  | 'video'
  | 'embed'
  | 'voice'
  | 'world'
  | 'music';

export type CanonicalCapabilityEditorKind =
  | 'text'
  | 'image'
  | 'video'
  | 'audio-transcribe'
  | 'audio-synthesize'
  | 'voice-create'
  | null;

export type CanonicalCapabilityRuntimeEvidenceClass =
  | 'turn'
  | 'job'
  | 'workflow';

export type CanonicalCapabilitySourceTable =
  | 'provider-capabilities'
  | 'local-adapter-routing';

export interface CanonicalCapabilitySourceRef {
  readonly table: CanonicalCapabilitySourceTable;
  readonly capability: string;
}

export interface CanonicalCapabilityI18nKeys {
  readonly title: string;
  readonly subtitle: string;
  readonly detail: string;
}

export interface CanonicalCapabilityGovernance {
  readonly owner: string;
  readonly dataMovement: string;
  readonly retention: string;
  readonly revocation: string;
  readonly auditSource: string;
}

export interface CanonicalCapabilityDescriptor {
  readonly capabilityId: string;
  readonly section: CanonicalCapabilitySectionId;
  readonly editorKind: CanonicalCapabilityEditorKind;
  readonly sourceRef: CanonicalCapabilitySourceRef;
  readonly additionalRuntimeTables: ReadonlyArray<CanonicalCapabilitySourceRef>;
  readonly i18nKeys: CanonicalCapabilityI18nKeys;
  readonly runtimeEvidenceClass: CanonicalCapabilityRuntimeEvidenceClass;
  readonly governance: CanonicalCapabilityGovernance;
}

export interface CanonicalCapabilityDeferredEntry {
  readonly capability: string;
  readonly table: CanonicalCapabilitySourceTable;
  readonly reason: string;
  readonly sourceRule: string;
}

export const CANONICAL_CAPABILITY_CATALOG: ReadonlyArray<CanonicalCapabilityDescriptor> = Object.freeze([
  Object.freeze({
    capabilityId: 'audio.synthesize',
    section: 'tts',
    editorKind: 'audio-synthesize',
    sourceRef: Object.freeze({
      table: 'provider-capabilities',
      capability: 'audio.synthesize',
    }),
    additionalRuntimeTables: Object.freeze([
      Object.freeze({
        table: 'local-adapter-routing',
        capability: 'audio.synthesize',
      }),
    ]),
    i18nKeys: Object.freeze({
      title: 'AIConfig.capability.audioSynthesize.title',
      subtitle: 'AIConfig.capability.audioSynthesize.subtitle',
      detail: 'AIConfig.capability.audioSynthesize.detail',
    }),
    runtimeEvidenceClass: 'job',
    governance: Object.freeze({
      owner: 'runtime-audio-route',
      dataMovement: 'local-or-cloud-by-selected-route',
      retention: 'runtime-audio-policy',
      revocation: 'route-or-connector-owner',
      auditSource: 'runtime-scenario-job-evidence',
    }),
  }),
  Object.freeze({
    capabilityId: 'audio.transcribe',
    section: 'stt',
    editorKind: 'audio-transcribe',
    sourceRef: Object.freeze({
      table: 'provider-capabilities',
      capability: 'audio.transcribe',
    }),
    additionalRuntimeTables: Object.freeze([
      Object.freeze({
        table: 'local-adapter-routing',
        capability: 'audio.transcribe',
      }),
    ]),
    i18nKeys: Object.freeze({
      title: 'AIConfig.capability.audioTranscribe.title',
      subtitle: 'AIConfig.capability.audioTranscribe.subtitle',
      detail: 'AIConfig.capability.audioTranscribe.detail',
    }),
    runtimeEvidenceClass: 'job',
    governance: Object.freeze({
      owner: 'runtime-audio-route',
      dataMovement: 'local-or-cloud-by-selected-route',
      retention: 'runtime-audio-policy',
      revocation: 'route-or-connector-owner',
      auditSource: 'runtime-scenario-job-evidence',
    }),
  }),
  Object.freeze({
    capabilityId: 'image.generate',
    section: 'image',
    editorKind: 'image',
    sourceRef: Object.freeze({
      table: 'provider-capabilities',
      capability: 'image.generate',
    }),
    additionalRuntimeTables: Object.freeze([
      Object.freeze({
        table: 'local-adapter-routing',
        capability: 'image.generate',
      }),
    ]),
    i18nKeys: Object.freeze({
      title: 'AIConfig.capability.imageGenerate.title',
      subtitle: 'AIConfig.capability.imageGenerate.subtitle',
      detail: 'AIConfig.capability.imageGenerate.detail',
    }),
    runtimeEvidenceClass: 'job',
    governance: Object.freeze({
      owner: 'runtime-media-route',
      dataMovement: 'local-or-cloud-by-selected-route',
      retention: 'runtime-artifact-policy',
      revocation: 'route-or-artifact-owner',
      auditSource: 'runtime-scenario-job-evidence',
    }),
  }),
  Object.freeze({
    capabilityId: 'music.generate',
    section: 'music',
    editorKind: null,
    sourceRef: Object.freeze({
      table: 'provider-capabilities',
      capability: 'music.generate',
    }),
    additionalRuntimeTables: Object.freeze([
      Object.freeze({
        table: 'local-adapter-routing',
        capability: 'music.generate',
      }),
    ]),
    i18nKeys: Object.freeze({
      title: 'AIConfig.capability.musicGenerate.title',
      subtitle: 'AIConfig.capability.musicGenerate.subtitle',
      detail: 'AIConfig.capability.musicGenerate.detail',
    }),
    runtimeEvidenceClass: 'job',
    governance: Object.freeze({
      owner: 'runtime-music-route',
      dataMovement: 'local-or-cloud-by-selected-route',
      retention: 'runtime-artifact-policy',
      revocation: 'route-or-artifact-owner',
      auditSource: 'runtime-scenario-job-evidence',
    }),
  }),
  Object.freeze({
    capabilityId: 'text.embed',
    section: 'embed',
    editorKind: null,
    sourceRef: Object.freeze({
      table: 'provider-capabilities',
      capability: 'text.embed',
    }),
    additionalRuntimeTables: Object.freeze([]),
    i18nKeys: Object.freeze({
      title: 'AIConfig.capability.textEmbed.title',
      subtitle: 'AIConfig.capability.textEmbed.subtitle',
      detail: 'AIConfig.capability.textEmbed.detail',
    }),
    runtimeEvidenceClass: 'job',
    governance: Object.freeze({
      owner: 'runtime-memory-route',
      dataMovement: 'local-or-cloud-by-embedding-route',
      retention: 'runtime-memory-policy',
      revocation: 'memory-policy-or-route-owner',
      auditSource: 'runtime-memory-evidence',
    }),
  }),
  Object.freeze({
    capabilityId: 'text.generate',
    section: 'chat',
    editorKind: 'text',
    sourceRef: Object.freeze({
      table: 'provider-capabilities',
      capability: 'text.generate',
    }),
    additionalRuntimeTables: Object.freeze([]),
    i18nKeys: Object.freeze({
      title: 'AIConfig.capability.textGenerate.title',
      subtitle: 'AIConfig.capability.textGenerate.subtitle',
      detail: 'AIConfig.capability.textGenerate.detail',
    }),
    runtimeEvidenceClass: 'turn',
    governance: Object.freeze({
      owner: 'runtime-route',
      dataMovement: 'local-or-cloud-by-selected-route',
      retention: 'zhiyu-retains-no-provider-payload',
      revocation: 'change-runtime-route-or-revoke-connector',
      auditSource: 'runtime-route-evidence',
    }),
  }),
  Object.freeze({
    capabilityId: 'video.generate',
    section: 'video',
    editorKind: 'video',
    sourceRef: Object.freeze({
      table: 'provider-capabilities',
      capability: 'video.generate',
    }),
    additionalRuntimeTables: Object.freeze([
      Object.freeze({
        table: 'local-adapter-routing',
        capability: 'video.generate',
      }),
    ]),
    i18nKeys: Object.freeze({
      title: 'AIConfig.capability.videoGenerate.title',
      subtitle: 'AIConfig.capability.videoGenerate.subtitle',
      detail: 'AIConfig.capability.videoGenerate.detail',
    }),
    runtimeEvidenceClass: 'job',
    governance: Object.freeze({
      owner: 'runtime-media-route',
      dataMovement: 'local-or-cloud-by-selected-route',
      retention: 'runtime-artifact-policy',
      revocation: 'route-or-artifact-owner',
      auditSource: 'runtime-scenario-job-evidence',
    }),
  }),
  Object.freeze({
    capabilityId: 'voice.create',
    section: 'tts',
    editorKind: 'voice-create',
    sourceRef: Object.freeze({
      table: 'provider-capabilities',
      capability: 'voice.create',
    }),
    additionalRuntimeTables: Object.freeze([]),
    i18nKeys: Object.freeze({
      title: 'AIConfig.capability.voiceCreate.title',
      subtitle: 'AIConfig.capability.voiceCreate.subtitle',
      detail: 'AIConfig.capability.voiceCreate.detail',
    }),
    runtimeEvidenceClass: 'job',
    governance: Object.freeze({
      owner: 'runtime-voice-creation',
      dataMovement: 'local-or-cloud-by-selected-route',
      retention: 'runtime-voice-asset-policy',
      revocation: 'runtime-voice-asset-owner',
      auditSource: 'runtime-scenario-job-evidence',
    }),
  }),
  Object.freeze({
    capabilityId: 'world.generate',
    section: 'world',
    editorKind: null,
    sourceRef: Object.freeze({
      table: 'provider-capabilities',
      capability: 'world.generate',
    }),
    additionalRuntimeTables: Object.freeze([]),
    i18nKeys: Object.freeze({
      title: 'AIConfig.capability.worldGenerate.title',
      subtitle: 'AIConfig.capability.worldGenerate.subtitle',
      detail: 'AIConfig.capability.worldGenerate.detail',
    }),
    runtimeEvidenceClass: 'job',
    governance: Object.freeze({
      owner: 'runtime-world-route',
      dataMovement: 'local-or-cloud-by-selected-route',
      retention: 'runtime-artifact-policy',
      revocation: 'route-or-artifact-owner',
      auditSource: 'runtime-scenario-job-evidence',
    }),
  }),
]);

export const CANONICAL_CAPABILITY_CATALOG_BY_ID: Readonly<Record<string, CanonicalCapabilityDescriptor>> = Object.freeze(
  CANONICAL_CAPABILITY_CATALOG.reduce<Record<string, CanonicalCapabilityDescriptor>>((acc, row) => {
    acc[row.capabilityId] = row;
    return acc;
  }, {}),
);

export const CANONICAL_CAPABILITY_IDS: ReadonlyArray<string> = Object.freeze(
  CANONICAL_CAPABILITY_CATALOG.map((row) => row.capabilityId),
);

export const CANONICAL_CAPABILITY_DEFERRED: ReadonlyArray<CanonicalCapabilityDeferredEntry> = Object.freeze([
]);
