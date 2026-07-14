package main

func runtimeChecklistPart1(
	pkgAppRegistry string,
	pkgAI string,
	pkgAccount string,
	pkgAuditLog string,
	pkgAuditSvc string,
	pkgLocalApp string,
	pkgGrpc string,
	pkgModel string,
	pkgNimillm string,
	pkgScheduler string,
	pkgWorkflow string,
) []checklistItemSpec {
	return []checklistItemSpec{
		{
			ID:          "RS-11-01",
			Requirement: "gRPC schema freeze + breaking-change check",
			Commands: []commandCheckSpec{
				{Name: "buf-build", Dir: "../proto", Binary: "buf", Args: []string{"build"}},
				{Name: "buf-breaking", Dir: "../proto", Binary: "buf", Args: []string{"breaking", "--against", "../runtime/proto/runtime-v1.baseline.binpb"}},
			},
		},
		{
			ID:          "RS-11-02",
			Requirement: "strict-only version negotiation",
			Tests: []testRef{
				{Package: pkgGrpc, Name: "TestUnaryProtocolInterceptorRejectsMissingMetadata"},
				{Package: pkgGrpc, Name: "TestUnaryProtocolInterceptorRejectsVersionMinorMismatch"},
			},
		},
		{
			ID:          "RS-11-03",
			Requirement: "local-app grant key and transition tests",
			Tests:       []testRef{{Package: pkgLocalApp, Name: "TestGrantKeyIncludesAccountPrincipalAndFingerprint"}},
		},
		{
			ID:          "RS-11-04",
			Requirement: "local-app principal/record/grant store separation",
			Tests: []testRef{
				{Package: pkgLocalApp, Name: "TestStoresUseSeparateTablesWithoutGrantFieldsInRecord"},
				{Package: pkgLocalApp, Name: "TestGrantKeyIncludesAccountPrincipalAndFingerprint"},
			},
		},
		{
			ID:          "RS-11-05",
			Requirement: "principal tombstone revokes inheritance",
			Tests:       []testRef{{Package: pkgLocalApp, Name: "TestTombstoneRemovesRecordAndNeverInheritsGrantOrKeys"}},
		},
		{
			ID:          "RS-11-06",
			Requirement: "grant supersession requires exact prior grant",
			Tests:       []testRef{{Package: pkgLocalApp, Name: "TestGrantKeyIncludesAccountPrincipalAndFingerprint"}},
		},
		{
			ID:          "RS-11-07",
			Requirement: "grant capability and resource fingerprint isolation",
			Tests:       []testRef{{Package: pkgLocalApp, Name: "TestGrantKeyIncludesAccountPrincipalAndFingerprint"}},
		},
		{
			ID:          "RS-11-08",
			Requirement: "grant approval requires presence evidence",
			Tests: []testRef{
				{Package: pkgAccount, Name: "TestLocalAppGrantZeroRequestPresenceDecisionAndReplay"},
				{Package: pkgAccount, Name: "TestLocalAppGrantExplicitDenialConsumesChallengeWithoutPresence"},
			},
		},
		{
			ID:          "RS-11-09",
			Requirement: "provenance promotion invalidates leases and sessions without grant mutation",
			Tests:       []testRef{{Package: pkgLocalApp, Name: "TestProvenanceAdvanceAtomicallyRecordsInvalidationWithoutGrantMutation"}},
		},
		{
			ID:          "RS-11-10",
			Requirement: "app mode violations (domain/scope/worldRelation/manifest)",
			Tests: []testRef{
				{Package: pkgAppRegistry, Name: "TestValidateManifestRejectsLiteExtensionWorldRelation"},
				{Package: pkgAppRegistry, Name: "TestValidateDomainAndScopesRejectsModeViolationsWithActionHint"},
			},
		},
		{
			ID:          "RS-11-11",
			Requirement: "app mode actionHint mapping",
			Tests:       []testRef{{Package: pkgAppRegistry, Name: "TestValidateDomainAndScopesRejectsModeViolationsWithActionHint"}},
		},
		{
			ID:          "RS-11-12",
			Requirement: "Scenario Execute/Stream request-response schema",
			Tests: []testRef{
				{Package: pkgAI, Name: "TestExecuteScenarioTextGenerateSuccess"},
				{Package: pkgAI, Name: "TestStreamScenarioTextGenerateSequence"},
			},
		},
		{
			ID:          "RS-11-13",
			Requirement: "scenario stream envelope contract",
			Tests:       []testRef{{Package: pkgAI, Name: "TestStreamScenarioTextGenerateSequence"}},
		},
		{
			ID:          "RS-11-14",
			Requirement: "AI reason-code mapping (timeout/unavailable/filter/auth/rate-limit/internal)",
			Tests: []testRef{
				{Package: pkgAI, Name: "TestStreamScenarioTextGenerateTimeoutEmitsFailedEvent"},
				{Package: pkgNimillm, Name: "TestMapProviderHTTPError_ContentFilter"},
				{Package: pkgNimillm, Name: "TestBackendStreamGenerateTextBrokenChunkReturnsReasonCode"},
				{Package: pkgNimillm, Name: "TestMapProviderHTTPError_ProviderAuthFailed"},
				{Package: pkgNimillm, Name: "TestMapProviderHTTPError_ProviderRateLimited"},
				{Package: pkgNimillm, Name: "TestMapProviderHTTPError_ProviderInternal"},
			},
		},
		{
			ID:          "RS-11-15",
			Requirement: "AI route policy regression (explicit route + no silent fallback)",
			Tests: []testRef{
				{Package: pkgAI, Name: "TestExecuteScenarioTextGenerateFallbackDenied"},
				{Package: pkgNimillm, Name: "TestCloudProviderPickBackendRejectsUnavailableExplicitPrefixWithoutFallback"}, // pragma: allowlist secret
			},
		},
		{
			ID:          "RS-11-16",
			Requirement: "model management contract (pull/list/remove/health)",
			Tests: []testRef{
				{Package: pkgModel, Name: "TestModelLifecycle"},
				{Package: pkgModel, Name: "TestModelRegistryPersistence"},
			},
		},
		{
			ID:          "RS-11-17",
			Requirement: "attribution metadata regression (callerKind/callerId/surfaceId)",
			Tests: []testRef{
				{Package: pkgGrpc, Name: "TestUnaryAuditInterceptorCapturesCallerMetadataForAI"},
				{Package: pkgGrpc, Name: "TestStreamAuditInterceptorCapturesCallerMetadataForAI"},
			},
		},
		{
			ID:          "RS-11-18",
			Requirement: "ListUsageStats consistency (desktop/app/third-party)",
			Tests:       []testRef{{Package: pkgAuditLog, Name: "TestStoreListUsageByCallerKindAndCapability"}},
		},
		{
			ID:          "RS-11-19",
			Requirement: "GetRuntimeHealth/SubscribeRuntimeHealthEvents contract",
			Tests: []testRef{
				{Package: pkgAuditSvc, Name: "TestGetRuntimeHealthContract"},
				{Package: pkgAuditSvc, Name: "TestSubscribeRuntimeHealthEvents"},
			},
		},
		{
			ID:          "RS-11-20",
			Requirement: "DAG state machine",
			Tests: []testRef{
				{Package: pkgWorkflow, Name: "TestWorkflowSubmitGetSubscribe"},
				{Package: pkgWorkflow, Name: "TestWorkflowCancel"},
			},
		},
		{
			ID:          "RS-11-21",
			Requirement: "GPU arbitration regression",
			Tests: []testRef{
				{Package: pkgScheduler, Name: "TestSchedulerPerAppConcurrencyIsolation"},
				{Package: pkgScheduler, Name: "TestSchedulerMarksStarvationWhenWaitExceedsThreshold"},
			},
		},
		{
			ID:          "RS-11-22",
			Requirement: "local-app grant lifecycle audit field completeness (P-PERM-004/K-AUDIT-001)",
			Tests:       []testRef{{Package: pkgAccount, Name: "TestLocalAppGrantLifecycleAuditFields"}},
		},
		{
			ID:          "RS-11-23",
			Requirement: "local and cloud routing regression",
			Tests: []testRef{
				{Package: pkgNimillm, Name: "TestCloudProviderPickBackendRoutesByPrefix"},
				{Package: pkgAI, Name: "TestExecuteScenarioTextGenerateSuccess"},
			},
		},
		{
			ID:          "RS-11-24",
			Requirement: "cloud-nimillm naming unified (no legacy cloud alias)",
			Tests: []testRef{
				{Package: pkgNimillm, Name: "TestCloudProviderPickBackendRoutesByPrefix"},
				{Package: pkgNimillm, Name: "TestCloudProviderPickBackendRejectsLegacyAliasPrefix"},
			},
		},
		{
			ID:          "RS-11-25",
			Requirement: "no forbidden legacy cloud-provider references outside explicit reject allowlist (zero-legacy static scan)",
			Commands: []commandCheckSpec{
				{Name: "legacy-cloud-provider-key-scan", Dir: "..", Binary: "node", Args: []string{"scripts/check-no-legacy-cloud-provider-keys.mjs"}},
			},
		},
		{
			ID:          "RS-11-26",
			Requirement: "error-mapping-matrix provider error classification",
			Tests: []testRef{
				{Package: pkgNimillm, Name: "TestMapProviderHTTPError_ProviderAuthFailed"},
				{Package: pkgNimillm, Name: "TestMapProviderHTTPError_ProviderRateLimited"},
				{Package: pkgNimillm, Name: "TestMapProviderHTTPError_ProviderInternal"},
				{Package: pkgNimillm, Name: "TestMapProviderHTTPError_ProviderUnavailable"},
				{Package: pkgNimillm, Name: "TestMapProviderRequestError_DeadlineExceeded"},
			},
		},
	}
}
