/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MessageType } from './MessageType';
export type SendMessageInputDto = {
    clientMessageId: string;
    diagnostics?: Record<string, any>;
    interaction?: Record<string, any>;
    payload?: Record<string, any>;
    replyToMessageId?: string;
    text?: string;
    type: MessageType;
};

