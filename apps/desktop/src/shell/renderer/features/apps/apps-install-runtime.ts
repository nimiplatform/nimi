import { asNimiError } from '@nimiplatform/sdk';
import type { NimiDesktopMachineProductRuntimeClient } from '@nimiplatform/sdk/runtime';
import {
  AppPackageJobKind,
  AppPackageJobPhase,
  AppPackageSourceClass,
  ReasonCode,
} from '@nimiplatform/sdk/runtime/wire-types';
import type { AppsInstallStartResult } from './apps-install-intent.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-014a
// @nimi-authority: rule.nimi.desktop.shell-ui.r053
export async function startAppsPackageInstall(
  start: NimiDesktopMachineProductRuntimeClient['apps']['startAppPackageInstall'],
  approvedTargetSelector: Uint8Array,
): Promise<AppsInstallStartResult> {
  const selector = approvedTargetSelector.slice();
  let response;
  try {
    response = await start({ approvedTargetSelector: selector });
  } catch (error) {
    const failure = asNimiError(error);
    switch (failure.reasonCode) {
      case 'APP_PACKAGE_SELECTION_STALE': return { kind: 'stale-selection' };
      case 'APP_PACKAGE_ALREADY_INSTALLED': return { kind: 'already-installed' };
      case 'APP_PACKAGE_JOB_ACTIVE': return { kind: 'job-active' };
      case 'APP_PACKAGE_INSTALL_UNAVAILABLE':
      case 'runtime-service-unavailable': return { kind: 'unavailable' };
      case 'APP_PACKAGE_POLICY_BLOCKED': {
        const metadata = failure.details?.reasonMetadata;
        if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)
          && 'policy_reason' in metadata && 'policy_revision' in metadata) {
          const reason = metadata.policy_reason;
          const revision = metadata.policy_revision;
          if (typeof reason === 'string' && reason.length > 0
            && typeof revision === 'string' && /^\d+$/u.test(revision)) {
            return { kind: 'policy-blocked', reason, revision };
          }
        }
        throw error;
      }
      default: throw error;
    }
  }
  const job = response.job;
  const returnedSelector = new TextEncoder().encode(job?.targetRef ?? '');
  if (response.reasonCode !== ReasonCode.ACTION_EXECUTED || !job || !job.jobId.length
    || !job.appId || job.kind !== AppPackageJobKind.INSTALL
    || job.sourceClass !== AppPackageSourceClass.VERIFIED
    || job.phase !== AppPackageJobPhase.QUEUED
    || returnedSelector.length !== selector.length
    || !returnedSelector.every((value, index) => value === selector[index])) {
    throw new Error('Runtime returned an inconsistent App package install job.');
  }
  return { kind: 'started' };
}
