package account

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"google.golang.org/protobuf/encoding/protojson"
)

func listAccountAuditEvents(t *testing.T, store *auditlog.Store) []*runtimev1.AuditEventRecord {
	t.Helper()
	resp, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: "runtime.account"})
	if err != nil {
		t.Fatalf("list account audit events: %v", err)
	}
	return resp.GetEvents()
}

func findAccountAuditEvent(events []*runtimev1.AuditEventRecord, operation string) *runtimev1.AuditEventRecord {
	for _, event := range events {
		if event.GetOperation() == operation {
			return event
		}
	}
	return nil
}

func TestAccountLoginEmitsOwnerAttributedAuditEvents(t *testing.T) {
	store := auditlog.New(128, 128)
	svc := newHarnessService(t, nil, WithAuditStore(store))

	completeLogin(t, svc)

	events := listAccountAuditEvents(t, store)
	begin := findAccountAuditEvent(events, "account.login.begin")
	if begin == nil {
		t.Fatalf("missing account.login.begin audit event: %+v", events)
	}
	if begin.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("begin reason_code: %v", begin.GetReasonCode())
	}
	payloadKeys := make([]string, 0, len(begin.GetPayload().GetFields()))
	for key := range begin.GetPayload().GetFields() {
		payloadKeys = append(payloadKeys, key)
	}
	if len(payloadKeys) != 1 || payloadKeys[0] != "login_attempt_id" {
		t.Fatalf("begin payload must carry only the login attempt correlation id, got %v", payloadKeys)
	}

	complete := findAccountAuditEvent(events, "account.login.complete")
	if complete == nil {
		t.Fatalf("missing account.login.complete audit event: %+v", events)
	}
	if complete.GetSubjectUserId() != "acct-1" {
		t.Fatalf("complete subject: got=%q want=%q", complete.GetSubjectUserId(), "acct-1")
	}
	if complete.GetPayload() != nil && len(complete.GetPayload().GetFields()) != 0 {
		t.Fatalf("complete payload must be empty, got %v", complete.GetPayload().GetFields())
	}
}

func TestAccountLogoutEmitsOwnerAttributedAuditEvent(t *testing.T) {
	store := auditlog.New(128, 128)
	svc := newHarnessService(t, nil, WithAuditStore(store))

	completeLogin(t, svc)
	logout, err := svc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: desktopAccountControlCaller()})
	if err != nil || !logout.GetAccepted() {
		t.Fatalf("Logout: %+v err=%v", logout, err)
	}

	event := findAccountAuditEvent(listAccountAuditEvents(t, store), "account.logout")
	if event == nil {
		t.Fatal("missing account.logout audit event")
	}
	if event.GetSubjectUserId() != "acct-1" {
		t.Fatalf("logout subject: got=%q want=%q", event.GetSubjectUserId(), "acct-1")
	}
	if event.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("logout reason_code: %v", event.GetReasonCode())
	}
}

func TestAccountSwitchEmitsOwnerAttributedAuditEvent(t *testing.T) {
	store := auditlog.New(128, 128)
	svc := newHarnessService(t, nil, WithAuditStore(store))

	completeLogin(t, svc)
	switched, err := svc.SwitchAccount(context.Background(), &runtimev1.SwitchAccountRequest{Caller: desktopAccountControlCaller()})
	if err != nil || !switched.GetAccepted() {
		t.Fatalf("SwitchAccount: %+v err=%v", switched, err)
	}

	event := findAccountAuditEvent(listAccountAuditEvents(t, store), "account.switch")
	if event == nil {
		t.Fatal("missing account.switch audit event")
	}
	if event.GetSubjectUserId() != "acct-1" {
		t.Fatalf("switch subject: got=%q want=%q", event.GetSubjectUserId(), "acct-1")
	}
	if event.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("switch reason_code: %v", event.GetReasonCode())
	}
}

