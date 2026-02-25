/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NotificationActorDto } from './NotificationActorDto';
import type { NotificationTargetDto } from './NotificationTargetDto';
export type NotificationDto = {
    actor: NotificationActorDto | null;
    body: string | null;
    createdAt: string;
    data: Record<string, any> | null;
    id: string;
    isRead: boolean;
    target: NotificationTargetDto | null;
    title: string;
    type: NotificationDto.type;
};
export namespace NotificationDto {
    export enum type {
        FRIEND_REQUEST_RECEIVED = 'friend_request_received',
        FRIEND_REQUEST_ACCEPTED = 'friend_request_accepted',
        GIFT_RECEIVED = 'gift_received',
        GIFT_ACCEPTED = 'gift_accepted',
        GIFT_REJECTED = 'gift_rejected',
        GIFT_STATUS_UPDATED = 'gift_status_updated',
        REVIEW_RECEIVED = 'review_received',
    }
}

