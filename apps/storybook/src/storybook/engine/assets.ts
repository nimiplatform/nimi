// asset-spec and explicit asset states. Generated assets are the preferred
// quality path, but a package may use prebuilt or fallback assets when generation
// is unavailable/incomplete/deferred. Every asset carries an explicit state and a
// provenance trail. Missing generation is never silently treated as success.

import { type TruthRef, mintId } from './ids.js';
import { type ValidationFinding } from './failure.js';

export type AssetKind = 'character-portrait' | 'background' | 'cg' | 'prop' | 'audio' | 'video';

/**
 * Explicit asset lifecycle states. `missing`/`incomplete`/`failed` are NOT
 * usable-as-success states. `generated`/`prebuilt`/`fallback`/`replaced` are
 * usable, each with provenance.
 */
export type AssetState = 'generated' | 'prebuilt' | 'fallback' | 'missing' | 'incomplete' | 'failed' | 'replaced';

export type AssetProvenanceAction =
  | 'requested'
  | 'generated'
  | 'prebuilt-attached'
  | 'fallback-attached'
  | 'incomplete'
  | 'failed'
  | 'replaced';

export type AssetProvenanceEntry = {
  at: string;
  action: AssetProvenanceAction;
  detail: string;
  /** Set when the artifact came from an app-local generation run. */
  generationRunId?: string;
  /** Set on replacement: the artifact ref that was superseded. */
  supersededArtifactRef?: string;
};

export type AssetSpec = {
  id: string;
  ref: TruthRef;
  kind: AssetKind;
  description: string;
  requiredness: 'required' | 'optional';
  state: AssetState;
  artifactRef?: string;
  mimeType?: string;
  provenance: AssetProvenanceEntry[];
};

const USABLE_STATES: ReadonlySet<AssetState> = new Set<AssetState>(['generated', 'prebuilt', 'fallback', 'replaced']);

export function isAssetUsable(spec: AssetSpec): boolean {
  return USABLE_STATES.has(spec.state) && Boolean(spec.artifactRef);
}

export function createAssetSpec(input: {
  ref: TruthRef;
  kind: AssetKind;
  description: string;
  requiredness: 'required' | 'optional';
  now: string;
}): AssetSpec {
  return {
    id: mintId('asset'),
    ref: input.ref,
    kind: input.kind,
    description: input.description,
    requiredness: input.requiredness,
    state: 'missing',
    provenance: [{ at: input.now, action: 'requested', detail: 'Asset spec created; awaiting generation or attachment.' }],
  };
}

function withProvenance(spec: AssetSpec, entry: AssetProvenanceEntry): AssetSpec {
  return { ...spec, provenance: [...spec.provenance, entry] };
}

export function attachGeneratedArtifact(spec: AssetSpec, artifactRef: string, mimeType: string, generationRunId: string, now: string): AssetSpec {
  return withProvenance(
    { ...spec, state: 'generated', artifactRef, mimeType },
    { at: now, action: 'generated', detail: 'Generated artifact attached.', generationRunId },
  );
}

export function attachPrebuiltArtifact(spec: AssetSpec, artifactRef: string, mimeType: string, now: string): AssetSpec {
  return withProvenance(
    { ...spec, state: 'prebuilt', artifactRef, mimeType },
    { at: now, action: 'prebuilt-attached', detail: 'Approved prebuilt artifact attached.' },
  );
}

export function attachFallbackArtifact(spec: AssetSpec, artifactRef: string, mimeType: string, now: string): AssetSpec {
  return withProvenance(
    { ...spec, state: 'fallback', artifactRef, mimeType },
    { at: now, action: 'fallback-attached', detail: 'Placeholder-safe fallback artifact attached.' },
  );
}

export function markAssetIncomplete(spec: AssetSpec, detail: string, now: string): AssetSpec {
  return withProvenance({ ...spec, state: 'incomplete' }, { at: now, action: 'incomplete', detail });
}

export function markAssetFailed(spec: AssetSpec, detail: string, now: string): AssetSpec {
  return withProvenance({ ...spec, state: 'failed' }, { at: now, action: 'failed', detail });
}

/** Replace an asset's artifact while preserving provenance (origin is retained). */
export function replaceAsset(spec: AssetSpec, artifactRef: string, mimeType: string, detail: string, now: string): AssetSpec {
  return withProvenance(
    { ...spec, state: 'replaced', artifactRef, mimeType },
    { at: now, action: 'replaced', detail, supersededArtifactRef: spec.artifactRef },
  );
}

export function validateAssetSpec(spec: AssetSpec): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (!spec.description.trim()) {
    findings.push({ code: 'asset_spec_incomplete', message: `Asset ${spec.id} has no description.`, pointers: [`asset:${spec.id}`] });
  }
  if (isAssetUsable(spec) && !spec.mimeType) {
    findings.push({ code: 'asset_state_invalid', message: `Asset ${spec.id} is usable but has no MIME type.`, pointers: [`asset:${spec.id}`] });
  }
  // Missing generation is not success: a required asset cannot be left missing/failed.
  if (spec.requiredness === 'required' && !isAssetUsable(spec)) {
    findings.push({
      code: 'asset_missing_generation_not_success',
      message: `Required asset "${spec.description || spec.id}" is in state "${spec.state}" — missing generation is not success.`,
      pointers: [`asset:${spec.id}`],
    });
  }
  return findings;
}
