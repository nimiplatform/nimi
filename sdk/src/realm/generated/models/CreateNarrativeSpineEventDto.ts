/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { GravityFieldDto } from './GravityFieldDto';
import type { SpineEventPayloadDto } from './SpineEventPayloadDto';
export type CreateNarrativeSpineEventDto = {
    /**
     * Additional causal links
     */
    causalLinks?: Array<string>;
    gravityField?: GravityFieldDto;
    narrativeWeight?: number;
    /**
     * Parent event ID for causal linking
     */
    parentEventId?: string;
    payload: SpineEventPayloadDto;
    sceneId?: string;
};

