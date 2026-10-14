import type { NimiAppActivityRecord } from '@nimiplatform/sdk/app';
import { isPendingTodo } from './home-app-activity-model.js';

/** A bounded preview; the Message center retains the complete loaded listing. */
export const HOME_MESSAGE_GROUP_LIMIT = 6;

export type HomeTimelineType = 'all' | 'message' | 'todo' | 'post';
export type HomeTimelineStatus = 'all' | 'unread' | 'pending';

/** Home toolbar quick filters; each preset pins one type/status pair. */
export type HomeTimelineQuickFilter = 'all' | 'unread' | 'pending' | 'message' | 'post' | 'todo';

export function quickFilterSelection(filter: HomeTimelineQuickFilter): Readonly<{ type: HomeTimelineType; status: HomeTimelineStatus }> {
  switch (filter) {
    case 'unread': return { type: 'all', status: 'unread' };
    case 'pending': return { type: 'all', status: 'pending' };
    case 'message': return { type: 'message', status: 'all' };
    case 'post': return { type: 'post', status: 'all' };
    case 'todo': return { type: 'todo', status: 'all' };
    default: return { type: 'all', status: 'all' };
  }
}

export function timelineType(message: HomeMessage): Exclude<HomeTimelineType, 'all'> {
  if (message.sourceKind === 'realm-post') return 'post';
  if (message.sourceKind === 'system' || message.record.kind === 'todo') return 'todo';
  return 'message';
}

export function filterTimelineMessages(messages: readonly HomeMessage[], type: HomeTimelineType, status: HomeTimelineStatus): HomeMessage[] {
  return messages.filter((message) => (type === 'all' || timelineType(message) === type)
    && (status === 'all' || (status === 'pending' ? isPendingMessage(message)
      : (message.sourceKind === 'app' || message.sourceKind === 'runtime-agent') && message.record.userView.unread)));
}

export type HomeSystemMessageKind = 'download' | 'setup' | 'update';

/** A Desktop system item projected from its existing owner; never republished as App activity. */
export type HomeSystemMessage = Readonly<{
  kind: HomeSystemMessageKind;
  /** Owner identity: install session, setup task or App id. */
  id: string;
  title: string;
  detail: string;
  progress: Readonly<{ value: number; max: number }> | null;
  /** Owner-provided fact time; null when the owner has none. */
  time: string | null;
  /** Display artwork of the App an update belongs to. */
  app: Readonly<{ appId: string; displayName: string; iconUrl: string | null }> | null;
  open: () => void;
}>;

export type HomeRealmThumbnail = Readonly<{ url: string; kind: 'IMAGE' | 'VIDEO' }>;

/** An agent-authored Realm Post from the viewer's personal feed. */
export type HomeRealmPost = Readonly<{
  id: string;
  authorKind: string;
  /** Trusted Realm author reference; null keeps the Post in its own group. */
  authorRef: string | null;
  authorName: string;
  authorAvatarUrl: string | null;
  caption: string;
  createdAt: string;
  /** Renderable Realm media in attachment order. */
  media: readonly HomeRealmThumbnail[];
}>;

type MessageBase = Readonly<{
  /** Namespaced stable identity of the message. */
  key: string;
  groupKey: string;
}>;

export type HomeActivityMessage = MessageBase & Readonly<{
  sourceKind: 'app' | 'runtime-agent';
  time: string;
  record: NimiAppActivityRecord;
}>;

export type HomeRealmPostMessage = MessageBase & Readonly<{
  sourceKind: 'realm-post';
  time: string;
  post: HomeRealmPost;
}>;

export type HomeSystemItemMessage = MessageBase & Readonly<{
  sourceKind: 'system';
  time: string | null;
  system: HomeSystemMessage;
}>;

export type HomeMessage = HomeActivityMessage | HomeRealmPostMessage | HomeSystemItemMessage;

export type HomeMessageGroup = Readonly<{
  key: string;
  sourceKind: HomeMessage['sourceKind'];
  /** Members in display order; the first leads a collapsed stack. */
  messages: readonly HomeMessage[];
}>;

export type HomeMessageFilter = 'all' | 'pending';

export function activityMessage(record: NimiAppActivityRecord): HomeActivityMessage {
  const key = `activity:${record.activityId}`;
  if (record.source.kind === 'runtime-agent') {
    return {
      key,
      sourceKind: 'runtime-agent',
      groupKey: record.agent ? `runtime-agent:${record.agent.agentRef}` : 'runtime-agent',
      time: record.occurredAt,
      record,
    };
  }
  // sourceRef is the registration-scoped publisher; appId never merges registrations.
  return { key, sourceKind: 'app', groupKey: `app:${record.source.sourceRef}`, time: record.occurredAt, record };
}

export function realmPostMessage(post: HomeRealmPost): HomeRealmPostMessage {
  return {
    key: `realm-post:${post.id}`,
    sourceKind: 'realm-post',
    groupKey: post.authorRef ? `realm-author:${post.authorKind}:${post.authorRef}` : `realm-post:${post.id}`,
    time: post.createdAt,
    post,
  };
}

