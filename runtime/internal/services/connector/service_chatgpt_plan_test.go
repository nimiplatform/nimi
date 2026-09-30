package connector

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/protobuf/proto"
)

func newChatGPTPlanTestService(t *testing.T, renewer ChatGPTPlanTokenRenewer) (*Service, *chatGPTPlanTestClock) {
	t.Helper()
	clock := &chatGPTPlanTestClock{now: time.Now().UTC().Truncate(time.Second)}
	store := NewConnectorStoreWithMemorySecrets(t.TempDir(), WithChatGPTPlanRenewer(renewer), WithClock(clock.Now))
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), store, auditlog.New(128, 128))
	svc.SetCloudProvider(nimillm.NewCloudProvider(nimillm.CloudConfig{AllowLoopbackEndpoint: true}))
	return svc, clock
}

func TestCreateChatGPTPlanConnectorAdmitsOnlyExactAuthorization(t *testing.T) {
	svc, clock := newChatGPTPlanTestService(t, &fakeChatGPTPlanRenewer{})
	ctx := userContext("user-1")
	for name, request := range map[string]*runtimev1.CreateConnectorRequest{
		"api key":          {Provider: ChatGPTPlanProvider, ApiKey: "sk-standard-api-key"},
		"foreign profile":  {Provider: ChatGPTPlanProvider, AuthKind: runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED, ProviderAuthProfile: "anthropic", CredentialJson: testChatGPTPlanAuthorization(t, clock.Now(), nil)},
		"private endpoint": {Provider: ChatGPTPlanProvider, Endpoint: "https://chatgpt.com/backend-api/codex", AuthKind: runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED, ProviderAuthProfile: ChatGPTPlanAuthProfile, CredentialJson: testChatGPTPlanAuthorization(t, clock.Now(), nil)},
		"codex token":      {Provider: ChatGPTPlanProvider, AuthKind: runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED, ProviderAuthProfile: ChatGPTPlanAuthProfile, CredentialJson: `{"access_token":"legacy","refresh_token":"legacy"}`},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := svc.CreateConnector(ctx, request)
			requireChatGPTPlanReason(t, err, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
		})
	}
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: ChatGPTPlanProvider, AuthKind: runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED,
		ProviderAuthProfile: ChatGPTPlanAuthProfile, CredentialJson: testChatGPTPlanAuthorization(t, clock.Now(), nil),
	})
	if err != nil {
		t.Fatalf("create SIWC connector: %v", err)
	}
	connector := created.GetConnector()
	if connector.GetEndpoint() != ChatGPTPlanEndpoint || connector.GetLabel() != "user@example.com" || !connector.GetHasCredential() {
		t.Fatalf("created SIWC connector projection = %+v", connector)
	}
	if projected := connector.GetOauthRegistration(); projected.GetIssuedClientId() != testChatGPTPlanClientID || projected.GetAccountLabel() != "user@example.com" {
		t.Fatalf("public registration projection = %+v", projected)
	}
	record, _, _ := svc.store.Get(connector.GetConnectorId())
	if record.OAuthRegistration == nil || record.OAuthRegistration.ClientID != testChatGPTPlanClientID {
		t.Fatalf("registration projection = %+v", record.OAuthRegistration)
	}
}

func TestUpdateChatGPTPlanConnectorBindsReauthorizationTyped(t *testing.T) {
	renewer := &fakeChatGPTPlanRenewer{}
	svc, clock := newChatGPTPlanTestService(t, renewer)
	ctx := userContext("user-1")
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: ChatGPTPlanProvider, AuthKind: runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED,
		ProviderAuthProfile: ChatGPTPlanAuthProfile, CredentialJson: testChatGPTPlanAuthorization(t, clock.Now(), nil),
	})
	if err != nil {
		t.Fatal(err)
	}
	id := created.GetConnector().GetConnectorId()
	otherAccount := testChatGPTPlanAuthorization(t, clock.Now(), func(value map[string]any) {
		value["subject"] = "other-subject"
		value["access_token"] = testChatGPTPlanAccessToken(t, testChatGPTPlanClientID, "other-subject", clock.Now().Add(time.Hour), "x")
	})
	_, err = svc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{ConnectorId: id, CredentialJson: proto.String(otherAccount)})
	requireChatGPTPlanReason(t, err, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	_, err = svc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{ConnectorId: id, Endpoint: proto.String("https://chatgpt.com/backend-api/codex")})
	requireChatGPTPlanReason(t, err, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	reauthorized := testChatGPTPlanAuthorization(t, clock.Now(), func(value map[string]any) { value["refresh_token"] = "refresh-reauthorized" })
	if _, err := svc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{ConnectorId: id, CredentialJson: proto.String(reauthorized)}); err != nil {
		t.Fatalf("explicit reauthorization: %v", err)
	}
	if sealed := sealedChatGPTPlanForTest(t, svc.store, id); sealed.Generation != 2 || sealed.RefreshToken != "refresh-reauthorized" ||
		len(sealed.PriorSessions) != 1 || sealed.PriorSessions[0] != "refresh-1" {
		t.Fatalf("reauthorized custody = %+v", sealed)
	}
	// Deleting after signing in again also ends the session it replaced.
	deleted, err := svc.DeleteConnector(ctx, &runtimev1.DeleteConnectorRequest{ConnectorId: id})
	if err != nil || !deleted.GetAck().GetOk() || deleted.GetAck().GetActionHint() != "" ||
		strings.Join(renewer.revoked, ",") != testChatGPTPlanClientID+"|refresh-reauthorized,"+testChatGPTPlanClientID+"|refresh-1" {
		t.Fatalf("delete after reauthorization = %+v err=%v revoked=%v", deleted, err, renewer.revoked)
	}
}

