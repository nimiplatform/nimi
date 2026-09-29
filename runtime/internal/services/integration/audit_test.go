package integration

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
)

func integrationAuditRecords(t *testing.T, s *Service, operation string) []*runtimev1.AuditEventRecord {
	t.Helper()
	response, err := s.audit.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: auditDomain, PageSize: 200})
	if err != nil {
		t.Fatalf("list Integration audit: %v", err)
	}
	var records []*runtimev1.AuditEventRecord
	for _, event := range response.GetEvents() {
		if event.GetOperation() == operation {
			records = append(records, event)
		}
	}
	return records
}

func requireIntegrationAuditCount(t *testing.T, s *Service, operation string, successes int, refusals int) {
	t.Helper()
	gotSuccesses, gotRefusals := 0, 0
	for _, event := range integrationAuditRecords(t, s, operation) {
		if event.GetReasonCode() == runtimev1.ReasonCode_ACTION_EXECUTED {
			gotSuccesses++
		} else {
			gotRefusals++
		}
	}
	if gotSuccesses != successes || gotRefusals != refusals {
		t.Fatalf("%s audit = %d successes/%d refusals, want %d/%d", operation, gotSuccesses, gotRefusals, successes, refusals)
	}
}

// blockIntegrationAudit makes every audit insert fail while the Integration
// business tables stay writable, so the test observes the ordering alone.
func blockIntegrationAudit(t *testing.T, s *Service) func() {
	t.Helper()
	if _, err := s.backend.DB().Exec(`CREATE TRIGGER test_block_audit BEFORE INSERT ON runtime_audit_event BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	return func() {
		if _, err := s.backend.DB().Exec(`DROP TRIGGER test_block_audit`); err != nil {
			t.Fatal(err)
		}
	}
}

func requireIntegrationAuditUnavailable(t *testing.T, err error) {
	t.Helper()
	metadata, _ := grpcerr.ExtractReasonMetadata(err)
	if status.Code(err) != codes.Unavailable || metadata["integration_reason"] != "INTEGRATION_AUDIT_UNAVAILABLE" {
		t.Fatalf("unrecordable mutation error = %v (metadata %v)", err, metadata)
	}
}

func requireNoSecretInIntegrationAudit(t *testing.T, s *Service, secrets ...string) {
	t.Helper()
	response, err := s.audit.ListEvents(&runtimev1.ListAuditEventsRequest{PageSize: 200})
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range response.GetEvents() {
		encoded, err := protojson.Marshal(event)
		if err != nil {
			t.Fatal(err)
		}
		for _, secret := range secrets {
			if strings.Contains(string(encoded), secret) {
				t.Fatalf("audit record contains secret material %q: %s", secret, encoded)
			}
		}
	}
}

func TestIntegrationPermissionMutationsRecordOneResult(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	provider, consumer := testDecision("provider", 1), testDecision("consumer", 2)
	target := registerTestProvider(t, s, provider, "read")
	s.registrations = integrationTestRegistrations{{Subject: consumer.RegisteredAppSubject, AppID: consumer.AppID, DisplayName: "Consumer"}}
	manage := desktopIntegrationContext(t, localappop.OperationIntegrationPermissionSet)
	consumerRef := ref("icons_", consumer.AccountID, consumer.RegisteredAppSubject)

	if _, err := s.SetIntegrationPermission(manage, &runtimev1.SetIntegrationPermissionRequest{ConsumerRef: consumerRef, TargetRef: target, Operations: []string{"document.read"}}); err != nil {
		t.Fatal(err)
	}
	requireIntegrationAuditCount(t, s, "integration.permission.set", 1, 0)
	granted := integrationAuditRecords(t, s, "integration.permission.set")[0]
	fields := granted.GetPayload().GetFields()
	if granted.GetAppId() != "nimi.desktop" || granted.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE ||
		granted.GetSubjectUserId() != "test-account" || fields["target_ref"].GetStringValue() != target ||
		fields["consumer_ref"].GetStringValue() != consumerRef || len(fields["operations"].GetListValue().GetValues()) != 1 {
		t.Fatalf("grant record = %v", granted)
	}

	unknown := &runtimev1.SetIntegrationPermissionRequest{ConsumerRef: ref("icons_", consumer.AccountID, "unknown"), TargetRef: target, Operations: []string{"document.read"}}
	if _, err := s.SetIntegrationPermission(manage, unknown); status.Code(err) != codes.NotFound {
		t.Fatalf("unknown consumer grant = %v", err)
	}
	requireIntegrationAuditCount(t, s, "integration.permission.set", 1, 1)
	for _, event := range integrationAuditRecords(t, s, "integration.permission.set") {
		if event.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED && event.GetPayload().GetFields()["integration_reason"].GetStringValue() != "INTEGRATION_CONSUMER_NOT_FOUND" {
			t.Fatalf("refusal record = %v", event)
		}
	}

	if _, err := s.SetIntegrationPermission(manage, &runtimev1.SetIntegrationPermissionRequest{ConsumerRef: consumerRef, TargetRef: target}); err != nil {
		t.Fatal(err)
	}
	requireIntegrationAuditCount(t, s, "integration.permission.revoke", 1, 0)
	if _, err := s.SetIntegrationPermission(manage, &runtimev1.SetIntegrationPermissionRequest{ConsumerRef: consumerRef, TargetRef: "missing-target"}); status.Code(err) != codes.NotFound {
		t.Fatalf("missing permission revoke = %v", err)
	}
	requireIntegrationAuditCount(t, s, "integration.permission.revoke", 1, 1)

	// An unrecordable grant never takes effect.
	unblock := blockIntegrationAudit(t, s)
	_, err := s.SetIntegrationPermission(manage, &runtimev1.SetIntegrationPermissionRequest{ConsumerRef: consumerRef, TargetRef: target, Operations: []string{"document.read"}})
	requireIntegrationAuditUnavailable(t, err)
	if s.permitted(context.Background(), consumer.AccountID, consumer.RegisteredAppSubject, target, "document.read") {
		t.Fatal("unrecordable grant took effect")
	}
	unblock()
	requireIntegrationAuditCount(t, s, "integration.permission.set", 1, 1)
}

func TestIntegrationConnectionMutationsRecordOneResult(t *testing.T) {
	s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		if strings.HasSuffix(req.URL.Path, "/getMe") {
			return jsonResponse(map[string]any{"ok": true, "result": map[string]any{"id": 7, "username": "test-bot"}}), nil
		}
		if strings.HasSuffix(req.URL.Path, "/getWebhookInfo") {
			return jsonResponse(map[string]any{"ok": true, "result": map[string]any{"url": ""}}), nil
		}
		return nil, fmt.Errorf("unexpected test request")
	}))
	putCtx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionPut)
	removeCtx := desktopIntegrationContext(t, localappop.OperationIntegrationConnectionRemove)

	created, err := s.PutIntegrationConnection(putCtx, &runtimev1.PutIntegrationConnectionRequest{Adapter: "telegram", DisplayName: "original", Secret: "bot-token-secret-value"})
	if err != nil {
		t.Fatal(err)
	}
	requireIntegrationAuditCount(t, s, "integration.connection.put", 1, 0)
	put := integrationAuditRecords(t, s, "integration.connection.put")[0].GetPayload().GetFields()
	if put["target_ref"].GetStringValue() != created.Connection.TargetRef || put["adapter"].GetStringValue() != "telegram" || put["disposition"].GetStringValue() != "created" {
		t.Fatalf("connection put record = %v", put)
	}
	if _, err := s.PutIntegrationConnection(putCtx, &runtimev1.PutIntegrationConnectionRequest{Adapter: "telegram", DisplayName: " "}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("invalid connection put = %v", err)
	}
	requireIntegrationAuditCount(t, s, "integration.connection.put", 1, 1)

	// An unrecordable update leaves the stored connection unchanged.
	unblock := blockIntegrationAudit(t, s)
	_, err = s.PutIntegrationConnection(putCtx, &runtimev1.PutIntegrationConnectionRequest{TargetRef: created.Connection.TargetRef, Adapter: "telegram", DisplayName: "renamed"})
	requireIntegrationAuditUnavailable(t, err)
	if stored, err := s.loadTarget(context.Background(), "test-account", created.Connection.TargetRef); err != nil || stored.Public.DisplayName != "original" {
		t.Fatalf("unrecordable update changed the connection: %v %v", stored.Public, err)
	}
	// An unrecordable removal keeps both the connection and its credential.
	_, err = s.RemoveIntegrationConnection(removeCtx, &runtimev1.RemoveIntegrationConnectionRequest{TargetRef: created.Connection.TargetRef})
	requireIntegrationAuditUnavailable(t, err)
	if _, err := s.loadTarget(context.Background(), "test-account", created.Connection.TargetRef); err != nil {
		t.Fatalf("unrecordable removal deleted the connection: %v", err)
	}
	if secret, _, err := s.secrets.ReadSecret("integration:" + created.Connection.TargetRef); err != nil || secret == "" {
		t.Fatalf("unrecordable removal deleted custody: %q %v", secret, err)
	}
	unblock()
	requireIntegrationAuditCount(t, s, "integration.connection.put", 1, 1)
	requireIntegrationAuditCount(t, s, "integration.connection.remove", 0, 0)

	if _, err := s.RemoveIntegrationConnection(removeCtx, &runtimev1.RemoveIntegrationConnectionRequest{TargetRef: created.Connection.TargetRef}); err != nil {
		t.Fatal(err)
	}
	requireIntegrationAuditCount(t, s, "integration.connection.remove", 1, 0)
	if _, err := s.RemoveIntegrationConnection(removeCtx, &runtimev1.RemoveIntegrationConnectionRequest{TargetRef: created.Connection.TargetRef}); status.Code(err) != codes.NotFound {
		t.Fatalf("second removal = %v", err)
	}
	requireIntegrationAuditCount(t, s, "integration.connection.remove", 1, 1)
	requireNoSecretInIntegrationAudit(t, s, "bot-token-secret-value")
}

func TestIntegrationProviderMutationsRecordOneResult(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	provider, consumer := testDecision("provider", 1), testDecision("consumer", 2)
	target := registerTestProvider(t, s, provider, "read")
	requireIntegrationAuditCount(t, s, "integration.provider.register", 1, 0)
	register := integrationAuditRecords(t, s, "integration.provider.register")[0]
	if register.GetAppId() != provider.AppID || register.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP ||
		register.GetCallerId() != provider.RegisteredAppSubject || register.GetPayload().GetFields()["target_ref"].GetStringValue() != target {
		t.Fatalf("provider register record = %v", register)
	}

	grantTestTarget(t, s, consumer, target, "document.read")
	callID := invokeTestCall(t, s, consumer, target, "document.read", `{"document":"private-input"}`)
	if polled := pollTestProvider(t, s, provider); len(polled.Calls) != 1 {
		t.Fatalf("provider poll = %v", polled)
	}
	completeCtx := testContext(provider, localappop.OperationIntegrationProviderComplete)
	completed, err := s.CompleteIntegrationProvider(completeCtx, &runtimev1.CompleteIntegrationProviderRequest{CallId: callID, ResultJson: `{"private":"result"}`})
	if err != nil || !completed.GetAccepted() {
		t.Fatalf("provider completion = %v %v", completed, err)
	}
	requireIntegrationAuditCount(t, s, "integration.provider.complete", 1, 0)
	complete := integrationAuditRecords(t, s, "integration.provider.complete")[0].GetPayload().GetFields()
	if complete["call_id"].GetStringValue() != callID || complete["call_state"].GetStringValue() != "completed" {
		t.Fatalf("provider completion record = %v", complete)
	}
	late, err := s.CompleteIntegrationProvider(completeCtx, &runtimev1.CompleteIntegrationProviderRequest{CallId: callID, ResultJson: `{"late":true}`})
	if err != nil || late.GetAccepted() {
		t.Fatalf("late completion = %v %v", late, err)
	}
	requireIntegrationAuditCount(t, s, "integration.provider.complete", 1, 1)
	requireNoSecretInIntegrationAudit(t, s, "private-input", "private")

	// An unrecordable unregister leaves the provider registered.
	unregisterCtx := testContext(provider, localappop.OperationIntegrationProviderUnregister)
	unblock := blockIntegrationAudit(t, s)
	_, err = s.UnregisterIntegrationProvider(unregisterCtx, &runtimev1.UnregisterIntegrationProviderRequest{TargetRef: target})
	requireIntegrationAuditUnavailable(t, err)
	s.mu.Lock()
	stillRegistered := s.providers[target] != nil
	s.mu.Unlock()
	if !stillRegistered {
		t.Fatal("unrecordable unregister removed the provider")
	}
	// An unrecordable registration never becomes reachable.
	other := testDecision("other-provider", 5)
	_, err = s.RegisterIntegrationProvider(testContext(other, localappop.OperationIntegrationProviderRegister), &runtimev1.RegisterIntegrationProviderRequest{IntegrationId: "documents", DisplayName: "Other", Operations: []*runtimev1.IntegrationOperation{testOperation("read")}})
	requireIntegrationAuditUnavailable(t, err)
	otherTarget := ref("iap_", other.AccountID, other.RegisteredAppSubject, "documents")
	if _, err := s.loadTarget(context.Background(), other.AccountID, otherTarget); err == nil {
		t.Fatal("unrecordable registration stored its target")
	}
	unblock()

	if _, err := s.UnregisterIntegrationProvider(unregisterCtx, &runtimev1.UnregisterIntegrationProviderRequest{TargetRef: target}); err != nil {
		t.Fatal(err)
	}
	requireIntegrationAuditCount(t, s, "integration.provider.unregister", 1, 0)
	if _, err := s.UnregisterIntegrationProvider(unregisterCtx, &runtimev1.UnregisterIntegrationProviderRequest{TargetRef: target}); status.Code(err) != codes.NotFound {
		t.Fatalf("second unregister = %v", err)
	}
	requireIntegrationAuditCount(t, s, "integration.provider.unregister", 1, 1)
	requireIntegrationAuditCount(t, s, "integration.provider.register", 1, 0)
}
