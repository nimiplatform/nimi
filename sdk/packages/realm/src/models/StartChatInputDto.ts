/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MessageType } from './MessageType';
export type StartChatInputDto = {
    asFriendRequest?: boolean;
    payload?: Record<string, any>;
    targetAccountId: string;
    text?: string;
    type?: MessageType;
};

