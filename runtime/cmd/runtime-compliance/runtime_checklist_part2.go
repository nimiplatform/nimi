package main

func runtimeChecklistPart2(
	pkgAI string,
	pkgApp string,
	pkgAppRegistry string,
	pkgAuth string,
	pkgAuthn string,
	pkgAuditLog string,
	pkgAuditSvc string,
	pkgConfig string,
	pkgConnector string,
	pkgDaemon string,
	pkgGrpc string,
	pkgGrpcErr string,
	pkgKnowledge string,
	pkgLocalService string,
	pkgModel string,
	pkgNimillm string,
	pkgProtocol string,
	pkgStreamutil string,
	pkgWorkflow string,
) []checklistItemSpec {
	return []checklistItemSpec{
		{
			ID:          "RS-11-27",
			Requirement: "scenario job reason code coverage",
			Tests: []testRef{
				{Package: pkgAI, Name: "TestScenarioJobReasonCodeClassification/GetScenarioJob_NotFound_ReasonCode"},
				{Package: pkgAI, Name: "TestScenarioJobReasonCodeClassification/CancelScenarioJob_NotFound_ReasonCode"},
				{Package: pkgAI, Name: "TestScenarioJobReasonCodeClassification/CancelScenarioJob_NotCancellable_ReasonCode"},
				{Package: pkgAI, Name: "TestScenarioJobReasonCodeClassification/SubmitScenarioJob_OptionUnsupported_ImageN"},
			},
		},
		{
			ID:          "RS-11-28",
			Requirement: "workflow reason code coverage",
			Tests: []testRef{
				{Package: pkgWorkflow, Name: "TestValidateDefinitionRejectsDuplicateInputSlot"},
				{Package: pkgWorkflow, Name: "TestValidateDefinitionRejectsCycle"},
				{Package: pkgWorkflow, Name: "TestValidateDefinitionRejectsMergeNOfMOutOfRange"},
				{Package: pkgWorkflow, Name: "TestGetWorkflowNotFoundReasonCode"},
				{Package: pkgWorkflow, Name: "TestCancelWorkflowNotFoundReasonCode"},
			},
		},
		{
			ID:          "RS-11-29",
			Requirement: "grant token chain reason code coverage",
			Tests: []testRef{
				{Package: "github.com/nimiplatform/nimi/runtime/internal/services/grant", Name: "TestListTokenChainRootRequiredReasonCode"},
				{Package: "github.com/nimiplatform/nimi/runtime/internal/services/grant", Name: "TestListTokenChainRootNotFoundReasonCode"},
			},
		},
		{
			ID:          "RS-11-30",
			Requirement: "realm primitive contract coverage (timeflow/economy graduated, others skeletonized)",
			Tests: []testRef{
				{Package: pkgProtocol, Name: "TestRealmPrimitiveContractSkeletonCoverage"},
				{Package: pkgProtocol, Name: "TestValidateTimeflowContractAcceptsCanonicalPayload"},
				{Package: pkgProtocol, Name: "TestValidateEconomyContractAcceptsCanonicalPayload"},
			},
		},
		{
			ID:          "RS-11-31",
			Requirement: "alg=none JWT rejection (K-AUTHN-003)",
			Tests:       []testRef{{Package: pkgAuthn, Name: "TestValidateAlgNoneTokenRejected"}},
		},
		{
			ID:          "RS-11-32",
			Requirement: "7-state scenario job machine enumeration (K-JOB-002)",
			Tests:       []testRef{{Package: pkgAI, Name: "TestScenarioJobStateEnumerationMatchesSpec"}},
		},
		{
			ID:          "RS-11-33",
			Requirement: "interceptor chain 6-layer order (K-DAEMON-005)",
			Tests:       []testRef{{Package: pkgGrpc, Name: "TestInterceptorChainOrderMatchesSpec"}},
		},
		{
			ID:          "RS-11-34",
			Requirement: "stream close modes (K-STREAM-001)",
			Tests: []testRef{
				{Package: pkgAI, Name: "TestStreamCloseModeDoneTrueCarriesUsage"},
				{Package: pkgAI, Name: "TestStreamCloseModeTerminalEventOnError"},
			},
		},
		{
			ID:          "RS-11-35",
			Requirement: "stream chunk minimum 32 bytes (K-STREAM-006)",
			Tests:       []testRef{{Package: pkgAI, Name: "TestStreamChunkMinBytes"}},
		},
		{
			ID:          "RS-11-36",
			Requirement: "connector check order: owner → status → credential (K-AUTH-005)",
			Tests:       []testRef{{Package: pkgConnector, Name: "TestConnectorCheckOrderOwnerBeforeStatusBeforeCredential"}},
		},
		{
			ID:          "RS-11-37",
			Requirement: "6 local connector categories (K-LOCAL-001)",
			Tests:       []testRef{{Package: pkgConnector, Name: "TestEnsureLocalConnectorsCreatesExactly6Categories"}},
		},
		{
			ID:          "RS-11-38",
			Requirement: "audit event 6 mandatory fields (K-AUDIT-001)",
			Tests:       []testRef{{Package: pkgGrpc, Name: "TestAuditEventMandatoryFieldsCompleteness"}},
		},
		{
			ID:          "RS-11-39",
			Requirement: "audit sensitive field masking (K-AUDIT-017)",
			Tests: []testRef{
				{Package: pkgAuditLog, Name: "TestAppendEventMasksPayload"},
				{Package: pkgAuditLog, Name: "TestMaskValue"},
			},
		},
		{
			ID:          "RS-11-40",
			Requirement: "key source managed/inline mutual exclusion (K-KEYSRC-002)",
			Tests:       []testRef{{Package: pkgAI, Name: "TestValidateKeySourceConflict"}},
		},
		{
			ID:          "RS-11-41",
			Requirement: "go vet passes",
			Commands:    []commandCheckSpec{{Name: "go-vet", Binary: "go", Args: []string{"vet", "./..."}}},
		},
		{
			ID:          "RS-11-42",
			Requirement: "daemon health state transitions on startup/shutdown",
			Tests:       []testRef{{Package: pkgDaemon, Name: "TestDaemonRunTransitionsStartupAndShutdownStates"}},
		},
		{
			ID:          "RS-11-43",
			Requirement: "stream close modes B/C/D",
			Tests: []testRef{
				{Package: pkgAI, Name: "TestScenarioJobStoreSubscribeBranches"},
				{Package: pkgAuditSvc, Name: "TestExportAuditEventsEofTrue"},
				{Package: pkgAuditSvc, Name: "TestSubscribeRuntimeHealthEventsReturnsCancelledOnStopping"},
			},
		},
		{
			ID:          "RS-11-44",
			Requirement: "auth service TTL bounds",
			Tests: []testRef{
				{Package: pkgAuthn, Name: "TestValidateAcceptsClockSkewWithinSixtySeconds"},
				{Package: pkgAuthn, Name: "TestValidateRejectsClockSkewBeyondSixtySeconds"},
				{Package: pkgAuth, Name: "TestOpenSessionRejectsTTLBounds"},
			},
		},
		{
			ID:          "RS-11-45",
			Requirement: "AppMode matrix and lite extension rejection",
			Tests: []testRef{
				{Package: pkgAppRegistry, Name: "TestValidateDomainAndScopesRejectsModeViolationsWithActionHint"},
				{Package: pkgAuth, Name: "TestRegisterAppRejectsLiteExtensionManifestAtServiceBoundary"},
			},
		},
		{
			ID:          "RS-11-46",
			Requirement: "media idempotency conflict maps to ALREADY_EXISTS",
			Tests:       []testRef{{Package: pkgGrpcErr, Name: "TestWithReasonCodeAlreadyExistsForMediaIdempotencyConflict"}},
		},
		{
			ID:          "RS-11-47",
			Requirement: "structured error completeness",
			Tests: []testRef{
				{Package: pkgGrpcErr, Name: "TestWithReasonCodeOptions_WritesActionHintAndRetryableMetadata"},
				{Package: pkgGrpcErr, Name: "TestWithReasonCodeOptions_EncodesStructuredFieldsInStatusMessage"},
				{Package: pkgNimillm, Name: "TestMapProviderHTTPError_BadRequestModelNotFound"},
			},
		},
		{
			ID:          "RS-11-48",
			Requirement: "key source subject_user_id requirement",
			Tests:       []testRef{{Package: pkgAI, Name: "TestPrepareScenarioRequestRequiresSubjectForTokenAPI"}},
		},
		{
			ID:          "RS-11-49",
			Requirement: "local model lifecycle state machine enumeration (K-LOCAL-005)",
			Tests:       []testRef{{Package: pkgLocalService, Name: "TestLocalModelLifecycleTransitionsMatchSpec"}},
		},
		{
			ID:          "RS-11-50",
			Requirement: "local service lifecycle state machine enumeration (K-LOCAL-005)",
			Tests:       []testRef{{Package: pkgLocalService, Name: "TestLocalServiceLifecycleTransitionsMatchSpec"}},
		},
		{
			ID:          "RS-11-51",
			Requirement: "connector status state machine (K-RPC-011)",
			Tests:       []testRef{{Package: pkgConnector, Name: "TestConnectorStatusTransitionsMatchSpec"}},
		},
		{
			ID:          "RS-11-52",
			Requirement: "connector delete flow state machine (K-RPC-011)",
			Tests:       []testRef{{Package: pkgConnector, Name: "TestConnectorDeleteFlowTransitionsMatchSpec"}},
		},
		{
			ID:          "RS-11-53",
			Requirement: "revoke session idempotency (K-AUTHSVC-005)",
			Tests:       []testRef{{Package: pkgAuth, Name: "TestRevokeSessionIdempotent"}},
		},
		{
			ID:          "RS-11-54",
			Requirement: "AI timeout defaults match spec (K-DAEMON-008)",
			Tests: []testRef{
				{Package: pkgAI, Name: "TestAITimeoutDefaultsMatchSpec"},
				{Package: pkgAI, Name: "TestMinStreamChunkBytesMatchesSpec"},
			},
		},
		{
			ID:          "RS-11-55",
			Requirement: "scenario job subscribe terminal then close (K-STREAM-005)",
			Tests:       []testRef{{Package: pkgAI, Name: "TestSubscribeJobEventsTerminalThenClose"}},
		},
		{
			ID:          "RS-11-56",
			Requirement: "audit retention policy enforcement (K-AUDIT-020)",
			Tests:       []testRef{{Package: pkgAuditLog, Name: "TestAuditRetentionPolicyEnforced"}},
		},
		{
			ID:          "RS-11-57",
			Requirement: "config defaults match spec schema (K-CFG-014/016/017)",
			Tests:       []testRef{{Package: pkgConfig, Name: "TestConfigDefaultsMatchSpec"}},
		},
		{
			ID:          "RS-11-58",
			Requirement: "reason code enum values match spec (K-RPC-011)",
			Tests:       []testRef{{Package: pkgGrpcErr, Name: "TestReasonCodeEnumValuesMatchSpec"}},
		},
		{
			ID:          "RS-11-59",
			Requirement: "AppService security baseline and optional fields (K-APP-002/K-APP-005)",
			Tests: []testRef{
				{Package: pkgApp, Name: "TestSendAppMessageOptionalFields"},
				{Package: pkgApp, Name: "TestSendAppMessageRejectsOversizedPayload"},
				{Package: pkgApp, Name: "TestSendAppMessageRateLimitEnforced"},
				{Package: pkgApp, Name: "TestSendAppMessageLoopDetected"},
				{Package: pkgApp, Name: "TestSendAppMessageRequiresRegisteredAppSession"},
			},
		},
		{
			ID:          "RS-11-60",
			Requirement: "ExportAuditEvents sequence from 0 (K-AUDIT-009)",
			Tests:       []testRef{{Package: pkgAuditSvc, Name: "TestExportAuditEventsSequenceStartsFromZero"}},
		},
		{
			ID:          "RS-11-61",
			Requirement: "ModelStatus state machine compliance (K-MODEL-008)",
			Tests: []testRef{
				{Package: pkgModel, Name: "TestPullModelTransitionsThroughPullingState"},
				{Package: pkgModel, Name: "TestModelStatusTransitionsMatchSpec"},
				{Package: pkgModel, Name: "TestRemoveModelRejectsIllegalSourceState"},
			},
		},
		{
			ID:          "RS-11-62",
			Requirement: "KnowledgeService reason-code alignment (K-KNOW-002/K-KNOW-003/K-KNOW-005)",
			Tests: []testRef{
				{Package: pkgKnowledge, Name: "TestBuildIndexExistingNoOverwriteReasonCode"},
				{Package: pkgKnowledge, Name: "TestSearchIndexNotFoundReturnsEmpty"},
			},
		},
		{
			ID:          "RS-11-63",
			Requirement: "streaming backpressure baseline (K-STREAM-011/K-STREAM-012/K-STREAM-013)",
			Tests: []testRef{
				{Package: pkgApp, Name: "TestSubscribeAppMessagesSlowConsumerClosed"},
				{Package: pkgAuditSvc, Name: "TestSubscribeRuntimeHealthEventsSlowConsumerClosed"},
				{Package: pkgAuditSvc, Name: "TestSubscribeAIProviderHealthEventsSlowConsumerClosed"},
				{Package: pkgStreamutil, Name: "TestStreamBackpressureCloses"},
				{Package: pkgWorkflow, Name: "TestSubscribeWorkflowEventsTerminalEventPriority"},
			},
		},
	}
}
