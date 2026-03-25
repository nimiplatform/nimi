import path from 'node:path';

export const OPENAPI_TYPESCRIPT_VERSION = '7.10.1';
export const DEFAULT_SPEC_RELATIVE_PATH = path.join('.cache', 'realm-openapi', 'api-nimi.yaml');
export const REALM_GENERATED_RELATIVE_PATH = path.join('sdk', 'src', 'realm', 'generated');
export const REALM_FACADE_RELATIVE_PATH = path.join('sdk', 'src', 'realm', 'index.ts');
export const SDK_PACKAGE_JSON_RELATIVE_PATH = path.join('sdk', 'package.json');
export const CLEAN_TARGETS = [
  'core',
  'models',
  'services',
  'schemas',
  'index.ts',
  'schema.ts',
  'model-map.ts',
  'operation-map.ts',
  'service-registry.ts',
  'type-helpers.ts',
  'property-enums.ts',
];

export const OPERATION_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];
export const PARAMETER_VALUE_TYPES = ['string', 'number', 'boolean', 'string[]', 'number[]', 'boolean[]', 'unknown'];

export const TAG_TO_SERVICE = Object.freeze({
  'Agent NSFW Consent': 'AgentNsfwConsentService',
  Agents: 'AgentsService',
  Auth: 'AuthService',
  Creator: 'CreatorService',
  'Creator Mods Control Plane': 'CreatorModsControlPlaneService',
  Desktop: 'DesktopService',
  'Economy (Currency & Gifts)': 'EconomyCurrencyGiftsService',
  Explore: 'ExploreService',
  Governance: 'GovernanceService',
  HumanChat: 'HumanChatService',
  HumanNsfwConsent: 'HumanNsfwConsentService',
  Invitations: 'InvitationsService',
  Me: 'MeService',
  Me2fa: 'MeTwoFactorService',
  Resources: 'ResourcesService',
  Notification: 'NotificationService',
  Post: 'PostService',
  'Relationships (Meta-Graph)': 'RelationshipsMetaGraphService',
  'Reviews (Economy/Trust)': 'ReviewsEconomyTrustService',
  Search: 'SearchService',
  'Social - Four-Dimensional Attributes': 'SocialAttributesService',
  'Social - V1 Default Visibility': 'SocialDefaultVisibilityService',
  Transits: 'TransitsService',
  Translation: 'TranslationService',
  User: 'UserService',
  'World Control': 'WorldControlService',
  'World Rules': 'WorldRulesService',
  Worlds: 'WorldsService',
});
