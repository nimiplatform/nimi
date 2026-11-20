import {
  readStorageJsonFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
} from '@nimiplatform/kit/core/storage-json';
import type {
  HabitatDaypart,
  HabitatParameterCondition,
  HabitatPlaceSpec,
  HabitatSceneryKind,
  HabitatSpecV1,
  HabitatThemeTag,
  NimiUtopiaActiveEvent,
  NimiUtopiaFrame,
  NimiUtopiaResident,
  NimiUtopiaSharedActivity,
  NimiUtopiaSharedState,
  NimiUtopiaSnapshot,
  NimiUtopiaTime,
} from '@nimiplatform/sdk/app';
import type { StageVisibilityCondition } from './bundle-validator.js';

const VISIT_CURSOR_STORAGE_KEY = 'nimi.utopia.visit-cursor.v1';
const JOURNAL_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_JOURNAL_HIGHLIGHTS = 12;

export const THEME_TAG_LABELS: Readonly<Record<HabitatThemeTag, string>> = {
  seaside: '临海渔岛',
  polar: '极地驻地',
  xianxia: '东方修仙',
  farming: '田园农庄',
  woodland: '林间秘境',
  mountain: '山居清修',
  harbor: '海港灯塔',
  observatory: '观星台站',
  courtyard: '四合庭院',
  shelter: '安心栖所',
};

export const DAYPART_LABELS: Readonly<Record<HabitatDaypart, string>> = {
  morning: '清晨',
  day: '白昼',
  dusk: '黄昏',
  night: '夜晚',
};

export const SCENERY_KIND_LABELS: Readonly<Record<HabitatSceneryKind, string>> = {
  'clear-sky': '晴朗天光',
  rain: '雨景',
  snowfall: '落雪',
  mist: '雾岚',
  aurora: '极光',
  'meteor-shower': '流星雨',
  blossom: '落花',
  'wildlife-visit': '生灵造访',
  'tide-pooling': '退潮岩池',
  harvest: '作物熟落',
  'hearth-lit': '炉火初燃',
  'radio-signal': '电波乐声',
};

export const SHARED_STATE_LABELS: Readonly<Record<NimiUtopiaSharedState, string>> = {
  invited: '刚递出邀约',
  accepted: '已约好同行',
  active: '正结伴同游',
  completed: '同游留影',
  declined: '婉言谢绝',
  expired: '邀约随风散',
  invalidated: '约定已失效',
  relocated: '随搬家暂别',
  relocated_partial: '旧居同游印记',
  missed: '擦肩错过',
  interrupted: '提前散场',
  unanswered: '尚未回音',
  unavailable: '未能送达',
};

export type VisitCursor = Readonly<{
  readonly lastVisitedAtMs: number;
  readonly lastActivationId: string;
}>;

export type JournalHighlight = Readonly<{
  readonly id: string;
  readonly timestampMs: number;
  readonly timeLabel: string;
  readonly badge: string;
  readonly tone: 'neutral' | 'success' | 'warning';
  readonly summary: string;
  readonly relatedHandle: string | null;
  readonly suggestedDraft: string | null;
}>;

export function utopiaTimeToMs(value: NimiUtopiaTime | null | undefined): number {
  if (!value) return 0;
  const sec = Number(value.seconds);
  if (!Number.isFinite(sec)) return 0;
  return sec * 1000 + Math.floor((value.nanos ?? 0) / 1_000_000);
}

export function resolveHourInTimezone(atMs: number, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'UTC',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(new Date(atMs));
    const hourStr = parts.find((p) => p.type === 'hour')?.value;
    const parsed = Number(hourStr);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 23) return parsed;
  } catch {
    // Fallback to UTC hour
  }
  return new Date(atMs).getUTCHours();
}

export function evalDaypartInTimezone(atMs: number, timezone: string): HabitatDaypart {
  const hour = resolveHourInTimezone(atMs, timezone);
  if (hour >= 5 && hour <= 10) return 'morning';
  if (hour >= 11 && hour <= 16) return 'day';
  if (hour >= 17 && hour <= 20) return 'dusk';
  return 'night';
}