func TestAccountDeletedRefreshCleanupEmitsAuditEvent(t *testing.T) {
	material := testMaterial("account-deleted-audit", "access-old", "refresh-old")
	custody := &refreshRestartProofCustody{material: material, has: true}
	observed, err := NewObservedRealmAccountDeletedResult(
		material.AccountID,
		"delete_operation_audit",
		time.Now().UTC().Truncate(time.Millisecond),
		RealmAccountDeletedReason,
	)
	if err != nil {
		t.Fatal(err)
	}
	store := auditlog.New(128, 128)
	service := New(nil,
		WithProductionActivation(),
		WithCustody(custody),
		WithCustodyPartition("account-deleted-audit"),
		WithRefresher(staticRefresher{err: newRealmAccountDeletedRefreshFailure(observed)}),
		WithAuditStore(store),
	)
	service.SetRealmAccountDeletedObserver(realmAccountDeletedObserverFunc(func(context.Context, ObservedRealmAccountDeletedResult) error {
		return nil
	}))
	result, refreshErr := service.refreshAccountSessionInternal(context.Background(), true)
	if refreshErr != nil || result.accepted || result.accountReasonCode != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_DELETED || custody.has {
		t.Fatalf("Account-deleted refresh result=(%+v,%v) custody=%+v", result, refreshErr, custody)
	}

	event := findAccountAuditEvent(listAccountAuditEvents(t, store), "account.realm_account_deleted")
	if event == nil {
		t.Fatal("missing account.realm_account_deleted audit event")
	}
	if event.GetSubjectUserId() != material.AccountID {
		t.Fatalf("deleted subject: got=%q want=%q", event.GetSubjectUserId(), material.AccountID)
	}
	if got := event.GetPayload().GetFields()["operation_id"].GetStringValue(); got != "delete_operation_audit" {
		t.Fatalf("deleted payload operation_id: got=%q", got)
	}
}

func TestAccountDeletedReplayCleanupEmitsAuditEvent(t *testing.T) {
	material := testMaterial("account-deleted-replay", "access-old", "refresh-old")
	observed, err := NewObservedRealmAccountDeletedResult(
		material.AccountID,
		"delete_operation_replay",
		time.Now().UTC().Truncate(time.Millisecond),
		RealmAccountDeletedReason,
	)
	if err != nil {
		t.Fatal(err)
	}
	pending := observed
	material.pendingRealmDeletion = &pending
	custody := &refreshRestartProofCustody{material: material, has: true}
	store := auditlog.New(128, 128)
	service := New(nil,
		WithProductionActivation(),
		WithCustody(custody),
		WithCustodyPartition("account-deleted-replay"),
		WithAuditStore(store),
	)
	service.SetRealmAccountDeletedObserver(realmAccountDeletedObserverFunc(func(context.Context, ObservedRealmAccountDeletedResult) error {
		return nil
	}))
	if custody.has {
		t.Fatal("pending Realm Account deletion replay did not clear custody")
	}

	event := findAccountAuditEvent(listAccountAuditEvents(t, store), "account.realm_account_deleted")
	if event == nil {
		t.Fatal("missing account.realm_account_deleted audit event after replay")
	}
	if event.GetSubjectUserId() != material.AccountID {
		t.Fatalf("replay subject: got=%q want=%q", event.GetSubjectUserId(), material.AccountID)
	}
	if got := event.GetPayload().GetFields()["operation_id"].GetStringValue(); got != "delete_operation_replay" {
		t.Fatalf("replay payload operation_id: got=%q", got)
	}
}

