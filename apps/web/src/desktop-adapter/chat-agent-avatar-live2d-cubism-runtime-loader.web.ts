import type {
  OfficialCubismRuntime,
} from '../../../desktop/src/shell/renderer/features/chat/chat-agent-avatar-live2d-cubism-runtime-types';

export async function loadOfficialCubismRuntimeModules(): Promise<OfficialCubismRuntime> {
  throw new Error('Live2D Cubism runtime is not available in the web shell.');
}
