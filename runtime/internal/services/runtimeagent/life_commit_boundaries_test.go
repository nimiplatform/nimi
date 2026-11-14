package runtimeagent

import (
	"context"
	"database/sql"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type lifeAccountTestOwner struct {
	mu         sync.Mutex
	generation uint64
	invalid    chan struct{}
}

func (o *lifeAccountTestOwner) AuthenticatedRuntimeProjection(ctx context.Context) (*runtimev1.AccountProjection, bool) {
	projection, _, _, ok := o.BindAuthenticatedRuntimeGeneration(ctx)
	return projection, ok
}

func (o *lifeAccountTestOwner) BindAuthenticatedRuntimeGeneration(context.Context) (*runtimev1.AccountProjection, uint64, <-chan struct{}, bool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	return &runtimev1.AccountProjection{AccountId: "user-1", RealmEnvironmentId: "test-realm"}, o.generation, o.invalid, true
}

func (o *lifeAccountTestOwner) CommitAuthenticatedRuntimeGeneration(ctx context.Context, accountID, realmID string, generation uint64, commit func() error) (bool, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if ctx.Err() != nil || accountID != "user-1" || realmID != "test-realm" || o.generation != generation {
		return false, ctx.Err()
	}
	return true, commit()
}

func TestLifeAccountReplacementRejectsOldPlanningResultEvenAfterRelogin(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	owner := &lifeAccountTestOwner{generation: 1, invalid: make(chan struct{})}
	svc.SetRuntimeAccountProjectionProvider(owner)
	ai := &fakeLifeTurnAI{response: &runtimev1.ExecuteScenarioResponse{
		FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
		Usage:        &runtimev1.UsageStats{InputTokens: 30, OutputTokens: 4},
		Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextGenerate{
			TextGenerate: &runtimev1.TextGenerateOutput{Text: `{"past":[],"future":[{"title":"Old account result","kind":"routine","duration_minutes":15,"end_progress":100,"completes_activity":true}],"next_check_minutes":60}`},
		}},
	}}
	svc.aiBridge.lifeFrameAI = lifeAIAccountReplacementExecutor{next: ai, owner: owner}
	ref := testRuntimeAgentLocalRef("agent-alpha")
	now := time.Now().UTC()
	if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Enabled = true
		e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW
		e.Agent.Autonomy.Config.DailyTokenBudget = 0
		e.Life.StartedAt, e.Life.SettledAt = now, now
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := svc.runLifeFrameSweep(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	svc.lifeFrameWG.Wait()
	entry, _ := svc.agentByID(ref)
	if len(ai.requests) != 1 || entry.Life.Current != nil || len(entry.Life.Future) != 0 || entry.Agent.Autonomy.UsedTokensInWindow != 34 {
		t.Fatalf("old account result was accepted or usage was lost: calls=%d active=%t future=%d tokens=%d", len(ai.requests), entry.Life.Current != nil, len(entry.Life.Future), entry.Agent.Autonomy.UsedTokensInWindow)
	}
}

type lifeAIAccountReplacementExecutor struct {
	next  lifeFrameScenarioExecutor
	owner *lifeAccountTestOwner
}

func (e lifeAIAccountReplacementExecutor) ExecuteScenario(ctx context.Context, request *runtimev1.ExecuteScenarioRequest) (*runtimev1.ExecuteScenarioResponse, error) {
	e.owner.mu.Lock()
	close(e.owner.invalid)
	e.owner.generation++
	e.owner.invalid = make(chan struct{})
	e.owner.mu.Unlock()
	return e.next.ExecuteScenario(ctx, request)
}

func TestJointLifeJudgmentConsumesDueContactWithoutSending(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ref := testRuntimeAgentLocalRef("agent-alpha")
	now := time.Now().UTC()
	if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Enabled = true
		e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW
		e.Agent.Autonomy.Config.FreeContactEnabled = true
		e.Agent.Autonomy.Config.MaxFreeContactsPerDay = 3
		e.Life.ContactNextAt = now.Add(-time.Minute)
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	entry, _ := svc.agentByID(ref)
	source, _ := svc.turnSourceView(ref)
	work := svc.claimAgentBackground(context.Background(), ref)
	defer svc.releaseAgentBackground(ref, work)
	if err := svc.commitLifeFramePlanning(work, lifeFrameExecutionInput{Entry: entry, Source: source, Now: now}, &lifeFrameResult{NextCheckMinutes: 60}, 27); err != nil {
		t.Fatal(err)
	}
	after, _ := svc.agentByID(ref)
	if !after.Life.ContactConsideredAt.Equal(now) || !after.Life.ContactNextAt.After(now.Add(time.Hour)) || len(after.Life.Intents) != 0 || len(after.Life.ContactTimes) != 0 || after.Agent.Autonomy.UsedTokensInWindow != 27 {
		t.Fatalf("joint no-send did not consume just the paid opportunity: %+v", after.Life)
	}
}

func TestLifeCancellationWhileWaitingForCommitRollsBackEffects(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ref := testRuntimeAgentLocalRef("agent-alpha")
	if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Enabled = true
		e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	entry, _ := svc.agentByID(ref)
	source, _ := svc.turnSourceView(ref)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	work := svc.claimAgentBackground(ctx, ref)
	defer svc.releaseAgentBackground(ref, work)
	locked, release, unlocked := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() {
		unlocked <- svc.stateRepo.backend.WriteTx(context.Background(), func(*sql.Tx) error { close(locked); <-release; return nil })
	}()
	<-locked
	done := make(chan error, 1)
	now := time.Now().UTC()
	go func() {
		done <- svc.commitLifeFramePlanning(work, lifeFrameExecutionInput{Entry: entry, Source: source, Now: now}, &lifeFrameResult{Future: []lifeFrameProposal{{Title: "A quiet walk", Kind: "routine", DurationMinutes: 5, EndProgress: 100, CompletesActivity: true}}, NextCheckMinutes: 60}, 31)
	}()
	// The owner holds this lock only after preparing its state and just before
	// persistence; the occupied database keeps the final transaction pending.
	deadline := time.Now().Add(5 * time.Second)
	for svc.chatSurfaceMu.TryLock() {
		svc.chatSurfaceMu.Unlock()
		if time.Now().After(deadline) {
			close(release)
			t.Fatal("commit did not reach persistence")
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	close(release)
	if err := <-unlocked; err != nil {
		t.Fatal(err)
	}
	if err := <-done; err == nil {
		t.Fatal("canceled work committed life effects")
	}
	svc.recordLifePlanningFailure(work, entry, context.Canceled, 31)
	after, _ := svc.agentByID(ref)
	if len(after.Life.Activities) != 0 || len(after.Life.Future) != 0 || after.Life.Current != nil || after.Agent.Autonomy.UsedTokensInWindow != 31 {
		t.Fatalf("canceled effects or actual cost were mishandled: %+v", after.Life)
	}
}

func TestJointContactCommitUsesCurrentQuietHours(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ref := testRuntimeAgentLocalRef("agent-alpha")
	before := time.Now().UTC()
	if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Enabled = true
		e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW
		e.Agent.Autonomy.Config.FreeContactEnabled = true
		e.Agent.Autonomy.Config.MaxFreeContactsPerDay = 3
		e.Life.ContactNextAt = before.Add(-time.Minute)
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	oldEntry, _ := svc.agentByID(ref)
	source, _ := svc.turnSourceView(ref)
	minute := uint32(before.In(time.UTC).Hour()*60 + before.In(time.UTC).Minute())
	if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Config.QuietHours = &runtimev1.AgentContactQuietHours{Timezone: "UTC", StartMinute: minute, EndMinute: (minute + 1) % 1440}
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	work := svc.claimAgentBackground(context.Background(), ref)
	defer svc.releaseAgentBackground(ref, work)
	if err := svc.commitLifeFramePlanning(work, lifeFrameExecutionInput{Entry: oldEntry, Source: source, Now: before}, &lifeFrameResult{NextCheckMinutes: 60}, 27); err != nil {
		t.Fatal(err)
	}
	after, _ := svc.agentByID(ref)
	if lifeContactPermitted(after, time.Now().UTC()) {
		t.Fatal("test setup did not enter quiet hours")
	}
	if after.Life.ContactNextAt.After(before.Add(time.Hour)) {
		t.Fatalf("joint judgment consumed a contact opportunity after it became ineligible: next=%v before=%v", after.Life.ContactNextAt, before)
	}
}
