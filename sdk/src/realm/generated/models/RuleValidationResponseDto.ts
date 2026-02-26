/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type RuleValidationResponseDto = {
    /**
     * Whether the rules are valid
     */
    isValid: boolean;
    /**
     * List of violations
     */
    violations: Array<string>;
    /**
     * List of warnings
     */
    warnings: Array<string>;
};