func TestAccountLoginProofRejectionEmitsAuditEvent(t *testing.T) {
	store := auditlog.New(128, 128)
	svc := newHarnessService(t, nil, WithAuditStore(store))

	begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: desktopAccountControlCaller()})
	if err != nil || !begin.GetAccepted() {
		t.Fatalf("BeginLogin: %+v err=%v", begin, err)
	}
	rejected, err := svc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         desktopAccountControlCaller(),
		LoginAttemptId: begin.GetLoginAttemptId(),
		Code:           "proof-rejection-code",
		State:          "wrong-state",
		Nonce:          begin.GetNonce(),
	})
	if err != nil || rejected.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_MISMATCHED {
		t.Fatalf("CompleteLogin proof rejection: %+v err=%v", rejected, err)
	}

	event := findAccountAuditEvent(listAccountAuditEvents(t, store), "account.login.rejected")
	if event == nil {
		t.Fatal("missing account.login.rejected audit event")
	}
	if event.GetReasonCode() != runtimev1.ReasonCode_AUTH_TOKEN_INVALID {
		t.Fatalf("proof_rejected reason_code: %v", event.GetReasonCode())
	}
	if got := event.GetPayload().GetFields()["login_attempt_id"].GetStringValue(); got != begin.GetLoginAttemptId() {
		t.Fatalf("proof_rejected payload login_attempt_id: got=%q want=%q", got, begin.GetLoginAttemptId())
	}
}

func TestAccountRefreshSuccessEmitsAuditEvent(t *testing.T) {
	store := auditlog.New(128, 128)
	svc := newHarnessService(t, nil,
		WithAuditStore(store),
		WithRefresher(staticRefresher{material: testMaterial("acct-1", "refresh-audit-access", "refresh-audit-refresh")}),
	)

	completeLogin(t, svc)
	result, err := svc.refreshAccountSessionInternal(context.Background(), true)
	if err != nil || !result.accepted {
		t.Fatalf("refreshAccountSessionInternal: %+v err=%v", result, err)
	}

	event := findAccountAuditEvent(listAccountAuditEvents(t, store), "account.refresh.complete")
	if event == nil {
		t.Fatal("missing account.refresh.complete audit event")
	}
	if event.GetSubjectUserId() != "acct-1" {
		t.Fatalf("refresh subject: got=%q want=%q", event.GetSubjectUserId(), "acct-1")
	}
	if event.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("refresh reason_code: %v", event.GetReasonCode())
	}
	if event.GetPayload() != nil && len(event.GetPayload().GetFields()) != 0 {
		t.Fatalf("refresh payload must be empty, got %v", event.GetPayload().GetFields())
	}
}

func TestAccountOperationsWithoutAuditStoreDoNotFail(t *testing.T) {
	svc := newHarnessService(t, nil)

	completeLogin(t, svc)
	logout, err := svc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: desktopAccountControlCaller()})
	if err != nil || !logout.GetAccepted() {
		t.Fatalf("Logout without audit store: %+v err=%v", logout, err)
	}
}

