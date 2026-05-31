/**
 * Runtime-owned local profile identity projected for SDK consumers.
 *
 * This is a typed identity shape only. It does not resolve, validate, install,
 * or choose local profiles; Runtime remains the authority for those operations.
 */
export type RuntimeLocalProfileRef = {
  targetId: string;
  profileId: string;
};
