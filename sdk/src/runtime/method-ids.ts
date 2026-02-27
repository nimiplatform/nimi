export const RuntimeMethodIds = {
  auth: {
    registerApp: '/nimi.runtime.v1.RuntimeAuthService/RegisterApp',
    openSession: '/nimi.runtime.v1.RuntimeAuthService/OpenSession',
    refreshSession: '/nimi.runtime.v1.RuntimeAuthService/RefreshSession',
    revokeSession: '/nimi.runtime.v1.RuntimeAuthService/RevokeSession',
    registerExternalPrincipal: '/nimi.runtime.v1.RuntimeAuthService/RegisterExternalPrincipal',
    openExternalPrincipalSession: '/nimi.runtime.v1.RuntimeAuthService/OpenExternalPrincipalSession',
    revokeExternalPrincipalSession: '/nimi.runtime.v1.RuntimeAuthService/RevokeExternalPrincipalSession',
  },
  appAuth: {
    authorizeExternalPrincipal: '/nimi.runtime.v1.RuntimeGrantService/AuthorizeExternalPrincipal',
    validateToken: '/nimi.runtime.v1.RuntimeGrantService/ValidateAppAccessToken',
    revokeToken: '/nimi.runtime.v1.RuntimeGrantService/RevokeAppAccessToken',
    issueDelegatedToken: '/nimi.runtime.v1.RuntimeGrantService/IssueDelegatedAccessToken',
    listTokenChain: '/nimi.runtime.v1.RuntimeGrantService/ListTokenChain',
  },
  ai: {
    generate: '/nimi.runtime.v1.RuntimeAiService/Generate',
    streamGenerate: '/nimi.runtime.v1.RuntimeAiService/StreamGenerate',
    embed: '/nimi.runtime.v1.RuntimeAiService/Embed',
    submitMediaJob: '/nimi.runtime.v1.RuntimeAiService/SubmitMediaJob',
    getMediaJob: '/nimi.runtime.v1.RuntimeAiService/GetMediaJob',
    cancelMediaJob: '/nimi.runtime.v1.RuntimeAiService/CancelMediaJob',
    subscribeMediaJobEvents: '/nimi.runtime.v1.RuntimeAiService/SubscribeMediaJobEvents',
    getMediaArtifacts: '/nimi.runtime.v1.RuntimeAiService/GetMediaArtifacts',
  },
  workflow: {
    submit: '/nimi.runtime.v1.RuntimeWorkflowService/SubmitWorkflow',
    get: '/nimi.runtime.v1.RuntimeWorkflowService/GetWorkflow',
    cancel: '/nimi.runtime.v1.RuntimeWorkflowService/CancelWorkflow',
    subscribeEvents: '/nimi.runtime.v1.RuntimeWorkflowService/SubscribeWorkflowEvents',
  },
  model: {
    list: '/nimi.runtime.v1.RuntimeModelService/ListModels',
    pull: '/nimi.runtime.v1.RuntimeModelService/PullModel',
    remove: '/nimi.runtime.v1.RuntimeModelService/RemoveModel',
    checkHealth: '/nimi.runtime.v1.RuntimeModelService/CheckModelHealth',
  },
  localRuntime: {
    listLocalModels: '/nimi.runtime.v1.RuntimeLocalRuntimeService/ListLocalModels',
    listVerifiedModels: '/nimi.runtime.v1.RuntimeLocalRuntimeService/ListVerifiedModels',
    searchCatalogModels: '/nimi.runtime.v1.RuntimeLocalRuntimeService/SearchCatalogModels',
    resolveModelInstallPlan: '/nimi.runtime.v1.RuntimeLocalRuntimeService/ResolveModelInstallPlan',
    installLocalModel: '/nimi.runtime.v1.RuntimeLocalRuntimeService/InstallLocalModel',
    installVerifiedModel: '/nimi.runtime.v1.RuntimeLocalRuntimeService/InstallVerifiedModel',
    importLocalModel: '/nimi.runtime.v1.RuntimeLocalRuntimeService/ImportLocalModel',
    removeLocalModel: '/nimi.runtime.v1.RuntimeLocalRuntimeService/RemoveLocalModel',
    startLocalModel: '/nimi.runtime.v1.RuntimeLocalRuntimeService/StartLocalModel',
    stopLocalModel: '/nimi.runtime.v1.RuntimeLocalRuntimeService/StopLocalModel',
    checkLocalModelHealth: '/nimi.runtime.v1.RuntimeLocalRuntimeService/CheckLocalModelHealth',
    collectDeviceProfile: '/nimi.runtime.v1.RuntimeLocalRuntimeService/CollectDeviceProfile',
    resolveDependencies: '/nimi.runtime.v1.RuntimeLocalRuntimeService/ResolveDependencies',
    applyDependencies: '/nimi.runtime.v1.RuntimeLocalRuntimeService/ApplyDependencies',
    listLocalServices: '/nimi.runtime.v1.RuntimeLocalRuntimeService/ListLocalServices',
    installLocalService: '/nimi.runtime.v1.RuntimeLocalRuntimeService/InstallLocalService',
    startLocalService: '/nimi.runtime.v1.RuntimeLocalRuntimeService/StartLocalService',
    stopLocalService: '/nimi.runtime.v1.RuntimeLocalRuntimeService/StopLocalService',
    checkLocalServiceHealth: '/nimi.runtime.v1.RuntimeLocalRuntimeService/CheckLocalServiceHealth',
    removeLocalService: '/nimi.runtime.v1.RuntimeLocalRuntimeService/RemoveLocalService',
    listNodeCatalog: '/nimi.runtime.v1.RuntimeLocalRuntimeService/ListNodeCatalog',
    listLocalAudits: '/nimi.runtime.v1.RuntimeLocalRuntimeService/ListLocalAudits',
    appendInferenceAudit: '/nimi.runtime.v1.RuntimeLocalRuntimeService/AppendInferenceAudit',
    appendRuntimeAudit: '/nimi.runtime.v1.RuntimeLocalRuntimeService/AppendRuntimeAudit',
  },
  knowledge: {
    buildIndex: '/nimi.runtime.v1.RuntimeKnowledgeService/BuildIndex',
    searchIndex: '/nimi.runtime.v1.RuntimeKnowledgeService/SearchIndex',
    deleteIndex: '/nimi.runtime.v1.RuntimeKnowledgeService/DeleteIndex',
  },
  app: {
    sendAppMessage: '/nimi.runtime.v1.RuntimeAppService/SendAppMessage',
    subscribeAppMessages: '/nimi.runtime.v1.RuntimeAppService/SubscribeAppMessages',
  },
  audit: {
    listAuditEvents: '/nimi.runtime.v1.RuntimeAuditService/ListAuditEvents',
    exportAuditEvents: '/nimi.runtime.v1.RuntimeAuditService/ExportAuditEvents',
    listUsageStats: '/nimi.runtime.v1.RuntimeAuditService/ListUsageStats',
    getRuntimeHealth: '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
    listAIProviderHealth: '/nimi.runtime.v1.RuntimeAuditService/ListAIProviderHealth',
    subscribeAIProviderHealthEvents: '/nimi.runtime.v1.RuntimeAuditService/SubscribeAIProviderHealthEvents',
    subscribeRuntimeHealthEvents: '/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents',
  },
} as const;

