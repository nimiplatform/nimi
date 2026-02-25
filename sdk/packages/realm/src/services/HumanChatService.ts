/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatSyncResultDto } from '../models/ChatSyncResultDto';
import type { ChatViewDto } from '../models/ChatViewDto';
import type { EditMessageInputDto } from '../models/EditMessageInputDto';
import type { ListChatsResultDto } from '../models/ListChatsResultDto';
import type { ListMessagesResultDto } from '../models/ListMessagesResultDto';
import type { MessageViewDto } from '../models/MessageViewDto';
import type { SendMessageInputDto } from '../models/SendMessageInputDto';
import type { StartChatInputDto } from '../models/StartChatInputDto';
import type { StartChatResultDto } from '../models/StartChatResultDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class HumanChatService {
    /**
     * List chats
     * @param limit
     * @param cursor
     * @returns ListChatsResultDto
     * @throws ApiError
     */
    public static listChats(
        limit?: number,
        cursor?: string,
    ): CancelablePromise<ListChatsResultDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/chats',
            query: {
                'limit': limit,
                'cursor': cursor,
            },
        });
    }
    /**
     * Start chat
     * @param requestBody
     * @returns StartChatResultDto
     * @throws ApiError
     */
    public static startChat(
        requestBody: StartChatInputDto,
    ): CancelablePromise<StartChatResultDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/human/chats',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get chat by ID
     * @param chatId
     * @returns ChatViewDto
     * @throws ApiError
     */
    public static getChatById(
        chatId: string,
    ): CancelablePromise<ChatViewDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/chats/{chatId}',
            path: {
                'chatId': chatId,
            },
        });
    }
    /**
     * List messages
     * @param chatId
     * @param limit
     * @param around
     * @param after
     * @param before
     * @returns ListMessagesResultDto
     * @throws ApiError
     */
    public static listMessages(
        chatId: string,
        limit?: number,
        around?: string,
        after?: string,
        before?: string,
    ): CancelablePromise<ListMessagesResultDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/chats/{chatId}/messages',
            path: {
                'chatId': chatId,
            },
            query: {
                'limit': limit,
                'around': around,
                'after': after,
                'before': before,
            },
        });
    }
    /**
     * Send message
     * @param chatId
     * @param requestBody
     * @returns MessageViewDto
     * @throws ApiError
     */
    public static sendMessage(
        chatId: string,
        requestBody: SendMessageInputDto,
    ): CancelablePromise<MessageViewDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/human/chats/{chatId}/messages',
            path: {
                'chatId': chatId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Edit message
     * @param messageId
     * @param chatId
     * @param requestBody
     * @returns MessageViewDto
     * @throws ApiError
     */
    public static editMessage(
        messageId: string,
        chatId: string,
        requestBody: EditMessageInputDto,
    ): CancelablePromise<MessageViewDto> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/human/chats/{chatId}/messages/{messageId}',
            path: {
                'messageId': messageId,
                'chatId': chatId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Recall message
     * @param messageId
     * @param chatId
     * @returns void
     * @throws ApiError
     */
    public static recallMessage(
        messageId: string,
        chatId: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/human/chats/{chatId}/messages/{messageId}/recall',
            path: {
                'messageId': messageId,
                'chatId': chatId,
            },
        });
    }
    /**
     * Mark chat read
     * @param chatId
     * @returns void
     * @throws ApiError
     */
    public static markChatRead(
        chatId: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/human/chats/{chatId}/read',
            path: {
                'chatId': chatId,
            },
        });
    }
    /**
     * Sync chat events
     * @param chatId
     * @param limit
     * @param afterSeq
     * @returns ChatSyncResultDto
     * @throws ApiError
     */
    public static syncChatEvents(
        chatId: string,
        limit?: number,
        afterSeq?: number,
    ): CancelablePromise<ChatSyncResultDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/chats/{chatId}/sync',
            path: {
                'chatId': chatId,
            },
            query: {
                'limit': limit,
                'afterSeq': afterSeq,
            },
        });
    }
}
