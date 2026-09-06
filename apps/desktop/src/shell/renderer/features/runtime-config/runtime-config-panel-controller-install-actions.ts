import { useCallback, useRef, useState } from 'react';
import {
  createOfflineNimiError as createOfflineError,
  ReasonCode,
} from '@nimiplatform/sdk/types';
import {
  type NimiRuntimeLocalInstallPlanDescriptor,
} from '@nimiplatform/sdk/runtime';
import { useTranslation } from 'react-i18next';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service';
import { formatKnownDownloadSize, isRuntimeInstallCancellation } from './runtime-config-model-center-utils';
import type { SetRuntimeConfigBanner } from './runtime-config-panel-controller-utils';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

export type RuntimeConfigInstallActions = {
  installResolvedModelPlan: (plan: NimiRuntimeLocalInstallPlanDescriptor) => Promise<void>;
};

export type RuntimeConfigInstallConfirmationRequest = {
  readonly message: string;
};

export type UseRuntimeConfigInstallActionsResult = RuntimeConfigInstallActions & {
  readonly installConfirmation: RuntimeConfigInstallConfirmationRequest | null;
  readonly resolveInstallConfirmation: (confirmed: boolean) => void;
};

export type UseRuntimeConfigInstallActionsInput = {
  setStatusBanner: SetRuntimeConfigBanner;
  onOpenLoadouts: () => void;
};

export function runtimeConfigInstallConfirmationMessage(input: {
  readonly name: string;
  readonly size: string;
  readonly warnings: readonly string[];
  readonly repository: string;
  readonly revision: string;
  readonly license: string;
  readonly fileCount: number;
  readonly translate: (key: string, defaultValue: string, options?: Record<string, unknown>) => string;
}): string {
  const base = input.translate(
    'runtimeConfig.local.confirmModelInstall',
    'Download and install “{{name}}”? Download size: {{size}}. No download starts until you confirm.',
    { name: input.name, size: input.size },
  );
  const warnings = input.warnings.map((warning) => warning.trim()).filter(Boolean);
  const source = `${input.translate('runtimeConfig.local.installSource', 'Source')}: ${input.repository}@${input.revision}`;
  const license = `${input.translate('runtimeConfig.local.installLicense', 'License')}: ${input.license}`;
  const files = `${input.translate('runtimeConfig.local.installFiles', 'Files')}: ${input.fileCount}`;
  const warningBlock = warnings.length === 0 ? '' : `\n${input.translate('runtimeConfig.local.installWarnings', 'Before continuing:')}\n${warnings.map((warning) => `• ${warning}`).join('\n')}`;
  return `${base}\n\n${source}\n${license}\n${files}${warningBlock}`;
}

export function useRuntimeConfigInstallActions(input: UseRuntimeConfigInstallActionsInput): UseRuntimeConfigInstallActionsResult {
  const localEnvironmentClient = useRuntimeConfigLocalEnvironmentClient();
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const { onOpenLoadouts, setStatusBanner } = input;
  const [installConfirmation, setInstallConfirmation] = useState<RuntimeConfigInstallConfirmationRequest | null>(null);
  const installConfirmationResolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const requestInstallConfirmation = useCallback((message: string) => {
    // A newer request supersedes a still-open dialog: cancel the pending one so
    // its install flow unwinds instead of hanging on an unresolved promise.
    installConfirmationResolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      installConfirmationResolverRef.current = resolve;
      setInstallConfirmation({ message });
    });
  }, []);

  const resolveInstallConfirmation = useCallback((confirmed: boolean) => {
    const resolver = installConfirmationResolverRef.current;
    installConfirmationResolverRef.current = null;
    setInstallConfirmation(null);
    resolver?.(confirmed);
  }, []);

  const translateRuntimeLocalText = useCallback((
    key: string,
    defaultValue: string,
    options?: Record<string, unknown>,
  ) => String(t(key, { defaultValue, ...(options || {}) })), [t]);

  const assertRuntimeWriteAllowed = useCallback(() => {
    if (bindings.sdk.offline.getTier() !== 'L2') {
      return;
    }
    throw createOfflineError({
      source: 'runtime',
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      message: t('runtimeConfig.local.runtimeUnavailableWriteReadOnly', {
        defaultValue: 'Runtime unavailable. Local model writes are disabled in read-only mode.',
      }),
      actionHint: 'retry-runtime-when-online',
    });
  }, [bindings.sdk.offline, t]);

  const runInstallPlanLifecycle = useCallback(async (
    plan: NimiRuntimeLocalInstallPlanDescriptor,
  ): Promise<void> => {
    assertRuntimeWriteAllowed();
    const installLabel = String(plan.entry || plan.modelId || plan.templateId || 'model asset').trim();
    const sizeLabel = formatKnownDownloadSize(
      plan.totalSizeBytes,
      translateRuntimeLocalText('runtimeConfig.local.unknownDownloadSize', 'size unknown'),
    );
    const confirmed = await requestInstallConfirmation(runtimeConfigInstallConfirmationMessage({
      name: installLabel,
      size: sizeLabel,
      warnings: plan.warnings,
      repository: plan.repo,
      revision: plan.revision,
      license: plan.license,
      fileCount: plan.files.length,
      translate: translateRuntimeLocalText,
    }));
    if (!confirmed) {
      return;
    }
    await localEnvironmentClient.install(plan.planId, { caller: 'core' });
    setStatusBanner({
      kind: 'success',
      message: translateRuntimeLocalText(
        'runtimeConfig.local.assetInstalled',
        '“{{name}}” is installed. Choose what you want to use it for.',
        { name: installLabel },
      ),
      actionLabel: translateRuntimeLocalText(
        'runtimeConfig.local.setModelUse',
        'Set use',
      ),
      onAction: onOpenLoadouts,
    });
  }, [assertRuntimeWriteAllowed, onOpenLoadouts, requestInstallConfirmation, setStatusBanner, translateRuntimeLocalText]);

  const installResolvedModelPlan = useCallback(async (plan: NimiRuntimeLocalInstallPlanDescriptor) => {
    try {
      await runInstallPlanLifecycle(plan);
    } catch (error) {
      if (isRuntimeInstallCancellation(error)) {
        setStatusBanner({
          kind: 'info',
          message: translateRuntimeLocalText('runtimeConfig.local.installCanceled', 'Download canceled.'),
        });
        return;
      }
      setStatusBanner({
        kind: 'error',
        message: `Catalog model install failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
      throw error;
    }
  }, [runInstallPlanLifecycle, setStatusBanner]);

  return {
    installResolvedModelPlan,
    installConfirmation,
    resolveInstallConfirmation,
  };
}
