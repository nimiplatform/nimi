import type { NimiRealtimeControlStatus } from './local-app-runtime-platform-realtime.js';
import {
  asRecord,
  assertExactKeys,
  assertExactProjectionKeys,
  localAppProjectionError,
  projectTimestamp,
} from './local-app-runtime-platform-validation.js';

export type NimiRealmRealtimeTarget =
  | { readonly type: 'chat'; readonly chatId: string }
  | { readonly type: 'presence' }
  | { readonly type: 'inbox' };

export type NimiRealmRealtimeMessagePayload =
  | { readonly type: 'text'; readonly content: string }
  | { readonly type: 'attachment'; readonly attachment: NimiRealmChatAttachment }
  | { readonly type: 'post-ref'; readonly postId: string }
  | { readonly type: 'user-ref'; readonly userId: string; readonly snapshot: NimiRealmChatUserSnapshot | null }
  | { readonly type: 'link-ref'; readonly url: string; readonly title: string | null }
  | { readonly type: 'friend-request'; readonly requestId: string; readonly status: string; readonly requestMessage: string | null }
  | { readonly type: 'system'; readonly code: string | null; readonly message: string | null };

export type NimiRealmChatAttachment = {
  readonly targetType: 'resource' | 'asset' | 'bundle';
  readonly targetId: string;
  readonly displayKind: 'image' | 'video' | 'audio' | 'text' | 'card' | null;
  readonly title: string | null;
  readonly subtitle: string | null;
  readonly url: string | null;
  readonly thumbnail: string | null;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly preview: NimiRealmChatAttachment | null;
};

export type NimiRealmChatUserSnapshot = {
  readonly id: string;
  readonly handle: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
};

export type NimiRealmChatUserSummary = NimiRealmChatUserSnapshot & {
  readonly status: string | null;
  readonly presenceStatus: string | null;
  readonly presenceText: string | null;
  readonly presenceEmoji: string | null;
  readonly createdAt: { readonly seconds: string; readonly nanos: number };
};

export type NimiRealmRealtimeMessageReply = {
  readonly id: string;
  readonly senderId: string;
  readonly messageType: NimiRealmRealtimeMessage['messageType'];
  readonly text: string | null;
  readonly payload: NimiRealmRealtimeMessagePayload | null;
};

export type NimiRealmRealtimeMessage = {
  readonly id: string;
  readonly chatId: string;
  readonly senderId: string;
  readonly clientMessageId: string | null;
  readonly messageType: 'text' | 'attachment' | 'post-ref' | 'user-ref' | 'link-ref' | 'friend-request' | 'system' | 'recall';
  readonly text: string | null;
  readonly payload: NimiRealmRealtimeMessagePayload | null;
  readonly isRead: boolean;
  readonly replyTo: NimiRealmRealtimeMessageReply | null;
  readonly createdAt: { readonly seconds: string; readonly nanos: number };
  readonly editedAt: { readonly seconds: string; readonly nanos: number } | null;
};

type NimiRealmRealtimeChatEventBase = {
  readonly type: 'chat';
  readonly streamId: string;
  readonly cursor: string;
  readonly eventId: string;
  readonly chatId: string;
  readonly actorId: string;
  readonly occurredAt: { readonly seconds: string; readonly nanos: number };
};

export type NimiRealmRealtimeChatEvent =
  | (NimiRealmRealtimeChatEventBase & { readonly kind: 'message-created' | 'message-edited'; readonly payload: { readonly message: NimiRealmRealtimeMessage } })
  | (NimiRealmRealtimeChatEventBase & { readonly kind: 'message-recalled'; readonly payload: { readonly chatId: string; readonly messageId: string; readonly recalledAt: { readonly seconds: string; readonly nanos: number } } })
  | (NimiRealmRealtimeChatEventBase & { readonly kind: 'chat-read'; readonly payload: { readonly chatId: string; readonly readerId: string; readonly readThroughMessageId: string | null; readonly readAt: { readonly seconds: string; readonly nanos: number } } });

