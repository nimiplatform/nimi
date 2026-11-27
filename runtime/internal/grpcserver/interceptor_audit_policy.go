package grpcserver

// @nimi-authority: rule.nimi.runtime.rpc-foundations.r001
// @nimi-authority: rule.nimi.runtime.rpc-foundations.r003
// Only successful ordinary, non-sensitive display reads skip durable audit.
// Failures and methods outside these allowlists record durable results.
var ordinaryAuditUnaryReads = map[string]struct{}{
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

var ordinaryAuditStreamReads = map[string]struct{}{
	"/grpc.health.v1.Health/Watch":                                      {},
	"/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents": {},
	"/nimi.runtime.v1.RuntimeLocalService/WatchLocalTransfers":          {},
}

func requiresDurableAudit(fullMethod string, success bool, ordinaryReads map[string]struct{}) bool {
	_, ordinary := ordinaryReads[fullMethod]
	return !success || !ordinary
}
