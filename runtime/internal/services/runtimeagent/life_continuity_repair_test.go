package runtimeagent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
)

func TestSolitaryIntentionChangeCommitsFutureAndMemoryTogether(t *testing.T) {
	for _, action := range []string{"change", "abandon", "invalid"} {
		t.Run(action, func(t *testing.T) {
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			ref := testRuntimeAgentLocalRef("agent-alpha")
			now := time.Now().UTC()
			var target, retained string
			if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
				e.Agent.Autonomy.Enabled = true
				e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW
				e.Life.StartedAt, e.Life.SettledAt = now, now
				if err := e.Life.acceptFuture([]lifeFrameProposal{
					{Title: "Cloud study", Kind: "project", DurationMinutes: 30, EndProgress: 50},
					{Title: "River walk", Kind: "routine", DurationMinutes: 10, EndProgress: 100, CompletesActivity: true},
				}, now.Add(time.Hour), 1, nil, false); err != nil {
					return nil, nil, err
				}
				target, retained = e.Life.Future[0].ActivityRef, e.Life.Future[1].ID
				return nil, nil, nil
			}); err != nil {
				t.Fatal(err)
			}
			entry, _ := svc.agentByID(ref)
			source, _ := svc.turnSourceView(ref)
			work := svc.claimAgentBackgroundFor(context.Background(), ref, "life_planning")
			if work == nil {
				t.Fatal("background owner unavailable")
			}
			defer svc.releaseAgentBackground(ref, work)
			title, result := "Quiet cloud study", "direction_changed"
			if action == "abandon" {
				title, result = "", "abandoned"
			}
			raw := fmt.Sprintf(`{"action":%q,"activity_ref":%q,"title":%q,"experience":{"action":"create","object":"Cloud study","result":%q,"outcome":"Selected quieter lines"}}`, action, target, title, result)
			proposal := &lifeFrameResult{SelfIntention: json.RawMessage(raw), NextCheckMinutes: 60}
			if action == "invalid" {
				proposal.Future = []lifeFrameProposal{{ActivityRef: target, Title: "Must not assume the rejected change", Kind: "project", DurationMinutes: 1, EndProgress: 50}}
			}
			if err := svc.commitLifeFramePlanning(work, lifeFrameExecutionInput{Entry: entry, Source: source, Now: now, RequestID: "life_repair_" + action}, proposal, 0); err != nil {
				t.Fatal(err)
			}
			after, _ := svc.agentByID(ref)
			if action == "invalid" {
				if len(after.Life.Future) != 2 || after.Life.Activities[target].Title != "Cloud study" {
					t.Fatal("invalid optional mutation affected accepted future")
				}
				return
			}
			if len(after.Life.Future) != 1 || after.Life.Future[0].ID != retained {
				t.Fatal("target future was retained or unrelated future was lost")
			}
			if action == "change" && after.Life.Activities[target].Title != title || action == "abandon" && after.Life.Activities[target].Phase != lifeCanceled {
				t.Fatal("own intention mutation did not commit")
			}
			svc.triggerCognitionMemory(ref)
			svc.cognitionMemoryWG.Wait()
			recalled, err := svc.cognitionMemoryFacade.Recall(context.Background(), cognitionmemory.RecallIntent{LocalAgentRef: ref, Query: "Cloud study", IncludeRecentLife: true, Limit: 4})
			if err != nil || len(recalled.Hits) != 1 || !strings.Contains(recalled.Hits[0].Content, "Cloud study") {
				t.Fatalf("committed solitary experience not recalled: %+v %v", recalled, err)
			}
		})
	}
}