export type NimiRealmRealtimeDataEvent =
  | { readonly type: 'control'; readonly control: NimiRealtimeControlStatus }
  | NimiRealmRealtimeChatEvent
  | { readonly type: 'typing'; readonly chatId: string; readonly userId: string; readonly isTyping: boolean; readonly expiresAt: { readonly seconds: string; readonly nanos: number } }
  | { readonly type: 'presence'; readonly userId: string; readonly isOnline: boolean; readonly presenceRevision: string; readonly occurredAt: { readonly seconds: string; readonly nanos: number } }
  | { readonly type: 'snapshot'; readonly chatId: string; readonly otherUser: NimiRealmChatUserSummary | null; readonly messages: readonly NimiRealmRealtimeMessage[]; readonly throughCursor: string; readonly unreadCount: number; readonly appliedAt: { readonly seconds: string; readonly nanos: number } }
  | { readonly type: 'inbox'; readonly chatId: string; readonly highWatermarkSeq: string; readonly occurredAt: { readonly seconds: string; readonly nanos: number } };

export type NimiRealmRealtimeEvent = {
  readonly realtimeSessionId: string;
  readonly channelId: string;
  readonly subscriptionId: string;
  readonly generation: string;
  readonly sequence: string;
  readonly correlationId: string;
  readonly occurredAt: { readonly seconds: string; readonly nanos: number };
  readonly event: NimiRealmRealtimeDataEvent;
};

export type NimiRealmRealtimeSubscription = AsyncIterable<NimiRealmRealtimeEvent> & { readonly cancel: () => Promise<void> };

export type NimiRealmRealtimeShellSubscription = { readonly events: AsyncIterable<unknown>; readonly cancel: () => Promise<void> };
export type NimiRealmRealtimeShell = {
  readonly open: () => Promise<unknown>;
  readonly subscribe: (input: { readonly channelId: string; readonly target: NimiRealmRealtimeTarget }) => Promise<NimiRealmRealtimeShellSubscription>;
  readonly ack: (input: { readonly channelId: string; readonly subscriptionId: string; readonly cursor: string }) => Promise<unknown>;
  readonly closeSubscription: (input: { readonly channelId: string; readonly subscriptionId: string }) => Promise<unknown>;
  readonly closeChannel: (input: { readonly channelId: string }) => Promise<unknown>;
};

export type NimiRealmRealtimeClient = {
  readonly open: () => Promise<{ readonly realtimeSessionId: string; readonly channelId: string; readonly generation: string; readonly control: NimiRealtimeControlStatus }>;
  readonly subscribe: (input: { readonly channelId: string; readonly target: NimiRealmRealtimeTarget }) => Promise<NimiRealmRealtimeSubscription>;
  readonly ack: (input: { readonly channelId: string; readonly subscriptionId: string; readonly cursor: string }) => Promise<{ readonly ok: boolean; readonly reasonCode: string; readonly actionHint: string }>;
  readonly closeSubscription: (input: { readonly channelId: string; readonly subscriptionId: string }) => Promise<{ readonly ok: boolean; readonly reasonCode: string; readonly actionHint: string }>;
  readonly closeChannel: (input: { readonly channelId: string }) => Promise<{ readonly ok: boolean; readonly reasonCode: string; readonly actionHint: string }>;
};

