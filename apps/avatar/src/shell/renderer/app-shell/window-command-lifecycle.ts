/** The Host tombstone is irreversible for this renderer sender. Other failures
 * remain actionable; neither a message substring nor generic unavailability
 * establishes that the window is closing. */
export function isAvatarSenderInvalidated(error: unknown): boolean {
  return error !== null && typeof error === 'object'
    && 'reasonCode' in error
    && error.reasonCode === 'electron-bundled-avatar-sender-invalidated';
}
