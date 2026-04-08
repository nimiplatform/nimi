/**
 * Shared field primitives, companion model components, and constants
 * for capability settings (image/video). Used by both Chat Settings and Profile Editor.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tooltip } from '@nimiplatform/nimi-kit/ui';
import { getPlatformClient } from '@nimiplatform/sdk';
import { useTranslation } from 'react-i18next';

// ---------------------------------------------------------------------------
// Shared field styles — matched to ModelSelectorTrigger
// ---------------------------------------------------------------------------

const FIELD_BASE = 'w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-800 outline-none transition-colors hover:border-slate-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';
const FIELD_HEIGHT = 'h-10';
const FIELD_PLACEHOLDER = 'text-slate-400';

// ---------------------------------------------------------------------------
// Field primitives
// ---------------------------------------------------------------------------

export function FieldLabel(props: { label: string; tooltip?: string }) {
  if (props.tooltip) {
    return (
      <Tooltip content={props.tooltip} placement="top">
        <span className="text-xs font-medium text-slate-500">{props.label}</span>
      </Tooltip>
    );
  }
  return <span className="text-xs font-medium text-slate-500">{props.label}</span>;
}

export function FieldRow(props: { label: string; tooltip?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <FieldLabel label={props.label} tooltip={props.tooltip} />
      {props.children}
    </div>
  );
}

export function FieldInput(props: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      className={`${FIELD_BASE} ${FIELD_HEIGHT} placeholder:${FIELD_PLACEHOLDER}`}
    />
  );
}

export function FieldSelect(props: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      className={`${FIELD_BASE} ${FIELD_HEIGHT}`}
    >
      {props.placeholder ? <option value="">{props.placeholder}</option> : null}
      {props.options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

export function FieldTextarea(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      rows={props.rows || 3}
      className={`${FIELD_BASE} resize-y py-2.5 placeholder:${FIELD_PLACEHOLDER}`}
    />
  );
}

export function FieldToggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-1">
      <span className="text-xs font-medium text-slate-500">{props.label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        onClick={() => props.onChange(!props.checked)}
        className={[
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
          props.checked ? 'bg-emerald-500' : 'bg-slate-200',
        ].join(' ')}
      >
        <span className={[
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
          props.checked ? 'translate-x-4' : 'translate-x-0',
        ].join(' ')} />
      </button>
    </label>
  );
}

export function PreviewBadge() {
  const { t } = useTranslation();
  return (
    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-600">
      {t('Chat.badgePreview', { defaultValue: 'Preview' })}
    </span>
  );
}

export function SubSectionLabel(props: { label: string; preview?: boolean }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <div className="h-px flex-1 bg-slate-100" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-300">{props.label}</span>
      {props.preview ? <PreviewBadge /> : null}
      <div className="h-px flex-1 bg-slate-100" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local asset types and hooks
// ---------------------------------------------------------------------------

export type LocalAssetEntry = {
  localAssetId: string;
  assetId: string;
  kind: number;
  engine: string;
  status: number;
};

// kind enum values from proto LocalAssetKind
export const ASSET_KIND_MAP: Record<string, number[]> = {
  vae: [10],
  chat: [1],
  clip: [11],
  controlnet: [13],
  lora: [12],
  auxiliary: [14],
};

export function useLocalAssets() {
  return useQuery({
    queryKey: ['image-companion-local-assets'],
    queryFn: async () => {
      const runtime = getPlatformClient().runtime;
      const response = await runtime.local.listLocalAssets({
        statusFilter: 0,
        kindFilter: 0,
        engineFilter: '',
        pageSize: 0,
        pageToken: '',
      });
      return (response.assets || []) as LocalAssetEntry[];
    },
    staleTime: 30_000,
  });
}

export function filterAssetsByKind(assets: LocalAssetEntry[], kind: string): LocalAssetEntry[] {
  const kindValues = ASSET_KIND_MAP[kind];
  if (!kindValues) return assets;
  return assets.filter((a) => kindValues.includes(a.kind) && a.status !== 4);
}

// ---------------------------------------------------------------------------
// Companion model types and components
// ---------------------------------------------------------------------------

export type CompanionSlotDef = {
  slot: string;
  label: string;
  kind: string;
};

export const COMPANION_SLOTS: CompanionSlotDef[] = [
  { slot: 'vae_path', label: 'VAE', kind: 'vae' },
  { slot: 'llm_path', label: 'LLM', kind: 'chat' },
  { slot: 'clip_l_path', label: 'CLIP-L', kind: 'clip' },
  { slot: 'clip_g_path', label: 'CLIP-G', kind: 'clip' },
  { slot: 'controlnet_path', label: 'ControlNet', kind: 'controlnet' },
  { slot: 'lora_path', label: 'LoRA', kind: 'lora' },
  { slot: 'aux_path', label: 'Auxiliary', kind: 'auxiliary' },
];

export function CompanionSlotSelector(props: {
  slot: CompanionSlotDef;
  value: string;
  onChange: (value: string) => void;
  assets: LocalAssetEntry[];
}) {
  const { t } = useTranslation();
  const filtered = useMemo(
    () => filterAssetsByKind(props.assets, props.slot.kind),
    [props.assets, props.slot.kind],
  );
  return (
    <FieldRow label={props.slot.label}>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className={`${FIELD_BASE} ${FIELD_HEIGHT}`}
      >
        <option value="">{t('Chat.companionSlotNone', { defaultValue: 'None' })}</option>
        {filtered.map((asset) => (
          <option key={asset.localAssetId} value={asset.localAssetId}>
            {asset.assetId || asset.localAssetId}
          </option>
        ))}
      </select>
    </FieldRow>
  );
}

// ---------------------------------------------------------------------------
// Image constants
// ---------------------------------------------------------------------------

export const IMAGE_SIZE_PRESETS = ['512x512', '768x768', '1024x1024', '1024x576', '576x1024'];
export const IMAGE_RESPONSE_FORMAT_OPTIONS = ['auto', 'base64', 'url'];

export type ImageParamsState = {
  size: string;
  responseFormat: string;
  seed: string;
  timeoutMs: string;
  steps: string;
  cfgScale: string;
  sampler: string;
  scheduler: string;
  optionsText: string;
};

export const DEFAULT_IMAGE_PARAMS: ImageParamsState = {
  size: '512x512',
  responseFormat: 'auto',
  seed: '',
  timeoutMs: '600000',
  steps: '25',
  cfgScale: '',
  sampler: '',
  scheduler: '',
  optionsText: '',
};

// ---------------------------------------------------------------------------
// Video constants
// ---------------------------------------------------------------------------

export const VIDEO_RATIO_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
export const VIDEO_MODE_OPTIONS = [
  { value: 't2v', i18nKey: 'Chat.videoModeT2v', defaultLabel: 'Text to Video' },
  { value: 'i2v-first-frame', i18nKey: 'Chat.videoModeI2vFirst', defaultLabel: 'Image to Video (first frame)' },
  { value: 'i2v-reference', i18nKey: 'Chat.videoModeI2vRef', defaultLabel: 'Image to Video (reference)' },
];

export type VideoParamsState = {
  mode: string;
  ratio: string;
  durationSec: string;
  resolution: string;
  fps: string;
  seed: string;
  timeoutMs: string;
  negativePrompt: string;
  cameraFixed: boolean;
  generateAudio: boolean;
};

export const DEFAULT_VIDEO_PARAMS: VideoParamsState = {
  mode: 't2v',
  ratio: '16:9',
  durationSec: '5',
  resolution: '',
  fps: '',
  seed: '',
  timeoutMs: '600000',
  negativePrompt: '',
  cameraFixed: false,
  generateAudio: false,
};
