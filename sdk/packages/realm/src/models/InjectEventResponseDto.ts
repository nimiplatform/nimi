/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RuleValidationResponseDto } from './RuleValidationResponseDto';
export type InjectEventResponseDto = {
    /**
     * Error message if failed
     */
    error?: string;
    /**
     * Event ID if successful
     */
    eventId: string;
    /**
     * Whether the event was injected successfully
     */
    success: boolean;
    /**
     * Validation result
     */
    validation?: RuleValidationResponseDto;
};

