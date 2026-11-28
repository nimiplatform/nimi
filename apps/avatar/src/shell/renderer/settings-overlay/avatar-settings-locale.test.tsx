import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RefObject } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import type { BootstrapHandle } from '../app-shell/app-bootstrap.js';
import { CompanionSurface } from '../companion-surface/companion-surface.js';
import {
  LOCALE_STORAGE_KEY,
  changeLocale,
  getCurrentLocale,
} from '../i18n/index.js';
import enAvatar from '../locales/en/avatar.json' with { type: 'json' };
import zhAvatar from '../locales/zh/avatar.json' with { type: 'json' };
import { defaultAvatarShellSettings } from '../settings-state.js';
import type { AvatarVoiceCaptureSession } from '../voice-capture.js';
import { initialVoiceCompanionState } from '../voice-companion-state.js';
import { AvatarSettingsOverlay } from './avatar-settings-overlay.js';

type CatalogDocument = {
  namespaces?: Array<{
    id?: string;
    keys?: Array<{
      key?: string;
      usage?: string;
    }>;
  }>;
};

function readNestedLocaleLeaf(bundle: Record<string, unknown>, dottedKey: string): unknown {
  return dottedKey.split('.').reduce<unknown>((cursor, segment) => {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    return (cursor as Record<string, unknown>)[segment];
  }, bundle);
}

function createCompanionSurfaceProps() {
  const captureRef: RefObject<AvatarVoiceCaptureSession | null> = { current: null };
  const abortRef: RefObject<AbortController | null> = { current: null };
  const bootstrapHandle = {
    getVoiceInputAvailability: vi.fn(async () => ({ available: true, reason: null })),
    startVoiceCapture: vi.fn(),
    submitVoiceCaptureTurn: vi.fn(),
    interruptConversationTurn: vi.fn(async () => undefined),
    sendConversationText: vi.fn(async () => ({ turnId: 'turn-1' })),
    activateCommittedPresentation: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
  } as unknown as BootstrapHandle;

  return {
    bootstrapHandle,
    binding: {
      conversationAnchorId: 'agent_anchor_AUDIO_TEST',
      agentHandle: 'agent-audio-test',
    },
    anchorKey: 'agent-audio-test::agent_anchor_AUDIO_TEST',
    voice: {
      ...initialVoiceCompanionState,
      panelVisible: true,
      availability: 'ready' as const,
      audioPlaybackState: 'failed' as const,
      lipsyncActive: false,
    },
    shellSettings: defaultAvatarShellSettings,
    compositionState: 'ready',
    setVoice: vi.fn(),
    voiceCaptureSessionRef: captureRef,
    voiceSubmitAbortRef: abortRef,
    beginVoiceOperation: vi.fn(() => 1),
    clearVoiceOperation: vi.fn(),
    isVoiceOperationCurrent: vi.fn(() => true),
    onExplicitEngage: vi.fn(),
    onOpenTextInput: vi.fn(),
    onInterruptLocalCleanup: vi.fn(),
    onInterruptFailure: vi.fn(),
    onClose: vi.fn(),
  };
}

beforeEach(async () => {
  window.localStorage.clear();
  await changeLocale('en');
  window.localStorage.clear();
});

