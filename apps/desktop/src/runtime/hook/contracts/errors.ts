export type HookErrorCode =
  | 'HOOK_PERMISSION_DENIED'
  | 'HOOK_CONTRACT_TARGET_NOT_FOUND'
  | 'HOOK_CONTRACT_VERSION_UNSUPPORTED'
  | 'HOOK_CONTRACT_INVALID_EXTENSION'
  | 'HOOK_DATA_CAPABILITY_UNSUPPORTED'
  | 'HOOK_INTER_MOD_CHANNEL_NOT_FOUND'
  | 'HOOK_LLM_SPEECH_PROVIDER_UNAVAILABLE'
  | 'HOOK_LLM_SPEECH_STREAM_UNSUPPORTED';

export class HookRuntimeError extends Error {
  code: HookErrorCode;
  details?: Record<string, unknown>;

  constructor(
    code: HookErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(`${code}: ${message}`);
    this.code = code;
    this.details = details;
  }
}

export function createHookError(
  code: HookErrorCode,
  message: string,
  details?: Record<string, unknown>,
): HookRuntimeError {
  return new HookRuntimeError(code, message, details);
}
