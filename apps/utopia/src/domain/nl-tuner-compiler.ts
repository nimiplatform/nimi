import type { NimiJsonObject } from '@nimiplatform/sdk';
import type {
  HabitatPlaceSpec,
  HabitatSceneryKind,
  HabitatSpecV1,
  NimiLocalAppAIConsumptionClient,
  NimiUtopiaEventMutation,
  NimiUtopiaUpdateIntent,
  NimiUtopiaSnapshot,
} from '@nimiplatform/sdk/app';
import { previewParameterPlaceDiff, SCENERY_KIND_LABELS } from './visit-journal.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.utopia-operations
// @nimi-authority: rule.nimi.sdks.feature-clients.r101

export const MAX_NL_TUNER_INPUT_CHARS = 120;

const ALLOWED_SCENERY_KINDS = new Set<HabitatSceneryKind>([
  'clear-sky', 'rain', 'snowfall', 'mist', 'aurora', 'meteor-shower',
  'blossom', 'wildlife-visit', 'tide-pooling', 'harvest', 'hearth-lit', 'radio-signal',
]);

const SHORT_NOUN_STRIP_RE = /[.!?。！？;；:：\r\n\t<>[\]{}]/gu;
const CONTROL_RE = /[\u0000-\u001f\u007f]/gu;

export type CompiledParameterChange = Readonly<{
  readonly key: string;
  readonly parameterLabel: string;
  readonly fromValue: string;
  readonly fromLabel: string;
  readonly toValue: string;
  readonly toLabel: string;
}>;

export type CompiledEventPreview =
  | Readonly<{
      readonly kind: 'trigger-preset';
      readonly presetId: string;
      readonly sceneryKind: HabitatSceneryKind;
      readonly label: string;
      readonly description: string;
      readonly placeId: string | null;
      readonly placeName: string | null;
      readonly durationMinutes: number;
    }>
  | Readonly<{
      readonly kind: 'put-custom';
      readonly sceneryKind: HabitatSceneryKind;
      readonly label: string;
      readonly description: string;
      readonly placeId: string | null;
      readonly placeName: string | null;
      readonly durationMinutes: number;
    }>;

export type NaturalLanguageTuningDraft = Readonly<{
  readonly userPrompt: string;
  readonly parameterChanges: readonly CompiledParameterChange[];
  readonly eventPreview: CompiledEventPreview | null;
  readonly newlyOpenedPlaces: readonly HabitatPlaceSpec[];
  readonly newlyClosedPlaces: readonly HabitatPlaceSpec[];
  readonly unsupportedNote: string | null;
  readonly commitIntent: Extract<NimiUtopiaUpdateIntent, { readonly kind: 'apply-tuning' }> | null;
}>;

export type TuningPreviewBasis = Pick<NimiUtopiaSnapshot, 'revision' | 'habitatActivationId' | 'contentDigest'>;
export type BoundTuningDraft = NaturalLanguageTuningDraft & { readonly basis: TuningPreviewBasis };

export function tuningPreviewMatches(basis: TuningPreviewBasis, current: TuningPreviewBasis): boolean {
  return basis.revision === current.revision && basis.habitatActivationId === current.habitatActivationId
    && basis.contentDigest === current.contentDigest;
}

// Own the generation lifetime separately from the React rendering lifetime.
// A late model result is never rebound to a newer settings revision.
export function createTuningPreviewGate() {
  let generation = 0;
  let controller: AbortController | null = null;
  return {
    invalidate() { generation++; controller?.abort(); controller = null; },
    begin(current: TuningPreviewBasis) {
      controller?.abort();
      controller = new AbortController();
      return { generation: ++generation, signal: controller.signal,
        basis: Object.freeze({ revision: current.revision, habitatActivationId: current.habitatActivationId,
          contentDigest: current.contentDigest }) };
    },
    isCurrent(ticket: { generation: number; basis: TuningPreviewBasis }, current: TuningPreviewBasis) {
      return ticket.generation === generation && tuningPreviewMatches(ticket.basis, current);
    },
  };
}

