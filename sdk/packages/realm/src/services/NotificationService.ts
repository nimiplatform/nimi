/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MarkNotificationsReadInputDto } from '../models/MarkNotificationsReadInputDto';
import type { NotificationListResultDto } from '../models/NotificationListResultDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class NotificationService {
    /**
     * List notifications
     * @param type
     * @param unreadOnly
     * @param limit
     * @param cursor
     * @returns NotificationListResultDto
     * @throws ApiError
     */
    public static listNotifications(
        type?: 'SYSTEM' | 'INTERACTION' | 'POST_LIKE' | 'POST_COMMENT' | 'MENTION',
        unreadOnly?: boolean,
        limit?: number,
        cursor?: string,
    ): CancelablePromise<NotificationListResultDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/notifications',
            query: {
                'type': type,
                'unreadOnly': unreadOnly,
                'limit': limit,
                'cursor': cursor,
            },
        });
    }
    /**
     * Mark notifications read
     * @param requestBody
     * @returns void
     * @throws ApiError
     */
    public static markNotificationsRead(
        requestBody: MarkNotificationsReadInputDto,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/human/notifications/read',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get unread count
     * @returns any Unread count
     * @throws ApiError
     */
    public static getUnreadCount(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/human/notifications/unread-count',
        });
    }
    /**
     * Mark notification read
     * @param notificationId
     * @returns void
     * @throws ApiError
     */
    public static markNotificationRead(
        notificationId: string,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/human/notifications/{notificationId}/read',
            path: {
                'notificationId': notificationId,
            },
        });
    }
}
