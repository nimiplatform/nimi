import type { ReactNode } from 'react';
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import {
  FieldInput,
  FieldRow,
  FieldSelect,
  FieldTextarea,
  FieldToggle,
  SubSectionLabel,
} from '@nimiplatform/nimi-kit/features/model-config';

type ParentosTextGenerateDraft = {
  temperature: string;
  topP: string;
  maxTokens: string;
  timeoutMs: string;
};

type ParentosSpeechTranscribeDraft = {
  language: string;
  responseFormat: string;
  timeoutMs: string;
  speakerCount: string;
  prompt: string;
  timestamps: boolean;
  diarization: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toFiniteNumberString(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : '';
}

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

function parseInteger(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseFloatValue(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildTextGenerateDraft(params: Record<string, unknown>): ParentosTextGenerateDraft {
  return {
    temperature: toFiniteNumberString(params.temperature),
    topP: toFiniteNumberString(params.topP),
    maxTokens: toFiniteNumberString(params.maxTokens),
    timeoutMs: toFiniteNumberString(params.timeoutMs),
  };
}

function serializeTextGenerateDraft(draft: ParentosTextGenerateDraft): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  const temperature = parseFloatValue(draft.temperature);
  const topP = parseFloatValue(draft.topP);
  const maxTokens = parseInteger(draft.maxTokens);
  const timeoutMs = parseInteger(draft.timeoutMs);

  if (temperature !== null) {
    next.temperature = temperature;
  }
  if (topP !== null) {
    next.topP = topP;
  }
  if (maxTokens !== null) {
    next.maxTokens = maxTokens;
  }
  if (timeoutMs !== null) {
    next.timeoutMs = timeoutMs;
  }

  return next;
}

function buildSpeechTranscribeDraft(params: Record<string, unknown>): ParentosSpeechTranscribeDraft {
  return {
    language: toTrimmedString(params.language),
    responseFormat: toTrimmedString(params.responseFormat),
    timeoutMs: toFiniteNumberString(params.timeoutMs),
    speakerCount: toFiniteNumberString(params.speakerCount),
    prompt: toTrimmedString(params.prompt),
    timestamps: toBoolean(params.timestamps),
    diarization: toBoolean(params.diarization),
  };
}

function serializeSpeechTranscribeDraft(draft: ParentosSpeechTranscribeDraft): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  const timeoutMs = parseInteger(draft.timeoutMs);
  const speakerCount = parseInteger(draft.speakerCount);
  const language = draft.language.trim();
  const responseFormat = draft.responseFormat.trim();
  const prompt = draft.prompt.trim();

  if (language) {
    next.language = language;
  }
  if (responseFormat) {
    next.responseFormat = responseFormat;
  }
  if (timeoutMs !== null) {
    next.timeoutMs = timeoutMs;
  }
  if (speakerCount !== null) {
    next.speakerCount = speakerCount;
  }
  if (prompt) {
    next.prompt = prompt;
  }
  if (draft.timestamps) {
    next.timestamps = true;
  }
  if (draft.diarization) {
    next.diarization = true;
  }

  return next;
}

function EditorShell(props: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3">
      <SubSectionLabel label={props.title} />
      <p className="text-[11px] leading-5 text-slate-500">{props.hint}</p>
      {props.children}
    </div>
  );
}

function normalizeBinding(binding: RuntimeRouteBinding | null): RuntimeRouteBinding {
  return binding || {
    source: 'local',
    connectorId: '',
    model: '',
  };
}

function patchBinding(
  current: RuntimeRouteBinding,
  patch: Partial<RuntimeRouteBinding>,
): RuntimeRouteBinding {
  const nextSource = patch.source ?? current.source;
  const modelPatched = Object.prototype.hasOwnProperty.call(patch, 'model');
  const next = {
    ...current,
    ...patch,
  } satisfies RuntimeRouteBinding;

  if (nextSource !== 'local') {
    next.localModelId = undefined;
  } else if (modelPatched) {
    next.localModelId = undefined;
  }

  if (modelPatched) {
    const nextModel = String(patch.model || '').trim();
    next.modelId = nextModel || undefined;
  }

  if (nextSource !== 'cloud') {
    next.connectorId = '';
  }

  return next;
}

function BindingEditor(props: {
  binding: RuntimeRouteBinding | null;
  onBindingChange: (binding: RuntimeRouteBinding | null) => void;
  pickerAvailable: boolean;
  pickerUnavailableHint?: string;
}) {
  const current = normalizeBinding(props.binding);

  const update = (patch: Partial<RuntimeRouteBinding>) => {
    const next = patchBinding(current, patch);
    props.onBindingChange(next.model.trim() ? next : null);
  };

  return (
    <EditorShell
      title="模型绑定"
      hint={props.pickerAvailable
        ? '你可以使用上方选择器选模型；这里也可以直接手动改 route、model 和 connector。'
        : (props.pickerUnavailableHint || '当前 runtime 路由列表不可用，请直接手动填写 route、model 和 connector。')}
    >
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label="Route Source" tooltip="本地模型或云端连接器。">
          <FieldSelect
            value={current.source}
            onChange={(value) => update({ source: value === 'cloud' ? 'cloud' : 'local' })}
            options={[
              { value: 'local', label: 'local' },
              { value: 'cloud', label: 'cloud' },
            ]}
          />
        </FieldRow>
        <FieldRow label="Model" tooltip="运行时实际使用的 model id。">
          <FieldInput
            value={current.model}
            onChange={(value) => update({ model: value })}
            placeholder="例如 gpt-5.4 / whisper-large-v3"
          />
        </FieldRow>
      </div>
      {current.source === 'cloud' ? (
        <FieldRow label="Connector ID" tooltip="云端路由需要指定 connectorId。">
          <FieldInput
            value={current.connectorId}
            onChange={(value) => update({ connectorId: value })}
            placeholder="例如 openai-main"
          />
        </FieldRow>
      ) : null}
    </EditorShell>
  );
}

