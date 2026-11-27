package grpcserver

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"log/slog"
	"net"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	localservice "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

type countingAuditBackend struct {
	inner   auditlog.Backend
	writeTx atomic.Int64
}

func (b *countingAuditBackend) DB() *sql.DB {
	return b.inner.DB()
}

func (b *countingAuditBackend) WriteTx(ctx context.Context, fn func(*sql.Tx) error) error {
	b.writeTx.Add(1)
	return b.inner.WriteTx(ctx, fn)
}

func openCountingDurableAuditStore(t *testing.T, maxEvents int, maxUsage int) (*countingAuditBackend, *auditlog.Store) {
	t.Helper()
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	rawBackend, err := runtimepersistence.Open(nil, statePath)
	if err != nil {
		t.Fatalf("open Runtime persistence: %v", err)
	}
	t.Cleanup(func() { _ = rawBackend.Close() })

	backend := &countingAuditBackend{inner: rawBackend}
	store, err := auditlog.Open(backend, nil, maxEvents, maxUsage)
	if err != nil {
		t.Fatalf("open durable audit store: %v", err)
	}
	// Reset counter after Open's startup retention reconciliation so assertions
	// measure interceptor traffic directly.
	backend.writeTx.Store(0)
	return backend, store
}

func countDurableAuditRows(t *testing.T, db *sql.DB) int {
	t.Helper()
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM runtime_audit_event`).Scan(&count); err != nil {
		t.Fatalf("count runtime_audit_event rows: %v", err)
	}
	return count
}

func TestLightweightReadAllowlistInvariantsAndFailClosedClassification(t *testing.T) {
	productControlRoot := filepath.Join(t.TempDir(), ".nimi")
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       filepath.Join(productControlRoot, "runtime", "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
	}
	server, err := newServer(cfg, health.NewState(), slog.New(slog.NewTextHandler(io.Discard, nil)), "test", nil, productControlRoot, localservice.ProductControlDataRootSecurityBinding{})
	if err != nil {
		t.Fatalf("construct server for service inventory verification: %v", err)
	}
	t.Cleanup(func() { _ = server.Stop(context.Background()) })

	registeredUnary := make(map[string]bool)
	registeredStream := make(map[string]bool)
	for serviceName, serviceInfo := range server.grpcServer.GetServiceInfo() {
		for _, method := range serviceInfo.Methods {
			fullMethod := "/" + serviceName + "/" + method.Name
			if method.IsClientStream || method.IsServerStream {
				registeredStream[fullMethod] = true
			} else {
				registeredUnary[fullMethod] = true
			}
		}
	}

	// Every allowlisted lightweight unary read must exist on g, must never be a
	// write or protected-capability method, and must fail closed to durable on error.
	for method := range lightweightAuditUnaryReadMethods {
		if !registeredUnary[method] {
			t.Errorf("allowlisted lightweight unary method %q is not a registered unary RPC on g", method)
		}
		if isWriteMethod(method) {
			t.Errorf("allowlisted lightweight unary method %q must not be a write method", method)
		}
		if _, required := protectedCapabilityForUnary(method, nil); required {
			t.Errorf("allowlisted lightweight unary method %q must not require a protected capability", method)
		}
		if classifyUnaryAuditMode(method, true) != auditRecordLightweightOnSuccess {
			t.Errorf("classifyUnaryAuditMode(%q, true) != lightweight", method)
		}
		if classifyUnaryAuditMode(method, false) != auditRecordDurable {
			t.Errorf("classifyUnaryAuditMode(%q, false) must stay durable for failure attribution", method)
		}
	}

	// Every allowlisted lightweight stream read must exist on g as a stream, must
	// never be a write or protected-capability method, and must fail closed on error.
	for method := range lightweightAuditStreamReadMethods {
		if !registeredStream[method] {
			t.Errorf("allowlisted lightweight stream method %q is not a registered stream RPC on g", method)
		}
		if isWriteMethod(method) {
			t.Errorf("allowlisted lightweight stream method %q must not be a write method", method)
		}
		if _, required := protectedCapabilityForStream(method, nil); required {
			t.Errorf("allowlisted lightweight stream method %q must not require a protected capability", method)
		}
		if classifyStreamAuditMode(method, true) != auditRecordLightweightOnSuccess {
			t.Errorf("classifyStreamAuditMode(%q, true) != lightweight", method)
		}
		if classifyStreamAuditMode(method, false) != auditRecordDurable {
			t.Errorf("classifyStreamAuditMode(%q, false) must stay durable for failure attribution", method)
		}
	}

	// Sensitive reads, auth/credential actions, billing/AI execution, business
	// mutations, and unclassified methods MUST stay durably audited even on success.
	mustStayDurableUnary := []string{
		// Private audit & usage/cloud history reads
		"/nimi.runtime.v1.RuntimeAuditService/ListAuditEvents",
		"/nimi.runtime.v1.RuntimeAuditService/ListDesktopAuditEvents",
		"/nimi.runtime.v1.RuntimeAuditService/ListUsageStats",
		"/nimi.runtime.v1.RuntimeAuditService/GetDesktopAIActivitySnapshot",
		"/nimi.runtime.v1.RuntimeAuditService/GetDesktopAIUsageSummary",
		"/nimi.runtime.v1.RuntimeAuditService/ListDesktopAICloudHistory",
		"/nimi.runtime.v1.RuntimeLocalService/ListLocalAudits",
		// Connector / credential / account-scoped catalog reads & writes
		"/nimi.runtime.v1.RuntimeConnectorService/GetConnector",
		"/nimi.runtime.v1.RuntimeConnectorService/ListConnectors",
		"/nimi.runtime.v1.RuntimeConnectorService/ListConnectorModels",
		"/nimi.runtime.v1.RuntimeConnectorService/ListModelCatalogProviders",
		"/nimi.runtime.v1.RuntimeConnectorService/ListCatalogProviderModels",
		"/nimi.runtime.v1.RuntimeConnectorService/GetCatalogModelDetail",
		"/nimi.runtime.v1.RuntimeConnectorService/CreateConnector",
		"/nimi.runtime.v1.RuntimeConnectorService/UpdateConnector",
		"/nimi.runtime.v1.RuntimeConnectorService/DeleteConnector",
		"/nimi.runtime.v1.RuntimeConnectorService/TestConnector",
		// Account / auth / session / token / remote-access / lifecycle security
		"/nimi.runtime.v1.RuntimeAccountService/GetAccountSessionStatus",
		"/nimi.runtime.v1.RuntimeAccountService/GetPrimaryRuntimeState",
		"/nimi.runtime.v1.RuntimeAccountService/BeginLogin",
		"/nimi.runtime.v1.RuntimeAccountService/Logout",
		"/nimi.runtime.v1.RuntimeAuthService/OpenDesktopSession",
		"/nimi.runtime.v1.RuntimeAuthService/OpenExternalPrincipalSession",
		"/nimi.runtime.v1.RuntimeAuthService/RegisterExternalPrincipal",
		"/nimi.runtime.v1.RuntimeAuthService/RevokeExternalPrincipalSession",
		"/nimi.runtime.v1.RuntimeExternalAgentService/GetExternalAgentGatewayStatus",
		"/nimi.runtime.v1.RuntimeExternalAgentService/ListExternalAgentTokens",
		"/nimi.runtime.v1.RuntimeRemoteAccessService/GetRemoteAccessState",
		"/nimi.runtime.v1.RuntimeRemoteAccessService/SetRemoteAccessEnabled",
		"/nimi.runtime.v1.RuntimeServiceControlService/GetRuntimeServiceState",
		"/nimi.runtime.v1.RuntimeServiceControlService/RequestRuntimeRestart",
		// App / Agent / AI execution / billing / config / mutations
		"/nimi.runtime.v1.RuntimeAppService/GetAppStorage",
		"/nimi.runtime.v1.RuntimeAppService/SendAppMessage",
		"/nimi.runtime.v1.RuntimeAgentService/GetAgentState",
		"/nimi.runtime.v1.RuntimeAgentService/ListDelegatedApprovalRequests",
		"/nimi.runtime.v1.RuntimeAgentService/ListDelegatedDiagnostics",
		"/nimi.runtime.v1.RuntimeAgentService/ListDelegatedProviderProfiles",
		"/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
		"/nimi.runtime.v1.RuntimeAiService/SubmitScenarioJob",
		"/nimi.runtime.v1.RuntimeAiService/GetAppAIConfig",
		"/nimi.runtime.v1.RuntimeAiService/OverwriteAppAIConfig",
		"/nimi.runtime.v1.RuntimeAiService/ListPresetVoices",
		"/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord",
		"/nimi.runtime.v1.RuntimeLocalService/GetProductControlSelectedDataRoot",
		"/nimi.runtime.v1.RuntimeLocalService/GetProductControlCheckSync",
		"/nimi.runtime.v1.RuntimeLocalService/ResolveLocalEnvironmentPlan",
		"/nimi.runtime.v1.RuntimeLocalService/ResolveModelInstallPlan",
		"/nimi.runtime.v1.RuntimeLocalService/InstallModelFromPlan",
		"/nimi.runtime.v1.RuntimeLocalService/CommitLoadout",
		"/nimi.runtime.v1.RuntimeLocalService/AppendInferenceAudit",
		"/nimi.runtime.v1.RuntimeLocalService/AppendRuntimeAudit",
		// Unclassified / unknown methods (fail-closed default)
		"",
		"/nimi.runtime.v1.RuntimeFutureService/ReadSomethingNew",
		"/nimi.runtime.v1.RuntimeLocalService/UnclassifiedRead",
	}
	for _, method := range mustStayDurableUnary {
		if classifyUnaryAuditMode(method, true) != auditRecordDurable {
			t.Errorf("unary method %q must stay durably audited on success", method)
		}
	}

	mustStayDurableStream := []string{
		"/nimi.runtime.v1.RuntimeAuditService/ExportAuditEvents",
		"/nimi.runtime.v1.RuntimeAuditService/SubscribeDesktopAIActivity",
		"/nimi.runtime.v1.RuntimeAiService/StreamScenario",
		"/nimi.runtime.v1.RuntimeAiService/SubscribeScenarioJobEvents",
		"/nimi.runtime.v1.RuntimeAiService/UploadArtifact",
		"/nimi.runtime.v1.RuntimeAccountService/SubscribeAccountSessionEvents",
		"/nimi.runtime.v1.RuntimeAppService/SubscribeAppMessages",
		"/nimi.runtime.v1.RuntimeLocalService/ImportSelectedModelFile",
		"",
		"/nimi.runtime.v1.RuntimeFutureService/WatchUnclassified",
	}
	for _, method := range mustStayDurableStream {
		if classifyStreamAuditMode(method, true) != auditRecordDurable {
			t.Errorf("stream method %q must stay durably audited on success", method)
		}
	}
}

func TestUnaryAuditInterceptorLightweightReadSkipsSQLiteAndAuditsFailures(t *testing.T) {
	backend, store := openCountingDurableAuditStore(t, 128, 128)
	interceptor := newUnaryAuditInterceptor(store)

	ordinaryReads := []struct {
		method string
		req    any
		resp   any
		calls  int
	}{
		{
			method: "/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth",
			req:    &runtimev1.GetRuntimeHealthRequest{},
			resp:   &runtimev1.GetRuntimeHealthResponse{Status: runtimev1.RuntimeHealthStatus_RUNTIME_HEALTH_STATUS_READY},
			calls:  4,
		},
		{
			method: "/grpc.health.v1.Health/Check",
			req:    &healthpb.HealthCheckRequest{},
			resp:   &healthpb.HealthCheckResponse{Status: healthpb.HealthCheckResponse_SERVING},
			calls:  3,
		},
		{
			method: "/nimi.runtime.v1.RuntimeAiService/ListScenarioProfiles",
			req:    &runtimev1.ListScenarioProfilesRequest{},
			resp:   &runtimev1.ListScenarioProfilesResponse{},
			calls:  2,
		},
		{
			method: "/nimi.runtime.v1.RuntimeLocalService/ListModelAssets",
			req:    &runtimev1.ListModelAssetsRequest{},
			resp:   &runtimev1.ListModelAssetsResponse{},
			calls:  1,
		},
	}

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-caller-kind", "desktop-core",
		"x-nimi-caller-id", "desktop.health-poller",
		"x-nimi-trace-id", "trace-lightweight-ok",
	))

	totalOrdinaryCalls := 0
	for _, tc := range ordinaryReads {
		for i := 0; i < tc.calls; i++ {
			totalOrdinaryCalls++
			resp, err := interceptor(ctx, tc.req, &grpc.UnaryServerInfo{FullMethod: tc.method}, func(context.Context, any) (any, error) {
				return tc.resp, nil
			})
			if err != nil || resp == nil {
				t.Fatalf("%s call %d failed: resp=%v err=%v", tc.method, i, resp, err)
			}
		}
	}

	// Zero durable SQLite transactions or rows written for ordinary successful reads.
	if got := backend.writeTx.Load(); got != 0 {
		t.Fatalf("ordinary successful reads triggered %d SQLite WriteTx calls, want 0", got)
	}
	if got := countDurableAuditRows(t, backend.DB()); got != 0 {
		t.Fatalf("durable SQLite audit rows = %d, want 0", got)
	}
	if events := mustListAuditEvents(t, store, &runtimev1.ListAuditEventsRequest{}); len(events.GetEvents()) != 0 {
		t.Fatalf("ListEvents returned %d durable rows, want 0", len(events.GetEvents()))
	}

	// Lightweight diagnostics must capture all aggregated counts accurately.
	diag := store.SnapshotLightweightReads()
	if diag.TotalCount != uint64(totalOrdinaryCalls) || len(diag.Summaries) != len(ordinaryReads) {
		t.Fatalf("lightweight diagnostics = total:%d buckets:%d, want total:%d buckets:%d",
			diag.TotalCount, len(diag.Summaries), totalOrdinaryCalls, len(ordinaryReads))
	}
	byMethod := make(map[string]auditlog.ReadDiagnosticSummary, len(diag.Summaries))
	for _, summary := range diag.Summaries {
		byMethod[summary.FullMethod] = summary
	}
	if healthSummary := byMethod["/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth"]; healthSummary.Count != 4 ||
		healthSummary.Domain != "runtime.audit" ||
		healthSummary.Operation != "get_runtime_health" ||
		healthSummary.AppID != "nimi.desktop" ||
		healthSummary.CallerKind != runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE ||
		healthSummary.LastTraceID != "trace-lightweight-ok" {
		t.Fatalf("unexpected GetRuntimeHealth lightweight summary: %+v", healthSummary)
	}

	// RecordUsage in-memory stats must remain preserved for lightweight reads.
	healthUsage := mustListUsageStats(t, store, &runtimev1.ListUsageStatsRequest{
		Capability: "runtime.audit.get_runtime_health",
	})
	if len(healthUsage.GetRecords()) != 1 || healthUsage.GetRecords()[0].GetRequestCount() != 4 || healthUsage.GetRecords()[0].GetSuccessCount() != 4 {
		t.Fatalf("RecordUsage not preserved for GetRuntimeHealth: %+v", healthUsage.GetRecords())
	}

	// A failure on the EXACT same ordinary read method MUST durably record fault attribution.
	failCtx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-caller-kind", "desktop-core",
		"x-nimi-caller-id", "desktop.health-poller",
		"x-nimi-trace-id", "trace-health-fail-001",
	))
	_, failErr := interceptor(
		failCtx,
		&runtimev1.GetRuntimeHealthRequest{},
		&grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth"},
		func(context.Context, any) (any, error) {
			return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
		},
	)
	if status.Code(failErr) != codes.Unavailable {
		t.Fatalf("expected Unavailable error, got %v", failErr)
	}
	if got := backend.writeTx.Load(); got != 1 {
		t.Fatalf("failed ordinary read WriteTx count = %d, want 1", got)
	}
	if got := countDurableAuditRows(t, backend.DB()); got != 1 {
		t.Fatalf("durable SQLite audit rows after failed read = %d, want 1", got)
	}
	events := mustListAuditEvents(t, store, &runtimev1.ListAuditEventsRequest{Domain: "runtime.audit"})
	if len(events.GetEvents()) != 1 {
		t.Fatalf("expected 1 durable failure audit event, got %d", len(events.GetEvents()))
	}
	failedEvent := events.GetEvents()[0]
	if failedEvent.GetOperation() != "get_runtime_health" ||
		failedEvent.GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE ||
		failedEvent.GetAppId() != "nimi.desktop" ||
		failedEvent.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE ||
		failedEvent.GetCallerId() != "desktop.health-poller" ||
		failedEvent.GetTraceId() != "trace-health-fail-001" ||
		failedEvent.GetPayload().GetFields()["success"].GetBoolValue() {
		t.Fatalf("unexpected failed ordinary read durable record: %+v", failedEvent)
	}
	if got := store.SnapshotLightweightReads().TotalCount; got != uint64(totalOrdinaryCalls) {
		t.Fatalf("failed read must not increment lightweight read total: got=%d want=%d", got, totalOrdinaryCalls)
	}
}

func TestStreamAuditInterceptorLightweightReadSkipsSQLiteAndAuditsFailures(t *testing.T) {
	backend, store := openCountingDurableAuditStore(t, 128, 128)
	interceptor := newStreamAuditInterceptor(store)

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-caller-kind", "desktop-core",
		"x-nimi-trace-id", "trace-health-stream-ok",
	))

	for _, method := range []string{
		"/grpc.health.v1.Health/Watch",
		"/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents",
		"/nimi.runtime.v1.RuntimeLocalService/WatchLocalTransfers",
	} {
		err := interceptor(nil, &recordingServerStream{ctx: ctx}, &grpc.StreamServerInfo{
			FullMethod:     method,
			IsServerStream: true,
		}, func(any, grpc.ServerStream) error {
			return nil
		})
		if err != nil {
			t.Fatalf("%s failed: %v", method, err)
		}
	}

	if got := backend.writeTx.Load(); got != 0 {
		t.Fatalf("lightweight read streams triggered %d SQLite WriteTx calls, want 0", got)
	}
	if got := countDurableAuditRows(t, backend.DB()); got != 0 {
		t.Fatalf("durable SQLite audit rows = %d, want 0", got)
	}
	diag := store.SnapshotLightweightReads()
	if diag.TotalCount != 3 || len(diag.Summaries) != 3 {
		t.Fatalf("lightweight stream diagnostics = total:%d buckets:%d, want total:3 buckets:3", diag.TotalCount, len(diag.Summaries))
	}
	usage := mustListUsageStats(t, store, &runtimev1.ListUsageStatsRequest{
		Capability: "runtime.audit.subscribe_runtime_health_events",
	})
	if len(usage.GetRecords()) != 1 || usage.GetRecords()[0].GetSuccessCount() != 1 {
		t.Fatalf("RecordUsage not preserved for SubscribeRuntimeHealthEvents: %+v", usage.GetRecords())
	}

	// Failure on the same lightweight read stream MUST persist a durable audit row.
	failCtx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-caller-kind", "desktop-core",
		"x-nimi-trace-id", "trace-health-stream-fail",
	))
	err := interceptor(nil, &recordingServerStream{ctx: failCtx}, &grpc.StreamServerInfo{
		FullMethod:     "/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents",
		IsServerStream: true,
	}, func(any, grpc.ServerStream) error {
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED)
	})
	if status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("expected ResourceExhausted, got %v", err)
	}
	if got := backend.writeTx.Load(); got != 1 || countDurableAuditRows(t, backend.DB()) != 1 {
		t.Fatalf("failed stream read WriteTx=%d rows=%d, want 1/1", got, countDurableAuditRows(t, backend.DB()))
	}
	events := mustListAuditEvents(t, store, &runtimev1.ListAuditEventsRequest{Domain: "runtime.audit"})
	if len(events.GetEvents()) != 1 ||
		events.GetEvents()[0].GetOperation() != "subscribe_runtime_health_events" ||
		events.GetEvents()[0].GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED ||
		events.GetEvents()[0].GetTraceId() != "trace-health-stream-fail" {
		t.Fatalf("unexpected failed stream audit record: %+v", events.GetEvents())
	}
}

func TestAuditInterceptorPreservesDurableTrailForSensitiveReadsAndMutations(t *testing.T) {
	backend, store := openCountingDurableAuditStore(t, 128, 128)
	unary := newUnaryAuditInterceptor(store)
	stream := newStreamAuditInterceptor(store)

	baseCtx := authn.WithIdentity(
		metadata.NewIncomingContext(context.Background(), metadata.Pairs(
			"x-nimi-app-id", "nimi.desktop",
			"x-nimi-app-instance-id", "instance-01",
			"x-nimi-caller-kind", "third-party-app",
			"x-nimi-caller-id", "app:auditor",
			"x-nimi-surface-id", "security-settings",
			"x-nimi-access-token-id", "tok-sec-01",
			"x-nimi-trace-id", "trace-durable-001",
		)),
		&authn.Identity{SubjectUserID: "user-jwt-42"},
	)

	// 1. Sensitive private audit read
	if _, err := unary(
		baseCtx,
		&runtimev1.ListAuditEventsRequest{AppId: "nimi.desktop"},
		&grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeAuditService/ListAuditEvents"},
		func(context.Context, any) (any, error) { return &runtimev1.ListAuditEventsResponse{}, nil },
	); err != nil {
		t.Fatalf("ListAuditEvents: %v", err)
	}

	// 2. Sensitive connector/credential read
	if _, err := unary(
		baseCtx,
		&runtimev1.GetConnectorRequest{ConnectorId: "conn-1"},
		&grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeConnectorService/GetConnector"},
		func(context.Context, any) (any, error) { return &runtimev1.GetConnectorResponse{}, nil },
	); err != nil {
		t.Fatalf("GetConnector: %v", err)
	}

	// 3. Auth / session action
	if _, err := unary(
		baseCtx,
		&runtimev1.OpenExternalPrincipalSessionRequest{AppId: "nimi.desktop"},
		&grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeAuthService/OpenExternalPrincipalSession"},
		func(context.Context, any) (any, error) {
			return &runtimev1.OpenExternalPrincipalSessionResponse{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
		},
	); err != nil {
		t.Fatalf("OpenExternalPrincipalSession: %v", err)
	}

	// 4. Billing / AI execution action
	if _, err := unary(
		baseCtx,
		scenarioExecuteTextRequest("nimi.desktop", "body-user-ignored", "cloud/gpt-4o"),
		&grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeAiService/ExecuteScenario"},
		func(context.Context, any) (any, error) {
			return &runtimev1.ExecuteScenarioResponse{
				ModelResolved: "gpt-4o",
				Usage:         &runtimev1.UsageStats{InputTokens: 20, OutputTokens: 10, ComputeMs: 45},
			}, nil
		},
	); err != nil {
		t.Fatalf("ExecuteScenario: %v", err)
	}

	// 5. Business / credential mutation
	if _, err := unary(
		baseCtx,
		&runtimev1.CreateConnectorRequest{Provider: "openai"},
		&grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeConnectorService/CreateConnector"},
		func(context.Context, any) (any, error) { return &runtimev1.CreateConnectorResponse{}, nil },
	); err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}

	// 6. Sensitive stream export
	if err := stream(
		nil,
		&recordingServerStream{ctx: baseCtx},
		&grpc.StreamServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeAuditService/ExportAuditEvents", IsServerStream: true},
		func(any, grpc.ServerStream) error { return nil },
	); err != nil {
		t.Fatalf("ExportAuditEvents: %v", err)
	}

	// 7. Unclassified method (fail-closed default MUST stay durably audited)
	if _, err := unary(
		baseCtx,
		struct{}{},
		&grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeFutureService/ReadUnclassified"},
		func(context.Context, any) (any, error) { return struct{}{}, nil },
	); err != nil {
		t.Fatalf("unclassified method: %v", err)
	}

	const wantDurable = 7
	if got := backend.writeTx.Load(); got != wantDurable {
		t.Fatalf("durable WriteTx count = %d, want %d", got, wantDurable)
	}
	if got := countDurableAuditRows(t, backend.DB()); got != wantDurable {
		t.Fatalf("durable SQLite audit rows = %d, want %d", got, wantDurable)
	}
	if got := store.SnapshotLightweightReads().TotalCount; got != 0 {
		t.Fatalf("sensitive/mutating/unclassified calls leaked into lightweight diagnostics: %d", got)
	}

	allEvents := mustListAuditEvents(t, store, &runtimev1.ListAuditEventsRequest{PageSize: 50})
	if len(allEvents.GetEvents()) != wantDurable {
		t.Fatalf("ListEvents count = %d, want %d", len(allEvents.GetEvents()), wantDurable)
	}
	byMethod := make(map[string]*runtimev1.AuditEventRecord, wantDurable)
	for _, ev := range allEvents.GetEvents() {
		method := ev.GetPayload().GetFields()["grpc_method"].GetStringValue()
		byMethod[method] = ev
		if ev.GetAppId() != "nimi.desktop" ||
			ev.GetSubjectUserId() != "user-jwt-42" ||
			ev.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP ||
			ev.GetCallerId() != "app:auditor" ||
			ev.GetSurfaceId() != "security-settings" ||
			ev.GetTokenId() != "tok-sec-01" ||
			ev.GetTraceId() != "trace-durable-001" ||
			ev.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
			t.Fatalf("incomplete attribution on durable record for %q: %+v", method, ev)
		}
	}
	aiEvent := byMethod["/nimi.runtime.v1.RuntimeAiService/ExecuteScenario"]
	if aiEvent == nil || !aiEvent.GetPayload().GetFields()["ai_execution"].GetBoolValue() ||
		aiEvent.GetPayload().GetFields()["model_id"].GetStringValue() != "gpt-4o" {
		t.Fatalf("ExecuteScenario missing AI execution durable payload: %+v", aiEvent)
	}
	for _, expectedMethod := range []string{
		"/nimi.runtime.v1.RuntimeAuditService/ListAuditEvents",
		"/nimi.runtime.v1.RuntimeConnectorService/GetConnector",
		"/nimi.runtime.v1.RuntimeAuthService/OpenExternalPrincipalSession",
		"/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
		"/nimi.runtime.v1.RuntimeConnectorService/CreateConnector",
		"/nimi.runtime.v1.RuntimeAuditService/ExportAuditEvents",
		"/nimi.runtime.v1.RuntimeFutureService/ReadUnclassified",
	} {
		if byMethod[expectedMethod] == nil {
			t.Fatalf("missing durable SQLite audit record for %q", expectedMethod)
		}
	}
}

func TestAuditInterceptorRealPublicGRPCChainLightweightReadVsSensitiveRead(t *testing.T) {
	productControlRoot := filepath.Join(t.TempDir(), ".nimi")
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       filepath.Join(productControlRoot, "runtime", "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
	}
	state := health.NewState()
	state.SetStatus(health.StatusReady, "ready")
	server, err := newServer(cfg, state, slog.New(slog.NewTextHandler(io.Discard, nil)), "test", nil, productControlRoot, localservice.ProductControlDataRootSecurityBinding{})
	if err != nil {
		t.Fatalf("newServer: %v", err)
	}
	server.SyncServingState()

	listener := bufconn.Listen(1024 * 1024)
	serveDone := make(chan error, 1)
	go func() { serveDone <- server.grpcServer.Serve(listener) }()
	t.Cleanup(func() {
		_ = server.Stop(context.Background())
		_ = listener.Close()
		<-serveDone
	})

	conn, err := grpc.NewClient(
		"passthrough:///d7-audit-chain-test",
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial bufconn: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	envelopeCtx := metadata.NewOutgoingContext(context.Background(), metadata.Pairs(
		"x-nimi-protocol-version", "1.0.0",
		"x-nimi-participant-protocol-version", "1.0.0",
		"x-nimi-participant-id", "test-client",
		"x-nimi-domain", "runtime.rpc",
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-caller-kind", "desktop-core",
		"x-nimi-caller-id", "desktop.test",
	))

	healthClient := healthpb.NewHealthClient(conn)
	for i := 0; i < 5; i++ {
		resp, err := healthClient.Check(envelopeCtx, &healthpb.HealthCheckRequest{})
		if err != nil || resp.GetStatus() != healthpb.HealthCheckResponse_SERVING {
			t.Fatalf("Health.Check[%d] = %v err=%v", i, resp, err)
		}
	}
	aiClient := runtimev1.NewRuntimeAiServiceClient(conn)
	for i := 0; i < 3; i++ {
		resp, err := aiClient.ListScenarioProfiles(envelopeCtx, &runtimev1.ListScenarioProfilesRequest{})
		if err != nil || len(resp.GetProfiles()) == 0 {
			t.Fatalf("ListScenarioProfiles[%d] = %v err=%v", i, resp, err)
		}
	}

	if got := countDurableAuditRows(t, server.persistenceBackend.DB()); got != 0 {
		t.Fatalf("ordinary reads over real gRPC server wrote %d durable audit rows, want 0", got)
	}
	if snap := server.AuditStore().SnapshotLightweightReads(); snap.TotalCount != 8 {
		t.Fatalf("real gRPC lightweight read total = %d, want 8", snap.TotalCount)
	}

	// Sensitive read over the exact same real gRPC server MUST persist durably.
	auditClient := runtimev1.NewRuntimeAuditServiceClient(conn)
	if _, err := auditClient.ListAuditEvents(envelopeCtx, &runtimev1.ListAuditEventsRequest{AppId: "nimi.desktop"}); err != nil {
		t.Fatalf("ListAuditEvents over real gRPC server: %v", err)
	}
	if got := countDurableAuditRows(t, server.persistenceBackend.DB()); got != 1 {
		t.Fatalf("sensitive ListAuditEvents over real gRPC server wrote %d durable rows, want 1", got)
	}
	events := mustListAuditEvents(t, server.AuditStore(), &runtimev1.ListAuditEventsRequest{Domain: "runtime.audit"})
	if len(events.GetEvents()) != 1 || events.GetEvents()[0].GetOperation() != "list_audit_events" {
		t.Fatalf("unexpected durable event from real gRPC ListAuditEvents: %+v", events.GetEvents())
	}
}

func TestAuditInterceptorConcurrentLightweightReadsAndDurableWrites(t *testing.T) {
	backend, store := openCountingDurableAuditStore(t, 512, 1024)
	unary := newUnaryAuditInterceptor(store)
	stream := newStreamAuditInterceptor(store)

	const (
		ordinaryWorkers      = 8
		ordinaryReadsEach    = 25
		ordinaryFailuresEach = 2
		sensitiveWorkers     = 4
		sensitiveReadsEach   = 10
		mutationWorkers      = 4
		mutationsEach        = 10
	)

	stopObservers := make(chan struct{})
	var observerWG sync.WaitGroup
	for o := 0; o < 2; o++ {
		observerWG.Add(1)
		go func() {
			defer observerWG.Done()
			for {
				select {
				case <-stopObservers:
					return
				default:
					_ = store.SnapshotLightweightReads()
					_, _ = store.ListEvents(&runtimev1.ListAuditEventsRequest{PageSize: 20})
					_, _ = store.ListUsage(&runtimev1.ListUsageStatsRequest{PageSize: 20})
				}
			}
		}()
	}

	var wg sync.WaitGroup
	// Concurrent ordinary non-sensitive reads (successes + occasional failures).
	for w := 0; w < ordinaryWorkers; w++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
				"x-nimi-app-id", fmt.Sprintf("app-read-%d", worker%3),
				"x-nimi-caller-kind", "desktop-core",
				"x-nimi-trace-id", fmt.Sprintf("trace-ord-%d", worker),
			))
			for i := 0; i < ordinaryReadsEach; i++ {
				if i%5 == 0 {
					if err := stream(
						nil,
						&recordingServerStream{ctx: ctx},
						&grpc.StreamServerInfo{FullMethod: "/grpc.health.v1.Health/Watch", IsServerStream: true},
						func(any, grpc.ServerStream) error { return nil },
					); err != nil {
						t.Errorf("ordinary stream read failed: %v", err)
					}
					continue
				}
				method := "/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth"
				if i%2 == 1 {
					method = "/nimi.runtime.v1.RuntimeLocalService/ListModelAssets"
				}
				if _, err := unary(ctx, struct{}{}, &grpc.UnaryServerInfo{FullMethod: method}, func(context.Context, any) (any, error) {
					return struct{}{}, nil
				}); err != nil {
					t.Errorf("ordinary unary read %s failed: %v", method, err)
				}
			}
			for f := 0; f < ordinaryFailuresEach; f++ {
				_, _ = unary(
					ctx,
					&runtimev1.GetRuntimeHealthRequest{},
					&grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth"},
					func(context.Context, any) (any, error) {
						return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
					},
				)
			}
		}(w)
	}

	// Concurrent sensitive reads.
	for w := 0; w < sensitiveWorkers; w++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
				"x-nimi-app-id", "nimi.desktop",
				"x-nimi-caller-kind", "desktop-core",
				"x-nimi-trace-id", fmt.Sprintf("trace-sens-%d", worker),
			))
			for i := 0; i < sensitiveReadsEach; i++ {
				method := "/nimi.runtime.v1.RuntimeAuditService/ListAuditEvents"
				if i%2 == 1 {
					method = "/nimi.runtime.v1.RuntimeConnectorService/GetConnector"
				}
				if _, err := unary(ctx, struct{}{}, &grpc.UnaryServerInfo{FullMethod: method}, func(context.Context, any) (any, error) {
					return struct{}{}, nil
				}); err != nil {
					t.Errorf("sensitive read %s failed: %v", method, err)
				}
			}
		}(w)
	}

	// Concurrent mutations / AI executions.
	for w := 0; w < mutationWorkers; w++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
				"x-nimi-app-id", "nimi.desktop",
				"x-nimi-caller-kind", "third-party-app",
				"x-nimi-caller-id", fmt.Sprintf("app:writer-%d", worker),
				"x-nimi-trace-id", fmt.Sprintf("trace-mut-%d", worker),
			))
			for i := 0; i < mutationsEach; i++ {
				if i%2 == 0 {
					req := scenarioExecuteTextRequest("nimi.desktop", "user-concurrent", "local/qwen2.5")
					if _, err := unary(ctx, req, &grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeAiService/ExecuteScenario"}, func(context.Context, any) (any, error) {
						return &runtimev1.ExecuteScenarioResponse{ModelResolved: "qwen2.5"}, nil
					}); err != nil {
						t.Errorf("ExecuteScenario failed: %v", err)
					}
				} else {
					if _, err := unary(ctx, &runtimev1.CreateConnectorRequest{Provider: "openai"}, &grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeConnectorService/CreateConnector"}, func(context.Context, any) (any, error) {
						return &runtimev1.CreateConnectorResponse{}, nil
					}); err != nil {
						t.Errorf("CreateConnector failed: %v", err)
					}
				}
			}
		}(w)
	}

	wg.Wait()
	close(stopObservers)
	observerWG.Wait()

	wantLightweight := uint64(ordinaryWorkers * ordinaryReadsEach)
	wantDurable := int64(ordinaryWorkers*ordinaryFailuresEach + sensitiveWorkers*sensitiveReadsEach + mutationWorkers*mutationsEach)

	diag := store.SnapshotLightweightReads()
	if diag.TotalCount != wantLightweight {
		t.Fatalf("concurrent lightweight read total = %d, want %d", diag.TotalCount, wantLightweight)
	}
	if got := backend.writeTx.Load(); got != wantDurable {
		t.Fatalf("concurrent durable WriteTx count = %d, want %d", got, wantDurable)
	}
	if got := int64(countDurableAuditRows(t, backend.DB())); got != wantDurable {
		t.Fatalf("concurrent durable SQLite audit rows = %d, want %d", got, wantDurable)
	}
}
