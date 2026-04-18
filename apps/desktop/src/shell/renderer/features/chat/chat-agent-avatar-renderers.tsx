import type { AvatarStageRendererRegistry } from '@nimiplatform/nimi-kit/features/avatar/headless';
import { createLazyLive2dAvatarRenderer } from '@nimiplatform/nimi-kit/features/avatar/live2d';
import { createLazyVrmAvatarRenderer } from '@nimiplatform/nimi-kit/features/avatar/vrm';

export const DESKTOP_AGENT_AVATAR_RENDERERS: AvatarStageRendererRegistry = {
  // Desktop opts into the admitted VRM surface explicitly and only loads the
  // desktop-local viewport module when a VRM backend is actually rendered.
  // Replacing that module with a true R3F/VRM implementation later does not
  // change chat consumers or the default avatar stage contract.
  vrm: createLazyVrmAvatarRenderer({
    loadViewport: () => import('./chat-agent-avatar-vrm-viewport.js'),
  }),
  live2d: createLazyLive2dAvatarRenderer({
    loadViewport: () => import('./chat-agent-avatar-live2d-viewport.js'),
  }),
};
