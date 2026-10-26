package ai

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aitelemetry"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/realtimecore"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

func realtimeObservationTestOwner(t *testing.T) (*Service, *realtimeSessionRecord, *aitelemetry.Store) {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	backend, err := runtimepersistence.Open(logger, filepath.Join(t.TempDir(), "runtime.json"))
	if err != nil {
		t.Fatal(err)
	}
	owner := aitelemetry.Open(backend, logger)
	t.Cleanup(func() { _ = owner.Close(); _ = backend.Close() })
	stream, err := realtimecore.NewStream[*runtimev1.AiRealtimeEvent](realtimecore.Config{
		RealtimeSessionID: "session", ChannelID: "channel", AdapterKind: "ai", Generation: 1, Capacity: 64,
	})
	if err != nil {
		t.Fatal(err)
	}
	record := &realtimeSessionRecord{
		sessionID: "session", channelID: "channel", generation: 1, appID: "runtime.agent", subjectUserID: "account",
		ctx: context.Background(), stream: stream, pendingRequestID: "turn-1",
		tracksByProvider: make(map[string]*realtimeOutputTrack), tracksByRuntime: make(map[string]*realtimeOutputTrack),
	}
	svc := &Service{aiObservation: owner, realtimeSessions: newRealtimeSessionStore()}
	svc.realtimeSessions.create(record)
	ctx := aitelemetry.WithSource(context.Background(), aitelemetry.Source{Kind: "local-agent", ID: "agent-1", Label: "LocalAgent"})
	svc.configureRealtimeAIObservation(ctx, record, "actual-provider", "actual-model", "actual-connector")
	return svc, record, owner
}