const TUNING_JSON_SCHEMA: NimiJsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['parameterChanges', 'eventMutation', 'unsupportedNote'],
  properties: {
    parameterChanges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'value'],
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
        },
      },
    },
    eventMutation: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['mode', 'presetId', 'sceneryKind', 'label', 'description', 'placeId', 'durationMinutes'],
          properties: {
            mode: { type: 'string', enum: ['preset', 'custom'] },
            presetId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            sceneryKind: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            label: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            description: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            placeId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            durationMinutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          },
        },
      ],
    },
    unsupportedNote: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
  },
};

function sanitizeShortNoun(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(CONTROL_RE, '').replace(SHORT_NOUN_STRIP_RE, '').trim();
  const cps = Array.from(cleaned);
  if (cps.length < 1) return null;
  let bounded = '';
  const encoder = new TextEncoder();
  for (const cp of cps.slice(0, 16)) {
    if (encoder.encode(bounded + cp).byteLength > 48) break;
    bounded += cp;
  }
  bounded = bounded.trim();
  return bounded.length > 0 ? bounded : null;
}

function sanitizeDisplayText(raw: unknown, maxCodePoints: number): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(CONTROL_RE, ' ').trim();
  const cps = Array.from(cleaned);
  if (cps.length < 1) return null;
  return cps.length > maxCodePoints ? cps.slice(0, maxCodePoints).join('').trim() : cleaned;
}

function clampDurationMinutes(raw: unknown, fallback = 120): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.min(720, Math.max(30, Math.round(raw)));
}

export function buildDeterministicTunerSystemPrompt(
  habitat: HabitatSpecV1,
  currentParameterValues: Readonly<Record<string, string>>,
): string {
  // Strictly zero private chat, zero resident handles/names, zero memory data.
  const specDigest = {
    habitatTitle: habitat.title,
    themeTag: habitat.themeTag,
    parameters: habitat.parameters.map((p) => ({
      key: p.key,
      label: p.label,
      currentValue: currentParameterValues[p.key] ?? p.defaultValue,
      options: p.options.map((o) => ({ value: o.value, label: o.label, summary: o.summary })),
    })),
    places: habitat.places.map((pl) => ({
      id: pl.id,
      name: pl.name,
      indoor: pl.indoor,
      openWhen: pl.openWhen,
    })),
    eventPresets: habitat.eventPresets.map((ep) => ({
      id: ep.id,
      sceneryKind: ep.sceneryKind,
      label: ep.label,
      placeId: ep.placeId,
      defaultDurationMinutes: ep.defaultDurationMinutes,
    })),
    allowedCustomSceneryKinds: Object.keys(SCENERY_KIND_LABELS),
  };

  return [
    '你是 NimiUtopia 受控洞天调音编译器。',
    '请将用户的自然语言愿望映射为当前洞天协议允许的「已有环境参数变更」与至多 1 条立即生效的「纯环境风物事件」。',
    '铁律：',
    '1. 只能从下方 parameters 枚举中选择存在的 key 和 option.value；不可凭空新建场所、建筑模块或扩建地形。',
    '2. 风物事件严禁包含支配角色行为、情绪或剧情指令的字眼；custom 事件的 label 必须是 2..14 字纯环境名词短语（不含句号/感叹号/冒号），sceneryKind 必须属于 allowedCustomSceneryKinds，durationMinutes 在 30..720 之间。',
    '3. 若用户请求超出了洞天支持范围（例如要求新建游乐场、盖新房子、强迫伙伴做某事或预约未来定时事件），请在保留可执行天气/风物调整的同时，在 unsupportedNote 中用温和简短中文诚实说明边界。',
    `当前洞天元数据 JSON：${JSON.stringify(specDigest)}`,
  ].join('\n');
}

function extractJsonObjectFromText(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  const candidate = fenced ? fenced[1]!.trim() : trimmed;
  return JSON.parse(candidate);
}

