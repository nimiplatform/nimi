import { getRuntimePlatformProjection } from '../shell/auth/runtime-platform.js';
import type { StudioRuntimeInspection } from '../ai-studio-core/runtime-types.js';

export async function inspectRuntimeConnection(
  getProjection: typeof getRuntimePlatformProjection = getRuntimePlatformProjection,
): Promise<StudioRuntimeInspection> {
  const projection = await getProjection();
  if (projection.status !== 'ready') {
    return { status: 'unavailable', mode: projection.mode, detail: projection.message };
  }
  return {
    status: 'connected',
    mode: projection.mode,
    detail: 'The protected local-app identity session is bound and Runtime is connected. The App AIConfig selects Local or an exact Cloud implementation; machine selection and execution availability remain Runtime-owned. Text requests run through the canonical Runtime execution path and fail closed with typed reasons when the composed route is not executable.',
  };
}