func TestCompleteLoginRejectionFamilyProducesOneSafeAudit(t *testing.T) {
	const secret = "sensitive-fixture-material"
	cases := []struct {
		name    string
		reason  runtimev1.AccountReasonCode
		prepare func(*testing.T, *Service, *memoryCustody, *runtimev1.CompleteLoginRequest)
	}{
		{"unknown attempt", runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_MISMATCHED, func(_ *testing.T, _ *Service, _ *memoryCustody, r *runtimev1.CompleteLoginRequest) {
			r.LoginAttemptId = secret
		}},
		{"missing code", runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_MISMATCHED, func(_ *testing.T, _ *Service, _ *memoryCustody, r *runtimev1.CompleteLoginRequest) { r.Code = "" }},
		{"state", runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_MISMATCHED, func(_ *testing.T, _ *Service, _ *memoryCustody, r *runtimev1.CompleteLoginRequest) { r.State = secret }},
		{"nonce", runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_MISMATCHED, func(_ *testing.T, _ *Service, _ *memoryCustody, r *runtimev1.CompleteLoginRequest) { r.Nonce = secret }},
		{"consumed", runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_CONSUMED, func(t *testing.T, s *Service, _ *memoryCustody, r *runtimev1.CompleteLoginRequest) {
			result, err := s.CompleteLogin(context.Background(), r)
			if err != nil || !result.GetAccepted() {
				t.Fatalf("initial completion: %+v %v", result, err)
			}
		}},
		{"expired", runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_EXPIRED, func(_ *testing.T, s *Service, _ *memoryCustody, r *runtimev1.CompleteLoginRequest) {
			s.mu.Lock()
			defer s.mu.Unlock()
			attempt := s.loginAttempts[r.LoginAttemptId]
			attempt.attempt.ExpiresAt = time.Now().Add(-time.Minute)
			s.loginAttempts[r.LoginAttemptId] = attempt
		}},
		{"sealed ticket", runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_UNSUPPORTED, func(_ *testing.T, _ *Service, _ *memoryCustody, r *runtimev1.CompleteLoginRequest) {
			r.SealedCompletionTicket = secret
		}},
		{"refresh injection", runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_UNSUPPORTED, func(_ *testing.T, _ *Service, _ *memoryCustody, r *runtimev1.CompleteLoginRequest) {
			r.RefreshToken = secret
		}},
		{"exchange", runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE, func(_ *testing.T, s *Service, _ *memoryCustody, _ *runtimev1.CompleteLoginRequest) {
			s.exchanger = staticExchanger{err: errors.New(secret)}
		}},
		{"incomplete material", runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE, func(_ *testing.T, s *Service, _ *memoryCustody, _ *runtimev1.CompleteLoginRequest) {
			s.exchanger = staticExchanger{}
		}},
		{"custody", runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE, func(_ *testing.T, _ *Service, c *memoryCustody, _ *runtimev1.CompleteLoginRequest) {
			c.err = errors.New(secret)
		}},
		{"identity", runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, func(_ *testing.T, s *Service, _ *memoryCustody, _ *runtimev1.CompleteLoginRequest) {
			material := testMaterial("acct-1", secret, secret)
			material.RealmEnvironmentID = ""
			s.exchanger = staticExchanger{material: material}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := auditlog.New(128, 128)
			custody := &memoryCustody{}
			s := newHarnessService(t, custody, WithAuditStore(store))
			begin, err := s.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: desktopAccountControlCaller()})
			if err != nil || !begin.GetAccepted() {
				t.Fatalf("begin: %+v %v", begin, err)
			}
			request := &runtimev1.CompleteLoginRequest{Caller: desktopAccountControlCaller(), LoginAttemptId: begin.GetLoginAttemptId(), Code: secret, State: begin.GetState(), Nonce: begin.GetNonce()}
			tc.prepare(t, s, custody, request)
			before := len(listAccountAuditEvents(t, store))
			result, err := s.CompleteLogin(context.Background(), request)
			if err != nil || result.GetAccepted() || result.GetAccountReasonCode() != tc.reason {
				t.Fatalf("rejection: %+v %v", result, err)
			}
			events := listAccountAuditEvents(t, store)
			if len(events) != before+1 {
				t.Fatalf("expected one audit: before=%d after=%d", before, len(events))
			}
			event := findAccountAuditEvent(events, "account.login.rejected")
			if event == nil || event.GetReasonCode() != result.GetReasonCode() {
				t.Fatalf("missing matching rejection: %+v", event)
			}
			fields := event.GetPayload().GetFields()
			if fields["account_reason_code"].GetStringValue() != tc.reason.String() {
				t.Fatalf("account reason lost: %v", fields)
			}
			for key, value := range fields {
				if key == "account_reason_code" {
					continue
				}
				if key != "login_attempt_id" || value.GetStringValue() != begin.GetLoginAttemptId() {
					t.Fatalf("unexpected payload: %v", fields)
				}
			}
			raw, err := protojson.Marshal(event)
			if err != nil {
				t.Fatal(err)
			}
			for _, excluded := range []string{secret, begin.GetState(), begin.GetNonce(), begin.GetPkceChallenge()} {
				if excluded != "" && strings.Contains(string(raw), excluded) {
					t.Fatalf("audit contains private request or proof data")
				}
			}
		})
	}
}

