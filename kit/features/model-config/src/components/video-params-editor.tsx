import type { VideoParamsState } from '../types.js';
import { VIDEO_MODE_OPTIONS, VIDEO_RATIO_OPTIONS } from '../constants.js';
import { FieldInput, FieldRow, FieldSelect, FieldToggle, SubSectionLabel } from './field-primitives.js';

export type VideoParamsEditorCopy = {
  parametersLabel: string;
  previewBadgeLabel?: string;
  modeLabel: string;
  ratioLabel: string;
  durationLabel: string;
  durationHint?: string;
  resolutionLabel: string;
  fpsLabel: string;
  seedLabel: string;
  seedHint?: string;
  timeoutLabel: string;
  cameraFixedLabel: string;
  generateAudioLabel: string;
  defaultPlaceholder?: string;
  randomPlaceholder?: string;
  modeOptions?: Array<{ value: string; label: string }>;
};

export type VideoParamsEditorProps = {
  params: VideoParamsState;
  onParamsChange: (next: VideoParamsState) => void;
  copy: VideoParamsEditorCopy;
};

export function VideoParamsEditor(props: VideoParamsEditorProps) {
  const { copy, params } = props;

  const updateParam = <K extends keyof VideoParamsState>(key: K, value: VideoParamsState[K]) => {
    props.onParamsChange({ ...params, [key]: value });
  };

  const modeOptions = copy.modeOptions || VIDEO_MODE_OPTIONS.map((item) => ({ value: item.value, label: item.label }));

  return (
    <div className="space-y-3">
      <SubSectionLabel label={copy.parametersLabel} previewLabel={copy.previewBadgeLabel} />

      <FieldRow label={copy.modeLabel}>
        <FieldSelect
          value={params.mode}
          onChange={(value) => updateParam('mode', value)}
          options={modeOptions}
        />
      </FieldRow>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={copy.ratioLabel}>
          <FieldSelect
            value={params.ratio}
            onChange={(value) => updateParam('ratio', value)}
            options={VIDEO_RATIO_OPTIONS.map((item) => ({ value: item, label: item }))}
          />
        </FieldRow>
        <FieldRow label={copy.durationLabel} tooltip={copy.durationHint}>
          <FieldInput
            value={params.durationSec}
            onChange={(value) => updateParam('durationSec', value)}
          />
        </FieldRow>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={copy.resolutionLabel}>
          <FieldInput
            value={params.resolution}
            onChange={(value) => updateParam('resolution', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </FieldRow>
        <FieldRow label={copy.fpsLabel}>
          <FieldInput
            value={params.fps}
            onChange={(value) => updateParam('fps', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </FieldRow>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={copy.seedLabel} tooltip={copy.seedHint}>
          <FieldInput
            value={params.seed}
            onChange={(value) => updateParam('seed', value)}
            placeholder={copy.randomPlaceholder}
          />
        </FieldRow>
        <FieldRow label={copy.timeoutLabel}>
          <FieldInput
            value={params.timeoutMs}
            onChange={(value) => updateParam('timeoutMs', value)}
          />
        </FieldRow>
      </div>

      <FieldToggle
        label={copy.cameraFixedLabel}
        checked={params.cameraFixed}
        onChange={(value) => updateParam('cameraFixed', value)}
      />
      <FieldToggle
        label={copy.generateAudioLabel}
        checked={params.generateAudio}
        onChange={(value) => updateParam('generateAudio', value)}
      />
    </div>
  );
}