func TestChatGPTPlanListMarksAccountAvailabilityAndTestUsesRenewedCredential(t *testing.T) {
	var modelRequests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		modelRequests.Add(1)
		if r.URL.Path != "/v1/models" || r.Header.Get("Authorization") == "" {
			t.Errorf("unexpected account inventory request %s auth=%q", r.URL.Path, r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"models":[{"slug":"gpt-6-luna","display_name":"GPT-6 Luna","visibility":"list"},{"slug":"gpt-6.1-sol","display_name":"GPT-6.1 Sol","visibility":"hidden"},{"slug":"remote-only","display_name":"Remote","visibility":"list"}]}`))
	}))
	defer server.Close()
	svc, clock := newChatGPTPlanTestService(t, &fakeChatGPTPlanRenewer{})
	sealed, registration, err := SealChatGPTPlanAuthorization(testChatGPTPlanAuthorization(t, clock.Now(), nil), "", clock.Now())
	if err != nil {
		t.Fatal(err)
	}
	record, err := svc.store.Create(ConnectorRecord{
		ConnectorID: "siwc-list", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "user-1",
		Provider: ChatGPTPlanProvider, Endpoint: server.URL, Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
		AuthKind: runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED, ProviderAuthProfile: ChatGPTPlanAuthProfile, OAuthRegistration: registration,
	}, sealed)
	if err != nil {
		t.Fatal(err)
	}
	ctx := userContext("user-1")
	listed, err := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{ConnectorId: record.ConnectorID, PageSize: 50})
	if err != nil {
		t.Fatalf("ListConnectorModels: %v", err)
	}
	availability := map[string]bool{}
	for _, model := range listed.GetModels() {
		availability[model.GetProviderModelId()] = model.GetAvailable()
	}
	if len(availability) != 3 || !availability["gpt-6-luna"] || availability["gpt-6.1-sol"] || availability["gpt-6-astra"] {
		t.Fatalf("reviewed-row availability = %v", availability)
	}
	tested, err := svc.TestConnector(ctx, &runtimev1.TestConnectorRequest{ConnectorId: record.ConnectorID})
	if err != nil || !tested.GetAck().GetOk() || modelRequests.Load() != 2 {
		t.Fatalf("test SIWC connector = %+v err=%v requests=%d", tested, err, modelRequests.Load())
	}
	// A terminal renewal failure projects an explicit reauthorization action
	// instead of an empty inventory or a silently healthy Connector.
	svc.store.chatGPTPlanRenewer = &fakeChatGPTPlanRenewer{result: func(int32, string) (ChatGPTPlanTokenSet, error) {
		return ChatGPTPlanTokenSet{}, newChatGPTPlanRenewalFailure(chatGPTPlanRenewalTokenInvalid, nil)
	}}
	clock.Advance(59 * time.Minute)
	tested, err = svc.TestConnector(ctx, &runtimev1.TestConnectorRequest{ConnectorId: record.ConnectorID})
	if err != nil || tested.GetAck().GetOk() || tested.GetAck().GetReasonCode() != runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING || tested.GetAck().GetActionHint() != ChatGPTPlanReauthorizeHint {
		t.Fatalf("reauthorization projection = %+v err=%v", tested, err)
	}
	_, err = svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{ConnectorId: record.ConnectorID})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING || modelRequests.Load() != 2 {
		t.Fatalf("unrenewable credential listing = %v requests=%d", err, modelRequests.Load())
	}
}

func TestDeleteChatGPTPlanConnectorReportsUnconfirmedRevocation(t *testing.T) {
	for _, confirmed := range []bool{true, false} {
		renewer := &fakeChatGPTPlanRenewer{}
		if !confirmed {
			renewer.revokeErr = context.DeadlineExceeded
		}
		svc, clock := newChatGPTPlanTestService(t, renewer)
		ctx := userContext("user-1")
		created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
			Provider: ChatGPTPlanProvider, AuthKind: runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED,
			ProviderAuthProfile: ChatGPTPlanAuthProfile, CredentialJson: testChatGPTPlanAuthorization(t, clock.Now(), nil),
		})
		if err != nil {
			t.Fatal(err)
		}
		deleted, err := svc.DeleteConnector(ctx, &runtimev1.DeleteConnectorRequest{ConnectorId: created.GetConnector().GetConnectorId()})
		if err != nil || !deleted.GetAck().GetOk() || len(renewer.revoked) != 1 || renewer.revoked[0] != testChatGPTPlanClientID+"|refresh-1" {
			t.Fatalf("delete = %+v err=%v revoked=%v", deleted, err, renewer.revoked)
		}
		if unconfirmed := deleted.GetAck().GetActionHint() == chatGPTPlanRevocationUnconfirmed; unconfirmed == confirmed {
			t.Fatalf("confirmed=%v action hint=%q", confirmed, deleted.GetAck().GetActionHint())
		}
		if _, found, _ := svc.store.Get(created.GetConnector().GetConnectorId()); found {
			t.Fatal("deleted SIWC connector remains")
		}
	}
}
