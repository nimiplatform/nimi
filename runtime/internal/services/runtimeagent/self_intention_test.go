package runtimeagent

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestOptionalSelfIntentionKeepsOrdinaryStreamingBody(t *testing.T) {
	for _, tail := range []string{"", `<self-intention>{broken}</self-intention><intention-confirmation>Already done.</intention-confirmation>`, `<self-intention>{"action":"adopt","tool":"weather"}</self-intention>`, `<intention-confirmation>Already done.</intention-confirmation>`, `<self-intention>{`} {
		raw := `<message intent="reply">A normal answer.</message>` + tail
		text, _ := publicChatStreamingMessageText(raw)
		body, err := parsePublicChatStructuredEnvelope(raw)
		if err != nil || body.Message.Text != "A normal answer." || text != body.Message.Text {
			t.Fatalf("ordinary body lost: %+v %q %v", body, text, err)
		}
		if strings.Contains(text, "Already done") {
			t.Fatal("conditional confirmation escaped before owner commit")
		}
	}
}

func TestMisplacedOptionalSuggestionCannotBreakReplyOrLeakConfirmation(t *testing.T) {
	raw := `<message intent="reply">Independent reply.<self-intention><action>adopt</action></self-intention><intention-confirmation>Already adopted.</intention-confirmation></message>`
	body, err := parsePublicChatStructuredEnvelope(raw)
	if err != nil || body.Message.Text != "Independent reply." || body.ControlError == "" || !body.IntentionSuggested {
		t.Fatalf("invalid optional field broke ordinary reply: %+v %v", body, err)
	}
	text, _ := publicChatStreamingMessageText(raw)
	if text != "Independent reply." {
		t.Fatal("uncommitted confirmation escaped")
	}
}

func TestInteractionRetainsIndependentFutureAndBlocksMissingProgress(t *testing.T) {
	now := time.Now().UTC()
	l := newAgentLifeState()
	l.Activities["drawing"] = &lifeActivity{Ref: "drawing", Title: "Drawing", Kind: "project", Phase: lifePlanned}
	l.Activities["reading"] = &lifeActivity{Ref: "reading", Title: "Reading", Kind: "routine", Phase: lifePlanned}
	if err := l.acceptFuture([]lifeFrameProposal{{ActivityRef: "drawing", Title: "Outline", Kind: "project", DurationMinutes: 1, EndProgress: 50}, {ActivityRef: "drawing", Title: "Finish", Description: &lifeSelfDescription{Action: "create", Object: "Line study", Result: "completed"}, Kind: "project", DurationMinutes: 2, EndProgress: 100, CompletesActivity: true}, {ActivityRef: "reading", Title: "Reading", Kind: "routine", DurationMinutes: 5, EndProgress: 100, CompletesActivity: true}}, now, 1, nil, false); err != nil {
		t.Fatal(err)
	}
	reading := l.Future[2]
	if _, err := l.beginInteraction("turn", now.Add(30*time.Second), true, false); err != nil {
		t.Fatal(err)
	}
	if completed, err := l.advance(now.Add(2*time.Minute), false); err != nil || len(completed) != 0 || l.Activities["drawing"].Progress != 0 {
		t.Fatal("conversation fabricated simulated progress")
	}
	if err := l.finishInteraction(now.Add(2 * time.Minute)); err != nil {
		t.Fatal(err)
	}
	if len(l.Future) != 1 || l.Future[0].ID != reading.ID || l.Future[0].Title != reading.Title || !l.Future[0].StartsAt.Equal(reading.StartsAt) {
		t.Fatalf("unrelated future lost: %+v", l.Future)
	}
	if l.canPlanAt(now.Add(2*time.Minute), 1) {
		t.Fatal("valid retained future forced a planning call")
	}
	if _, err := l.advance(reading.StartsAt, false); err != nil || l.Current == nil || l.Current.ID != reading.ID {
		t.Fatal("retained future did not resume")
	}
}

