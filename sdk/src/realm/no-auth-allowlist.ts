import { createNimiError } from '../runtime/errors.js';
import { ReasonCode } from '../types/index.js';

const NO_AUTH_REALM_ENDPOINTS = new Set([
  'POST /api/auth/email/check',
  'POST /api/auth/email/otp/request',
  'POST /api/auth/email/otp/verify',
  'POST /api/auth/password/login',
]);

export function assertNoAuthRealmEndpointAllowed(input: {
  accessToken: string;
  methodName: string;
  path: string;
}): void {
  if (input.accessToken || NO_AUTH_REALM_ENDPOINTS.has(`${input.methodName.toUpperCase()} ${input.path}`)) {
    return;
  }
  throw createNimiError({
    message: 'realm accessToken is required for this endpoint',
    reasonCode: ReasonCode.SDK_REALM_TOKEN_REQUIRED,
    actionHint: 'set_realm_auth_access_token',
    source: 'sdk',
    details: {
      method: input.methodName,
      path: input.path,
    },
  });
}