export function validateAndCompileTunerResponse(
  userPrompt: string,
  rawParsed: unknown,
  habitat: HabitatSpecV1,
  currentParameterValues: Readonly<Record<string, string>>,
): NaturalLanguageTuningDraft {
  if (!rawParsed || typeof rawParsed !== 'object' || Array.isArray(rawParsed)) {
    throw new Error('模型未返回有效结构化调音草案。');
  }
  const obj = rawParsed as Record<string, unknown>;
  const paramByKey = new Map(habitat.parameters.map((p) => [p.key, p]));
  const placeById = new Map(habitat.places.map((p) => [p.id, p]));
  const presetById = new Map(habitat.eventPresets.map((ep) => [ep.id, ep]));

  const compiledChanges: CompiledParameterChange[] = [];
  const nextParamRecord: Record<string, string> = {};
  const seenKeys = new Set<string>();

  if (Array.isArray(obj.parameterChanges)) {
    for (const entry of obj.parameterChanges) {
      if (!entry || typeof entry !== 'object') continue;
      const rec = entry as { key?: unknown; value?: unknown };
      if (typeof rec.key !== 'string' || typeof rec.value !== 'string' || seenKeys.has(rec.key)) continue;
      const specParam = paramByKey.get(rec.key);
      if (!specParam) continue;
      const targetOpt = specParam.options.find((o) => o.value === rec.value);
      if (!targetOpt) continue;
      const currentVal = currentParameterValues[rec.key] ?? specParam.defaultValue;
      seenKeys.add(rec.key);
      if (currentVal === targetOpt.value) continue;
      const fromOpt = specParam.options.find((o) => o.value === currentVal);
      nextParamRecord[rec.key] = targetOpt.value;
      compiledChanges.push({
        key: rec.key,
        parameterLabel: specParam.label,
        fromValue: currentVal,
        fromLabel: fromOpt?.label ?? currentVal,
        toValue: targetOpt.value,
        toLabel: targetOpt.label,
      });
    }
  }

  let eventPreview: CompiledEventPreview | null = null;
  let eventMutation: NimiUtopiaEventMutation | undefined;
  let droppedPlaceFallbackNote: string | null = null;

  if (obj.eventMutation && typeof obj.eventMutation === 'object' && !Array.isArray(obj.eventMutation)) {
    const ev = obj.eventMutation as Record<string, unknown>;
    if (ev.mode === 'preset' && typeof ev.presetId === 'string') {
      const preset = presetById.get(ev.presetId);
      if (preset) {
        const durationMinutes = clampDurationMinutes(ev.durationMinutes, preset.defaultDurationMinutes);
        const placeName = preset.placeId ? (placeById.get(preset.placeId)?.name ?? null) : null;
        eventPreview = {
          kind: 'trigger-preset',
          presetId: preset.id,
          sceneryKind: preset.sceneryKind,
          label: preset.label,
          description: preset.description,
          placeId: preset.placeId,
          placeName,
          durationMinutes,
        };
        eventMutation = {
          kind: 'trigger-preset',
          presetId: preset.id,
          durationMinutes,
        };
      }
    } else if (
      ev.mode === 'custom'
      && typeof ev.sceneryKind === 'string'
      && ALLOWED_SCENERY_KINDS.has(ev.sceneryKind as HabitatSceneryKind)
    ) {
      const label = sanitizeShortNoun(ev.label);
      const description = sanitizeDisplayText(ev.description, 120)
        ?? (label ? `${habitat.title}出现了「${label}」的即时风物景象。` : null);
      if (label && description) {
        const rawRequestedPlace = typeof ev.placeId === 'string' ? ev.placeId.trim() : '';
        const validPlace = rawRequestedPlace && placeById.has(rawRequestedPlace)
          ? placeById.get(rawRequestedPlace)!
          : null;
        if (rawRequestedPlace && !validPlace) {
          const safePlaceRef = sanitizeDisplayText(rawRequestedPlace, 24) ?? '所指地点';
          droppedPlaceFallbackNote = `当前洞天未找到公共场所「${safePlaceRef}」，该即时风物已调整为全洞天范围生效。`;
        }
        const durationMinutes = clampDurationMinutes(ev.durationMinutes, 180);
        eventPreview = {
          kind: 'put-custom',
          sceneryKind: ev.sceneryKind as HabitatSceneryKind,
          label,
          description,
          placeId: validPlace?.id ?? null,
          placeName: validPlace?.name ?? null,
          durationMinutes,
        };
        eventMutation = {
          kind: 'put-custom',
          sceneryKind: ev.sceneryKind as HabitatSceneryKind,
          label,
          description,
          ...(validPlace ? { placeId: validPlace.id } : {}),
          durationMinutes,
        };
      }
    }
  }

  const diff = previewParameterPlaceDiff(habitat, currentParameterValues, nextParamRecord);
  let unsupportedNote = sanitizeDisplayText(obj.unsupportedNote, 120);
  if (droppedPlaceFallbackNote) {
    unsupportedNote = unsupportedNote
      ? sanitizeDisplayText(`${droppedPlaceFallbackNote} ${unsupportedNote}`, 120) ?? droppedPlaceFallbackNote
      : droppedPlaceFallbackNote;
  }

  const hasChanges = compiledChanges.length > 0 || Boolean(eventMutation);
  if (!hasChanges && !unsupportedNote) {
    unsupportedNote = '当前洞天仅支持调拨已声明的天气／环境参数与即时风物，未能从该描述中匹配到可执行变更。';
  }

  const commitIntent: Extract<NimiUtopiaUpdateIntent, { readonly kind: 'apply-tuning' }> | null = hasChanges
    ? {
        kind: 'apply-tuning',
        ...(compiledChanges.length > 0 ? { parameters: nextParamRecord } : {}),
        ...(eventMutation ? { event: eventMutation } : {}),
      }
    : null;

  return Object.freeze({
    userPrompt,
    parameterChanges: compiledChanges,
    eventPreview,
    newlyOpenedPlaces: diff.newlyOpened,
    newlyClosedPlaces: diff.newlyClosed,
    unsupportedNote,
    commitIntent,
  });
}

