import type { ZhiyuAvatarLaunchResult } from './avatar-launch-handoff';

export type ZhiyuAvatarLaunchFeedback =
  | { readonly state: 'pending' }
  | { readonly state: 'settled'; readonly result: ZhiyuAvatarLaunchResult };

export function avatarLaunchRecovery(reasonCode: string): 'nimi' | 'appearance' {
  return [
    'avatar-host-desktop-not-running',
    'avatar-host-transport-unavailable',
    'avatar-host-bridge-auth-failed',
    'avatar-host-caller-session-unavailable',
    'zhiyu-avatar-host-handoff-unavailable',
  ].includes(reasonCode) ? 'nimi' : 'appearance';
}
