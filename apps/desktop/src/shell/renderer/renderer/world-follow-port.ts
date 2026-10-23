export type DesktopWorldFollowReadResult =
  | { readonly state: 'missing' }
  | { readonly state: 'ready'; readonly value: unknown }
  | { readonly state: 'error'; readonly error: string };

export type DesktopWorldFollowWriteResult =
  | { readonly state: 'saved' }
  | { readonly state: 'error'; readonly error: string };

export interface DesktopRendererWorldFollowPort {
  read(accountId: string): DesktopWorldFollowReadResult;
  write(accountId: string, worldIds: readonly string[]): DesktopWorldFollowWriteResult;
  subscribe(listener: (accountId: string | null) => void): () => void;
}
