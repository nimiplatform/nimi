package runtimeagent

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// Hold the real owner lock or serialized SQLite writer, not a substituted commit.
func holdUtopiaCommit(t *testing.T, svc *Service, boundary string) func() {
	t.Helper()
	if boundary == "agent-lock" {
		svc.mu.Lock()
		var once sync.Once
		release := func() { once.Do(svc.mu.Unlock) }
		t.Cleanup(release)
		return release
	}
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() {
		done <- svc.backend.WriteTx(context.Background(), func(*sql.Tx) error { close(entered); <-release; return nil })
	}()
	<-entered
	var once sync.Once
	unlock := func() {
		once.Do(func() {
			close(release)
			if err := <-done; err != nil {
				t.Error(err)
			}
		})
	}
	t.Cleanup(unlock)
	return unlock
}

func waitUtopiaExpiry(t *testing.T, expiry time.Time, done <-chan error) {
	t.Helper()
	select {
	case err := <-done:
		t.Fatalf("commit did not wait across expiry: %v", err)
	case <-time.After(time.Until(expiry.Add(10 * time.Millisecond))):
	}
}

func TestUtopiaRepairExpiryDuringCommitWait(t *testing.T) {
	for _, boundary := range []string{"uncontended", "agent-lock", "sqlite-writer"} {
		for _, purpose := range []string{"private", "contact", "public", "shared"} {
			t.Run(boundary+"/"+purpose, func(t *testing.T) {
				var svc *Service
				var input lifeFrameExecutionInput
				var public lifePublicInput
				if purpose == "shared" {
					var ref, recipient string
					var now time.Time
					svc, ref, recipient, now = prepareSharedLifeTest(t)
					entry, _ := svc.agentByID(ref)
					_, account, _ := svc.currentLifeAccount(context.Background())
					work := svc.claimAgentBackground(context.Background(), ref)
					t.Cleanup(func() { svc.releaseAgentBackground(ref, work) })
					input = lifeFrameExecutionInput{Entry: entry, Work: work, Account: account, Now: now}
					start := now.Add(25 * time.Minute)
					public.Options = []lifePublicOption{{Action: "invite", Place: "observation-window", Activity: "observe-snow", recipient: recipient, Deadline: now.Add(5 * time.Minute), StartsAt: start, EndsAt: start.Add(15 * time.Minute)}}
				} else {
					svc, input = repairPlanningFixture(t)
				}
				expiry := time.Now().UTC().Add(500 * time.Millisecond)
				seedRepairScenery(t, svc, expiry.Add(-30*time.Minute), expiry)
				attachRepairHabitat(t, svc, &input, time.Now().UTC())
				if !input.Context.UtopiaRead.customScenery() {
					t.Fatal("event was not consumed")
				}
				public.Utopia, public.habitatRead, public.account = *input.Context.Utopia, input.Context.UtopiaRead, input.Account
				if purpose == "public" {
					public.Options = lifePublicOptionsAt(input.Entry.Life, public.Utopia, input.Now)
					if len(public.Options) == 0 {
						t.Fatal("missing valid public action")
					}
				}
				beforeCurrent, beforeFuture := input.Entry.Life.Current, len(input.Entry.Life.Future)
				release := func() {}
				if boundary != "uncontended" {
					release = holdUtopiaCommit(t, svc, boundary)
				}
				done := make(chan error, 1)
				go func() {
					if purpose == "public" || purpose == "shared" {
						svc.commitPublicLifeChoice(input.Work, input.Entry, public, 1, 7, nil)
						done <- nil
						return
					}
					input.ContactOnly = purpose == "contact"
					result := &lifeFrameResult{NextCheckMinutes: 60, Contact: "Meteor shower", Future: []lifeFrameProposal{{Title: "Sketch the sky", Kind: "routine", DurationMinutes: 30, EndProgress: 100, CompletesActivity: true}}}
					err := svc.commitLifeFramePlanning(input.Work, input, result, 7)
					if err != nil {
						svc.recordLifePlanningFailure(input.Work, input.Entry, err, 7)
					}
					done <- nil
				}()
				if boundary != "uncontended" {
					waitUtopiaExpiry(t, expiry, done)
				}
				release()
				select {
				case err := <-done:
					if err != nil {
						t.Fatal(err)
					}
				case <-time.After(5 * time.Second):
					t.Fatal("commit failed to release locks")
				}
				after, _ := svc.agentByID(input.Entry.Agent.GetLocalAgentRef())
				if boundary != "uncontended" && (len(after.Life.Future) != beforeFuture || (after.Life.Current == nil) != (beforeCurrent == nil) || len(after.Life.Intents) != 0) {
					t.Fatal("expired input created Life effects")
				}
				if after.Agent.Autonomy.UsedTokensInWindow != input.Entry.Agent.Autonomy.UsedTokensInWindow+7 {
					t.Fatal("usage was lost or charged more than once")
				}
				records, err := svc.readLifeSharedRecords(context.Background(), "user-1")
				wantRecords := 0
				if boundary == "uncontended" {
					if purpose == "shared" {
						wantRecords = 1
					} else if purpose == "contact" {
						if len(after.Life.Intents) != 1 {
							t.Fatal("valid Contact control did not commit")
						}
					} else if after.Life.Current == nil && len(after.Life.Future) == 0 {
						t.Fatal("valid Life control did not commit")
					}
				}
				if err != nil || len(records) != wantRecords {
					t.Fatalf("shared records=%+v want=%d err=%v", records, wantRecords, err)
				}
			})
		}
	}
}

