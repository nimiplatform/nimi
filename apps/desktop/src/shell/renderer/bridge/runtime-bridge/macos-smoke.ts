import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import { invokeTauri } from '@runtime/tauri-api';
import type { JsonObject } from './shared.js';
import {
  parseDesktopMacosSmokeContext,
  parseDesktopMacosSmokeAvatarEvidenceReadResult,
  parseDesktopMacosSmokeReportResult,
  type DesktopMacosSmokeContext,
  type DesktopMacosSmokeAvatarEvidenceReadResult,
  type DesktopMacosSmokeReportPayload,
  type DesktopMacosSmokeReportResult,
} from './types';

export async function getDesktopMacosSmokeContext(): Promise<DesktopMacosSmokeContext> {
  if (!hasTauriInvoke()) {
    return { enabled: false };
  }
  return invokeChecked(
    'desktop_macos_smoke_context_get',
    {},
    parseDesktopMacosSmokeContext,
  );
}

export async function readDesktopMacosSmokeAvatarEvidence(
  avatarInstanceId: string,
): Promise<DesktopMacosSmokeAvatarEvidenceReadResult> {
  if (!hasTauriInvoke()) {
    throw new Error('desktop_macos_smoke_avatar_evidence_read requires Tauri runtime');
  }
  return invokeChecked(
    'desktop_macos_smoke_avatar_evidence_read',
    { payload: { avatarInstanceId } },
    parseDesktopMacosSmokeAvatarEvidenceReadResult,
  );
}

export async function writeDesktopMacosSmokeReport(
  payload: DesktopMacosSmokeReportPayload,
): Promise<DesktopMacosSmokeReportResult> {
  if (!hasTauriInvoke()) {
    throw new Error('desktop_macos_smoke_report_write requires Tauri runtime');
  }
  return invokeChecked(
    'desktop_macos_smoke_report_write',
    { payload },
    parseDesktopMacosSmokeReportResult,
  );
}

export async function pingDesktopMacosSmoke(
  stage: string,
  details?: JsonObject,
): Promise<void> {
  if (!hasTauriInvoke()) {
    return;
  }
  await invokeTauri('desktop_macos_smoke_ping', {
    payload: {
      stage,
      details,
    },
  });
}
