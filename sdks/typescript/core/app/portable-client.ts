import type { NimiLocalAppClient } from './local-app-runtime-platform.js';

// @nimi-authority: rule.nimi.sdks.client-core.remote-runtime-carrier
/** The operations shared by ordinary local and remote Apps. This type does not
 * assert configured resources, permissions or support for native Host actions. */
export type NimiAppRuntimeClient = Pick<NimiLocalAppClient,
  'aiConfig' | 'agents' | 'conversation' | 'embodiment' | 'agentConfigure'> & {
  readonly ai: Omit<NimiLocalAppClient['ai'], 'realtime' | 'videoSessions'>;
  readonly storage: Omit<NimiLocalAppClient['storage'], 'assets'> & {
    readonly assets: Omit<NimiLocalAppClient['storage']['assets'], 'reveal'>;
  };
  readonly activity: NimiLocalAppClient['activity'];
  readonly realm: {
    readonly worldCore: NimiLocalAppClient['realm']['worldCore'];
    readonly personaCharacter: NimiLocalAppClient['realm']['personaCharacter'];
  };
};
