import { z } from 'zod';

export const SHOW_HUMAN_CHAT_NOTICE = 'desktop_human_chat_notice_show';
export const FOCUS_HUMAN_CHAT_NOTICE = 'desktop_human_chat_notice_focus';
export const OPEN_HUMAN_CHAT_NOTICE = 'human-chat-notice:open';

const generation = z.string().min(1).max(128);
const chatId = z.string().trim().min(1).max(512);
// eslint-disable-next-line no-control-regex -- Native notification labels reject NUL and line breaks.
const senderLabel = /^[^\r\n\u0000]+$/u;
const notice = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('summary') }),
  z.strictObject({
    kind: z.enum(['arrival', 'unread']),
    chatId,
    sender: z.string().trim().min(1).max(120).regex(senderLabel),
  }),
]);

export const humanChatNoticeFocus = z.strictObject({ generation });
export const humanChatNoticeRequest = z.strictObject({ generation, notice });
export const humanChatNoticeTarget = z.strictObject({ generation, chatId: chatId.nullable() });
export type HumanChatNotice = z.infer<typeof notice>;

export const SHOW_PARTNER_CHAT_NOTICE = 'desktop_partner_chat_notice_show';
export const CLOSE_PARTNER_CHAT_NOTICE = 'desktop_partner_chat_notice_close';
export const OPEN_PARTNER_CHAT_NOTICE = 'partner-chat-notice:open';

const activityId = z.string().min(1).max(256);
export const partnerChatNoticeTarget = z.strictObject({
  generation,
  activityId,
  localAgentRef: z.string().min(1).max(256),
  turnId: z.string().min(1).max(200),
  messageId: z.string().min(1).max(256).optional(),
});
export const partnerChatNoticeRequest = partnerChatNoticeTarget.extend({
  sender: z.string().trim().min(1).max(256).regex(senderLabel),
});
export const partnerChatNoticeClose = z.strictObject({ generation, activityId });