export const RuntimeAllowlistedMethodIds: readonly string[] = Object.freeze(
  Object.values(RuntimeMethodIds)
    .flatMap((serviceMethods) => Object.values(serviceMethods)),
);

export const RuntimeStreamMethodIds: readonly string[] = Object.freeze([
  RuntimeMethodIds.ai.streamGenerate,
  RuntimeMethodIds.ai.subscribeMediaJobEvents,
  RuntimeMethodIds.workflow.subscribeEvents,
  RuntimeMethodIds.app.subscribeAppMessages,
  RuntimeMethodIds.audit.exportAuditEvents,
  RuntimeMethodIds.audit.subscribeAIProviderHealthEvents,
  RuntimeMethodIds.audit.subscribeRuntimeHealthEvents,
]);

export const RuntimeWriteMethodIds: readonly string[] = Object.freeze([
  RuntimeMethodIds.auth.registerApp,
  RuntimeMethodIds.auth.openSession,
  RuntimeMethodIds.auth.refreshSession,
  RuntimeMethodIds.auth.revokeSession,
  RuntimeMethodIds.auth.registerExternalPrincipal,
  RuntimeMethodIds.auth.openExternalPrincipalSession,
  RuntimeMethodIds.auth.revokeExternalPrincipalSession,
  RuntimeMethodIds.appAuth.authorizeExternalPrincipal,
  RuntimeMethodIds.appAuth.revokeToken,
  RuntimeMethodIds.appAuth.issueDelegatedToken,
  RuntimeMethodIds.ai.generate,
  RuntimeMethodIds.ai.streamGenerate,
  RuntimeMethodIds.ai.embed,
  RuntimeMethodIds.ai.submitMediaJob,
  RuntimeMethodIds.ai.cancelMediaJob,
  RuntimeMethodIds.workflow.submit,
  RuntimeMethodIds.workflow.cancel,
  RuntimeMethodIds.model.pull,
  RuntimeMethodIds.model.remove,
  RuntimeMethodIds.localRuntime.installLocalModel,
  RuntimeMethodIds.localRuntime.installVerifiedModel,
  RuntimeMethodIds.localRuntime.importLocalModel,
  RuntimeMethodIds.localRuntime.removeLocalModel,
  RuntimeMethodIds.localRuntime.startLocalModel,
  RuntimeMethodIds.localRuntime.stopLocalModel,
  RuntimeMethodIds.localRuntime.applyDependencies,
  RuntimeMethodIds.localRuntime.installLocalService,
  RuntimeMethodIds.localRuntime.startLocalService,
  RuntimeMethodIds.localRuntime.stopLocalService,
  RuntimeMethodIds.localRuntime.removeLocalService,
  RuntimeMethodIds.localRuntime.appendInferenceAudit,
  RuntimeMethodIds.localRuntime.appendRuntimeAudit,
  RuntimeMethodIds.knowledge.buildIndex,
  RuntimeMethodIds.knowledge.deleteIndex,
  RuntimeMethodIds.app.sendAppMessage,
  RuntimeMethodIds.audit.exportAuditEvents,
]);

export function isRuntimeStreamMethod(methodId: string): boolean {
  return RuntimeStreamMethodIds.includes(methodId);
}

export function isRuntimeWriteMethod(methodId: string): boolean {
  return RuntimeWriteMethodIds.includes(methodId);
}