export async function compileNaturalLanguageTuning(input: {
  readonly prompt: string;
  readonly habitat: HabitatSpecV1;
  readonly currentParameterValues: Readonly<Record<string, string>>;
  readonly aiClient: Pick<NimiLocalAppAIConsumptionClient, 'scenario'>;
  readonly signal?: AbortSignal;
}): Promise<NaturalLanguageTuningDraft> {
  const trimmed = input.prompt.replace(CONTROL_RE, ' ').trim();
  const cps = Array.from(trimmed);
  if (cps.length === 0) {
    throw new Error('请输入想要调整的洞天风物描述。');
  }
  if (cps.length > MAX_NL_TUNER_INPUT_CHARS) {
    throw new Error(`单次描述请控制在 ${MAX_NL_TUNER_INPUT_CHARS} 字以内。`);
  }

  const systemPrompt = buildDeterministicTunerSystemPrompt(input.habitat, input.currentParameterValues);
  const response = await input.aiClient.scenario.execute(
    {
      type: 'text-generate',
      messages: [
        { role: 'system', text: systemPrompt },
        { role: 'user', text: trimmed },
      ],
      responseFormat: {
        type: 'json-schema',
        name: 'utopia_tuning_draft',
        schema: TUNING_JSON_SCHEMA,
        strict: true,
      },
    },
    {
      ...(input.signal ? { signal: input.signal } : {}),
      timeoutMs: 30_000,
    },
  );

  if (response.output.type !== 'text-generate') {
    throw new Error('模型返回了非文本生成结果。');
  }

  const textOutput = response.output.items
    .filter((item): item is Extract<typeof item, { readonly type: 'text' }> => item.type === 'text')
    .map((item) => item.text)
    .join('')
    .trim();

  if (!textOutput) {
    throw new Error('模型未返回调音内容，请检查当前应用的生成模型配置。');
  }

  let rawParsed: unknown;
  try {
    rawParsed = extractJsonObjectFromText(textOutput);
  } catch {
    throw new Error('模型输出格式无法解析为结构化洞天变更，请换一种简短描述重试。');
  }

  return validateAndCompileTunerResponse(trimmed, rawParsed, input.habitat, input.currentParameterValues);
}
