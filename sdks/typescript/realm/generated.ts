import type {
  RealmTypedModel,
  RealmTypedModelMap,
  RealmTypedModelName,
} from '../core-generated/realm-typed-client';

type RealmPrivateModelName = Extract<
  RealmTypedModelName,
  | `AccountGrant${string}`
  | `AccountGrants${string}`
  | `AppPermission${string}`
  | `RuntimeRealmGrant${string}`
  | `${string}DependencyClosureV3Dto`
  | `${string}Materialization${string}`
  | `${string}SourceRefV3Dto`
  | `ProfileCoverageManifest${string}`
  | `Readiness${string}`
  | `Validity${string}`
  | 'RealmCoreOriginDto'
>;

export type RealmModelName = Exclude<RealmTypedModelName, RealmPrivateModelName>;
export type RealmModels = Pick<RealmTypedModelMap, RealmModelName>;
export type RealmModel<Name extends RealmModelName> = RealmTypedModel<Name>;

export type {
  PostDto,
  RealmGetExploreFeedOperationResponse,
  RealmGetMeOperationResponse,
  RealmWorldCoreControllerGetOasisWorldOperationResponse,
  RealmWorldCoreControllerGetPersonaCharacterOperationResponse,
  RealmWorldCoreControllerGetWorldCharacterOperationResponse,
  RealmWorldCoreControllerGetWorldCoreOperationResponse,
  RealmWorldCoreControllerListPersonaCharactersOperationResponse,
  RealmWorldCoreControllerListWorldCharactersOperationResponse,
  RealmWorldCoreControllerListWorldCoresOperationRequest,
  RealmWorldCoreControllerListWorldCoresOperationResponse,
  ReportReason,
  ReviewRating,
} from '../core-generated/realm-typed-client';
export {
  ReportReasonValue,
  ReportReasonValues,
  ReviewRatingValue,
  ReviewRatingValues,
} from '../core-generated/realm-typed-client';