// @nimi-authority: rule.nimi.sdks.feature-clients.r107
// @nimi-authority: rule.nimi.sdks.realm-consumer.r048
export function createNimiRealmRealtimeClient(shell: NimiRealmRealtimeShell): NimiRealmRealtimeClient {
  return Object.freeze({
    open: async () => {
      const record = requiredRecord(await shell.open(), 'Realm Realtime open');
      assertExactProjectionKeys(record, ['realtimeSessionId', 'channelId', 'generation', 'control'], 'Realm Realtime open');
      return Object.freeze({
        realtimeSessionId: selector(record.realtimeSessionId), channelId: selector(record.channelId),
        generation: decimal(record.generation), control: projectControl(record.control),
      });
    },
    subscribe: async (input) => {
      assertExactKeys(input, ['channelId', 'target'], 'Realm Realtime subscribe');
      const target = projectTarget(input.target);
      const subscription = await shell.subscribe({ channelId: selector(input.channelId), target });
      return Object.freeze({
        async *[Symbol.asyncIterator]() {
          for await (const event of subscription.events) yield projectEvent(event);
        },
        cancel: () => subscription.cancel(),
      });
    },
    ack: async (input) => {
      assertExactKeys(input, ['channelId', 'subscriptionId', 'cursor'], 'Realm Realtime acknowledgement');
      return projectAck(await shell.ack({ channelId: selector(input.channelId), subscriptionId: selector(input.subscriptionId), cursor: decimal(input.cursor) }));
    },
    closeSubscription: async (input) => {
      assertExactKeys(input, ['channelId', 'subscriptionId'], 'Realm Realtime close subscription');
      return projectAck(await shell.closeSubscription({ channelId: selector(input.channelId), subscriptionId: selector(input.subscriptionId) }));
    },
    closeChannel: async (input) => {
      assertExactKeys(input, ['channelId'], 'Realm Realtime close channel');
      return projectAck(await shell.closeChannel({ channelId: selector(input.channelId) }));
    },
  });
}

function projectTarget(target: NimiRealmRealtimeTarget): NimiRealmRealtimeTarget {
  if (target.type === 'chat') {
    assertExactKeys(target, ['type', 'chatId'], 'Realm Realtime chat target');
    return Object.freeze({ type: 'chat', chatId: selector(target.chatId) });
  }
  assertExactKeys(target, ['type'], 'Realm Realtime account target');
  if (target.type !== 'presence' && target.type !== 'inbox') fail('Realm Realtime target');
  return Object.freeze({ type: target.type });
}

function projectAck(value: unknown): { readonly ok: boolean; readonly reasonCode: string; readonly actionHint: string } {
  const record = requiredRecord(value, 'Realm Realtime acknowledgement'); assertExactProjectionKeys(record, ['ack'], 'Realm Realtime acknowledgement');
  const ack = requiredRecord(record.ack, 'Realm Realtime acknowledgement'); assertExactProjectionKeys(ack, ['ok', 'reasonCode', 'actionHint'], 'Realm Realtime acknowledgement');
  if (typeof ack.ok !== 'boolean') fail('Realm Realtime acknowledgement');
  return Object.freeze({ ok: ack.ok, reasonCode: text(ack.reasonCode, 'reasonCode', true, 128), actionHint: text(ack.actionHint, 'actionHint', true, 256) });
}

function projectEvent(value: unknown): NimiRealmRealtimeEvent {
  const record = requiredRecord(value, 'Realm Realtime event');
  assertExactProjectionKeys(record, ['realtimeSessionId','channelId','subscriptionId','generation','sequence','correlationId','occurredAt','event'], 'Realm Realtime event');
  return Object.freeze({
    realtimeSessionId: selector(record.realtimeSessionId), channelId: selector(record.channelId), subscriptionId: selector(record.subscriptionId),
    generation: decimal(record.generation), sequence: decimal(record.sequence), correlationId: selector(record.correlationId),
    occurredAt: requiredTimestamp(record.occurredAt), event: projectDataEvent(record.event),
  });
}