export function ParentosTextGenerateParamsEditor(props: {
  binding: RuntimeRouteBinding | null;
  onBindingChange: (binding: RuntimeRouteBinding | null) => void;
  pickerAvailable: boolean;
  pickerUnavailableHint?: string;
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
}) {
  const current = buildTextGenerateDraft(asRecord(props.params));

  const update = <K extends keyof ParentosTextGenerateDraft>(key: K, value: ParentosTextGenerateDraft[K]) => {
    props.onChange(serializeTextGenerateDraft({
      ...current,
      [key]: value,
    }));
  };

  return (
    <div className="space-y-3">
      <BindingEditor
        binding={props.binding}
        onBindingChange={props.onBindingChange}
        pickerAvailable={props.pickerAvailable}
        pickerUnavailableHint={props.pickerUnavailableHint}
      />
      <EditorShell
        title="高级参数"
        hint="这些值会作为 ParentOS 文本能力的默认运行时参数。留空时沿用各场景原本的安全默认值。"
      >
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Temperature" tooltip="控制输出随机性，常用范围 0 到 1。">
            <FieldInput value={current.temperature} onChange={(value) => update('temperature', value)} placeholder="沿用场景默认值" />
          </FieldRow>
          <FieldRow label="Top P" tooltip="核采样阈值，留空表示不额外限制。">
            <FieldInput value={current.topP} onChange={(value) => update('topP', value)} placeholder="沿用场景默认值" />
          </FieldRow>
          <FieldRow label="Max Tokens" tooltip="单次输出上限。">
            <FieldInput value={current.maxTokens} onChange={(value) => update('maxTokens', value)} placeholder="沿用场景默认值" />
          </FieldRow>
          <FieldRow label="Timeout (ms)" tooltip="运行时请求超时。">
            <FieldInput value={current.timeoutMs} onChange={(value) => update('timeoutMs', value)} placeholder="沿用场景默认值" />
          </FieldRow>
        </div>
      </EditorShell>
    </div>
  );
}

export function ParentosSpeechTranscribeParamsEditor(props: {
  binding: RuntimeRouteBinding | null;
  onBindingChange: (binding: RuntimeRouteBinding | null) => void;
  pickerAvailable: boolean;
  pickerUnavailableHint?: string;
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
}) {
  const current = buildSpeechTranscribeDraft(asRecord(props.params));

  const update = <K extends keyof ParentosSpeechTranscribeDraft>(key: K, value: ParentosSpeechTranscribeDraft[K]) => {
    props.onChange(serializeSpeechTranscribeDraft({
      ...current,
      [key]: value,
    }));
  };

  return (
    <div className="space-y-3">
      <BindingEditor
        binding={props.binding}
        onBindingChange={props.onBindingChange}
        pickerAvailable={props.pickerAvailable}
        pickerUnavailableHint={props.pickerUnavailableHint}
      />
      <EditorShell
        title="转写参数"
        hint="这些值会作为语音观察等 STT 能力的默认运行时参数。留空时保持 ParentOS 当前默认行为。"
      >
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Language" tooltip="例如 zh-CN、en-US。">
            <FieldInput value={current.language} onChange={(value) => update('language', value)} placeholder="zh-CN" />
          </FieldRow>
          <FieldRow label="Response Format" tooltip="运行时返回格式。默认使用 text。">
            <FieldSelect
              value={current.responseFormat}
              onChange={(value) => update('responseFormat', value)}
              placeholder="text"
              options={[
                { value: 'text', label: 'text' },
                { value: 'json', label: 'json' },
                { value: 'verbose_json', label: 'verbose_json' },
                { value: 'srt', label: 'srt' },
                { value: 'vtt', label: 'vtt' },
              ]}
            />
          </FieldRow>
          <FieldRow label="Timeout (ms)" tooltip="运行时请求超时。">
            <FieldInput value={current.timeoutMs} onChange={(value) => update('timeoutMs', value)} placeholder="沿用场景默认值" />
          </FieldRow>
          <FieldRow label="Speaker Count" tooltip="仅在启用 diarization 时有效。">
            <FieldInput value={current.speakerCount} onChange={(value) => update('speakerCount', value)} placeholder="自动判断" />
          </FieldRow>
        </div>

        <FieldToggle
          label="Timestamps"
          checked={current.timestamps}
          onChange={(value) => update('timestamps', value)}
        />
        <FieldToggle
          label="Diarization"
          checked={current.diarization}
          onChange={(value) => update('diarization', value)}
        />
        <FieldRow label="Prompt" tooltip="为转写器提供术语或上下文提示。">
          <FieldTextarea
            value={current.prompt}
            onChange={(value) => update('prompt', value)}
            placeholder="例如：儿童成长记录、常见人名与术语"
            rows={3}
          />
        </FieldRow>
      </EditorShell>
    </div>
  );
}