export function systemMessage(system: HomeSystemMessage): HomeSystemItemMessage {
  return {
    key: `system:${system.kind}:${system.id}`,
    sourceKind: 'system',
    groupKey: `system:${system.kind}`,
    time: system.time,
    system,
  };
}

/** Open todos (read or not) and unresolved system items; activity summaries and Posts never are. */
export function isPendingMessage(message: HomeMessage): boolean {
  if (message.sourceKind === 'system') return true;
  if (message.sourceKind === 'realm-post') return false;
  return isPendingTodo(message.record);
}

/** Only running downloads are work in progress; failures and updates wait for the user. */
export function isInProgressMessage(message: HomeMessage): boolean {
  return message.sourceKind === 'system' && message.system.kind === 'download';
}

export function isHideableMessage(message: HomeMessage): boolean {
  return message.sourceKind !== 'system';
}

function factTime(message: HomeMessage): number | null {
  if (!message.time) return null;
  const value = Date.parse(message.time);
  return Number.isFinite(value) ? value : null;
}

/**
 * Work in progress first, then known owner time newest first, then items
 * without a time; the stable key breaks ties so progress updates never
 * reorder cards.
 */
export function compareMessages(left: HomeMessage, right: HomeMessage): number {
  const progress = Number(isInProgressMessage(right)) - Number(isInProgressMessage(left));
  if (progress !== 0) return progress;
  return compareTimelineMessages(left, right);
}

/** Home uses only owner fact time, never progress or pending priority. */
export function compareTimelineMessages(left: HomeMessage, right: HomeMessage): number {
  const leftTime = factTime(left);
  const rightTime = factTime(right);
  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) return rightTime - leftTime;
  if (leftTime === null && rightTime !== null) return 1;
  if (leftTime !== null && rightTime === null) return -1;
  return left.key.localeCompare(right.key);
}

/** Groups by source; a group takes the place of its leading visible member. */
export function groupMessages(messages: readonly HomeMessage[]): HomeMessageGroup[] {
  const groups = new Map<string, HomeMessage[]>();
  for (const message of [...messages].sort(compareMessages)) {
    const members = groups.get(message.groupKey);
    if (members) members.push(message);
    else groups.set(message.groupKey, [message]);
  }
  return [...groups.entries()]
    .map(([key, members]) => ({ key, sourceKind: members[0]!.sourceKind, messages: members }))
    .sort((left, right) => compareMessages(left.messages[0]!, right.messages[0]!));
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r015
/** Only consecutive, same-type messages within an hour of the lead may fold together. */
export function homePreviewGroups(
  messages: readonly HomeMessage[],
  limit = HOME_MESSAGE_GROUP_LIMIT,
): HomeMessageGroup[] {
  const groups: { key: string; sourceKind: HomeMessage['sourceKind']; messages: HomeMessage[] }[] = [];
  for (const message of [...messages].sort(compareTimelineMessages)) {
    const group = groups.at(-1);
    const lead = group?.messages[0];
    const time = factTime(message);
    const leadTime = lead ? factTime(lead) : null;
    const sameType = lead && (lead.sourceKind === 'app' || lead.sourceKind === 'runtime-agent')
      && (message.sourceKind === 'app' || message.sourceKind === 'runtime-agent')
      && lead.record.type === message.record.type && lead.record.kind === message.record.kind
      && lead.record.todoState === message.record.todoState;
    if (group && lead && sameType && lead.groupKey === message.groupKey
      && time !== null && leadTime !== null && leadTime - time <= 60 * 60 * 1000) {
      group.messages.push(message);
    } else {
      if (groups.length >= limit) break;
      groups.push({ key: `${message.groupKey}:${message.key}`, sourceKind: message.sourceKind, messages: [message] });
    }
  }
  return groups;
}

export function filterCenterMessages(
  messages: readonly HomeMessage[],
  filter: HomeMessageFilter,
  groupKey: string | null,
): HomeMessage[] {
  return messages
    .filter((message) => (filter === 'all' || isPendingMessage(message))
      && (!groupKey || messageCenterSourceKey(message) === groupKey))
    .sort(compareMessages);
}

export type HomeMessageDomain = 'app' | 'runtime-agent' | 'realm-post' | 'system';

// @nimi-authority: rule.nimi.desktop.product-surfaces.r036
/** Center filtering aggregates App registrations only; records and actions retain their exact source. */
export function messageCenterSourceKey(message: HomeMessage): string {
  return message.sourceKind === 'app' && message.record.source.appId
    ? `app-id:${message.record.source.appId}`
    : message.groupKey;
}

/** Owner domain of a source filter; null selects every source. */
export function messageDomainOfGroup(groupKey: string | null): HomeMessageDomain | null {
  if (!groupKey) return null;
  if (groupKey.startsWith('app:') || groupKey.startsWith('app-id:')) return 'app';
  if (groupKey.startsWith('runtime-agent')) return 'runtime-agent';
  if (groupKey.startsWith('system:')) return 'system';
  return 'realm-post';
}
