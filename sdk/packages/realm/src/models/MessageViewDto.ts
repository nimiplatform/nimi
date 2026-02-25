/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MessageType } from './MessageType';
export type MessageViewDto = {
    chatId: string;
    clientMessageId?: string;
    createdAt: string;
    editedAt?: string;
    id: string;
    isRead: boolean;
    payload: Record<string, any> | null;
    replyTo?: Record<string, any>;
    senderId: string;
    text?: string | null;
    type: MessageType;
};