func TestUtopiaRepairProactiveExpiryDuringWriterWait(t *testing.T) {
	svc, input := repairPlanningFixture(t)
	expiry := time.Now().UTC().Add(500 * time.Millisecond)
	seedRepairScenery(t, svc, expiry.Add(-30*time.Minute), expiry)
	attachRepairHabitat(t, svc, &input, time.Now().UTC())
	ref := input.Entry.Agent.GetLocalAgentRef()
	intent := lifeProactiveIntent{ID: "waiting-contact", Source: "contact", Text: "Meteor shower", DueAt: input.Now, ExpiresAt: input.Now.Add(time.Hour), UtopiaRead: input.Context.UtopiaRead}
	if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Life.Intents = []lifeProactiveIntent{intent}
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	// Use the actual transcript owner; delaying its final writer must roll back
	// the transcript, ContactTimes and habitat observation as a single unit.
	anchor := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	req := publicChatTurnRequestPayload{LocalAgentRef: ref, OwnerUserID: "user-1", RuntimeSourceRef: testRuntimeAgentSourceRef("agent-alpha"), ConversationAnchorID: anchor, RequestID: "wait-contact", backgroundAdmission: input.Work, proactiveClaim: &intent, Messages: publicChatFollowUpInstructionInput("Generated contact")}
	runtime := svc.publicChatRuntime()
	session, turn, turnCtx, err := runtime.reserveTurn(context.Background(), "desktop.app", "user-1", req)
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.finishTurnReservation(session, turn.TurnID)
	release := holdUtopiaCommit(t, svc, "sqlite-writer")
	defer release()
	done := make(chan error, 1)
	go func() {
		done <- svc.commitPublicChatFollowUpTranscriptWithProjection(turnCtx, anchor, turn.TurnID, req.Messages[0].Content, intent.Text, func(p *publicChatTurnProjectionState) {
			p.Status, p.MessageID, p.AssistantText = publicChatTurnStatusCommitted, "wait-contact-reply", intent.Text
		})
	}()
	waitUtopiaExpiry(t, expiry, done)
	release()
	if err := <-done; err == nil {
		t.Fatal("expired contact transcript committed")
	}
	after, _ := svc.agentByID(ref)
	if len(after.Life.ContactTimes) != 0 || len(after.Life.Intents) != 1 {
		t.Fatal("failed contact consumed intent or delivery budget")
	}
	svc.chatSurfaceMu.Lock()
	defer svc.chatSurfaceMu.Unlock()
	if len(svc.chatAnchors[anchor].CommittedTranscript) != 0 {
		t.Fatal("expired contact reached transcript")
	}
}