func TestAccountControlDenialsAreAudited(t *testing.T) {
	store := auditlog.New(128, 128)
	s := newHarnessService(t, nil, WithAuditStore(store))
	calls := []struct {
		operation string
		call      func()
	}{
		{"account.login.begin_rejected", func() { _, _ = s.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{}) }},
		{"account.login.rejected", func() { _, _ = s.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{}) }},
		{"account.logout.rejected", func() { _, _ = s.Logout(context.Background(), &runtimev1.LogoutRequest{}) }},
		{"account.switch.rejected", func() { _, _ = s.SwitchAccount(context.Background(), &runtimev1.SwitchAccountRequest{}) }},
	}
	for _, call := range calls {
		before := len(listAccountAuditEvents(t, store))
		call.call()
		events := listAccountAuditEvents(t, store)
		if len(events) != before+1 || findAccountAuditEvent(events, call.operation) == nil {
			t.Fatalf("missing or duplicate %s rejection", call.operation)
		}
	}
}

func TestAccountMutationFailuresAreAuditedOnce(t *testing.T) {
	for _, operation := range []string{"account.logout.rejected", "account.switch.rejected", "account.refresh.failed"} {
		t.Run(operation, func(t *testing.T) {
			store := auditlog.New(128, 128)
			custody := &memoryCustody{}
			s := newHarnessService(t, custody, WithAuditStore(store), WithRefresher(staticRefresher{err: errors.New("private-refresh-error")}))
			completeLogin(t, s)
			before := len(listAccountAuditEvents(t, store))
			switch operation {
			case "account.logout.rejected":
				custody.err = ErrCustodyUnavailable
				_, _ = s.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: desktopAccountControlCaller()})
			case "account.switch.rejected":
				custody.err = ErrCustodyUnavailable
				_, _ = s.SwitchAccount(context.Background(), &runtimev1.SwitchAccountRequest{Caller: desktopAccountControlCaller()})
			case "account.refresh.failed":
				result, err := s.refreshAccountSessionInternal(context.Background(), true)
				if err != nil || result.accepted {
					t.Fatalf("refresh failure not observed: %+v %v", result, err)
				}
			}
			events := listAccountAuditEvents(t, store)
			event := findAccountAuditEvent(events, operation)
			if len(events) != before+1 || event == nil || event.GetSubjectUserId() != "acct-1" {
				t.Fatalf("missing or duplicate owner audit: %+v", event)
			}
			if event.GetReasonCode() == runtimev1.ReasonCode_ACTION_EXECUTED {
				t.Fatal("failure reported as success")
			}
		})
	}
}

// Pausing trace extraction verifies that a later account mutation cannot
// overtake the current operation's audit.
type pausedAuditContext struct {
	context.Context
	reached chan struct{}
	release chan struct{}
	once    sync.Once
}

func (ctx *pausedAuditContext) Value(key any) any {
	if typ := reflect.TypeOf(key); typ != nil && typ.PkgPath() == "google.golang.org/grpc/metadata" {
		ctx.once.Do(func() {
			close(ctx.reached)
			<-ctx.release
		})
	}
	return ctx.Context.Value(key)
}

