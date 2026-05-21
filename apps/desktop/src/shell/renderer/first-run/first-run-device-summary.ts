// First-Run Device Summary — projects the real Runtime device-scan evidence
// into the short "Detected: <device>" line shown under the Phase 2 cards.
//
// The device summary is a projection of `LocalRuntimeDeviceProfile`, the
// Runtime-owned host capability evidence (P-COLD-005). When device evidence
// is unavailable the projection fails closed: it returns `null` and the
// renderer shows an explicit "device scan unavailable" line instead of
// fabricating a device string.

import type { LocalRuntimeDeviceProfile } from '../../../runtime/local-runtime/index.js';

const GIB = 1024 * 1024 * 1024;

function formatGib(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  const gib = bytes / GIB;
  if (gib < 1) return `${Math.round(gib * 10) / 10} GB`;
  return `${Math.round(gib)} GB`;
}

/**
 * Builds a concise human device summary from real device-scan evidence.
 *
 * Returns `null` when the evidence is too sparse to describe the device
 * (no OS/arch). A `null` result must be surfaced as an explicit unavailable
 * line — never replaced with a guessed device string.
 */
export function projectDeviceSummary(
  profile: LocalRuntimeDeviceProfile | null,
): string | null {
  if (!profile) return null;
  const os = String(profile.os || '').trim();
  const arch = String(profile.arch || '').trim();
  if (!os && !arch) return null;

  const parts: string[] = [];
  const platform = [os, arch].filter(Boolean).join(' ');
  if (platform) parts.push(platform);

  const ram = formatGib(profile.totalRamBytes);
  if (ram) parts.push(`${ram} RAM`);

  if (profile.gpu?.available) {
    const gpuVendor = String(profile.gpu.vendor || '').trim();
    const gpuModel = String(profile.gpu.model || '').trim();
    const gpuLabel = gpuModel || gpuVendor || 'GPU';
    parts.push(gpuLabel);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}