afterEach(async () => {
  cleanup();
  await changeLocale('en');
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('Avatar silent-audio copy contract (OBS-032(b))', () => {
  it('declares silent voice and lip sync when audio playback is unavailable in en and zh bundles', () => {
    const enCopy = enAvatar.Avatar.status.audio_unavailable;
    const zhCopy = zhAvatar.Avatar.status.audio_unavailable;

    expect(enCopy).toMatch(/audio playback is unavailable/i);
    expect(enCopy).toMatch(/voice/i);
    expect(enCopy).toMatch(/lip sync/i);
    expect(enCopy).toMatch(/silent/i);
    expect(enCopy).not.toMatch(/continue|timing data/i);

    expect(zhCopy).toContain('音频');
    expect(zhCopy).toContain('不可用');
    expect(zhCopy).toContain('语音');
    expect(zhCopy).toContain('口型同步');
    expect(zhCopy).toContain('静音');
    expect(zhCopy).not.toMatch(/继续|时间数据/);
  });

  it('projects the silent-audio accessible status label in CompanionSurface across en and zh locales', async () => {
    render(<CompanionSurface {...createCompanionSurfaceProps()} />);

    const enSpeakerStatus = screen.getByLabelText(enAvatar.Avatar.status.audio_unavailable);
    expect(enSpeakerStatus.getAttribute('role')).toBe('status');

    await act(async () => {
      await changeLocale('zh');
    });

    await waitFor(() => {
      const zhSpeakerStatus = screen.getByLabelText(zhAvatar.Avatar.status.audio_unavailable);
      expect(zhSpeakerStatus.getAttribute('role')).toBe('status');
    });
  });

  it('registers Avatar.status.audio_unavailable and Avatar.settings.language.* in key-catalog.yaml and both locales', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const catalogPath = path.resolve(here, '../i18n/key-catalog.yaml');
    const parsed = YAML.parse(readFileSync(catalogPath, 'utf8')) as CatalogDocument;
    const keys = new Set(
      (parsed.namespaces ?? []).flatMap((namespace) =>
        (namespace.keys ?? [])
          .map((entry) => entry.key)
          .filter((key): key is string => typeof key === 'string'),
      ),
    );

    const requiredKeys = [
      'Avatar.status.audio_unavailable',
      'Avatar.settings.language.label',
      'Avatar.settings.language.aria',
      'Avatar.settings.language.en',
      'Avatar.settings.language.zh',
    ];

    for (const key of requiredKeys) {
      expect(keys.has(key), `missing ${key} in key-catalog.yaml`).toBe(true);
      const enValue = readNestedLocaleLeaf(enAvatar as unknown as Record<string, unknown>, key);
      const zhValue = readNestedLocaleLeaf(zhAvatar as unknown as Record<string, unknown>, key);
      expect(typeof enValue).toBe('string');
      expect((enValue as string).trim().length).toBeGreaterThan(0);
      expect(typeof zhValue).toBe('string');
      expect((zhValue as string).trim().length).toBeGreaterThan(0);
    }
  });
});

describe('AvatarSettingsOverlay language switcher (OBS-032(a-local))', () => {
  it('switches cleanly between EN and 中文 via click and keyboard without dismissing the overlay', async () => {
    const onSettingsChange = vi.fn();
    const onDismiss = vi.fn();

    render(
      <AvatarSettingsOverlay
        x={120}
        y={120}
        settings={defaultAvatarShellSettings}
        onSettingsChange={onSettingsChange}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Avatar settings' })).toBeTruthy();
    expect(screen.getByText('Language')).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Interface language' })).toBeTruthy();

    const enRadio = screen.getByRole('radio', { name: 'EN' });
    const zhRadio = screen.getByRole('radio', { name: '中文' });
    expect(enRadio.getAttribute('aria-checked')).toBe('true');
    expect(zhRadio.getAttribute('aria-checked')).toBe('false');

    // Switch EN -> ZH by click
    await act(async () => {
      fireEvent.click(zhRadio);
    });

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '伙伴形象设置' })).toBeTruthy();
      expect(screen.getByText('语言')).toBeTruthy();
      expect(screen.getByText('始终置顶')).toBeTruthy();
      expect(screen.getByText('显示语音字幕')).toBeTruthy();
      expect(screen.getByRole('radiogroup', { name: '界面语言' })).toBeTruthy();
    });

    expect(getCurrentLocale()).toBe('zh');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh');
    expect(screen.getByRole('radio', { name: '中文' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'EN' }).getAttribute('aria-checked')).toBe('false');
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onSettingsChange).not.toHaveBeenCalled();

    // Switch ZH -> EN via keyboard navigation on the segmented radiogroup
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('radio', { name: '中文' }), { key: 'ArrowLeft' });
    });

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Avatar settings' })).toBeTruthy();
      expect(screen.getByText('Language')).toBeTruthy();
      expect(screen.getByText('Always on top')).toBeTruthy();
      expect(screen.getByText('Show voice captions')).toBeTruthy();
      expect(screen.getByRole('radiogroup', { name: 'Interface language' })).toBeTruthy();
    });

    expect(getCurrentLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(screen.getByRole('radio', { name: 'EN' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: '中文' }).getAttribute('aria-checked')).toBe('false');
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onSettingsChange).not.toHaveBeenCalled();
  });
});
