/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MessageViewDto } from './MessageViewDto';
import type { UserLiteDto } from './UserLiteDto';
export type ChatViewDto = {
    createdAt: string;
    id: string;
    lastMessage: MessageViewDto | null;
    lastMessageAt: string | null;
    otherUser: UserLiteDto;
    unreadCount: number;
    updatedAt: string;
};

