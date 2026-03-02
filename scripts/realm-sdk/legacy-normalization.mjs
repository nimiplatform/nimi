const LEGACY_SERVICE_NAME_MAP = Object.freeze({
  Me2FaService: 'MeTwoFactorService',
  SocialV1DefaultVisibilityService: 'SocialDefaultVisibilityService',
  SocialFourDimensionalAttributesService: 'SocialAttributesService',
});

const LEGACY_MODEL_SYMBOL_MAP = Object.freeze({
  Auth2faVerifyDto: 'AuthTwoFactorVerifyInput',
  Me2faVerifyDto: 'MeTwoFactorVerifyInput',
  Me2faPrepareResponseDto: 'MeTwoFactorPrepareOutput',
});

const LEGACY_METHOD_NAME_MAP = Object.freeze({
  AuthService: Object.freeze({
    verify2Fa: 'verifyTwoFactor',
  }),
  MeTwoFactorService: Object.freeze({
    disable2Fa: 'disableTwoFactor',
    enable2Fa: 'enableTwoFactor',
    prepare2Fa: 'prepareTwoFactor',
  }),
});

const LEGACY_ENUM_MEMBER_KEY_MAP = Object.freeze({
  NEEDS_2FA: 'NEEDS_TWO_FACTOR',
});

const LEGACY_OPERATION_ID_MAP = Object.freeze({
  verify2Fa: 'verifyTwoFactor',
  disable2Fa: 'disableTwoFactor',
  enable2Fa: 'enableTwoFactor',
  prepare2Fa: 'prepareTwoFactor',
});

export function normalizeServiceName(serviceName) {
  return LEGACY_SERVICE_NAME_MAP[String(serviceName || '')] || String(serviceName || '');
}

export function normalizeModelSymbolName(symbolName) {
  return LEGACY_MODEL_SYMBOL_MAP[String(symbolName || '')] || String(symbolName || '');
}

export function normalizeMethodName(serviceName, methodName) {
  const service = String(serviceName || '');
  const method = String(methodName || '');
  const serviceMap = LEGACY_METHOD_NAME_MAP[service];
  if (!serviceMap) {
    return method;
  }
  return serviceMap[method] || method;
}

export function normalizeOperationId(operationId) {
  const value = String(operationId || '');
  return LEGACY_OPERATION_ID_MAP[value] || value;
}

export function normalizeEnumMemberKey(memberKey) {
  const value = String(memberKey || '');
  return LEGACY_ENUM_MEMBER_KEY_MAP[value] || value;
}

