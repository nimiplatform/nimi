// Wave 1 (step 5) of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Dev-only VRM preview surface — mounted **only** when
// `import.meta.env.VITE_AVATAR_DEV_VRM_PREVIEW === 'true'` and the
// resolved model is VRM. Default product mode keeps the degraded
// fail-close surface (`vrm-backend.ts`); this file MUST never run in
// production builds.
//
// Wave_1 scope is limited to a placeholder visualization that proves
// the BackendBranch wiring (surface mount + lifecycle callback flow)
// without yet pulling in `@pixiv/three-vrm` runtime — the actual
// Three.js / R3F renderer lands in topic-internal wave_2 (=
// feature-matrix v3 wave_7) once VRM motion-preset / emote-state
// scaffolding is admitted.

import { useEffect } from 'react';
import type { ComponentType } from 'react';
import type { VrmAvatarModelManifest } from '@nimiplatform/kit/features/avatar/headless';
import type { BackendSurfaceProps } from '@nimiplatform/kit/features/avatar/headless';

export type VrmDevPreviewSurfaceDeps = {
  manifest: VrmAvatarModelManifest;
};

export function createVrmDevPreviewSurfaceComponent(
  deps: VrmDevPreviewSurfaceDeps,
): ComponentType<BackendSurfaceProps> {
  return function VrmDevPreviewSurface(props: BackendSurfaceProps) {
    useEffect(() => {
      props.onLifecycleEvidence?.('dev_preview_mounted', {
        source: 'vrm-dev-preview-surface',
        vrm_file: deps.manifest.vrm.vrmFile,
        motion_presets_dir: deps.manifest.vrm.motionPresetsDir ?? null,
      });
      return () => {
        props.onLifecycleEvidence?.('dev_preview_unmounted', {
          source: 'vrm-dev-preview-surface',
        });
      };
    }, [props.onLifecycleEvidence]);

    return (
      <div
        data-testid="avatar-vrm-dev-preview"
        data-avatar-vrm-dev-preview-mode="placeholder"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255, 255, 255, 0.85)',
          background:
            'linear-gradient(135deg, rgba(33, 36, 60, 0.85), rgba(70, 47, 100, 0.85))',
          fontFamily: 'monospace',
          fontSize: 12,
          padding: 16,
          textAlign: 'center',
          pointerEvents: 'none',
        }}
      >
        [dev preview]
        <br />
        VRM backend wave_1 placeholder
        <br />
        {deps.manifest.modelId}
      </div>
    );
  };
}