export function formatClockInTimezone(atMs: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone || 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(atMs));
  } catch {
    return new Date(atMs).toISOString().slice(11, 16);
  }
}

export function formatShortDateTimeInTimezone(atMs: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone || 'UTC',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(atMs));
  } catch {
    return new Date(atMs).toISOString().slice(5, 16).replace('T', ' ');
  }
}

export function formatRemainingDuration(expiresAt: NimiUtopiaTime, nowMs: number): string {
  const diffMin = Math.max(1, Math.round((utopiaTimeToMs(expiresAt) - nowMs) / 60_000));
  if (diffMin < 60) return `剩 ${diffMin} 分钟`;
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  return mins > 0 ? `剩 ${hours} 小时 ${mins} 分` : `剩 ${hours} 小时`;
}

export function detectSystemIanaTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (
      typeof tz === 'string'
      && tz.length >= 1
      && tz.length <= 64
      && tz !== 'UTC'
      && tz !== 'Etc/UTC'
      && tz.toLowerCase() !== 'local'
    ) {
      return tz;
    }
  } catch {
    // Ignore
  }
  return null;
}

export function evalParameterConditions(
  conditions: readonly HabitatParameterCondition[],
  values: Readonly<Record<string, string>>,
): boolean {
  for (const cond of conditions) {
    const actual = values[cond.parameterKey];
    if (!actual || !cond.allowedValues.includes(actual)) {
      return false;
    }
  }
  return true;
}

export function computeOpenPlaceIds(
  habitat: HabitatSpecV1,
  parameterValues: Readonly<Record<string, string>>,
): readonly string[] {
  const open: string[] = [];
  for (const place of habitat.places) {
    if (evalParameterConditions(place.openWhen, parameterValues)) {
      open.push(place.id);
    }
  }
  return open;
}

export function previewParameterPlaceDiff(
  habitat: HabitatSpecV1,
  currentParams: Readonly<Record<string, string>>,
  nextParams: Readonly<Record<string, string>>,
): {
  readonly newlyOpened: readonly HabitatPlaceSpec[];
  readonly newlyClosed: readonly HabitatPlaceSpec[];
  readonly nextOpenPlaceIds: readonly string[];
} {
  const merged = { ...currentParams, ...nextParams };
  const prevOpen = new Set(computeOpenPlaceIds(habitat, currentParams));
  const nextOpenList = computeOpenPlaceIds(habitat, merged);
  const nextOpen = new Set(nextOpenList);

  const newlyOpened = habitat.places.filter((p) => !prevOpen.has(p.id) && nextOpen.has(p.id));
  const newlyClosed = habitat.places.filter((p) => prevOpen.has(p.id) && !nextOpen.has(p.id));

  return Object.freeze({
    newlyOpened,
    newlyClosed,
    nextOpenPlaceIds: nextOpenList,
  });
}

export function evalStageCondition(
  condition: StageVisibilityCondition | undefined,
  daypart: HabitatDaypart,
  parameterValues: Readonly<Record<string, string>>,
  activeEvents: readonly NimiUtopiaActiveEvent[],
): boolean {
  if (!condition) return true;
  if (condition.dayparts && !condition.dayparts.includes(daypart)) {
    return false;
  }
  if (condition.parameters) {
    for (const [key, allowed] of Object.entries(condition.parameters)) {
      const actual = parameterValues[key];
      if (!actual || !allowed.includes(actual)) return false;
    }
  }
  if (condition.sceneryKinds) {
    // Panoramic stage layers, ambient effects, and soundscapes respond only to
    // whole-habitat scenery (`!e.placeId`); place-scoped scenery stays localized.
    const activeKinds = new Set(
      activeEvents.filter((e) => !e.placeId).map((e) => e.sceneryKind),
    );
    if (!condition.sceneryKinds.some((k) => activeKinds.has(k))) {
      return false;
    }
  }
  return true;
}

