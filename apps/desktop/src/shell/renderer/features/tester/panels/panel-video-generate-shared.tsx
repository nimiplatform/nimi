import React from 'react';

export type VideoMode = 't2v' | 'i2v-first-frame' | 'i2v-reference';

export const PROMPT_MAX = 500;
export const HISTORY_LIMIT = 20;

export const RATIO_PRESETS: Array<{ label: string; value: string; w: number; h: number }> = [
  { label: '21:9', value: '21:9', w: 21, h: 9 },
  { label: '16:9', value: '16:9', w: 16, h: 9 },
  { label: '4:3', value: '4:3', w: 4, h: 3 },
  { label: '1:1', value: '1:1', w: 1, h: 1 },
  { label: '3:4', value: '3:4', w: 3, h: 4 },
  { label: '9:16', value: '9:16', w: 9, h: 16 },
];

export const DURATION_PRESETS = [3, 5, 8, 10];
export const RESOLUTION_PRESETS = ['', '480p', '720p', '1080p'];

// ---------------------------------------------------------------------------
// Inline icons
// ---------------------------------------------------------------------------

export const ARROW_UP_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

export const PLUS_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const X_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const CHEVRON_ICON = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export const CLOCK_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

export const SOUND_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </svg>
);

export const LOCK_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export const FILM_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

export const RECT_ICON = (
  <svg width="13" height="9" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="10" rx="1.5" />
  </svg>
);

export const TRASH_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
);

export const EMPTY_VIDEO_ICON = (
  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

export const EYE_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const DOWNLOAD_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const COPY_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const REFRESH_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isI2vMode(mode: string): boolean {
  return mode !== 't2v';
}

export function modeShortLabel(mode: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (mode === 'i2v-first-frame') return t('Tester.videoGenerate.modeLongI2vFirstFrame', { defaultValue: 'First Frame' });
  if (mode === 'i2v-reference' || mode === 'i2v-first-last') return t('Tester.videoGenerate.modeLongI2vReference', { defaultValue: 'Reference' });
  return t('Tester.videoGenerate.modeLongT2v', { defaultValue: 'Text' });
}

export function modeDescription(mode: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (mode === 'i2v-first-frame') return t('Tester.videoGenerate.modeDescI2vFirstFrame', { defaultValue: 'Your photo becomes the opening shot' });
  if (mode === 'i2v-reference' || mode === 'i2v-first-last') return t('Tester.videoGenerate.modeDescI2vReference', { defaultValue: 'Match the look of your photo' });
  return t('Tester.videoGenerate.modeDescT2v', { defaultValue: 'Describe your video with words' });
}

export function formatScenarioJobProgress(job: Record<string, unknown> | null | undefined): string {
  const record = job || {};
  const progressPercent = Number(record.progressPercent ?? record.progress);
  const currentStep = Number(record.progressCurrentStep ?? record.progress_current_step);
  const totalSteps = Number(record.progressTotalSteps ?? record.progress_total_steps);
  const parts: string[] = [];
  if (Number.isFinite(progressPercent) && progressPercent >= 0) {
    parts.push(`${Math.round(progressPercent)}%`);
  }
  if (Number.isFinite(currentStep) && currentStep > 0 && Number.isFinite(totalSteps) && totalSteps > 0) {
    parts.push(`${Math.round(currentStep)}/${Math.round(totalSteps)}`);
  }
  return parts.join(' · ');
}

export function formatRelativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function useOutsideClick(ref: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  React.useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [ref, open, onClose]);
}

// ---------------------------------------------------------------------------
// Visual primitives
// ---------------------------------------------------------------------------
