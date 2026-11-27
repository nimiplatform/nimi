package grpcserver

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"github.com/nimiplatform/nimi/runtime/internal/services/agentsession"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestProductionNamedBriefWiringResolutionAmbiguityReregisterAndRevocation(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	dbPath, err := localappkernel.CanonicalRegistrationDatabasePath(root)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := localappkernel.ValidateVerifiedMacOSInteractiveUser(501, 42)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(ctx, dbPath, identity, localappkernel.Options{
		HostInstallID: "host-named-brief",
		DataRoot:      root,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = kernel.Close() })

	svc, err := buildProductionAgentSessionService(
		config.Config{LocalStatePath: filepath.Join(t.TempDir(), "state.json")},
		nil, nil, nil, nil, kernel,
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })

	zhiyuApp := smokeLocalAppAppService{
		appID:          "nimi.zhiyu",
		accountID:      "acct-prod-1",
		subject:        "ras_v1_zhiyu",
		allowedDomains: map[localappop.Domain]bool{"agent.local": true, "agent.companion": true},
	}
	zhiyuRouteCtx, err := zhiyuApp.AuthorizeLocalAppIngress(ctx, localappop.IngressAgentSessionRouteSubmit)
	if err != nil {
		t.Fatal(err)
	}

	// 1. No Harness registered -> named brief MUST fail closed.
	if _, err := svc.RouteAndSubmitInput(zhiyuRouteCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:      "agent-xiaoman",
		RequestId:        "prod-req-absent",
		Text:             "整理文档",
		HandoffBriefText: "目标：整理机密文档",
		EntrySurface:     "zhiyu_handoff",
		TrustTierHint:    "trusted",
	}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition when nimi.harness absent, got %v", err)
	}

	// 2. Register original Harness with agent.body.pc -> handoff binds to its exact RegisteredAppSubject.
	origHarness, err := kernel.Registrations().RegisterInstalled(ctx, localappkernel.RegisterInstalledInput{
		AppID:                agentsession.NamedHarnessAppID,
		DisplayName:          "Nimi Harness",
		SourceRef:            "package:harness-orig",
		SourceClass:          localappkernel.SourceClassUserImported,
		ProjectRoot:          "/installed/harness-1",
		ManifestPath:         "/installed/harness-1/nimi.app.yaml",
		RawDeclaration:       []string{agentsession.DomainAgentBodyPC, agentsession.DomainAgentSessionManage, agentsession.DomainAgentLocal},
		ImmutableLineageID:   "lineage:harness-1",
		ProvenanceRevision:   1,
		ExecutionProfileRef:  "exec:harness-1",
		HostExecutableDigest: "host:harness-1",
		PayloadRootDigest:    "payload:harness-1",
	})
	if err != nil {
		t.Fatal(err)
	}

	handoffResp, err := svc.RouteAndSubmitInput(zhiyuRouteCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:      "agent-xiaoman",
		RequestId:        "prod-req-bound",
		Text:             "整理文档",
		HandoffBriefText: "目标：整理春季机密简报",
		EntrySurface:     "zhiyu_handoff",
		TrustTierHint:    "trusted",
	})
	if err != nil {
		t.Fatalf("named brief submission with unique active Harness failed: %v", err)
	}
	if handoffResp.GetOutcome() != runtimev1.RouteAndSubmitOutcome_ROUTE_AND_SUBMIT_OUTCOME_DEFERRED_BODY_OFFLINE {
		t.Fatalf("expected DEFERRED_BODY_OFFLINE before Harness registers carrier, got %v", handoffResp.GetOutcome())
	}

	// 3. Register a SECOND active nimi.harness (ambiguity) -> new handoff MUST fail closed!
	secondHarness, err := kernel.Registrations().RegisterDevelopment(ctx, localappkernel.RegisterDevelopmentInput{
		AppID:                agentsession.NamedHarnessAppID,
		DisplayName:          "Nimi Harness Dev",
		SourceRef:            "project:harness-dev",
		ProjectRoot:          "/dev/harness-2",
		ManifestPath:         "/dev/harness-2/nimi.app.yaml",
		ShellKind:            1,
		RawDeclaration:       []string{agentsession.DomainAgentBodyPC, agentsession.DomainAgentSessionManage, agentsession.DomainAgentLocal},
		HostExecutableDigest: "host:harness-dev",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RouteAndSubmitInput(zhiyuRouteCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:      "agent-xiaoman",
		RequestId:        "prod-req-ambig",
		Text:             "第二份文档",
		HandoffBriefText: "目标：第二份简报",
		EntrySurface:     "zhiyu_handoff",
		TrustTierHint:    "trusted",
	}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition when two active nimi.harness registrations exist, got %v", err)
	}

	// 4. Tombstone (revoke) the original Harness!
	//    - Re-registered/second Harness (same app_id, different subject) MUST NOT receive the original brief.
	//    - Tombstoned original Harness subject MUST ALSO NOT receive the original brief!
	if err := kernel.Registrations().Tombstone(ctx, origHarness.RegistrationHandle); err != nil {
		t.Fatal(err)
	}

	secondApp := smokeLocalAppAppService{
		appID:          agentsession.NamedHarnessAppID,
		accountID:      "acct-prod-1",
		subject:        secondHarness.RegisteredAppSubject,
		allowedDomains: map[localappop.Domain]bool{"agent.body.pc": true, "agent.session.manage": true, "agent.local": true},
	}
	secondRegCtx, err := secondApp.AuthorizeLocalAppIngress(ctx, localappop.IngressAgentBodyPCRegister)
	if err != nil {
		t.Fatal(err)
	}
	secondReg, err := svc.RegisterBodyCarrier(secondRegCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-prod-1",
		CapabilityNamespace: agentsession.DefaultPCNamespace,
		InstanceId:          "second-inst",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(secondReg.GetPendingIntents()) != 0 {
		t.Fatalf("second/re-registered nimi.harness subject received tombstoned original Harness brief: %+v", secondReg.GetPendingIntents())
	}
	secondUnregCtx, _ := secondApp.AuthorizeLocalAppIngress(ctx, localappop.IngressAgentBodyPCUnregister)
	_, _ = svc.UnregisterBodyCarrier(secondUnregCtx, &runtimev1.UnregisterBodyCarrierRequest{
		DeviceId:            "dev-prod-1",
		CapabilityNamespace: agentsession.DefaultPCNamespace,
		LeaseEpoch:          secondReg.GetLeaseEpoch(),
	})

	origApp := smokeLocalAppAppService{
		appID:          agentsession.NamedHarnessAppID,
		accountID:      "acct-prod-1",
		subject:        origHarness.RegisteredAppSubject,
		allowedDomains: map[localappop.Domain]bool{"agent.body.pc": true, "agent.session.manage": true, "agent.local": true},
	}
	origRegCtx, err := origApp.AuthorizeLocalAppIngress(ctx, localappop.IngressAgentBodyPCRegister)
	if err != nil {
		t.Fatal(err)
	}
	origReg, err := svc.RegisterBodyCarrier(origRegCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-prod-1",
		CapabilityNamespace: agentsession.DefaultPCNamespace,
		InstanceId:          "orig-inst",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(origReg.GetPendingIntents()) != 0 {
		t.Fatalf("tombstoned original Harness still received queued brief: %+v", origReg.GetPendingIntents())
	}
}

func TestProductionUpgradeFencesLegacyCognitionOutboxAndPendingReceiptsForRestrictedHandoff(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	localStatePath := filepath.Join(dataDir, "local-state.json")
	sessionsDBPath := filepath.Join(dataDir, "sessions.db")

	// 1. Seed a disposable pre-migration sessions.db with a legacy Zhiyu handoff
	//    session (content_restricted=0 before migration) AND an ordinary session.
	legacyStore, err := agentsession.OpenStore(sessionsDBPath)
	if err != nil {
		t.Fatalf("open legacy sessions.db: %v", err)
	}
	if err := legacyStore.Close(); err != nil {
		t.Fatalf("close initialized legacy sessions.db: %v", err)
	}
	legacyDB, err := sql.Open("sqlite", sessionsDBPath)
	if err != nil {
		t.Fatalf("open raw legacy sessions.db: %v", err)
	}
	nowStr := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := legacyDB.ExecContext(ctx, `
		INSERT INTO runtime_session(
			work_session_ref, account_id, agent_binding, session_kind, owner_body_kind,
			device_id, publisher_scope_key, title, status, trust_tier, permission_mode,
			latest_receipt_json, topic_summary, last_active_at, created_at, updated_at,
			handoff_sender_subject, handoff_recipient_subject, handoff_recipient_app_id, content_restricted
		) VALUES (
			'ws_upgrade_restricted', 'acct-up-1', 'agent-upgrade-1', 'pc_work', 'os.pc.workspace',
			'local-default', 'subject:subj-zhiyu', '旧私密简报', 'queued_body_offline', 'trusted', 'plan-readonly',
			'{}', '旧私密摘要', ?, ?, ?, '', '', '', 0
		), (
			'ws_upgrade_ordinary', 'acct-up-1', 'agent-upgrade-1', 'pc_work', 'os.pc.workspace',
			'local-default', 'subject:subj-other', '常规公开任务', 'active', 'trusted', 'full',
			'{}', '常规公开任务摘要', ?, ?, ?, '', '', '', 0
		)`, nowStr, nowStr, nowStr, nowStr, nowStr, nowStr); err != nil {
		t.Fatalf("seed legacy sessions: %v", err)
	}
	if _, err := legacyDB.ExecContext(ctx, `
		INSERT INTO runtime_body_outbox(
			outbox_id, account_id, device_id, capability_namespace, work_session_ref,
			agent_binding, command_kind, payload_json, payload_hash, state, created_at,
			recipient_subject, recipient_app_id, recipient_required
		) VALUES (
			'ob_upgrade_legacy_1', 'acct-up-1', 'local-default', 'os.pc.workspace', 'ws_upgrade_restricted',
			'agent-upgrade-1', 1, '{"entrySurface":"zhiyu_handoff","handoffBriefText":"玉露机密口令"}', 'h1', 'pending', ?, '', '', 0
		)`, nowStr); err != nil {
		t.Fatalf("seed legacy body outbox: %v", err)
	}
	// Reset migration marker to simulate pre-upgrade database on disk.
	if _, err := legacyDB.ExecContext(ctx, `DELETE FROM runtime_session_meta WHERE key = 'named_handoff_isolation_v1'`); err != nil {
		t.Fatalf("reset migration marker: %v", err)
	}
	if err := legacyDB.Close(); err != nil {
		t.Fatalf("close raw legacy sessions.db: %v", err)
	}

	// 2. Seed pre-migration runtime_cognition_memory_outbox AND an already-received
	//    unremembered Cognition receipt for the legacy restricted session, plus a
	//    pending ordinary session pointer right behind it.
	backend, err := runtimepersistence.Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("open backend: %v", err)
	}
	t.Cleanup(func() { _ = backend.Close() })
	memStore := cognitionmemory.NewStore(backend)
	const agentRef = "agent-upgrade-1"
	var binding cognitionmemory.Binding
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		var createErr error
		binding, createErr = memStore.CreateAgentBindingTx(tx, agentRef, "cmsub_upgrade_1", true)
		return createErr
	}); err != nil {
		t.Fatalf("create binding: %v", err)
	}
	core, err := memoryv1.Open(filepath.Join(dataDir, "cognition-memory"))
	if err != nil {
		t.Fatalf("open memoryv1: %v", err)
	}
	t.Cleanup(func() { _ = core.Close() })
	authorize := func(context.Context, cognitionmemory.Binding) error { return nil }
	ownerPort := cognitionmemory.NewOwnerAdapter(core, memStore.BindingForOwner, nil)
	bridge := cognitionmemory.NewBridge(memStore, ownerPort, authorize)
	facade := cognitionmemory.NewFacade(memStore, ownerPort, bridge, authorize, func(context.Context, cognitionmemory.Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		return memoryv1.CapabilitySnapshot{ConfigRevision: 1, Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil, nil
	})
	if err := bridge.EnsureBinding(ctx, agentRef); err != nil {
		t.Fatalf("EnsureBinding: %v", err)
	}

	baseTime := time.Date(2026, 11, 25, 12, 0, 0, 0, time.UTC)
	enqueue := func(deliveryID, sessionRef, summary string, offset time.Duration) string {
		opID := "cmop_" + deliveryID
		env := &runtimev1.CognitionMemoryCommittedEventEnvelope{
			Event:       &runtimev1.CognitionMemoryEventRef{Value: "cmevt_" + deliveryID},
			Operation:   &runtimev1.CognitionMemoryOperationRef{Value: opID},
			Subjects:    []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: binding.AccountSubjectRef}},
			Sources:     []*runtimev1.CognitionMemorySourceRef{{Kind: "session", Value: sessionRef}},
			CommittedAt: timestamppb.New(baseTime.Add(offset)),
			Fact: &runtimev1.CognitionMemoryCommittedEventEnvelope_SessionPointerCommitted{
				SessionPointerCommitted: &runtimev1.CognitionMemorySessionPointerCommitted{
					WorkSessionRef: sessionRef,
					ScopeTag:       memoryv1.ScopeTagSessionPointer,
					SlotKey:        "session_ref:" + sessionRef,
					TopicSummary:   summary,
					BodyKind:       "os.pc.workspace",
				},
			},
		}
		if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
			_, err := memStore.EnqueueCommittedEventTx(tx, agentRef, env)
			return err
		}); err != nil {
			t.Fatalf("enqueue %s: %v", deliveryID, err)
		}
		return opID
	}

	// Row 1: already drained into memory_receipts BEFORE upgrade (not yet remembered).
	inFlightReceiptOp := enqueue("up-restricted-received", "ws_upgrade_restricted", "玉露机密口令-已收未记", 1*time.Minute)
	if drained, err := bridge.DrainOne(ctx, agentRef); err != nil || !drained.Drained || drained.OperationID != inFlightReceiptOp {
		t.Fatalf("pre-upgrade DrainOne receipt seed failed: %+v err=%v", drained, err)
	}
	// Row 2: a damaged pending payload must not prevent either the session
	// fence or the ordered Cognition recovery from running.
	damagedOp := enqueue("up-damaged", "ws_upgrade_ordinary", "待损坏的普通会话", 2*time.Minute)
	if _, err := backend.DB().ExecContext(ctx, "UPDATE runtime_cognition_memory_outbox SET payload=? WHERE operation_id=?", []byte{0xff}, damagedOp); err != nil {
		t.Fatalf("damage committed payload: %v", err)
	}
	// Row 3: still pending in runtime_cognition_memory_outbox BEFORE upgrade.
	pendingRestrictedOp := enqueue("up-restricted-pending", "ws_upgrade_restricted", "玉露机密口令-待投队列", 3*time.Minute)
	// Row 4: ordinary pending pointer behind it.
	pendingOrdinaryOp := enqueue("up-ordinary-pending", "ws_upgrade_ordinary", "公开升级验证普通会话", 4*time.Minute)

	// 3. Open upgraded production AgentSession service with memoryFacade wired
	//    (runs migrateNamedHandoffIsolation + installs SessionRestrictionChecker +
	//    fences legacy pending outbox & unremembered receipts BEFORE replay!).
	svc, err := openProductionAgentSessionService(
		config.Config{LocalStatePath: localStatePath},
		nil, nil, nil, facade, nil,
	)
	if err != nil {
		t.Fatalf("openProductionAgentSessionService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })

	// 4. Replay outbox and resume pending receipts -> private content MUST NOT enter Memory!
	if err := bridge.ReplayStartup(ctx); err != nil {
		t.Fatalf("ReplayStartup after upgrade: %v", err)
	}
	if _, err := facade.ProcessRemember(ctx, agentRef, pendingOrdinaryOp); err != nil {
		t.Fatalf("ProcessRemember ordinary: %v", err)
	}
	if _, err := facade.ResumePending(ctx, agentRef); err != nil {
		t.Fatalf("ResumePending after upgrade: %v", err)
	}

	// Verify pending restricted outbox row was neutralized to cutoff_non_effecting with payload=NULL.
	var state string
	var payloadPresent bool
	if err := backend.DB().QueryRowContext(ctx, `SELECT state, payload IS NOT NULL FROM runtime_cognition_memory_outbox WHERE operation_id = ?`, pendingRestrictedOp).Scan(&state, &payloadPresent); err != nil {
		t.Fatalf("query neutralized outbox row: %v", err)
	}
	if state != "cutoff_non_effecting" || payloadPresent {
		t.Fatalf("pending restricted outbox row not neutralized: state=%q payloadPresent=%v", state, payloadPresent)
	}
	var outcome string
	if err := backend.DB().QueryRowContext(ctx, "SELECT state, outcome, payload IS NOT NULL FROM runtime_cognition_memory_outbox WHERE operation_id=?", damagedOp).Scan(&state, &outcome, &payloadPresent); err != nil {
		t.Fatalf("query settled damaged outbox row: %v", err)
	}
	if state != "terminated" || outcome != "rejected" || payloadPresent {
		t.Fatalf("damaged outbox was not rejected by ordered recovery: state=%q outcome=%q payloadPresent=%v", state, outcome, payloadPresent)
	}

	// Verify Cognition Memory contains ONLY the ordinary session pointer and ZERO private text!
	proj, err := facade.Inspect(ctx, cognitionmemory.InspectIntent{LocalAgentRef: agentRef, Limit: 50})
	if err != nil {
		t.Fatalf("Inspect: %v", err)
	}
	if proj.CurrentCount != 1 || len(proj.Items) != 1 || proj.Items[0].SlotKey != "session_ref:ws_upgrade_ordinary" {
		t.Fatalf("expected only ordinary session in Memory, got current=%d items=%+v", proj.CurrentCount, proj.Items)
	}
	secretRecall, err := facade.Recall(ctx, cognitionmemory.RecallIntent{
		NoModelWork:   true,
		LocalAgentRef: agentRef,
		Query:         "玉露机密口令",
		Limit:         10,
		ScopeTags:     []string{memoryv1.ScopeTagSessionPointer},
	})
	if err != nil || len(secretRecall.Hits) != 0 {
		t.Fatalf("legacy private brief entered FTS5 recall index after upgrade: %+v err=%v", secretRecall.Hits, err)
	}
	ordinaryRecall, err := facade.Recall(ctx, cognitionmemory.RecallIntent{
		NoModelWork:   true,
		LocalAgentRef: agentRef,
		Query:         "公开升级验证普通会话",
		Limit:         10,
		ScopeTags:     []string{memoryv1.ScopeTagSessionPointer},
	})
	if err != nil || len(ordinaryRecall.Hits) != 1 || ordinaryRecall.Hits[0].SlotKey != "session_ref:ws_upgrade_ordinary" {
		t.Fatalf("ordinary pointer missing from recall after upgrade: %+v err=%v", ordinaryRecall.Hits, err)
	}
}
