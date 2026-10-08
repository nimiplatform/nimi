export type NativeConversation = Readonly<{ kind: string; id: string }>;
export type NativeReferenceMedia = Readonly<{
  kind: 'image'|'file'|'audio'|'video'; mediaRef: string; fileName: string; mediaType: string; sizeBytes: number;
  unavailableReason?: 'source-not-provided'|'source-rejected';
}>;
export type NativeEvent = Readonly<{
  eventId: string; conversation: NativeConversation; messageId: string; senderId: string;
  segments: readonly Readonly<{ kind: string; text?: string; origin?:'platform-transcription'; id?: string; displayName?: string; mediaRef?: string; fileName?: string; mediaType?: string; sizeBytes?: number }>[];
  references?:readonly Readonly<{messageId:string;relation?:'parent'|'root';title:string;text:string;origin?:'platform-transcription';mediaKind:string;fileName:string;contentStatus:string;media?:readonly NativeReferenceMedia[];partialText?:{start:string;end:string;startIndex:number;endIndex:number;quoteMD5:string}}>[];
  replyRef: string; platformTime: string; receivedAt: string;
}>;
export function nativeConversations(adapter: string): readonly string[] {
  return adapter === 'feishu' ? ['user','chat'] : adapter === 'qq-official' ? ['c2c','group'] : adapter === 'onebot-v11' ? ['private','group'] : ['private'];
}
// @nimi-authority: rule.nimi.runtime.integration.native-messaging
// Keep the actual envelope eventId as data; Feishu's retained message identity
// also owns the transcript row and its saved-batch lookup.
export function nativeEventKey(adapter: string, event: NativeEvent): string {
  return adapter === 'feishu' ? event.messageId : event.eventId;
}
// @nimi-authority: definition.nimi.runtime.integration.native-operation-contract
export function nativeReadInput(filters: string, cursor = ''): string {
  const conversations = filters.split(/[\n,]/).map(value => value.trim()).filter(Boolean);
  if (conversations.length > 64 || new Set(conversations).size !== conversations.length
    || conversations.some(value => value.length > 512 || !/^[a-z0-9-]+:.+$/u.test(value))) throw new Error(t('Integrations.invalidFilters'));
  return JSON.stringify({ conversations, cursor, waitMs: 25000 });
}
// This is a projection of a Runtime-validated operation result, not a separate
// protocol decoder or history format. A read never advances another App cursor.
export function nativeReadPage(resultJson: string): { cursor: string; events: readonly NativeEvent[]; coverageGap: string } {
  const page = JSON.parse(resultJson) as { cursor: string; events: NativeEvent[]; coverageGap: string };
  if (typeof page.cursor !== 'string' || !Array.isArray(page.events) || page.events.length > 32 || typeof page.coverageGap !== 'string') throw new Error(t('Integrations.invalidFeed'));
  // @nimi-authority: definition.nimi.runtime.integration.native-operation-contract
  // Reference media stays nested under its supplied reference. Reject a broken
  // public projection rather than turning arbitrary fields into a save action.
  for (const event of page.events) {
    if (!event || !Array.isArray(event.segments) || event.segments.length > 64
      || (event.references !== undefined && (!Array.isArray(event.references) || event.references.length > 64))
      || new TextEncoder().encode(JSON.stringify(event)).byteLength > 64 * 1024) throw new Error(t('Integrations.invalidFeed'));
    let mediaCount = event.segments.filter(segment => ['image','file','audio','video'].includes(segment.kind)).length;
    for (const reference of event.references ?? []) {
      if (!reference || (reference.media !== undefined && (!Array.isArray(reference.media) || reference.media.length > 64))) throw new Error(t('Integrations.invalidFeed'));
      for (const media of reference.media ?? []) {
        mediaCount++;
        const keys = ['kind','mediaRef','fileName','mediaType','sizeBytes','unavailableReason'];
        if (!media || Object.keys(media).some(key => !keys.includes(key)) || !['image','file','audio','video'].includes(media.kind)
          || typeof media.mediaRef !== 'string' || media.mediaRef.length > 512
          || typeof media.fileName !== 'string' || Array.from(media.fileName).length > 255
          || typeof media.mediaType !== 'string' || media.mediaType.length > 128
          || !Number.isSafeInteger(media.sizeBytes) || media.sizeBytes < 0 || media.sizeBytes > 32 * 1024 * 1024
          || (media.mediaRef ? media.unavailableReason !== undefined : !['source-not-provided','source-rejected'].includes(media.unavailableReason ?? ''))) throw new Error(t('Integrations.invalidFeed'));
      }
    }
    if (mediaCount > 64) throw new Error(t('Integrations.invalidFeed'));
  }
  return page;
}
export function nativeReceipt(operation:string,resultJson:string):{confirmation:'provider-accepted'|'message-created';messageId:string}|undefined{
  if(!/^(weixin|feishu|qq-official|onebot-v11)\.messages\.(send|reply|update)$/u.test(operation)||!resultJson)return;
  const value=JSON.parse(resultJson) as {confirmation:unknown;messageId:unknown};
  if((value.confirmation!=='provider-accepted'&&value.confirmation!=='message-created')||typeof value.messageId!=='string')return;
  return {confirmation:value.confirmation,messageId:value.messageId};
}
import { t } from '../../shell/i18n/index.js';
