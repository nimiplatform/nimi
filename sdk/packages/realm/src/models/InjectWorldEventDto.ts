/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type InjectWorldEventDto = {
    /**
     * Affected areas/regions
     */
    affectedAreas?: Array<string>;
    /**
     * Event description
     */
    description: string;
    /**
     * Duration in world-time (hours)
     */
    durationHours?: number;
    /**
     * Event type/category
     */
    eventType: InjectWorldEventDto.eventType;
    /**
     * Whether agents must acknowledge this event
     */
    requiresAcknowledgment?: boolean;
    /**
     * Scope of the event
     */
    scope: InjectWorldEventDto.scope;
    /**
     * Event title/name
     */
    title: string;
};
export namespace InjectWorldEventDto {
    /**
     * Event type/category
     */
    export enum eventType {
        NATURAL = 'NATURAL',
        SOCIAL = 'SOCIAL',
        POLITICAL = 'POLITICAL',
        ECONOMIC = 'ECONOMIC',
        MAGICAL = 'MAGICAL',
        DISASTER = 'DISASTER',
        DISCOVERY = 'DISCOVERY',
        OTHER = 'OTHER',
    }
    /**
     * Scope of the event
     */
    export enum scope {
        GLOBAL = 'GLOBAL',
        REGIONAL = 'REGIONAL',
        LOCAL = 'LOCAL',
    }
}

