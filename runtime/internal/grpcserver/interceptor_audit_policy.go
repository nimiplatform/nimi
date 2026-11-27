package grpcserver

// @nimi-authority: rule.nimi.runtime.rpc-foundations.r001
// @nimi-authority: rule.nimi.runtime.rpc-foundations.r003
// auditRecordMode chooses between durable SQLite audit persistence and the
// bounded in-memory lightweight read diagnostic path.
//
// Fail-closed default: every unclassified method, every failure or denial,
// every sensitive read (credentials, secrets, tokens, connectors, private audit
// logs, account/session security, agent/app private data, protected host
// projections), every auth/permission/credential change, every AI execution /
// billing / usage commit, and every business mutation ALWAYS records a durable
// SQLite audit event.
type auditRecordMode uint8

const (
	auditRecordDurable auditRecordMode = iota
	auditRecordLightweightOnSuccess
)

// lightweightAuditUnaryReadMethods is the explicit closed allowlist of
// ordinary, non-sensitive, pure read-only unary health/catalog/display RPCs
// whose successful invocations use in-memory diagnostic aggregation instead of
// per-call durable SQLite audit transactions. Failures on these same methods
// still write durable failure attribution.
var lightweightAuditUnaryReadMethods = map[string]struct{}{
	// Standard gRPC health probes (pass public transport).
	"/grpc.health.v1.Health/Check": {},
	"/grpc.health.v1.Health/List":  {},

	// Runtime health snapshot (RuntimeAuditService health only; audit-log and
	// usage/cloud-history queries remain durably audited).
	"/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth": {},

	// Static AI scenario profile table and non-blocking scheduling preflight
	// occupancy observation (execution, jobs, configs, artifacts, and voice
	// endpoints remain durably audited).
	"/nimi.runtime.v1.RuntimeAiService/ListScenarioProfiles": {},
	"/nimi.runtime.v1.RuntimeAiService/PeekScheduling":       {},

	// Static built-in provider catalog display only (connectors, models,
	// credentials, and account-scoped catalog overlays remain durably audited).
	"/nimi.runtime.v1.RuntimeConnectorService/ListProviderCatalog": {},

	// Ordinary local machine hardware, catalog, loadout, model asset, transfer,
	// and local-environment display reads only (ListLocalAudits, ProductControl
	// projections, plan resolvers, and all mutations remain durably audited).
	"/nimi.runtime.v1.RuntimeLocalService/CollectDeviceProfile":                {},
	"/nimi.runtime.v1.RuntimeLocalService/ListLoadoutRecipes":                  {},
	"/nimi.runtime.v1.RuntimeLocalService/GetMachineLoadouts":                  {},
	"/nimi.runtime.v1.RuntimeLocalService/GetLoadout":                          {},
	"/nimi.runtime.v1.RuntimeLocalService/ListVerifiedAssets":                  {},
	"/nimi.runtime.v1.RuntimeLocalService/ListModelAssets":                     {},
	"/nimi.runtime.v1.RuntimeLocalService/GetModelAsset":                       {},
	"/nimi.runtime.v1.RuntimeLocalService/SearchCatalogModels":                 {},
	"/nimi.runtime.v1.RuntimeLocalService/GetCatalogModelCard":                 {},
	"/nimi.runtime.v1.RuntimeLocalService/ListCatalogVariants":                 {},
	"/nimi.runtime.v1.RuntimeLocalService/ListFeaturedModelAssets":             {},
	"/nimi.runtime.v1.RuntimeLocalService/ListFactoryProfileRecommendations":   {},
	"/nimi.runtime.v1.RuntimeLocalService/ListLocalTransfers":                  {},
	"/nimi.runtime.v1.RuntimeLocalService/ListLocalEnvironmentSelectedSources": {},
	"/nimi.runtime.v1.RuntimeLocalService/ListLocalEnvironmentDependencyJobs":  {},
}

// lightweightAuditStreamReadMethods is the explicit closed allowlist of
// ordinary, non-sensitive, read-only health/transfer observation streams whose
// clean completions use in-memory diagnostic aggregation instead of durable
// SQLite audit transactions. Failures on these streams remain durably audited.
var lightweightAuditStreamReadMethods = map[string]struct{}{
	"/grpc.health.v1.Health/Watch":                                      {},
	"/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents": {},
	"/nimi.runtime.v1.RuntimeLocalService/WatchLocalTransfers":          {},
}

func classifyUnaryAuditMode(fullMethod string, success bool) auditRecordMode {
	if !success {
		return auditRecordDurable
	}
	if _, ok := lightweightAuditUnaryReadMethods[fullMethod]; ok {
		return auditRecordLightweightOnSuccess
	}
	return auditRecordDurable
}

func classifyStreamAuditMode(fullMethod string, success bool) auditRecordMode {
	if !success {
		return auditRecordDurable
	}
	if _, ok := lightweightAuditStreamReadMethods[fullMethod]; ok {
		return auditRecordLightweightOnSuccess
	}
	return auditRecordDurable
}
