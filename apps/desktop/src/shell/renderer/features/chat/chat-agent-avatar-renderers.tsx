import { createLazyVrmAvatarRenderer } from '@nimiplatform/nimi-kit/features/avatar/vrm';
import type { AvatarStageRendererRegistry } from '@nimiplatform/nimi-kit/features/avatar/headless';

export const DESKTOP_AGENT_AVATAR_RENDERERS: AvatarStageRendererRegistry = {
  // Desktop opts into the admitted VRM surface explicitly and only loads the
  // desktop-local viewport module when a VRM backend is actually rendered.
  // Replacing that module with a true R3F/VRM implementation later does not
  // change chat consumers or the default avatar stage contract.
  vrm: createLazyVrmAvatarRenderer({
    loadViewport: () => import('./chat-agent-avatar-vrm-viewport.js'),
  }),
};
