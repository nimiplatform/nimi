/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatEventEnvelopeDto } from './ChatEventEnvelopeDto';
import type { ChatSyncSnapshotDto } from './ChatSyncSnapshotDto';
export type ChatSyncResultDto = {
    events: Array<ChatEventEnvelopeDto>;
    highWatermarkSeq: number;
    mode: ChatSyncResultDto.mode;
    snapshot?: ChatSyncSnapshotDto;
};
export namespace ChatSyncResultDto {
    export enum mode {
        DELTA = 'delta',
        FULL = 'full',
    }
}

