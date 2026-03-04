import type {
  RuntimeBridgeConfigGetResult,
  RuntimeBridgeConfigSetResult,
  RuntimeBridgeDaemonStatus,
  RuntimeDefaults,
} from '@renderer/bridge';

const CONFIG_RESTART_REQUIRED = 'CONFIG_RESTART_REQUIRED';

export type RuntimeJwtSyncBridge = {
  getRuntimeBridgeConfig: () => Promise<RuntimeBridgeConfigGetResult>;
  setRuntimeBridgeConfig: (configJson: string) => Promise<RuntimeBridgeConfigSetResult>;
  restartRuntimeBridge: () => Promise<RuntimeBridgeDaemonStatus>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalize(value: unknown): string {
  return String(value || '').trim();
}

export function mergeRuntimeJwtConfig(
  baseConfig: Record<string, unknown>,
  realmDefaults: RuntimeDefaults['realm'],
): { nextConfig: Record<string, unknown>; changed: boolean } {
  const currentConfig = asRecord(baseConfig);
  const currentAuth = asRecord(currentConfig.auth);
  const currentJwt = asRecord(currentAuth.jwt);

  const nextIssuer = normalize(realmDefaults.jwtIssuer);
  const nextAudience = normalize(realmDefaults.jwtAudience);
  const nextJwksUrl = normalize(realmDefaults.jwksUrl);

  const currentIssuer = normalize(currentJwt.issuer);
  const currentAudience = normalize(currentJwt.audience);
  const currentJwksUrl = normalize(currentJwt.jwksUrl);

  const changed = currentIssuer !== nextIssuer
    || currentAudience !== nextAudience
    || currentJwksUrl !== nextJwksUrl;

  if (!changed) {
    return {
      nextConfig: currentConfig,
      changed: false,
    };
  }

  return {
    nextConfig: {
      ...currentConfig,
      auth: {
        ...currentAuth,
        jwt: {
          ...currentJwt,
          issuer: nextIssuer,
          audience: nextAudience,
          jwksUrl: nextJwksUrl,
        },
      },
    },
    changed: true,
  };
}

export async function syncRuntimeJwtConfig(input: {
  daemonStatus: RuntimeBridgeDaemonStatus;
  realmDefaults: RuntimeDefaults['realm'];
  bridge: RuntimeJwtSyncBridge;
}): Promise<RuntimeBridgeDaemonStatus> {
  const { daemonStatus, realmDefaults, bridge } = input;

  const current = await bridge.getRuntimeBridgeConfig();
  const { nextConfig, changed } = mergeRuntimeJwtConfig(current.config, realmDefaults);
  if (!changed) {
    return daemonStatus;
  }

  const setResult = await bridge.setRuntimeBridgeConfig(JSON.stringify(nextConfig));
  if (setResult.reasonCode !== CONFIG_RESTART_REQUIRED) {
    return daemonStatus;
  }

  if (!daemonStatus.running) {
    return daemonStatus;
  }

  if (!daemonStatus.managed) {
    const hint = String(setResult.actionHint || '').trim();
    throw new Error(
      hint
      || 'Runtime JWT config updated and requires restart. Please restart external runtime manually.',
    );
  }

  return bridge.restartRuntimeBridge();
}