func TestLifeExhaustionRechecksOnceAndChatBoundsPast(t *testing.T) {
	now := time.Now().UTC()
	life := newAgentLifeState()
	if err := life.acceptFuture([]lifeFrameProposal{{Title: "Walk", Kind: "routine", DurationMinutes: 1, EndProgress: 100, CompletesActivity: true}}, now, 1, nil, false); err != nil {
		t.Fatal(err)
	}
	life.NextCheckAt = now.Add(2 * time.Hour)
	if _, err := life.advance(now.Add(time.Minute), false); err != nil {
		t.Fatal(err)
	}
	if !life.canPlanAt(now.Add(time.Minute), 1) {
		t.Fatal("exhaustion did not allow a coverage check")
	}
	life.NextCheckAt = now.Add(time.Hour) // an ensuing budget/failure wait
	if _, err := life.advance(now.Add(2*time.Minute), false); err != nil || !life.NextCheckAt.Equal(now.Add(time.Hour)) {
		t.Fatal("empty sweep overwrote the ensuing wait")
	}
	input := lifeExecutorTestInput(t, 128)
	input.Transcript = []agentTurnTranscriptPairInput{{TurnID: "turn", Sequence: 1, UserText: "New direction", AssistantText: "I will consider it"}}
	input.Transcript[0].KnownAt = input.Now.Add(-time.Minute)
	if err := constrainLifePastKnowledge(&input); err != nil {
		t.Fatal(err)
	}
	if input.PastFrom.Before(input.Transcript[0].KnownAt) {
		t.Fatal("new conversation could rewrite earlier unknown life")
	}
}

func TestNewDirectionAfterInteractionCanUseAnIndependentFutureGap(t *testing.T) {
	now := time.Now().UTC()
	life := newAgentLifeState()
	if err := life.acceptFuture([]lifeFrameProposal{{Title: "Later walk", Kind: "routine", DurationMinutes: 10, EndProgress: 100, CompletesActivity: true}}, now.Add(time.Hour), 1, nil, false); err != nil {
		t.Fatal(err)
	}
	retained := life.Future[0]
	if _, err := life.beginInteraction("turn", now, true, false); err != nil {
		t.Fatal(err)
	}
	if _, err := acceptSelfIntention(life, &selfIntentionProposal{Action: "adopt", Title: "Cloud study", Kind: "project"}, now); err != nil {
		t.Fatal(err)
	}
	if err := life.finishInteraction(now.Add(lifeInteractionSilence)); err != nil {
		t.Fatal(err)
	}
	if len(life.Future) != 1 || life.Future[0].ID != retained.ID || !life.canPlanAt(now.Add(lifeInteractionSilence), 1) {
		t.Fatal("retained future hid a newly accepted direction or was discarded")
	}
}

func TestProactiveBudgetIncludesPriorResponseWithoutChargingTwice(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ref := testRuntimeAgentLocalRef("agent-alpha")
	input := lifeExecutorTestInput(t, 128)
	compiled, err := compileLifeFrameContext(input)
	if err != nil {
		t.Fatal(err)
	}
	estimate, err := lifeCallEstimate(compiled)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Config.DailyTokenBudget = int64(estimate) + 10
		e.Agent.Autonomy.UsedTokensInWindow = 0
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	turn := publicChatTurnState{AgentID: ref, Origin: publicChatTurnOriginFollowUp}
	if err := svc.admitProactiveCall(context.Background(), turn, compiled, nil); err != nil {
		t.Fatal(err)
	}
	if err := svc.admitProactiveCall(context.Background(), turn, compiled, &runtimev1.UsageStats{InputTokens: 8, OutputTokens: 3}); err == nil {
		t.Fatal("second generation ignored the first response cost")
	}
	entry, _ := svc.agentByID(ref)
	if entry.Agent.Autonomy.UsedTokensInWindow != 0 {
		t.Fatal("admission charged cost that the existing turn accountant still owns")
	}
}

func TestMemoryInvalidationCancelsOnlyBackgroundWorkThatReadIt(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ref := testRuntimeAgentLocalRef("agent-alpha")
	work := svc.claimAgentBackgroundFor(context.Background(), ref, "life_planning")
	if work == nil {
		t.Fatal("background owner unavailable")
	}
	defer svc.releaseAgentBackground(ref, work)
	work.memoryRefs = []string{"read-memory"}
	svc.invalidateConversationMemoryReads(ref, map[string]bool{"unrelated-memory": true}, false)
	if work.ctx.Err() != nil {
		t.Fatal("unrelated Memory canceled the current work")
	}
	svc.invalidateConversationMemoryReads(ref, map[string]bool{"read-memory": true}, false)
	if work.ctx.Err() == nil || !work.invalidated {
		t.Fatal("invalidated input did not cancel its actual consumer")
	}
}