func TestRealtimeObservationCountsProviderRoundsAndRawUsageOnce(t *testing.T) {
	svc, record, owner := realtimeObservationTestOwner(t)
	for i := 0; i < 2; i++ {
		svc.projectRealtimeProviderEvent(record, capabilitydriver.CloudRealtimeEvent{Kind: capabilitydriver.CloudRealtimeEventOutputStarted, ProviderResponseID: "response-1"})
	}
	snapshot := owner.Snapshot("account", 50)
	if len(snapshot.Executions) != 1 || snapshot.Executions[0].ParentWorkId != "turn-1" || snapshot.Executions[0].SourceKind != "local-agent" {
		t.Fatalf("response was duplicated or lost its Agent turn: %+v", snapshot)
	}
	if snapshot.Executions[0].Models[0].ProviderId != "actual-provider" || snapshot.Executions[0].Models[0].ModelId != "actual-model" {
		t.Fatal("Realtime did not retain the adopted model")
	}
	// The Conversation may combine a prior private-intention round. Product AI
	// accounting must consume this response's original usage, before that merge.
	record.selfUsage = &runtimev1.UsageStats{InputTokens: 100}
	done := capabilitydriver.CloudRealtimeEvent{Kind: capabilitydriver.CloudRealtimeEventResponseDone, ProviderResponseID: "response-1",
		ResponseStatus: capabilitydriver.CloudRealtimeResponseStatusCompleted, NoOutput: true, Usage: &runtimev1.UsageStats{InputTokens: 2, OutputTokens: 3}}
	svc.projectRealtimeProviderEvent(record, done)
	svc.projectRealtimeProviderEvent(record, done)
	record.pendingRequestID = "turn-2"
	svc.projectRealtimeProviderEvent(record, capabilitydriver.CloudRealtimeEvent{Kind: capabilitydriver.CloudRealtimeEventOutputStarted, ProviderResponseID: "response-2"})
	done.ProviderResponseID, done.Usage = "response-2", &runtimev1.UsageStats{InputTokens: 5, OutputTokens: 7}
	svc.projectRealtimeProviderEvent(record, done)
	if err := owner.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	summary, err := owner.Summary(context.Background(), "account", time.Now().Add(-time.Minute), time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if summary.GetTotals().GetAttemptCount() != 2 || summary.GetTotals().GetInputTokens() != 7 || summary.GetTotals().GetOutputTokens() != 10 {
		t.Fatalf("response or combined usage was counted twice: %+v", summary.GetTotals())
	}
	if len(owner.Snapshot("account", 50).Executions) != 0 {
		t.Fatal("completed responses stayed active")
	}
	history, err := owner.CloudHistory(context.Background(), "account", "actual-connector", time.Now().Add(-time.Minute), time.Now().Add(time.Minute), 20, "")
	if err != nil || len(history.GetAttempts()) != 2 {
		t.Fatalf("round history: %+v %v", history, err)
	}
	for _, attempt := range history.Attempts {
		if attempt.ConnectorRef != "actual-connector" || attempt.Outcome != runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_SUCCEEDED {
			t.Fatalf("round identity or outcome lost: %+v", attempt)
		}
	}
}

func TestRealtimeObservationDoesNotCountInventedResponseIdentity(t *testing.T) {
	svc, record, owner := realtimeObservationTestOwner(t)
	for i := 0; i < 2; i++ {
		svc.projectRealtimeProviderEvent(record, capabilitydriver.CloudRealtimeEvent{Kind: capabilitydriver.CloudRealtimeEventOutputStarted})
	}
	if len(owner.Snapshot("account", 50).Executions) != 0 {
		t.Fatal("missing Provider identity fabricated attempts")
	}
	if err := owner.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	summary, err := owner.Summary(context.Background(), "account", time.Now().Add(-time.Minute), time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if summary.GetTotals().GetAttemptCount() != 0 || summary.TimeComplete {
		t.Fatal("unknown responses became a complete zero")
	}
	if !strings.Contains(strings.Join(summary.PartialReasons, ","), "response-identity-unavailable") {
		t.Fatalf("missing response identity lost its coverage gap: %+v", summary.PartialReasons)
	}
}

func TestRealtimeObservationKeepsDisconnectedResponseUnknown(t *testing.T) {
	svc, record, owner := realtimeObservationTestOwner(t)
	svc.projectRealtimeProviderEvent(record, capabilitydriver.CloudRealtimeEvent{Kind: capabilitydriver.CloudRealtimeEventOutputStarted, ProviderResponseID: "response-1"})
	svc.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, realtimecore.TerminalOwnerFailed)
	snapshot := owner.Snapshot("account", 50)
	if len(snapshot.Executions) != 1 || snapshot.Executions[0].State != runtimev1.DesktopAIExecutionState_DESKTOP_AI_EXECUTION_STATE_OBSERVATION_UNKNOWN || snapshot.WorkCountKnown {
		t.Fatalf("disconnection invented a terminal or current execution: %+v", snapshot)
	}
}

func TestRealtimeObservationCountsAdmittedNoOutputRoundWithoutOutputTrack(t *testing.T) {
	_, _, owner := realtimeObservationTestOwner(t)
	svc, record, _, ctx := geminiRealtimeServiceFixture(t)
	svc.aiObservation = owner
	svc.configureRealtimeAIObservation(ctx, record, "google", "gemini-live", "gemini-connector")
	_, err := svc.AppendRealtimeInput(ctx, &runtimev1.AppendRealtimeInputRequest{RealtimeSessionId: "session", Generation: 1,
		Input: &runtimev1.AppendRealtimeInputRequest_Text{Text: &runtimev1.AiRealtimeTextInput{RequestId: "input", Text: "Speak"}}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.SubmitRealtimeOwnerControl(ctx, &runtimev1.SubmitRealtimeOwnerControlRequest{RealtimeSessionId: "session", Generation: 1,
		RequestId: "request", Control: runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE})
	if err != nil {
		t.Fatal(err)
	}
	if len(record.tracksByRuntime) != 0 {
		t.Fatal("dispatch fabricated an output track")
	}
	if len(owner.Snapshot(record.subjectUserID, 50).Executions) != 1 {
		t.Fatal("actual model dispatch was not observed")
	}
	events, err := record.driver.Normalize([]byte(`{"serverContent":{"turnComplete":true,"interactionStatus":"IDLE","waitingForInput":true}}`))
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		svc.projectRealtimeProviderEvent(record, event)
	}
	if len(record.tracksByRuntime) != 0 {
		t.Fatal("no-output terminal fabricated an output track")
	}
	if len(owner.Snapshot(record.subjectUserID, 50).Executions) != 0 {
		t.Fatal("terminal round remained active")
	}
	if err := owner.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	summary, err := owner.Summary(context.Background(), record.subjectUserID, time.Now().Add(-time.Minute), time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if summary.GetTotals().GetAttemptCount() != 1 {
		t.Fatalf("no-output dispatch count = %d", summary.GetTotals().GetAttemptCount())
	}
}