export function describeResidentFrame(
  frame: NimiUtopiaFrame | null,
  currentActivationId: string,
): string {
  if (!frame) return '暂无记录';
  if (frame.interaction || frame.title === 'Interaction') return '正在对话或应用协作中';
  const baseTitle = (!frame.title || frame.title === 'Activity') ? '日常小憩' : frame.title;
  const placePart = frame.placeLabel || '';
  const fromPriorHabitat = frame.habitatActivationId
    && frame.habitatActivationId !== currentActivationId
    && frame.habitatTitle;
  if (fromPriorHabitat) {
    if (placePart && placePart !== frame.habitatTitle) {
      return `${baseTitle} · ${frame.habitatTitle}·${placePart}`;
    }
    return baseTitle === frame.habitatTitle ? baseTitle : `${baseTitle}（${frame.habitatTitle}）`;
  }
  return placePart && placePart !== baseTitle ? `${baseTitle} · ${placePart}` : baseTitle;
}

export function formatSharedActivityDisplay(
  act: NimiUtopiaSharedActivity,
  currentActivationId: string,
): {
  readonly placeInline: string;
  readonly placeLocation: string;
  readonly subtitle: string;
  readonly highlightSummary: (initiator: string, recipient: string) => string;
  readonly draftForPartner: (partnerName: string, stateText: string) => string;
} {
  const crossHabitat = act.habitatActivationId !== currentActivationId;
  const locationParts = Array.from(
    new Set((crossHabitat ? [act.habitatTitle, act.placeLabel] : [act.placeLabel]).filter(Boolean)),
  );
  const placeInline = locationParts.join('·') || act.placeLabel;
  const placeLocation = locationParts.join(' · ') || act.placeLabel;
  const activitySameAsPlace = act.activityLabel === act.placeLabel || act.activityLabel === placeInline;

  return {
    placeInline,
    placeLocation,
    subtitle: activitySameAsPlace ? placeLocation : `${act.activityLabel} · ${placeLocation}`,
    highlightSummary: (initiator, recipient) =>
      activitySameAsPlace
        ? `${initiator} 与 ${recipient} · ${placeInline}`
        : `${initiator} 与 ${recipient} 在${placeInline}「${act.activityLabel}」`,
    draftForPartner: (partnerName, stateText) =>
      activitySameAsPlace
        ? `看到你和${partnerName}此前的「${placeLocation}」（${stateText}），想听你聊聊。`
        : `看到你和${partnerName}在${placeLocation}的「${act.activityLabel}」（${stateText}），想聊聊吗？`,
  };
}

export function describeSolitudeConsequence(
  resident: NimiUtopiaResident,
  snapshot: NimiUtopiaSnapshot,
): string {
  if (resident.solitary) {
    return snapshot.publicParticipation
      ? `关闭后，又可以去「${snapshot.habitat.title}」的街巷庭院散步、和伙伴相约小聚啦。`
      : `关闭后，闲暇时又可以独自去「${snapshot.habitat.title}」的开放场所散步活动（当前街巷串门与小聚仍为关闭）。`;
  }
  const activeShared = snapshot.sharedActivities.find(
    (item) => item.state === 'active'
      && (item.initiatorHandle === resident.agentHandle || item.recipientHandle === resident.agentHandle),
  );
  if (activeShared) {
    return `开启后，会先向同伴道别、结束在「${activeShared.placeLabel}」的「${activeShared.activityLabel}」，回到「${snapshot.habitat.personalQuarter.name}」静静休息。`;
  }
  if (resident.current && !resident.current.interaction && resident.current.placeId && resident.current.placeId !== 'personal-quarter') {
    return `开启后，会离开「${resident.current.placeLabel || resident.current.placeId}」，回到自己的「${snapshot.habitat.personalQuarter.name}」享受清静。`;
  }
  return snapshot.publicParticipation
    ? `开启后只待在自己的「${snapshot.habitat.personalQuarter.name}」里安静起居，暂时不去街巷串门。`
    : `开启后只留在自己的「${snapshot.habitat.personalQuarter.name}」里安静起居，不再独自前往公共场所。`;
}

export function findRelocationAffectedActivities(
  snapshot: NimiUtopiaSnapshot,
): readonly NimiUtopiaSharedActivity[] {
  return snapshot.sharedActivities.filter(
    (item) => item.state === 'invited' || item.state === 'accepted' || item.state === 'active',
  );
}

