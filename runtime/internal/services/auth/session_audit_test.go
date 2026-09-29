package auth

import (
	"bytes"
	"context"
	"crypto/rand"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
)

type sessionAuditHarness struct {
	backend *runtimepersistence.Backend
	store   *auditlog.Store
}

func newSessionAuditHarness(t *testing.T) sessionAuditHarness {
	t.Helper()
	backend, err := runtimepersistence.Open(nil, filepath.Join(t.TempDir(), "local-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = backend.Close() })
	store, err := auditlog.Open(backend, nil, 100, 10)
	if err != nil {
		t.Fatal(err)
	}
	return sessionAuditHarness{backend: backend, store: store}
}

// block makes audit inserts fail so the session owner's ordering is observed.
func (h sessionAuditHarness) block(t *testing.T) func() {
	t.Helper()
	if _, err := h.backend.DB().Exec(`CREATE TRIGGER test_block_audit BEFORE INSERT ON runtime_audit_event BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	return func() {
		if _, err := h.backend.DB().Exec(`DROP TRIGGER test_block_audit`); err != nil {
			t.Fatal(err)
		}
	}
}

func (h sessionAuditHarness) records(t *testing.T, operation string) (successes []*runtimev1.AuditEventRecord, refusals []*runtimev1.AuditEventRecord) {
	t.Helper()
	response, err := h.store.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: "runtime.auth", PageSize: 200})
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range response.GetEvents() {
		if event.GetOperation() != operation {
			continue
		}
		encoded, _ := protojson.Marshal(event)
		if strings.Contains(strings.ToLower(string(encoded)), "proof") {
			t.Fatalf("session audit record carries proof material: %s", encoded)
		}
		if event.GetReasonCode() == runtimev1.ReasonCode_ACTION_EXECUTED {
			successes = append(successes, event)
		} else {
			refusals = append(refusals, event)
		}
	}
	return successes, refusals
}

func requireSessionAuditCounts(t *testing.T, h sessionAuditHarness, operation string, successes int, refusals int) {
	t.Helper()
	gotSuccesses, gotRefusals := h.records(t, operation)
	if len(gotSuccesses) != successes || len(gotRefusals) != refusals {
		t.Fatalf("%s audit = %d successes/%d refusals, want %d/%d", operation, len(gotSuccesses), len(gotRefusals), successes, refusals)
	}
}

func TestOpenDesktopSessionRecordsOneResultAndFailsClosedWhenUnrecordable(t *testing.T) {
	fixture := newDesktopSessionFixture(t)
	harness := newSessionAuditHarness(t)
	service := NewWithDependencies(slog.New(slog.NewTextHandler(io.Discard, nil)), harness.store, 60, 86400, WithDesktopSessionManager(fixture.manager))
	callContext := protectedlocal.ContextWithDesktopConnection(context.Background(), fixture.connection)

	unblock := harness.block(t)
	_, err := service.OpenDesktopSession(callContext, &runtimev1.OpenDesktopSessionRequest{})
	assertDesktopSessionReason(t, err, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE)
	if metadata, _ := grpcerr.ExtractReasonMetadata(err); metadata["audit_disposition"] != "unrecorded" {
		t.Fatalf("unrecordable open metadata = %v", metadata)
	}
	if err := fixture.manager.AuthorizeContext(callContext, protectedlocal.RoleVerifiedDesktopProcess); err == nil {
		t.Fatal("unrecorded Desktop session remained authoritative")
	}
	unblock()
	requireSessionAuditCounts(t, harness, "OpenDesktopSession", 0, 0)

	response, err := service.OpenDesktopSession(callContext, &runtimev1.OpenDesktopSessionRequest{})
	if err != nil {
		t.Fatalf("open after audit recovered: %v", err)
	}
	successes, _ := harness.records(t, "OpenDesktopSession")
	if len(successes) != 1 {
		t.Fatalf("Desktop session successes = %d", len(successes))
	}
	record := successes[0]
	if record.GetAppId() != "nimi.desktop" || record.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE ||
		!strings.HasPrefix(record.GetPayload().GetFields()["session_ref"].GetStringValue(), "dsr_") {
		t.Fatalf("Desktop session record = %v", record)
	}
	encoded, _ := protojson.Marshal(record)
	if bytes.Contains(encoded, response.GetDesktopSessionId()) || strings.Contains(string(encoded), string(response.GetDesktopSessionId())) {
		t.Fatal("Desktop session record carries the raw session identifier")
	}

	if _, err := service.OpenDesktopSession(callContext, &runtimev1.OpenDesktopSessionRequest{}); err == nil {
		t.Fatal("duplicate Desktop session opened")
	}
	requireSessionAuditCounts(t, harness, "OpenDesktopSession", 1, 1)
	_, refusals := harness.records(t, "OpenDesktopSession")
	if refusals[0].GetReasonCode() != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("duplicate open refusal = %v", refusals[0])
	}
}

type sessionAuditAccountSecurity struct{}

func (sessionAuditAccountSecurity) AuthenticatedRuntimeSecurityContext(context.Context) (*runtimev1.AccountProjection, uint64, bool) {
	return nil, 0, false
}

// sessionAuditOpener binds a real technical session on the connection, as the
// App owner does, and projects only the audit attribution.
type sessionAuditOpener struct {
	fail error
}

func (opener *sessionAuditOpener) bind(ctx context.Context) (LocalAppSessionProjection, error) {
	if opener.fail != nil {
		return LocalAppSessionProjection{}, opener.fail
	}
	connection, _ := protectedlocal.LocalAppConnectionFromContext(ctx)
	if previous, bound := connection.Session(); bound {
		connection.InvalidateSession(previous)
	}
	handle, err := protectedlocal.NewLocalAppSessionHandle(rand.Reader)
	if err != nil {
		return LocalAppSessionProjection{}, err
	}
	if _, bound := connection.Session(); !bound {
		if err := connection.BindSession(handle); err != nil {
			return LocalAppSessionProjection{}, err
		}
	}
	return LocalAppSessionProjection{AppID: "app.session.audit", AccountID: "account-1"}, nil
}

func (opener *sessionAuditOpener) OpenLocalAppSessionProjection(ctx context.Context) (LocalAppSessionProjection, error) {
	return opener.bind(ctx)
}
func (opener *sessionAuditOpener) RenewLocalAppSessionProjection(ctx context.Context) (LocalAppSessionProjection, error) {
	if opener.fail != nil {
		return LocalAppSessionProjection{}, opener.fail
	}
	return LocalAppSessionProjection{AppID: "app.session.audit", AccountID: "account-1"}, nil
}
func (opener *sessionAuditOpener) RebindLocalAppSessionProjection(ctx context.Context) (LocalAppSessionProjection, error) {
	return opener.bind(ctx)
}

func TestLocalAppSessionMethodsRecordOneResultAndFailClosedWhenUnrecordable(t *testing.T) {
	harness := newSessionAuditHarness(t)
	opener := &sessionAuditOpener{}
	service := NewWithDependencies(slog.New(slog.NewTextHandler(io.Discard, nil)), harness.store, 60, 86400)
	service.SetRuntimeAccountSecurityContextProvider(sessionAuditAccountSecurity{})
	service.SetLocalAppSessionOpener(opener)
	ownerDone := make(chan struct{})
	t.Cleanup(func() { close(ownerDone) })
	connection, err := protectedlocal.EstablishInstalledAppConnection(
		"lar_v1_session_audit", protectedlocal.LocalAppTrustVerified,
		localAppSessionAuthTestIdentifier(0x41), localAppSessionAuthTestIdentifier(0x42),
		protectedlocal.ProcessTuple{
			OS: protectedlocal.OSWindows, PID: 5150, CreationMarker: "session-audit-start", OSLoginSession: "interactive-login",
			SecurityPrincipal: "interactive-user", CanonicalExecutableIdentity: "session-audit-app",
			ExecutableDigest: localAppSessionAuthTestIdentifier(0x43), ExecutableTrustSetID: "session-audit-release",
		},
		ownerDone,
	)
	if err != nil {
		t.Fatal(err)
	}
	ctx := protectedlocal.ContextWithLocalAppConnection(context.Background(), connection)

	if _, err := service.OpenLocalAppSession(ctx, &runtimev1.OpenLocalAppSessionRequest{}); err != nil {
		t.Fatalf("open local-app session: %v", err)
	}
	successes, _ := harness.records(t, "OpenLocalAppSession")
	if len(successes) != 1 || successes[0].GetAppId() != "app.session.audit" || successes[0].GetSubjectUserId() != "account-1" ||
		successes[0].GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP ||
		!strings.HasPrefix(successes[0].GetPayload().GetFields()["session_ref"].GetStringValue(), "lsr_") {
		t.Fatalf("local-app open records = %v", successes)
	}

	if _, err := service.RenewLocalAppSession(ctx, &runtimev1.RenewLocalAppSessionRequest{}); err != nil {
		t.Fatalf("renew local-app session: %v", err)
	}
	requireSessionAuditCounts(t, harness, "RenewLocalAppSession", 1, 0)

	// An unrecordable renewal invalidates the live session instead of
	// extending it unaudited.
	handle, _ := connection.Session()
	invalidated, _ := connection.SessionInvalidated(handle)
	unblock := harness.block(t)
	_, err = service.RenewLocalAppSession(ctx, &runtimev1.RenewLocalAppSessionRequest{})
	if localAppSessionTestReason(err) != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("unrecordable renew = %v", err)
	}
	select {
	case <-invalidated:
	default:
		t.Fatal("unrecorded renewal left the session live")
	}
	unblock()
	requireSessionAuditCounts(t, harness, "RenewLocalAppSession", 1, 0)

	if _, err := service.RebindLocalAppSession(ctx, &runtimev1.RebindLocalAppSessionRequest{}); err != nil {
		t.Fatalf("rebind local-app session: %v", err)
	}
	requireSessionAuditCounts(t, harness, "RebindLocalAppSession", 1, 0)

	opener.fail = grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	if _, err := service.RebindLocalAppSession(ctx, &runtimev1.RebindLocalAppSessionRequest{}); localAppSessionTestReason(err) != runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED {
		t.Fatalf("refused rebind = %v", err)
	}
	requireSessionAuditCounts(t, harness, "RebindLocalAppSession", 1, 1)
	requireSessionAuditCounts(t, harness, "OpenLocalAppSession", 1, 0)
}