func TestRejectedAuditPrecedesNextAccountMutation(t *testing.T) {
	store := auditlog.New(128, 128)
	s := newHarnessService(t, nil, WithAuditStore(store), WithRefresher(staticRefresher{
		err: newRefreshFailure(refreshFailureTokenInvalid, errors.New("invalid token")),
	}))
	stopAccountRefreshTimer(t, s)
	completeLogin(t, s)
	ctx := &pausedAuditContext{Context: context.Background(), reached: make(chan struct{}), release: make(chan struct{})}
	refreshDone := make(chan *refreshAccountSessionResult, 1)
	go func() {
		result, _ := s.refreshAccountSessionInternal(ctx, true)
		refreshDone <- result
	}()
	select {
	case <-ctx.reached:
	case <-time.After(2 * time.Second):
		t.Fatal("refresh did not reach audit")
	}
	beginDone := make(chan *runtimev1.BeginLoginResponse, 1)
	go func() {
		result, _ := s.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: desktopAccountControlCaller()})
		beginDone <- result
	}()
	var begin *runtimev1.BeginLoginResponse
	select {
	case begin = <-beginDone:
	case <-time.After(100 * time.Millisecond):
	}
	close(ctx.release)
	refresh := <-refreshDone
	if begin == nil {
		begin = <-beginDone
	}
	if refresh.accepted || !begin.GetAccepted() {
		t.Fatalf("unexpected results: refresh=%+v begin=%+v", refresh, begin)
	}
	events := listAccountAuditEvents(t, store)
	failed := findAccountAuditEvent(events, "account.refresh.failed")
	started := findAccountAuditEvent(events, "account.login.begin")
	if failed == nil || started == nil {
		t.Fatalf("missing expected audits")
	}
	if !failed.GetTimestamp().AsTime().Before(started.GetTimestamp().AsTime()) {
		t.Fatalf("audit chronology reversed: refresh failure=%s, replacement login begin=%s", failed.GetTimestamp().AsTime(), started.GetTimestamp().AsTime())
	}
}

func TestExpiredSwitchRejectionKeepsKnownAuditSubject(t *testing.T) {
	store := auditlog.New(128, 128)
	now := time.Now().UTC()
	s := newHarnessService(t, nil, WithAuditStore(store), WithClock(func() time.Time { return now }))
	stopAccountRefreshTimer(t, s)
	completeLogin(t, s)
	now = now.Add(10 * time.Minute)
	_, _, _, authenticated := s.BindAuthenticatedRuntimeGeneration(context.Background())
	if authenticated || s.currentState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED {
		t.Fatal("did not reach supported expired-account state")
	}
	result, err := s.SwitchAccount(context.Background(), &runtimev1.SwitchAccountRequest{Caller: desktopAccountControlCaller()})
	if err != nil || result.GetAccepted() || result.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE {
		t.Fatalf("unexpected switch result: %+v %v", result, err)
	}
	event := findAccountAuditEvent(listAccountAuditEvents(t, store), "account.switch.rejected")
	if event == nil || event.GetSubjectUserId() != "acct-1" {
		t.Fatalf("known Runtime account omitted from denied switch audit: %+v", event)
	}
}

func TestRestartMarkerRejectionIsAudited(t *testing.T) {
	material := testMaterial("acct-restart", "access-restart", "refresh-restart")
	material.RefreshTokenHashes = map[string]bool{refreshHash(material.RefreshToken): true}
	custody := &refreshRestartProofCustody{material: material, has: true}
	store := auditlog.New(128, 128)
	s := New(nil, WithProductionActivation(), WithCustody(custody), WithAuditStore(store))
	stopAccountRefreshTimer(t, s)
	if s.currentState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED || custody.has {
		t.Fatal("restart did not reject and clear the in-flight refresh marker")
	}
	events := listAccountAuditEvents(t, store)
	if len(events) == 0 {
		t.Fatal("security-relevant restart rejection cleared custody without an audit")
	}
}

func TestSuccessfulCustodyRecoveryIsAudited(t *testing.T) {
	material := testMaterial("acct-recovered", "private-recovered-access", "private-recovered-refresh")
	custody := &refreshRestartProofCustody{material: material, has: true}
	store := auditlog.New(128, 128)
	s := New(nil, WithProductionActivation(), WithCustody(custody), WithAuditStore(store))
	stopAccountRefreshTimer(t, s)
	if s.currentState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
		t.Fatal("recovery did not authenticate")
	}
	event := findAccountAuditEvent(listAccountAuditEvents(t, store), "account.custody.recovered")
	if event == nil || event.GetSubjectUserId() != material.AccountID || event.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("missing recovery audit: %+v", event)
	}
	if event.GetPayload() != nil {
		t.Fatal("recovery audit should carry no credential payload")
	}
}
