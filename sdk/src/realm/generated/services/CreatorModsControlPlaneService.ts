/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreatorModControlAuditIngestRequestDto } from '../models/CreatorModControlAuditIngestRequestDto';
import type { CreatorModControlGrantIssueRequestDto } from '../models/CreatorModControlGrantIssueRequestDto';
import type { CreatorModControlGrantValidateRequestDto } from '../models/CreatorModControlGrantValidateRequestDto';
import type { CreatorModControlManifestVerifyRequestDto } from '../models/CreatorModControlManifestVerifyRequestDto';
import type { CreatorModControlSignatureVerifyRequestDto } from '../models/CreatorModControlSignatureVerifyRequestDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class CreatorModsControlPlaneService {
    /**
     * Ingest runtime audit records from desktop execution-plane
     * @param requestBody
     * @returns any Audit ingest accepted count
     * @throws ApiError
     */
    public static creatorModsControllerIngestAudit(
        requestBody: CreatorModControlAuditIngestRequestDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/creator/mods/control/audit/ingest',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Creator runtime audit query
     * @returns any Runtime audit records
     * @throws ApiError
     */
    public static creatorModsControllerQueryAudit(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/creator/mods/control/audit/query',
        });
    }
    /**
     * Issue protected capability grant token
     * @param requestBody
     * @returns any Grant issued
     * @throws ApiError
     */
    public static creatorModsControllerIssueGrant(
        requestBody: CreatorModControlGrantIssueRequestDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/creator/mods/control/grants/issue',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Validate protected capability grant token
     * @param requestBody
     * @returns any Grant validation result
     * @throws ApiError
     */
    public static creatorModsControllerValidateGrant(
        requestBody: CreatorModControlGrantValidateRequestDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/creator/mods/control/grants/validate',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Creator manifest verification
     * @param requestBody
     * @returns any Manifest verification result
     * @throws ApiError
     */
    public static creatorModsControllerVerifyManifest(
        requestBody: CreatorModControlManifestVerifyRequestDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/creator/mods/control/manifest/verify',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Read runtime revocation feed
     * @returns any Revocation feed items
     * @throws ApiError
     */
    public static creatorModsControllerRevocations(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/creator/mods/control/revocations',
        });
    }
    /**
     * Creator signature verification
     * @param requestBody
     * @returns any Signature verification result
     * @throws ApiError
     */
    public static creatorModsControllerVerifySignature(
        requestBody: CreatorModControlSignatureVerifyRequestDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/creator/mods/control/signature/verify',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
}