function projectDataEvent(value: unknown): NimiRealmRealtimeDataEvent {
  const record = requiredRecord(value, 'Realm Realtime event'); const type = text(record.type, 'event type', false, 64);
  if (type === 'control') { assertExactProjectionKeys(record,['type','control'],type); return Object.freeze({type,control:projectControl(record.control)}); }
  if (type === 'chat') return projectChatEvent(record);
  if (type === 'typing') { assertExactProjectionKeys(record,['type','chatId','userId','isTyping','expiresAt'],type); if(typeof record.isTyping!=='boolean')fail(type); return Object.freeze({type,chatId:selector(record.chatId),userId:selector(record.userId),isTyping:record.isTyping,expiresAt:requiredTimestamp(record.expiresAt)}); }
  if (type === 'presence') { assertExactProjectionKeys(record,['type','userId','isOnline','presenceRevision','occurredAt'],type); if(typeof record.isOnline!=='boolean')fail(type); return Object.freeze({type,userId:selector(record.userId),isOnline:record.isOnline,presenceRevision:decimal(record.presenceRevision),occurredAt:requiredTimestamp(record.occurredAt)}); }
  if (type === 'inbox') { assertExactProjectionKeys(record,['type','chatId','highWatermarkSeq','occurredAt'],type); return Object.freeze({type,chatId:selector(record.chatId),highWatermarkSeq:decimal(record.highWatermarkSeq),occurredAt:requiredTimestamp(record.occurredAt)}); }
  if (type === 'snapshot') { assertExactProjectionKeys(record,['type','chatId','otherUser','messages','throughCursor','unreadCount','appliedAt'],type); if(!Array.isArray(record.messages)||!Number.isSafeInteger(record.unreadCount)||(record.unreadCount as number)<0)fail(type); return Object.freeze({type,chatId:selector(record.chatId),otherUser:record.otherUser===null?null:projectRealmChatUserSummary(record.otherUser),messages:Object.freeze(record.messages.map(projectRealmChatMessage)),throughCursor:decimal(record.throughCursor),unreadCount:record.unreadCount as number,appliedAt:requiredTimestamp(record.appliedAt)}); }
  return fail('Realm Realtime event');
}

function projectChatEvent(record: Record<string, unknown>): NimiRealmRealtimeChatEvent {
  const type = 'chat' as const;
  assertExactProjectionKeys(record,['type','streamId','cursor','eventId','chatId','actorId','occurredAt','kind','payload'],type);
  const base = {
    type,
    streamId: selector(record.streamId),
    cursor: decimal(record.cursor),
    eventId: selector(record.eventId),
    chatId: selector(record.chatId),
    actorId: selector(record.actorId),
    occurredAt: requiredTimestamp(record.occurredAt),
  };
  const payload = requiredRecord(record.payload, 'Realm Chat event payload');
  const kind = oneOf(record.kind,['message-created','message-edited','message-recalled','chat-read']);
  if (kind === 'message-created' || kind === 'message-edited') {
    assertExactProjectionKeys(payload, ['message'], `Realm Chat ${kind} payload`);
    return Object.freeze({ ...base, kind, payload: Object.freeze({ message: projectRealmChatMessage(payload.message) }) });
  }
  if (kind === 'message-recalled') {
    assertExactProjectionKeys(payload, ['chatId','messageId','recalledAt'], 'Realm Chat recall payload');
    const chatId = selector(payload.chatId);
    if (chatId !== base.chatId) fail('Realm Chat recall payload');
    return Object.freeze({ ...base, kind, payload: Object.freeze({ chatId, messageId: selector(payload.messageId), recalledAt: requiredTimestamp(payload.recalledAt) }) });
  }
  assertExactProjectionKeys(payload, ['chatId','readerId','readThroughMessageId','readAt'], 'Realm Chat read payload');
  const chatId = selector(payload.chatId);
  if (chatId !== base.chatId) fail('Realm Chat read payload');
  return Object.freeze({ ...base, kind, payload: Object.freeze({ chatId, readerId: selector(payload.readerId), readThroughMessageId: nullableText(payload.readThroughMessageId), readAt: requiredTimestamp(payload.readAt) }) });
}

export function projectRealmChatMessage(value: unknown): NimiRealmRealtimeMessage {
  const record=requiredRecord(value, 'Realm Realtime message'); assertExactProjectionKeys(record,['id','chatId','senderId','clientMessageId','messageType','text','payload','isRead','replyTo','createdAt','editedAt'],'Realm Realtime message');
  if(typeof record.isRead!=='boolean')fail('Realm Realtime message');
  const messageType=oneOf(record.messageType,['text','attachment','post-ref','user-ref','link-ref','friend-request','system','recall']);
  return Object.freeze({id:selector(record.id),chatId:selector(record.chatId),senderId:selector(record.senderId),clientMessageId:nullableText(record.clientMessageId),messageType,text:nullableText(record.text),payload:projectMessagePayload(record.payload,messageType),isRead:record.isRead,replyTo:record.replyTo===null?null:projectMessageReply(record.replyTo),createdAt:requiredTimestamp(record.createdAt),editedAt:record.editedAt===null?null:requiredTimestamp(record.editedAt)});
}

