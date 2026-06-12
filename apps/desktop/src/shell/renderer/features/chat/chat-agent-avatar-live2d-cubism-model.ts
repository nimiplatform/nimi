import type { ChatAgentAvatarLive2dModelSource } from './chat-agent-avatar-live2d-viewport-state';
import type { AvatarLive2dFramingIntent } from '@nimiplatform/kit/features/avatar/live2d';
import type {
  CubismModelHandle,
  OfficialCubismRuntime,
} from './chat-agent-avatar-live2d-cubism-runtime-types';

export async function createOfficialLive2dCubismModelImpl(input: {
  runtime: OfficialCubismRuntime;
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  source: ChatAgentAvatarLive2dModelSource;
  width: number;
  height: number;
  verticalOffsetY?: number;
  framingIntent?: AvatarLive2dFramingIntent;
  setGlobalLive2dDebugSnapshot: (snapshot: Record<string, unknown> | null) => void;
}): Promise<CubismModelHandle> {
  void input.runtime;
  void input.gl;
  void input.source;
  void input.width;
  void input.height;
  void input.verticalOffsetY;
  void input.framingIntent;
  input.setGlobalLive2dDebugSnapshot(null);
  throw new Error('Desktop Live2D carrier execution is decommissioned; launch the Avatar-owned carrier instead.');
}
