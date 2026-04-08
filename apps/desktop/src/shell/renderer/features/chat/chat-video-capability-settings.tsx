import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  VIDEO_RATIO_OPTIONS,
  VIDEO_MODE_OPTIONS,
  DEFAULT_VIDEO_PARAMS,
  type VideoParamsState,
  FieldRow,
  FieldInput,
  FieldSelect,
  FieldToggle,
  SubSectionLabel,
} from './capability-settings-shared';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function VideoCapabilitySettings() {
  const { t } = useTranslation();
  const [params, setParams] = useState<VideoParamsState>(DEFAULT_VIDEO_PARAMS);

  const updateParam = <K extends keyof VideoParamsState>(key: K, value: VideoParamsState[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-3">
      <SubSectionLabel label={t('Chat.videoParameters', { defaultValue: 'Parameters' })} preview />

      <FieldRow label={t('Chat.videoParamMode', { defaultValue: 'Mode' })}>
        <FieldSelect
          value={params.mode}
          onChange={(v) => updateParam('mode', v)}
          options={VIDEO_MODE_OPTIONS.map((m) => ({ value: m.value, label: t(m.i18nKey, { defaultValue: m.defaultLabel }) }))}
        />
      </FieldRow>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={t('Chat.videoParamRatio', { defaultValue: 'Aspect ratio' })}>
          <FieldSelect
            value={params.ratio}
            onChange={(v) => updateParam('ratio', v)}
            options={VIDEO_RATIO_OPTIONS.map((r) => ({ value: r, label: r }))}
          />
        </FieldRow>
        <FieldRow label={t('Chat.videoParamDuration', { defaultValue: 'Duration (sec)' })} tooltip={t('Chat.videoParamDurationHint', { defaultValue: 'Range: 1–11 seconds' })}>
          <FieldInput value={params.durationSec} onChange={(v) => updateParam('durationSec', v)} />
        </FieldRow>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={t('Chat.videoParamResolution', { defaultValue: 'Resolution' })}>
          <FieldInput value={params.resolution} onChange={(v) => updateParam('resolution', v)} placeholder={t('Chat.placeholderDefault', { defaultValue: 'Default' })} />
        </FieldRow>
        <FieldRow label={t('Chat.videoParamFps', { defaultValue: 'FPS' })}>
          <FieldInput value={params.fps} onChange={(v) => updateParam('fps', v)} placeholder={t('Chat.placeholderDefault', { defaultValue: 'Default' })} />
        </FieldRow>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={t('Chat.videoParamSeed', { defaultValue: 'Seed' })} tooltip={t('Chat.videoParamSeedHint', { defaultValue: 'Optional seed for reproducibility' })}>
          <FieldInput value={params.seed} onChange={(v) => updateParam('seed', v)} placeholder={t('Chat.placeholderRandom', { defaultValue: 'Random' })} />
        </FieldRow>
        <FieldRow label={t('Chat.videoParamTimeout', { defaultValue: 'Timeout (ms)' })}>
          <FieldInput value={params.timeoutMs} onChange={(v) => updateParam('timeoutMs', v)} />
        </FieldRow>
      </div>

      <FieldToggle
        label={t('Chat.videoParamCameraFixed', { defaultValue: 'Fixed camera' })}
        checked={params.cameraFixed}
        onChange={(v) => updateParam('cameraFixed', v)}
      />
      <FieldToggle
        label={t('Chat.videoParamGenerateAudio', { defaultValue: 'Generate audio' })}
        checked={params.generateAudio}
        onChange={(v) => updateParam('generateAudio', v)}
      />
    </div>
  );
}