function projectMessagePayload(value: unknown, messageType: NimiRealmRealtimeMessage['messageType']): NimiRealmRealtimeMessagePayload | null {
  if (value === null) {
    if (messageType !== 'recall') fail('Realm Chat message payload');
    return null;
  }
  if (messageType === 'recall') fail('Realm Chat recall payload');
  const record=requiredRecord(value,'Realm Chat message payload');
  const type=oneOf(record.type,['text','attachment','post-ref','user-ref','link-ref','friend-request','system']);
  if(type!==messageType)fail('Realm Chat message payload');
  if(type==='text'){assertExactProjectionKeys(record,['type','content'],type);return Object.freeze({type,content:text(record.content,'content',false,64*1024)});}
  if(type==='attachment'){assertExactProjectionKeys(record,['type','attachment'],type);return Object.freeze({type,attachment:projectRealmChatAttachment(record.attachment)});}
  if(type==='post-ref'){assertExactProjectionKeys(record,['type','postId'],type);return Object.freeze({type,postId:selector(record.postId)});}
  if(type==='user-ref'){assertExactProjectionKeys(record,['type','userId','snapshot'],type);return Object.freeze({type,userId:selector(record.userId),snapshot:record.snapshot===null?null:projectRealmChatUserSnapshot(record.snapshot)});}
  if(type==='link-ref'){assertExactProjectionKeys(record,['type','url','title'],type);return Object.freeze({type,url:text(record.url,'url',false,4096),title:nullableText(record.title)});}
  if(type==='friend-request'){assertExactProjectionKeys(record,['type','requestId','status','requestMessage'],type);return Object.freeze({type,requestId:selector(record.requestId),status:text(record.status,'status',false,128),requestMessage:nullableText(record.requestMessage)});}
  assertExactProjectionKeys(record,['type','code','message'],type);return Object.freeze({type,code:nullableText(record.code),message:nullableText(record.message)});
}

function projectMessageReply(value: unknown): NimiRealmRealtimeMessageReply {
  const record=requiredRecord(value,'Realm Chat reply');
  assertExactProjectionKeys(record,['id','senderId','messageType','text','payload'],'Realm Chat reply');
  const messageType=oneOf(record.messageType,['text','attachment','post-ref','user-ref','link-ref','friend-request','system','recall']);
  return Object.freeze({id:selector(record.id),senderId:selector(record.senderId),messageType,text:nullableText(record.text),payload:projectMessagePayload(record.payload,messageType)});
}

export function projectRealmChatAttachment(value: unknown): NimiRealmChatAttachment {
  const record=requiredRecord(value,'Realm Chat attachment');
  assertExactProjectionKeys(record,['targetType','targetId','displayKind','title','subtitle','url','thumbnail','width','height','duration','preview'],'Realm Chat attachment');
  if(!Number.isSafeInteger(record.width)||!Number.isSafeInteger(record.height)||typeof record.duration!=='number'||!Number.isFinite(record.duration)||(record.width as number)<0||(record.height as number)<0||record.duration<0)fail('Realm Chat attachment');
  return Object.freeze({targetType:oneOf(record.targetType,['resource','asset','bundle']),targetId:selector(record.targetId),displayKind:record.displayKind===null?null:oneOf(record.displayKind,['image','video','audio','text','card']),title:nullableText(record.title),subtitle:nullableText(record.subtitle),url:nullableText(record.url),thumbnail:nullableText(record.thumbnail),width:record.width as number,height:record.height as number,duration:record.duration,preview:record.preview===null?null:projectRealmChatAttachment(record.preview)});
}

