package ai

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/realtimecore"
)

func intentionTestRecord(t *testing.T) (*Service, *realtimeSessionRecord) {
	t.Helper()
	stream, err := realtimecore.NewStream[*runtimev1.AiRealtimeEvent](realtimecore.Config{RealtimeSessionID: "session", ChannelID: "channel", AdapterKind: "ai", Generation: 1, Capacity: 16})
	if err != nil {
		t.Fatal(err)
	}
	r := &realtimeSessionRecord{sessionID: "session", channelID: "channel", generation: 1, ctx: context.Background(), stream: stream, pendingRequestID: "request", tracksByProvider: map[string]*realtimeOutputTrack{}, tracksByRuntime: map[string]*realtimeOutputTrack{}, selfHandler: func(context.Context, string) (string, error) { t.Fatal("collection must not commit"); return "", nil }}
	s := &Service{realtimeSessions: newRealtimeSessionStore()}
	s.realtimeSessions.create(r)
	ensureRealtimeOutputTrack(r, "response")
	return s, r
}

func TestRealtimeSelfIntentionDuplicateAndLateEventsCannotReplay(t *testing.T) {
	s, r := intentionTestRecord(t)
	call := capabilitydriver.CloudRealtimeEvent{Kind: capabilitydriver.CloudRealtimeEventSelfIntention, ProviderResponseID: "response", CallID: "call", Text: `{"action":"adopt","kind":"project","title":"Sketches"}`}
	s.collectRealtimeSelfIntention(r, call)
	if r.selfPending == nil {
		t.Fatal("valid call not retained")
	}
	s.collectRealtimeSelfIntention(r, call)
	if r.closed {
		t.Fatal("identical duplicate closed session")
	}
	r.tracksByProvider["response"].terminal = true
	late := call
	late.CallID = "late"
	s.collectRealtimeSelfIntention(r, late)
	if r.selfPending.CallID != "call" {
		t.Fatal("late terminal response replayed")
	}
	changed := call
	changed.Text = `{"action":"abandon","activity_ref":"other"}`
	s.collectRealtimeSelfIntention(r, changed)
	if r.closed || r.selfPending.Text != call.Text {
		t.Fatal("changed duplicate replaced the suggestion or interrupted the session")
	}
}

func TestRealtimeSpeechAroundOptionalSuggestionKeepsStreaming(t *testing.T) {
	s, r := intentionTestRecord(t)
	for _, event := range []capabilitydriver.CloudRealtimeEvent{
		{Kind: capabilitydriver.CloudRealtimeEventTextDelta, ProviderResponseID: "response", Text: "Let me think."},
		{Kind: capabilitydriver.CloudRealtimeEventSelfIntention, ProviderResponseID: "response", CallID: "call", Text: `{"action":"adopt","kind":"project","title":"Sketches"}`},
		{Kind: capabilitydriver.CloudRealtimeEventTextDelta, ProviderResponseID: "response", Text: "I like drawing."},
	} {
		if s.projectRealtimeProviderEvent(r, event) || r.closed {
			t.Fatal("optional suggestion interrupted ordinary speech")
		}
	}
	if r.selfPending == nil {
		t.Fatal("speech discarded a structurally eligible suggestion")
	}
}

func TestRealtimeSelfIntentionCancellationRetainsIncurredUsage(t *testing.T) {
	s, r := intentionTestRecord(t)
	var recorded *runtimev1.UsageStats
	r.selfUsageObserver = func(request string, usage *runtimev1.UsageStats) {
		if request != "request" {
			t.Fatal("wrong original request")
		}
		recorded = usage
	}
	r.selfHandler = func(context.Context, string) (string, error) {
		if recorded == nil {
			t.Fatal("owner commit ran before incurred usage was retained")
		}
		return "", context.Canceled
	}
	call := capabilitydriver.CloudRealtimeEvent{Kind: capabilitydriver.CloudRealtimeEventSelfIntention, ProviderResponseID: "response", CallID: "call", Text: "{}"}
	s.collectRealtimeSelfIntention(r, call)
	handled, terminal := s.completeRealtimeSelfIntention(r, capabilitydriver.CloudRealtimeEvent{Kind: capabilitydriver.CloudRealtimeEventResponseDone, ProviderResponseID: "response", ResponseStatus: capabilitydriver.CloudRealtimeResponseStatusCompleted, Usage: &runtimev1.UsageStats{InputTokens: 23, OutputTokens: 11}})
	if !handled || !terminal || recorded == nil || recorded.InputTokens != 23 || recorded.OutputTokens != 11 {
		t.Fatal("cancelled owner lost incurred first-response usage")
	}
	reader, release, err := r.stream.ClaimReader()
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	select {
	case event := <-reader:
		if event.GetSessionTerminal() == nil {
			t.Fatal("cancelled owner exposed a successful request")
		}
	case <-time.After(time.Second):
		t.Fatal("terminal missing")
	}
}
