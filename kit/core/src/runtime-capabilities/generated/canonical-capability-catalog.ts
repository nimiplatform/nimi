// GENERATED FILE — DO NOT EDIT.
// Source: .nimi/spec/platform/kernel/tables/canonical-capability-catalog.yaml
// Emitter: scripts/gen-canonical-capability-catalog.mjs
// Authority: P-CAPCAT-001 / P-CAPCAT-002 / P-CAPCAT-003

export type CanonicalCapabilitySectionId =
  | 'chat'
  | 'tts'
  | 'stt'
  | 'image'
  | 'video'
  | 'embed'
  | 'voice'
  | 'world';

export type CanonicalCapabilityEditorKind =
  | 'text'
  | 'image'
  | 'video'
  | 'audio-transcribe'
  | 'audio-synthesize'
  | 'voice-workflow'
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

export interface CanonicalCapabilityDescriptor {
  readonly capabilityId: string;
  readonly section: CanonicalCapabilitySectionId;
  readonly editorKind: CanonicalCapabilityEditorKind;
  readonly sourceRef: CanonicalCapabilitySourceRef;
  readonly additionalRuntimeTables: ReadonlyArray<CanonicalCapabilitySourceRef>;
  readonly i18nKeys: CanonicalCapabilityI18nKeys;
  readonly runtimeEvidenceClass: CanonicalCapabilityRuntimeEvidenceClass;
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
      title: 'ModelConfig.capability.audioSynthesize.title',
      subtitle: 'ModelConfig.capability.audioSynthesize.subtitle',
      detail: 'ModelConfig.capability.audioSynthesize.detail',
    }),
    runtimeEvidenceClass: 'job',
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
      title: 'ModelConfig.capability.audioTranscribe.title',
      subtitle: 'ModelConfig.capability.audioTranscribe.subtitle',
      detail: 'ModelConfig.capability.audioTranscribe.detail',
    }),
    runtimeEvidenceClass: 'job',
  }),
  Object.freeze({
    capabilityId: 'image.edit',
    section: 'image',
    editorKind: 'image',
    sourceRef: Object.freeze({
      table: 'local-adapter-routing',
      capability: 'image.edit',
    }),
    additionalRuntimeTables: Object.freeze([]),
    i18nKeys: Object.freeze({
      title: 'ModelConfig.capability.imageEdit.title',
      subtitle: 'ModelConfig.capability.imageEdit.subtitle',
      detail: 'ModelConfig.capability.imageEdit.detail',
    }),
    runtimeEvidenceClass: 'job',
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
      title: 'ModelConfig.capability.imageGenerate.title',
      subtitle: 'ModelConfig.capability.imageGenerate.subtitle',
      detail: 'ModelConfig.capability.imageGenerate.detail',
    }),
    runtimeEvidenceClass: 'job',
  }),
  Object.freeze({
    capabilityId: 'text.embed',
    section: 'embed',
    editorKind: null,
    sourceRef: Object.freeze({
      table: 'provider-capabilities',
      capability: 'text.embed',
    }),
    additionalRuntimeTables: Object.freeze([
      Object.freeze({
        table: 'local-adapter-routing',
        capability: 'text.embed',
      }),
    ]),
    i18nKeys: Object.freeze({
      title: 'ModelConfig.capability.textEmbed.title',
      subtitle: 'ModelConfig.capability.textEmbed.subtitle',
      detail: 'ModelConfig.capability.textEmbed.detail',
    }),
    runtimeEvidenceClass: 'job',
  }),
  Object.freeze({
    capabilityId: 'text.generate',
    section: 'chat',
    editorKind: 'text',
    sourceRef: Object.freeze({
      table: 'provider-capabilities',
      capability: 'text.generate',
    }),
    additionalRuntimeTables: Object.freeze([
      Object.freeze({
        table: 'local-adapter-routing',
        capability: 'text.generate',
      }),
    ]),
    i18nKeys: Object.freeze({
      title: 'ModelConfig.capability.textGenerate.title',
      subtitle: 'ModelConfig.capability.textGenerate.subtitle',
      detail: 'ModelConfig.capability.textGenerate.detail',
    }),
    runtimeEvidenceClass: 'turn',
  }),
  Object.freeze({
    capabilityId: 'text.generate.vision',
    section: 'chat',
    editorKind: 'text',
    sourceRef: Object.freeze({
      table: 'provider-capabilities',
      capability: 'text.generate.vision',
    }),
    additionalRuntimeTables: Object.freeze([]),
    i18nKeys: Object.freeze({
      title: 'ModelConfig.capability.textGenerateVision.title',
      subtitle: 'ModelConfig.capability.textGenerateVision.subtitle',
      detail: 'ModelConfig.capability.textGenerateVision.detail',
    }),
    runtimeEvidenceClass: 'turn',
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
      title: 'ModelConfig.capability.videoGenerate.title',
      subtitle: 'ModelConfig.capability.videoGenerate.subtitle',
      detail: 'ModelConfig.capability.videoGenerate.detail',
    }),
    runtimeEvidenceClass: 'job',
  }),
  Object.freeze({
    capabilityId: 'voice_workflow.tts_t2v',
    section: 'voice',
    editorKind: 'voice-workflow',
    sourceRef: Object.freeze({
      table: 'provider-capabilities',
      capability: 'voice_workflow.tts_t2v',
    }),
    additionalRuntimeTables: Object.freeze([]),
    i18nKeys: Object.freeze({
      title: 'ModelConfig.capability.voiceWorkflowTtsT2v.title',
      subtitle: 'ModelConfig.capability.voiceWorkflowTtsT2v.subtitle',
      detail: 'ModelConfig.capability.voiceWorkflowTtsT2v.detail',
    }),
    runtimeEvidenceClass: 'workflow',
  }),
  Object.freeze({
    capabilityId: 'voice_workflow.tts_v2v',
    section: 'voice',
    editorKind: 'voice-workflow',
    sourceRef: Object.freeze({
      table: 'provider-capabilities',
      capability: 'voice_workflow.tts_v2v',
    }),
    additionalRuntimeTables: Object.freeze([]),
    i18nKeys: Object.freeze({
      title: 'ModelConfig.capability.voiceWorkflowTtsV2v.title',
      subtitle: 'ModelConfig.capability.voiceWorkflowTtsV2v.subtitle',
      detail: 'ModelConfig.capability.voiceWorkflowTtsV2v.detail',
    }),
    runtimeEvidenceClass: 'workflow',
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
      title: 'ModelConfig.capability.worldGenerate.title',
      subtitle: 'ModelConfig.capability.worldGenerate.subtitle',
      detail: 'ModelConfig.capability.worldGenerate.detail',
    }),
    runtimeEvidenceClass: 'job',
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
  Object.freeze({
    capability: '*',
    table: 'local-adapter-routing',
    reason: 'Wildcard fallback route used by openai_compat_adapter for unlisted capabilities. Not a canonical capability identity; it is the runtime local-adapter fallback marker.',
    sourceRule: 'K-LOCAL-017',
  }),
  Object.freeze({
    capability: 'audio.understand',
    table: 'local-adapter-routing',
    reason: 'Audio-understanding route admitted by llama_native_adapter but not yet admitted as a cross-layer CanonicalCapabilityId; consumers currently consume transcription via audio.transcribe.',
    sourceRule: 'K-LOCAL-017',
  }),
  Object.freeze({
    capability: 'chat',
    table: 'local-adapter-routing',
    reason: 'Legacy alias token emitted by llama_native_adapter route; the canonical identity for conversational text is text.generate (P-CAPCAT-001). The runtime route remains admitted while the adapter migrates off the alias.',
    sourceRule: 'K-LOCAL-017',
  }),
  Object.freeze({
    capability: 'embed',
    table: 'local-adapter-routing',
    reason: 'Short-form alias emitted by llama_native_adapter embedding route; canonical identity is text.embed. Kept admitted only as a runtime route token.',
    sourceRule: 'K-LOCAL-017',
  }),
  Object.freeze({
    capability: 'embedding',
    table: 'local-adapter-routing',
    reason: 'Legacy alias token for llama_native_adapter embedding route; canonical identity is text.embed. Runtime route stays admitted until the adapter rename lands.',
    sourceRule: 'K-LOCAL-017',
  }),
  Object.freeze({
    capability: 'i2v',
    table: 'local-adapter-routing',
    reason: 'Image-to-video route token emitted by media_native_adapter; canonical identity for cross-layer video generation is video.generate. Kept as a runtime-only token pending adapter rename.',
    sourceRule: 'K-LOCAL-017',
  }),
  Object.freeze({
    capability: 'image.understand',
    table: 'local-adapter-routing',
    reason: 'Image-understanding route admitted by llama_native_adapter but not yet admitted as a cross-layer CanonicalCapabilityId; consumers today obtain vision context through text.generate.vision instead.',
    sourceRule: 'K-LOCAL-017',
  }),
  Object.freeze({
    capability: 'music',
    table: 'local-adapter-routing',
    reason: 'Coarse-grained music route token emitted by sidecar_music_adapter; retained as a runtime-only token pending admission of a canonical music section.',
    sourceRule: 'K-LOCAL-017',
  }),
  Object.freeze({
    capability: 'music.generate',
    table: 'provider-capabilities',
    reason: 'Music generation token admitted by select providers but not yet admitted as a cross-layer CanonicalCapabilityId. No consumer AIConfig currently emits music.generate; deferred until a music section is admitted in the canonical catalog.',
    sourceRule: 'K-MCAT-027',
  }),
  Object.freeze({
    capability: 'music.generate',
    table: 'local-adapter-routing',
    reason: 'Local sidecar music route token emitted by sidecar_music_adapter; canonical identity deferred alongside the provider-plane music.generate admission.',
    sourceRule: 'K-LOCAL-017',
  }),
  Object.freeze({
    capability: 'music.generate.iteration',
    table: 'provider-capabilities',
    reason: 'Iterative-music-generation token admitted by a single provider; deferred for the same reason as music.generate. No cross-layer canonical identity yet.',
    sourceRule: 'K-MCAT-027',
  }),
]);
