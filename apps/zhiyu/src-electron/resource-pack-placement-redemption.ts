import {
  readDesktopOpenJsonResponse,
  resolveDesktopOpenFetch,
  resolveDesktopOpenPresenceDescriptor,
  type NimiElectronStandardShellHost,
} from '@nimiplatform/kit/shell/electron/main';

const DESKTOP_ZHIYU_RESOURCE_PACK_REDEEM_PATH = '/v1/zhiyu-resource-pack-placement/redeem';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-041a
export async function redeemDesktopZhiyuResourcePackPlacement(input: {
  readonly correlationRef: string;
  readonly host?: NimiElectronStandardShellHost;
}): Promise<{ readonly conversationAnchorId: string }> {
  const correlationRef = exactCorrelationRef(input.correlationRef);
  const descriptorResult = await resolveDesktopOpenPresenceDescriptor(input.host);
  if (!descriptorResult.ok) throw new Error('desktop-placement-presence-unavailable');
  const fetchImpl = resolveDesktopOpenFetch(input.host);
  if (!fetchImpl) throw new Error('desktop-placement-redeem-unavailable');
  const descriptor = descriptorResult.descriptor;
  const response = await fetchImpl(`${descriptor.endpoint}${DESKTOP_ZHIYU_RESOURCE_PACK_REDEEM_PATH}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${descriptor.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ schemaVersion: 1, correlationRef }),
  });
  if (response.status !== 200) throw new Error('desktop-placement-correlation-unavailable');
  const raw = await readDesktopOpenJsonResponse(response);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('desktop-placement-redeem-invalid');
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== [
    'bridgeId', 'conversationAnchorId', 'status',
  ].sort().join(',')
    || record.bridgeId !== descriptor.bridgeId
    || record.status !== 'redeemed') {
    throw new Error('desktop-placement-redeem-invalid');
  }
  return Object.freeze({ conversationAnchorId: exactAnchor(record.conversationAnchorId) });
}

function exactCorrelationRef(value: unknown): string {
  const ref = typeof value === 'string' ? value.trim() : '';
  if (!ref || ref !== value || ref.length > 160 || !/^zhiyu-placement-[A-Za-z0-9_-]+$/u.test(ref)) {
    throw new Error('desktop-placement-correlation-invalid');
  }
  return ref;
}

function exactAnchor(value: unknown): string {
  const anchor = typeof value === 'string' ? value.trim() : '';
  if (!anchor || anchor !== value || anchor.length > 256 || /[\u0000-\u001f\u007f]/u.test(anchor)) {
    throw new Error('desktop-placement-anchor-invalid');
  }
  return anchor;
}