func TestUtopiaRepairCustomProvenanceAcrossPlanningRounds(t *testing.T) {
	for _, source := range []string{"explanation", "recent", "activity"} {
		t.Run(source, func(t *testing.T) {
			svc, input := repairPlanningFixture(t)
			seedRepairScenery(t, svc, input.Now.Add(-time.Minute), input.Now.Add(30*time.Minute))
			attachRepairHabitat(t, svc, &input, input.Now)
			result := &lifeFrameResult{NextCheckMinutes: 60, Explanation: "Meteor drawing study"}
			if source != "explanation" {
				result.Past = []lifePastProposal{{Title: "Meteor drawing", Kind: "project", StartFraction: 0, EndFraction: 0.8, EndProgress: 20}}
			}
			if err := svc.commitLifeFramePlanning(input.Work, input, result, 0); err != nil {
				t.Fatal(err)
			}
			ref := input.Entry.Agent.GetLocalAgentRef()
			// Event expiry/clear is independent of durable derived state.
			seedRepairScenery(t, svc, input.Now.Add(-31*time.Minute), input.Now.Add(-time.Minute))
			if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
				if source != "explanation" {
					e.Life.Explanation = nil
				}
				if source == "activity" {
					e.Life.Recent = nil
				}
				if source == "recent" {
					for _, a := range e.Life.Activities {
						a.Phase = lifeCompleted
					}
				}
				return nil, nil, nil
			}); err != nil {
				t.Fatal(err)
			}
			// Rehydrate the persisted Life document, rather than relying on process-local flags.
			var raw string
			if err := svc.backend.DB().QueryRow(`SELECT life_json FROM runtime_local_agent_life WHERE local_agent_ref=?`, ref).Scan(&raw); err != nil {
				t.Fatal(err)
			}
			var restored agentLifeState
			if err := json.Unmarshal([]byte(raw), &restored); err != nil {
				t.Fatal(err)
			}
			input.Entry, _ = svc.agentByID(ref)
			input.Entry.Life = &restored
			input.Now = time.Now().UTC()
			attachRepairHabitat(t, svc, &input, input.Now)
			input.Binding = lifeExecutorTestInput(t, 1024).Binding
			if _, err := compileSelectedLifeFrameContext(&input, input.Context.Core); err != nil {
				t.Fatal(err)
			}
			if input.Context.UtopiaRead.customScenery() || !input.Context.customSceneryRead() {
				t.Fatalf("%s provenance disappeared after expiry", source)
			}
			next := &lifeFrameResult{NextCheckMinutes: 60, Explanation: "Continued meteor study", Future: []lifeFrameProposal{{Title: "A new drawing", Kind: "routine", DurationMinutes: 1, EndProgress: 100, CompletesActivity: true, Description: &lifeSelfDescription{Action: "create", Object: "drawing", Outcome: "Finished a drawing", Result: "completed"}}}}
			if err := svc.commitLifeFramePlanning(input.Work, input, next, 0); err != nil {
				t.Fatal(err)
			}
			after, _ := svc.agentByID(ref)
			if after.Life.Current == nil {
				t.Fatal("second planning round did not commit")
			}
			end := after.Life.Current.EndsAt
			if _, err := after.Life.advance(end); err != nil {
				t.Fatal(err)
			}
			frame := after.Life.Recent[len(after.Life.Recent)-1]
			if independentLifeFrameFact(after.Life, frame, end) != nil || !after.Life.Explanation.CustomSceneryDerived {
				t.Fatal("derived custom context was laundered into Memory")
			}
		})
	}
}

