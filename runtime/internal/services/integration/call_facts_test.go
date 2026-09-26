package integration

import (
	"context"
	"net/http"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
)

func TestTerminalRecordFailureIsUnconfirmedOnEveryFactSurface(t *testing.T) {
	s := newIntegrationTestService(t, nil)
	s.registrations = &integrationDescriptionRegistrations{}
	backend := &integrationFailingBackend{Backend: s.backend}
	s.backend = backend
	provider, consumer := testDecision("provider", 11), testDecision("consumer", 12)
	target := registerTestProvider(t, s, provider, "write")
	grantTestTarget(t, s, consumer, target, "document.read")
	id := invokeTestCall(t, s, consumer, target, "document.read", `{}`)
	_ = pollTestProvider(t, s, provider)
	backend.fail.Store(true)
	response, err := s.CompleteIntegrationProvider(testContext(provider, localappop.OperationIntegrationProviderComplete), &runtimev1.CompleteIntegrationProviderRequest{CallId: id, ResultJson: `{"private":"actual result"}`})
	if err != nil || response.GetAccepted() {
		t.Fatalf("unrecorded outcome claimed committed: %v %v", response, err)
	}
	backend.fail.Store(false)
	assertFact := func(fact *runtimev1.IntegrationCall) {
		t.Helper()
		if fact.GetCallId() != id || fact.GetStatus() != "unconfirmed" || fact.GetErrorCode() != "INTEGRATION_RESULT_RECORD_UNAVAILABLE" || fact.GetResultJson() != "" {
			t.Fatalf("contradictory or private call fact: %v", fact)
		}
	}
	assertFact(waitTestCall(t, s, consumer, id))
	list, err := s.ListIntegrationCalls(testContext(consumer, localappop.OperationIntegrationCallList), &runtimev1.ListIntegrationCallsRequest{})
	if err != nil || len(list.GetCalls()) != 1 {
		t.Fatalf("list unavailable: %v %v", list, err)
	}
	assertFact(list.Calls[0])
	management, err := s.GetIntegrationManagement(desktopIntegrationContext(t, localappop.OperationIntegrationManagementGet), &runtimev1.GetIntegrationManagementRequest{})
	if err != nil || len(management.GetCalls()) != 1 {
		t.Fatalf("management unavailable: %v %v", management, err)
	}
	assertFact(management.Calls[0])
	reopened := consumer
	reopened.SessionID[0]++
	got, err := s.GetIntegrationCall(testContext(reopened, localappop.OperationIntegrationCallGet), &runtimev1.GetIntegrationCallRequest{CallId: id})
	if err != nil {
		t.Fatal(err)
	}
	assertFact(got.Call)
	s.mu.Lock()
	s.dropCallLocked(id)
	s.mu.Unlock()
	list, err = s.ListIntegrationCalls(testContext(consumer, localappop.OperationIntegrationCallList), &runtimev1.ListIntegrationCallsRequest{})
	if err != nil || len(list.GetCalls()) != 1 || list.Calls[0].Status != "unconfirmed" {
		t.Fatalf("evicted executor became accepted: %v %v", list, err)
	}
}

func TestCallAttributionSurvivesConnectionAndRegistrationRemoval(t *testing.T) {
	s := newIntegrationTestService(t, testRoundTripper(func(req *http.Request) (*http.Response, error) {
		return jsonResponse(map[string]any{"ok": true, "result": map[string]any{"message_id": 7, "chat": map[string]any{"id": 1}}}), nil
	}))
	consumer := testDecision("consumer", 9)
	registrations := &integrationDescriptionRegistrations{descriptions: map[string]Consumer{consumer.RegisteredAppSubject: {Subject: consumer.RegisteredAppSubject, AppID: consumer.AppID, DisplayName: "Original App", SourceKind: "development"}}}
	s.registrations = registrations
	target := saveTelegramTestTarget(t, s)
	target.Public.AccountLabel = "@original_bot"
	if err := s.saveTarget(context.Background(), target); err != nil {
		t.Fatal(err)
	}
	grantTestTarget(t, s, consumer, target.Public.TargetRef, "telegram.sendMessage")
	id := invokeTestCall(t, s, consumer, target.Public.TargetRef, "telegram.sendMessage", `{"chatId":"1","text":"private message"}`)
	if result := waitTestCall(t, s, consumer, id); result.Status != "completed" {
		t.Fatalf("call failed: %v", result)
	}
	if _, err := s.RemoveIntegrationConnection(desktopIntegrationContext(t, localappop.OperationIntegrationConnectionRemove), &runtimev1.RemoveIntegrationConnectionRequest{TargetRef: target.Public.TargetRef}); err != nil {
		t.Fatal(err)
	}
	registrations.descriptions = nil
	s.mu.Lock()
	s.dropCallLocked(id)
	s.mu.Unlock()
	management, err := s.GetIntegrationManagement(desktopIntegrationContext(t, localappop.OperationIntegrationManagementGet), &runtimev1.GetIntegrationManagementRequest{})
	if err != nil || len(management.GetCalls()) != 1 || len(management.Targets) != 0 {
		t.Fatalf("removed target lost history: %v %v", management, err)
	}
	fact := management.Calls[0]
	if fact.ConsumerDisplayName != "Original App" || fact.TargetDisplayName != "Test Telegram" || fact.AccountLabel != "@original_bot" || fact.ResultJson != "" || fact.CreatedAt == nil || fact.UpdatedAt == nil {
		t.Fatalf("historical attribution changed or private result escaped: %v", fact)
	}
}
