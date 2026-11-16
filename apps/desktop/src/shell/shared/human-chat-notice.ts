import { z } from 'zod';

export const SHOW_HUMAN_CHAT_NOTICE = 'desktop_human_chat_notice_show';
export const FOCUS_HUMAN_CHAT_NOTICE = 'desktop_human_chat_notice_focus';
export const OPEN_HUMAN_CHAT_NOTICE = 'human-chat-notice:open';

const generation = z.string().min(1).max(128);
const chatId = z.string().trim().min(1).max(512);
const notice = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('summary') }),
  z.strictObject({
    kind: z.enum(['arrival', 'unread']),
    chatId,
    sender: z.string().trim().min(1).max(120).regex(/^[^\r\n\u0000]+$/u),
  }),
]);

export const humanChatNoticeFocus = z.strictObject({ generation });
export const humanChatNoticeRequest = z.strictObject({ generation, notice });
export const humanChatNoticeTarget = z.strictObject({ generation, chatId: chatId.nullable() });
export type HumanChatNotice = z.infer<typeof notice>;
