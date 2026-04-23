import type {
  ModelConfigCapabilityStatusTone,
  ModelConfigSection,
} from '@nimiplatform/nimi-kit/features/model-config';
import { SettingsSummaryCard } from './chat-shared-settings-summary-card';

export const AI_MODEL_MODULE_ORDER = ['chat', 'tts', 'stt', 'image', 'video', 'embed'] as const;
export type AiModelModuleId = (typeof AI_MODEL_MODULE_ORDER)[number];

const SECTION_TO_MODULE: Record<string, AiModelModuleId> = {
  chat: 'chat',
  tts: 'tts',
  stt: 'stt',
  image: 'image',
  video: 'video',
  embed: 'embed',
};

export function deriveSectionSummary(section: ModelConfigSection): {
  subtitle: string | null;
  statusDot: ModelConfigCapabilityStatusTone;
  statusLabel: string | null;
} {
  const primaryItem = section.items?.[0];
  if (!primaryItem) {
    return { subtitle: null, statusDot: 'neutral', statusLabel: null };
  }
  const binding = primaryItem.binding;
  const subtitle = binding?.modelLabel || binding?.model || null;
  const statusDot = primaryItem.status?.tone ?? 'neutral';
  const statusLabel = primaryItem.status?.badgeLabel ?? null;
  return { subtitle, statusDot, statusLabel };
}

export function buildAiModelSectionMap(sections: ModelConfigSection[]): Map<AiModelModuleId, ModelConfigSection> {
  const map = new Map<AiModelModuleId, ModelConfigSection>();
  for (const section of sections) {
    const moduleId = SECTION_TO_MODULE[section.id];
    if (moduleId && !section.hidden) {
      map.set(moduleId, section);
    }
  }
  return map;
}

export function summarizeAiModelAggregate(
  sections: ModelConfigSection[],
  labels: { ready: string; attention: string; neutral: string },
): { subtitle: string; statusDot: ModelConfigCapabilityStatusTone } {
  const map = buildAiModelSectionMap(sections);
  let ready = 0;
  let attention = 0;
  let neutral = 0;
  for (const moduleId of AI_MODEL_MODULE_ORDER) {
    const section = map.get(moduleId);
    if (!section) continue;
    const tone = deriveSectionSummary(section).statusDot;
    if (tone === 'ready') ready += 1;
    else if (tone === 'attention') attention += 1;
    else neutral += 1;
  }
  const parts: string[] = [];
  if (ready > 0) parts.push(labels.ready.replace('{{count}}', String(ready)));
  if (attention > 0) parts.push(labels.attention.replace('{{count}}', String(attention)));
  if (neutral > 0 && ready === 0 && attention === 0) {
    parts.push(labels.neutral.replace('{{count}}', String(neutral)));
  }
  const statusDot: ModelConfigCapabilityStatusTone = attention > 0 ? 'attention' : ready > 0 ? 'ready' : 'neutral';
  return { subtitle: parts.join(' · '), statusDot };
}

export type ChatSettingsAiModelHomeProps = {
  sections: ModelConfigSection[];
  onSelectModule: (moduleId: AiModelModuleId) => void;
};

export function ChatSettingsAiModelHome({ sections, onSelectModule }: ChatSettingsAiModelHomeProps) {
  const sectionByModule = buildAiModelSectionMap(sections);

  return (
    <div className="space-y-2">
      {AI_MODEL_MODULE_ORDER.map((moduleId) => {
        const section = sectionByModule.get(moduleId);
        if (!section) return null;
        const summary = deriveSectionSummary(section);
        return (
          <SettingsSummaryCard
            key={moduleId}
            title={section.title}
            subtitle={summary.subtitle}
            statusDot={summary.statusDot}
            statusLabel={summary.statusLabel}
            onClick={() => onSelectModule(moduleId)}
          />
        );
      })}
    </div>
  );
}
