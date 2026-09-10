import type { ApprovedAppCatalogTarget, CommittedAppRelease } from '@nimiplatform/sdk/runtime/wire-types';

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
  readonly os: 'windows' | 'macos';
  readonly windowsCodeSigning: 'signed' | 'unsigned' | 'not-applicable';
  readonly macosNotarization: 'notarized' | 'absent' | 'not-applicable';
  readonly observedSigningSubject: string | null;
  readonly update?: { readonly launchSelector: Uint8Array; readonly installedVersion: string };
}

export type AppsInstallStartResult =
  | { readonly kind: 'started' }
  | { readonly kind: 'stale-selection' }
  | { readonly kind: 'policy-blocked'; readonly reason: string; readonly revision: string }
  | { readonly kind: 'already-installed' }
  | { readonly kind: 'job-active' }
  | { readonly kind: 'host-running' }
  | { readonly kind: 'unavailable' };

export type AppsInstallIntentResult =
  | { readonly kind: 'confirmation-required'; readonly intent: AppsInstallIntentSnapshot }
  | { readonly kind: 'policy-blocked'; readonly reason: string; readonly revision: string }
  | { readonly kind: 'start-result'; readonly result: AppsInstallStartResult }
  | { readonly kind: 'no-pending-intent' };

export interface AppsInstallIntentController {
  requestInstall(target: ApprovedAppCatalogTarget): Promise<AppsInstallIntentResult>;
  requestUpdate(target: ApprovedAppCatalogTarget, installed: CommittedAppRelease): Promise<AppsInstallIntentResult>;
  confirm(): Promise<AppsInstallIntentResult>;
  cancel(): void;
  pending(): AppsInstallIntentSnapshot | null;
}

export function createAppsInstallIntentController(input: {
  readonly startInstall: (approvedTargetSelector: Uint8Array) => Promise<AppsInstallStartResult>;
  readonly startUpdate?: (approvedTargetSelector: Uint8Array, launchSelector: Uint8Array, installedVersion: string) => Promise<AppsInstallStartResult>;
  readonly refresh: () => void | Promise<void>;
}): AppsInstallIntentController {
  let pending: AppsInstallIntentSnapshot | null = null;

  const start = async (intent: AppsInstallIntentSnapshot): Promise<AppsInstallIntentResult> => {
    const result = intent.update
      ? await input.startUpdate!(intent.approvedTargetSelector.slice(), intent.update.launchSelector.slice(), intent.update.installedVersion)
      : await input.startInstall(intent.approvedTargetSelector.slice());
    if (
      result.kind === 'stale-selection'
      || result.kind === 'policy-blocked'
      || result.kind === 'already-installed'
      || result.kind === 'job-active'
      || result.kind === 'host-running'
    ) {
      await input.refresh();
    }
    return { kind: 'start-result', result };
  };

  return Object.freeze({
    async requestUpdate(target: ApprovedAppCatalogTarget, installed: CommittedAppRelease): Promise<AppsInstallIntentResult> {
      pending = null;
      if (!input.startUpdate || installed.appId !== target.appId || !installed.launchSelector.length) throw new Error('App update is unavailable');
      if (target.policyBlocked) {
        await input.refresh();
        return { kind: 'policy-blocked', reason: target.policyReason ?? 'policy-blocked', revision: target.policyRevision };
      }
      pending = { ...snapshotAppsInstallIntent(target), update: { launchSelector: installed.launchSelector.slice(), installedVersion: installed.version } };
      return { kind: 'confirmation-required', intent: cloneIntent(pending) };
    },
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
      if (intent.windowsCodeSigning === 'unsigned' || intent.macosNotarization === 'absent') {
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
  const windows = target.os === 'windows' && target.arch === 'x86_64' && target.targetId === 'windows-x86_64';
  const macos = target.os === 'macos' && target.arch === 'arm64' && target.targetId === 'macos-aarch64';
  if (!windows && !macos) {
    throw new Error(`Unsupported App Catalog target: ${target.targetId}`);
  }
  if (windows && target.windowsCodeSigning !== 'signed' && target.windowsCodeSigning !== 'unsigned') {
    throw new Error(`Unsupported Windows native posture: ${target.windowsCodeSigning}`);
  }
  if (
    windows && ((target.windowsCodeSigning === 'signed' && !target.observedSigningSubject?.trim())
    || (target.windowsCodeSigning === 'unsigned' && Boolean(target.observedSigningSubject?.trim()))
    )
  ) {
    throw new Error('Contradictory Windows native posture');
  }
  if (macos) {
    const signer = target.macosDeveloperIdSubject;
    if (target.windowsCodeSigning !== 'not-applicable'
      || !['absent', 'notarized'].includes(target.macosNotarization)
      || signer !== target.observedSigningSubject
      || (signer !== undefined && (!signer.trim() || signer.trim() !== signer))
      || (target.macosNotarization === 'notarized' && signer === undefined)) {
      throw new Error('Contradictory macOS native posture');
    }
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
    os: macos ? 'macos' : 'windows',
    windowsCodeSigning: macos ? 'not-applicable' : target.windowsCodeSigning as 'signed' | 'unsigned',
    macosNotarization: macos ? target.macosNotarization as 'absent' | 'notarized' : 'not-applicable',
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
  return { ...intent, approvedTargetSelector: intent.approvedTargetSelector.slice(),
    ...(intent.update ? { update: { ...intent.update, launchSelector: intent.update.launchSelector.slice() } } : {}),
  };
}
