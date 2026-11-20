import type { NimiLocalAppClient } from '@nimiplatform/sdk';
import type {
  NimiLocalAppAgentIntroduction,
  NimiUtopiaResident,
  NimiUtopiaSnapshot,
} from '@nimiplatform/sdk/app';
import type { CompanionPresenceTone } from '../components/CompanionAvatar.js';

export type CompanionIntroSummary = Readonly<{
  readonly originLine: string | null;
  readonly greeting: string | null;
  readonly referenceImageUrl: string | null;
  readonly voiceUrl: string | null;
  readonly voiceDurationSec: number | null;
  readonly topics: readonly string[];
}>;

export type ResidentPresenceSummary = Readonly<{
  readonly tone: CompanionPresenceTone;
  readonly statusBadge: string;
  readonly shortLocationOrState: string;
  readonly focusPlaceId: string | null;
}>;

export type AgentReferenceDirectory = Readonly<{
  readonly avatarsByHandle: Readonly<Record<string, string | null>>;
  readonly bindingsByHandle: Readonly<Record<string, string>>;
}>;

export async function loadAgentReferenceDirectory(
  client: NimiLocalAppClient,
): Promise<AgentReferenceDirectory> {
  if (!client || typeof client.agents?.listReferences !== 'function') {
    return Object.freeze({ avatarsByHandle: {}, bindingsByHandle: {} });
  }
  try {
    const refs = await client.agents.listReferences();
    const avatars: Record<string, string | null> = {};
    const bindings: Record<string, string> = {};
    for (const ref of refs) {
      avatars[ref.agentHandle] = ref.avatarUrl;
      if (typeof ref.agentBinding === 'string' && ref.agentBinding.trim()) {
        bindings[ref.agentHandle] = ref.agentBinding;
      }
    }
    return Object.freeze({
      avatarsByHandle: Object.freeze(avatars),
      bindingsByHandle: Object.freeze(bindings),
    });
  } catch {
    return Object.freeze({ avatarsByHandle: {}, bindingsByHandle: {} });
  }
}

export async function loadAgentAvatarMap(
  client: NimiLocalAppClient,
): Promise<Readonly<Record<string, string | null>>> {
  const dir = await loadAgentReferenceDirectory(client);
  return dir.avatarsByHandle;
}

export async function loadCompanionIntroduction(
  client: NimiLocalAppClient,
  agentHandle: NimiUtopiaResident['agentHandle'],
): Promise<CompanionIntroSummary | null> {
  if (!client || typeof client.agents?.getIntroduction !== 'function') {
    return null;
  }
  try {
    const intro: NimiLocalAppAgentIntroduction = await client.agents.getIntroduction({ agentHandle });
    const originParts = [intro.worldName, intro.era, intro.role].filter((p): p is string => Boolean(p && p.trim()));
    return Object.freeze({
      originLine: originParts.length > 0 ? originParts.join(' · ') : null,
      greeting: intro.greeting,
      referenceImageUrl: intro.referenceImageUrl,
      voiceUrl: intro.voicePreviewUrl ?? intro.voiceSampleUrl,
      voiceDurationSec: intro.voiceSampleDurationSec,
      topics: intro.questionTopics.slice(0, 3).map((t) => t.text),
    });
  } catch {
    return null;
  }
}

