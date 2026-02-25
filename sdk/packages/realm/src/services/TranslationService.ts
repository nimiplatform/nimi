/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TranslateRequestDto } from '../models/TranslateRequestDto';
import type { TranslateResponseDto } from '../models/TranslateResponseDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class TranslationService {
    /**
     * Translate text
     * @param requestBody
     * @returns TranslateResponseDto
     * @throws ApiError
     */
    public static translateText(
        requestBody: TranslateRequestDto,
    ): CancelablePromise<TranslateResponseDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/translation/translate',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
}