export function projectRealmChatUserSnapshot(value: unknown): NimiRealmChatUserSnapshot {
  const record=requiredRecord(value,'Realm Chat user snapshot');
  assertExactProjectionKeys(record,['id','handle','displayName','avatarUrl'],'Realm Chat user snapshot');
  return Object.freeze({id:selector(record.id),handle:text(record.handle,'handle',false,256),displayName:text(record.displayName,'displayName',false,512),avatarUrl:nullableText(record.avatarUrl)});
}

export function projectRealmChatUserSummary(value: unknown): NimiRealmChatUserSummary {
  const record=requiredRecord(value,'Realm Chat user summary');
  assertExactProjectionKeys(record,['id','handle','displayName','avatarUrl','status','presenceStatus','presenceText','presenceEmoji','createdAt'],'Realm Chat user summary');
  return Object.freeze({id:selector(record.id),handle:text(record.handle,'handle',false,256),displayName:text(record.displayName,'displayName',false,512),avatarUrl:nullableText(record.avatarUrl),status:nullableText(record.status),presenceStatus:nullableText(record.presenceStatus),presenceText:nullableText(record.presenceText),presenceEmoji:nullableText(record.presenceEmoji),createdAt:requiredTimestamp(record.createdAt)});
}

function projectControl(value: unknown): NimiRealtimeControlStatus {
  const record=requiredRecord(value, 'Realm Realtime control'); assertExactProjectionKeys(record,['realtimeSessionId','channelId','subscriptionId','adapterKind','lifecycle','generation','sequence','correlationId','backpressure','bufferedItems','bufferCapacity','terminalReason','actionHint','occurredAt'],'Realm Realtime control');
  if(!Number.isSafeInteger(record.bufferedItems)||!Number.isSafeInteger(record.bufferCapacity))fail('Realm Realtime control');
  return Object.freeze({realtimeSessionId:text(record.realtimeSessionId,'realtimeSessionId',true,256),channelId:text(record.channelId,'channelId',true,256),subscriptionId:text(record.subscriptionId,'subscriptionId',true,256),adapterKind:oneOf(record.adapterKind,['realm']),lifecycle:oneOf(record.lifecycle,['opening','ready','degraded','reconnecting','closed','failed']),generation:decimal(record.generation,true),sequence:decimal(record.sequence,true),correlationId:text(record.correlationId,'correlationId',true,256),backpressure:oneOf(record.backpressure,['normal','pressured','blocked']),bufferedItems:record.bufferedItems as number,bufferCapacity:record.bufferCapacity as number,terminalReason:oneOf(record.terminalReason,['','cancelled','unauthenticated','permission-denied','not-found','unavailable','protocol-failure','resource-exhausted','slow-consumer','runtime-shutdown','stale-generation','owner-failed']),actionHint:text(record.actionHint,'actionHint',true,256),occurredAt:record.occurredAt===null?null:requiredTimestamp(record.occurredAt)});
}

function requiredTimestamp(value: unknown): { readonly seconds: string; readonly nanos: number } { const projected=projectTimestamp(value,'Realm Realtime timestamp'); if(!projected) return fail('Realm Realtime timestamp'); return projected; }
function selector(value: unknown): string { return text(value,'selector',false,512); }
function nullableText(value: unknown): string | null { return value===null?null:text(value,'text',true,64*1024)||null; }
function decimal(value: unknown, allowZero=false): string { const decimalText=text(value,'decimal',false,32); if(!/^(0|[1-9][0-9]*)$/u.test(decimalText)||(!allowZero&&decimalText==='0'))return fail('Realm Realtime decimal'); return decimalText; }
function oneOf<const T extends string>(value: unknown, allowed: readonly T[]): T { const enumText=text(value,'enum',true,128); if(!allowed.includes(enumText as T))return fail('Realm Realtime enum'); return enumText as T; }
function requiredRecord(value: unknown, label: string): Record<string, unknown> { return asRecord(value) || fail(label); }
function text(value: unknown, label: string, allowEmpty: boolean, maxBytes: number): string { if(typeof value!=='string'||value.trim()!==value||value.length>maxBytes||(!allowEmpty&&value.length===0))return fail(label); return value; }
function fail(label:string):never { return localAppProjectionError(`${label} projection is invalid.`); }