func TestSelfIntentionAbandonRemovesOnlyRelatedFuture(t *testing.T) {
	l := newAgentLifeState()
	now := time.Now().UTC()
	if err := l.acceptFuture([]lifeFrameProposal{{Title: "Painting", Kind: "project", DurationMinutes: 20}, {Title: "Reading", Kind: "routine", DurationMinutes: 10}}, now.Add(time.Hour), 1, nil, false); err != nil {
		t.Fatal(err)
	}
	ref, unrelated := l.Future[0].ActivityRef, l.Future[1]
	l.NextCheckAt = now.Add(24 * time.Hour)
	result, err := acceptSelfIntention(l, &selfIntentionProposal{Action: "abandon", ActivityRef: ref}, now)
	if err != nil || !result.Accepted || l.Activities[ref].Phase != lifeCanceled || len(l.Future) != 1 || l.Future[0].ID != unrelated.ID || l.NextCheckAt.After(now) {
		t.Fatalf("abandonment not atomic: %+v %v", l, err)
	}
}

func TestSelfIntentionOwnerCommitCancellationReplayAndStaleness(t *testing.T) {
	for _, mode := range []string{"accept", "cancel-before", "stale"} {
		t.Run(mode, func(t *testing.T) {
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
			req := publicChatTurnRequestPayload{LocalAgentRef: testRuntimeAgentLocalRef("agent-alpha"), OwnerUserID: "user-1", RuntimeSourceRef: testRuntimeAgentSourceRef("agent-alpha"), ConversationAnchorID: anchorID, RequestID: "intention", Messages: []publicChatMessagePayload{{Role: "user", Content: "What do you want to create?"}}}
			session, turn, _, err := svc.reservePublicChatTurn(context.Background(), "desktop.app", "user-1", req)
			if err != nil {
				t.Fatal(err)
			}
			defer svc.publicChatRuntime().releaseTurn(anchorID, turn.TurnID)
			if _, err = svc.publicChatRuntime().composePublicChatTurnContext(context.Background(), session, turn, req); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if mode == "cancel-before" {
				cancel()
			}
			if mode == "stale" {
				svc.mu.Lock()
				svc.agents[req.LocalAgentRef].Life.Revision++
				svc.mu.Unlock()
			}
			p := &selfIntentionProposal{Action: "adopt", Title: "A cloud postcard", Kind: "project"}
			result, err := svc.applySelfIntention(ctx, session, turn, req, p, "I have chosen to make a postcard.", nil)
			entry, _ := svc.agentByID(req.LocalAgentRef)
			if mode != "accept" {
				if len(entry.Life.Activities) != 0 || result != nil && result.Accepted {
					t.Fatal("invalid suggestion changed life")
				}
				return
			}
			if err != nil || result == nil || !result.Accepted || len(entry.Life.Activities) != 1 {
				t.Fatalf("owner failed: %+v %v", result, err)
			}
			cancel() // Output interruption after commit cannot undo the result.
			again, err := svc.applySelfIntention(context.Background(), session, turn, req, p, "second", nil)
			if err != nil || again.ActivityRef != result.ActivityRef || again.Confirmation != result.Confirmation {
				t.Fatal("original result replayed or changed")
			}
			if err := svc.stateRepo.loadAgentLifeState(svc); err != nil {
				t.Fatal(err)
			}
			restored, _ := svc.agentByID(req.LocalAgentRef)
			if len(restored.Life.Activities) != 1 {
				t.Fatal("committed intention lost on recovery")
			}
		})
	}
}

func TestInteractionOnlyRealConflictReopensPlanning(t *testing.T) {
	now := time.Now().UTC()
	for _, conflict := range []bool{false, true} {
		l := newAgentLifeState()
		if conflict {
			if err := l.acceptFuture([]lifeFrameProposal{{Title: "Outline", Kind: "project", DurationMinutes: 10, EndProgress: 50}}, now, 1, nil, false); err != nil {
				t.Fatal(err)
			}
		}
		l.NextCheckAt = now.Add(time.Hour)
		if _, err := l.beginInteraction("turn", now.Add(time.Minute), true, false); err != nil {
			t.Fatal(err)
		}
		if err := l.finishInteraction(now.Add(2 * time.Minute)); err != nil {
			t.Fatal(err)
		}
		if l.canPlanAt(now.Add(2*time.Minute), 1) != conflict {
			t.Fatalf("new chat is not a planning reason; real interruption is: conflict=%v", conflict)
		}
	}
}