func TestUtopiaRepairCustomContinuationAndOptionalPruning(t *testing.T) {
	l := newAgentLifeState()
	now := time.Now().UTC()
	if err := l.acceptFuture([]lifeFrameProposal{{Title: "Study", Kind: "project", DurationMinutes: 1, EndProgress: 10, CustomSceneryActive: true}}, now, nil, false); err != nil {
		t.Fatal(err)
	}
	_, _ = l.advance(now.Add(time.Minute))
	var ref string
	for id := range l.Activities {
		ref = id
	}
	l.Recent = nil
	if err := l.acceptFuture([]lifeFrameProposal{{ActivityRef: ref, Title: "Continue study", Kind: "project", DurationMinutes: 1, EndProgress: 100, CompletesActivity: true}}, now.Add(time.Minute), nil, false); err != nil {
		t.Fatal(err)
	}
	if !l.Future[0].CustomSceneryActive {
		t.Fatal("continuation shed activity provenance")
	}
	input := lifeExecutorTestInput(t, 1024)
	input.Context.Explanation = strings.Repeat("large optional explanation ", 100000)
	input.Context.ExplanationCustomScenery = true
	compiled, err := compileSelectedLifeFrameContext(&input, input.Context.Core)
	if err != nil {
		t.Fatal(err)
	}
	if input.Context.customSceneryRead() {
		t.Fatal("pruned explanation permanently tainted an independent round")
	}
	for _, lane := range compiled.PrivateLanes {
		for _, item := range lane.Items {
			if item.StableID == "life.explanation" && item.Included {
				t.Fatal("fixture explanation was not pruned")
			}
		}
	}
	if got := projectLifeContext(l, true, true, nil, now); !got.CoreCustomScenery {
		t.Fatal("unfinished activity provenance dropped with explanation")
	}
	if _, err := l.advance(now.Add(2 * time.Minute)); err != nil {
		t.Fatal(err)
	}
	l.Recent = nil
	l.pruneActivities()
	if projectLifeContext(l, true, false, nil, now.Add(3*time.Minute)).customSceneryRead() {
		t.Fatal("pruned custom work left a permanent Agent taint")
	}
}

func TestUtopiaRepairConversationIntentionPreservesCustomSource(t *testing.T) {
	for _, custom := range []bool{false, true} {
		t.Run(fmt.Sprint(custom), func(t *testing.T) {
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			ref := testRuntimeAgentLocalRef("agent-alpha")
			if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
				e.Life.Explanation = &lifeExplanation{Text: "An earlier meteor drawing study", CustomSceneryDerived: custom}
				return nil, nil, nil
			}); err != nil {
				t.Fatal(err)
			}
			anchor := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
			req := publicChatTurnRequestPayload{LocalAgentRef: ref, OwnerUserID: "user-1", RuntimeSourceRef: testRuntimeAgentSourceRef("agent-alpha"), ConversationAnchorID: anchor, RequestID: "custom-intention", Messages: []publicChatMessagePayload{{Role: "user", Content: "What would you like to study?"}}}
			session, turn, ctx, err := svc.reservePublicChatTurn(context.Background(), "desktop.app", "user-1", req)
			if err != nil {
				t.Fatal(err)
			}
			defer svc.publicChatRuntime().releaseTurn(anchor, turn.TurnID)
			if _, err := svc.publicChatRuntime().composePublicChatTurnContext(ctx, session, turn, req); err != nil {
				t.Fatal(err)
			}
			result, err := svc.applySelfIntention(ctx, session, turn, req, &selfIntentionProposal{Action: "adopt", Title: "Meteor drawing", Kind: "project"}, "I will study drawing.", nil)
			if err != nil || result == nil || !result.Accepted {
				t.Fatalf("intention was not accepted: %+v %v", result, err)
			}
			if err := svc.stateRepo.loadAgentLifeState(svc); err != nil {
				t.Fatal(err)
			}
			after, _ := svc.agentByID(ref)
			if after.Life.Activities[result.ActivityRef].CustomSceneryDerived != custom {
				t.Fatal("actual Conversation input lost its Life provenance")
			}
			// A later direction change cannot turn the same derived identity into an
			// independent Cognition fact, even after explanations are gone.
			after.Life.Explanation = nil
			p := &selfIntentionProposal{Action: "change", ActivityRef: result.ActivityRef, Title: "Meteor composition", Description: &lifeSelfDescription{Action: "create", Object: "Meteor composition", Result: "direction_changed", Outcome: "Changed from line studies to composition"}}
			changed, err := acceptSelfIntention(after.Life, p, time.Now().UTC())
			if err != nil {
				t.Fatal(err)
			}
			hook, err := svc.selfIntentionMemoryTxHook(after, p, changed, "later-direction", time.Now().UTC())
			if err != nil {
				t.Fatal(err)
			}
			if (hook == nil) != custom {
				t.Fatalf("Memory sink custom=%t hook=%t", custom, hook != nil)
			}
		})
	}
}
