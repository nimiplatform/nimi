/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AdminSensitiveWordsDto = {
    operation: AdminSensitiveWordsDto.operation;
    /**
     * List of sensitive words to add/remove
     */
    words: Array<string>;
};
export namespace AdminSensitiveWordsDto {
    export enum operation {
        ADD = 'ADD',
        REMOVE = 'REMOVE',
        SET = 'SET',
    }
}

