import type { ApprovedAppCatalogTarget } from '@nimiplatform/sdk/runtime/wire-types';

// @nimi-authority: rule.nimi.desktop.shell-ui.r053

export interface AppsInstallIntentSnapshot {
  readonly approvedTargetSelector: Uint8Array;
  readonly observedRegistryRevision: string;
  readonly descriptorId: string;
  readonly targetId: string;
  readonly appId: string;
  readonly displayName: string;
  readonly publisherGithubNamespace: string;
  readonly version: string;
  readonly assetName: string;
  readonly assetSize: string;
  readonly windowsCodeSigning: 'signed' | 'unsigned';
  readonly observedSigningSubject: string | null;
}

export type AppsInstallStartResult =
  | { readonly kind: 'started' }
  | { readonly kind: 'stale-selection' }
  | { readonly kind: 'policy-blocked'; readonly reason: string; readonly revision: string }
  | { readonly kind: 'already-installed' }
  | { readonly kind: 'job-active' }
  | { readonly kind: 'unavailable' };

export type AppsInstallIntentResult =
  | { readonly kind: 'confirmation-required'; readonly intent: AppsInstallIntentSnapshot }
  | { readonly kind: 'policy-blocked'; readonly reason: string; readonly revision: string }
  | { readonly kind: 'start-result'; readonly result: AppsInstallStartResult }
  | { readonly kind: 'no-pending-intent' };

export interface AppsInstallIntentController {
  requestInstall(target: ApprovedAppCatalogTarget): Promise<AppsInstallIntentResult>;
  confirm(): Promise<AppsInstallIntentResult>;
  cancel(): void;
  pending(): AppsInstallIntentSnapshot | null;
}

export function createAppsInstallIntentController(input: {
  readonly startInstall: (approvedTargetSelector: Uint8Array) => Promise<AppsInstallStartResult>;
  readonly refresh: () => void | Promise<void>;
}): AppsInstallIntentController {
  let pending: AppsInstallIntentSnapshot | null = null;

  const start = async (intent: AppsInstallIntentSnapshot): Promise<AppsInstallIntentResult> => {
    const result = await input.startInstall(intent.approvedTargetSelector.slice());
    if (
      result.kind === 'stale-selection'
      || result.kind === 'policy-blocked'
      || result.kind === 'already-installed'
      || result.kind === 'job-active'
    ) {
      await input.refresh();
    }
    return { kind: 'start-result', result };
  };

  return Object.freeze({
    async requestInstall(target: ApprovedAppCatalogTarget): Promise<AppsInstallIntentResult> {
      pending = null;
      if (target.policyBlocked) {
        await input.refresh();
        return {
          kind: 'policy-blocked',
          reason: target.policyReason ?? 'policy-blocked',
          revision: target.policyRevision,
        };
      }
      const intent = snapshotAppsInstallIntent(target);
      if (intent.windowsCodeSigning === 'unsigned') {
        pending = intent;
        return { kind: 'confirmation-required', intent: cloneIntent(intent) };
      }
      return start(intent);
    },
    async confirm(): Promise<AppsInstallIntentResult> {
      const intent = pending;
      pending = null;
      return intent ? start(intent) : { kind: 'no-pending-intent' };
    },
    cancel(): void {
      pending = null;
    },
    pending(): AppsInstallIntentSnapshot | null {
      return pending ? cloneIntent(pending) : null;
    },
  });
}

export function snapshotAppsInstallIntent(target: ApprovedAppCatalogTarget): AppsInstallIntentSnapshot {
  if (target.os !== 'windows' || target.arch !== 'x86_64' || target.targetId !== 'windows-x86_64') {
    throw new Error(`Unsupported App Catalog target: ${target.targetId}`);
  }
  if (target.windowsCodeSigning !== 'signed' && target.windowsCodeSigning !== 'unsigned') {
    throw new Error(`Unsupported Windows native posture: ${target.windowsCodeSigning}`);
  }
  if (
    (target.windowsCodeSigning === 'signed' && !target.observedSigningSubject?.trim())
    || (target.windowsCodeSigning === 'unsigned' && Boolean(target.observedSigningSubject?.trim()))
  ) {
    throw new Error('Contradictory Windows native posture');
  }
  if (
    target.approvedTargetSelector.length === 0
    || target.observedRegistryRevision.length === 0
    || target.descriptorId.length === 0
    || target.appId.length === 0
    || target.version.length === 0
  ) {
    throw new Error('Incomplete approved App Catalog target');
  }
  return {
    approvedTargetSelector: target.approvedTargetSelector.slice(),
    observedRegistryRevision: target.observedRegistryRevision,
    descriptorId: target.descriptorId,
    targetId: target.targetId,
    appId: target.appId,
    displayName: target.displayName,
    publisherGithubNamespace: target.publisherGithubNamespace,
    version: target.version,
    assetName: target.assetName,
    assetSize: target.assetSize,
    windowsCodeSigning: target.windowsCodeSigning,
    observedSigningSubject: target.observedSigningSubject ?? null,
  };
}

export function approvedCatalogTargetMatchesIntent(
  target: ApprovedAppCatalogTarget,
  intent: AppsInstallIntentSnapshot,
): boolean {
  return !target.policyBlocked
    && target.appId === intent.appId
    && target.descriptorId === intent.descriptorId
    && target.targetId === intent.targetId
    && target.observedRegistryRevision === intent.observedRegistryRevision
    && target.approvedTargetSelector.length === intent.approvedTargetSelector.length
    && target.approvedTargetSelector.every((value, index) => value === intent.approvedTargetSelector[index]);
}

function cloneIntent(intent: AppsInstallIntentSnapshot): AppsInstallIntentSnapshot {
  return { ...intent, approvedTargetSelector: intent.approvedTargetSelector.slice() };
}