export function readLocalVisitCursor(): VisitCursor | null {
  const storage = resolveBrowserStorage('local');
  const read = readStorageJsonFrom<VisitCursor | null>(storage, VISIT_CURSOR_STORAGE_KEY, (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const rec = raw as Record<string, unknown>;
    if (typeof rec.lastVisitedAtMs !== 'number' || typeof rec.lastActivationId !== 'string') return null;
    return {
      lastVisitedAtMs: rec.lastVisitedAtMs,
      lastActivationId: rec.lastActivationId,
    };
  });
  return read.state === 'ready' ? read.value : null;
}

export function saveLocalVisitCursor(cursor: VisitCursor): void {
  const storage = resolveBrowserStorage('local');
  writeStorageJsonTo(storage, VISIT_CURSOR_STORAGE_KEY, cursor);
}

export function computeVisitJournalHighlights(
  snapshot: NimiUtopiaSnapshot,
  priorCursor: VisitCursor | null,
  nowMs: number,
): readonly JournalHighlight[] {
  const cutoffMs = priorCursor
    ? Math.max(nowMs - JOURNAL_WINDOW_MS, priorCursor.lastVisitedAtMs - 5 * 60_000)
    : nowMs - JOURNAL_WINDOW_MS;

  const nameOf = (handle: string) =>
    snapshot.residents.find((r) => r.agentHandle === handle)?.displayName ?? '伙伴';

  const items: JournalHighlight[] = [];

  if (snapshot.lastRelocation) {
    const relocatedMs = utopiaTimeToMs(snapshot.lastRelocation.relocatedAt);
    if (relocatedMs >= cutoffMs) {
      const firstResident = snapshot.residents[0] ?? null;
      items.push({
        id: `relocation-${relocatedMs}`,
        timestampMs: relocatedMs,
        timeLabel: formatClockInTimezone(relocatedMs, snapshot.timezone),
        badge: '展卷迁居',
        tone: 'neutral',
        summary: `从「${snapshot.lastRelocation.fromHabitatTitle}」迁入「${snapshot.lastRelocation.toHabitatTitle}」`,
        relatedHandle: firstResident?.agentHandle ?? null,
        suggestedDraft: firstResident
          ? `刚搬来「${snapshot.lastRelocation.toHabitatTitle}」，这边住得还习惯吗？`
          : null,
      });
    }
  }

  for (const act of snapshot.sharedActivities) {
    const stampMs = Math.max(
      utopiaTimeToMs(act.endsAt),
      utopiaTimeToMs(act.startsAt),
      utopiaTimeToMs(act.acceptedAt),
    ) || utopiaTimeToMs(snapshot.observedAt);
    if (stampMs < cutoffMs && act.state !== 'active' && act.state !== 'accepted' && act.state !== 'invited') {
      continue;
    }

    const initiator = nameOf(act.initiatorHandle);
    const recipient = nameOf(act.recipientHandle);
    const display = formatSharedActivityDisplay(act, snapshot.habitatActivationId);
    const stateLabel = SHARED_STATE_LABELS[act.state] ?? act.state;

    let tone: JournalHighlight['tone'] = 'neutral';
    if (act.state === 'active' || act.state === 'completed') tone = 'success';
    else if (act.state === 'relocated' || act.state === 'relocated_partial' || act.state === 'invalidated') tone = 'warning';

    const residentTarget = snapshot.residents.find((r) => r.agentHandle === act.initiatorHandle)
      ?? snapshot.residents.find((r) => r.agentHandle === act.recipientHandle)
      ?? null;
    const partnerName = residentTarget?.agentHandle === act.initiatorHandle ? recipient : initiator;

    items.push({
      id: `shared-${act.activityRef}`,
      timestampMs: stampMs,
      timeLabel: formatClockInTimezone(stampMs, snapshot.timezone),
      badge: stateLabel,
      tone,
      summary: display.highlightSummary(initiator, recipient),
      relatedHandle: residentTarget?.agentHandle ?? null,
      suggestedDraft: residentTarget
        ? display.draftForPartner(partnerName, stateLabel)
        : null,
    });
  }

  items.sort((a, b) => b.timestampMs - a.timestampMs);
  return items.slice(0, MAX_JOURNAL_HIGHLIGHTS);
}
