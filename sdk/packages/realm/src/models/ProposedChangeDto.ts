/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ProposedChangeDto = {
    /**
     * JSON Patch operation (add, remove, replace)
     */
    op: string;
    /**
     * JSON Pointer path
     */
    path: string;
    value?: Record<string, any>;
};

