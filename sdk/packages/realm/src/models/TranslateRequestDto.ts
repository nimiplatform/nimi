/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type TranslateRequestDto = {
    /**
     * Context of the text
     */
    context: TranslateRequestDto.context;
    /**
     * Target language code (ISO 639-1). If not provided, inferred from user settings.
     */
    targetLang?: string;
    /**
     * Text to translate
     */
    text: string;
};
export namespace TranslateRequestDto {
    /**
     * Context of the text
     */
    export enum context {
        CAPTION = 'caption',
        CHAT = 'chat',
    }
}