export function resolveResidentPresence(
  resident: NimiUtopiaResident,
  snapshot: NimiUtopiaSnapshot,
): ResidentPresenceSummary {
  if (resident.current?.interaction || resident.current?.title === 'Interaction') {
    return {
      tone: 'conversing',
      statusBadge: '对话或协作中',
      shortLocationOrState: '正在对话或参与应用协作',
      focusPlaceId: null,
    };
  }

  const activeShared = snapshot.sharedActivities.find(
    (act) => act.state === 'active'
      && (act.initiatorHandle === resident.agentHandle || act.recipientHandle === resident.agentHandle),
  );
  if (activeShared) {
    const partnerHandle = activeShared.initiatorHandle === resident.agentHandle
      ? activeShared.recipientHandle
      : activeShared.initiatorHandle;
    const partnerName = snapshot.residents.find((r) => r.agentHandle === partnerHandle)?.displayName;
    return {
      tone: 'shared',
      statusBadge: '结伴中',
      shortLocationOrState: partnerName
        ? `${activeShared.placeLabel} · 与${partnerName}${activeShared.activityLabel}`
        : `${activeShared.placeLabel} · ${activeShared.activityLabel}`,
      focusPlaceId: activeShared.placeId || null,
    };
  }

  if (resident.current?.placeId) {
    const placeName = resident.current.placeId === 'personal-quarter'
      ? snapshot.habitat.personalQuarter.name
      : (resident.current.placeLabel || resident.current.placeId);
    const rawAct = resident.current.title;
    const actTitle = (!rawAct || rawAct === 'Activity') ? '小憩' : rawAct;
    return {
      tone: resident.solitary ? 'solitary' : 'active',
      statusBadge: resident.solitary ? '安静独处' : placeName,
      shortLocationOrState: `${placeName} · ${actTitle}`,
      focusPlaceId: resident.current.placeId,
    };
  }

  if (resident.solitary) {
    return {
      tone: 'solitary',
      statusBadge: '安静独处',
      shortLocationOrState: `${snapshot.habitat.personalQuarter.name} · 静息`,
      focusPlaceId: 'personal-quarter',
    };
  }

  return {
    tone: 'resting',
    statusBadge: '空闲中',
    shortLocationOrState: '暂无当前活动 · 待下一段日程',
    focusPlaceId: null,
  };
}

export function buildContextualIcebreakers(
  resident: NimiUtopiaResident,
  snapshot: NimiUtopiaSnapshot,
): readonly { readonly label: string; readonly prefill: string }[] {
  const chips: { label: string; prefill: string }[] = [];

  const activeShared = snapshot.sharedActivities.find(
    (act) => act.state === 'active'
      && (act.initiatorHandle === resident.agentHandle || act.recipientHandle === resident.agentHandle),
  );
  if (activeShared) {
    const partnerHandle = activeShared.initiatorHandle === resident.agentHandle
      ? activeShared.recipientHandle
      : activeShared.initiatorHandle;
    const partnerName = snapshot.residents.find((r) => r.agentHandle === partnerHandle)?.displayName ?? '伙伴';
    chips.push({
      label: `聊聊与${partnerName}的「${activeShared.activityLabel}」`,
      prefill: `看你正和${partnerName}在${activeShared.placeLabel}一起「${activeShared.activityLabel}」，今天聊得开心吗？`,
    });
  } else if (resident.current && !resident.current.interaction) {
    const rawTitle = resident.current.title;
    const actTitle = (!rawTitle || rawTitle === 'Activity') ? '' : rawTitle;
    const placeLabel = resident.current.placeId === 'personal-quarter'
      ? snapshot.habitat.personalQuarter.name
      : (resident.current.placeLabel || '');
    if (placeLabel && actTitle) {
      chips.push({
        label: `问问此刻在${placeLabel}的日常`,
        prefill: `看你正在${placeLabel}「${actTitle}」，这会儿感觉怎么样？`,
      });
    } else if (placeLabel) {
      chips.push({
        label: `去${placeLabel}打个招呼`,
        prefill: `路过${placeLabel}来看看你，今天在这边过得惬意吗？`,
      });
    }
  }

  const firstEvent = snapshot.activeEvents[0];
  if (firstEvent) {
    chips.push({
      label: `提起「${firstEvent.label}」`,
      prefill: `洞天里刚刚出现了「${firstEvent.label}」，你注意到了吗？`,
    });
  }

  chips.push({
    label: `聊聊在「${snapshot.habitat.title}」的感受`,
    prefill: `在「${snapshot.habitat.title}」住下来感觉如何？有没有最喜欢待的一处角落？`,
  });

  return chips.slice(0, 3);
}
