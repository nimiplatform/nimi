package runtimeagent

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestAutonomyBudgetFixedWindows(t *testing.T) {
	start := time.Date(2026, 10, 14, 19, 57, 44, 867771000, time.UTC)
	for _, tc := range []struct {
		name    string
		at      time.Time
		windows int64
	}{
		{"before boundary", start.Add(24*time.Hour - time.Nanosecond), 0},
		{"exact boundary", start.Add(24 * time.Hour), 1},
		{"long idle", start.Add(73 * time.Hour), 3},
		{"clock rollback", start.Add(-48 * time.Hour), 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			entry := &agentEntry{Agent: &runtimev1.LocalAgentRecord{Autonomy: &runtimev1.AgentAutonomyState{
				Revision: 4, Config: &runtimev1.AgentAutonomyConfig{DailyTokenBudget: 10}, UsedTokensInWindow: 10,
				WindowStartedAt: timestamppb.New(start), BudgetExhausted: true,
			}}}
			advanceAutonomyWindow(entry, tc.at)
			a := entry.Agent.Autonomy
			wantUsed := int64(10)
			if tc.windows > 0 {
				wantUsed = 0
			}
			if !a.WindowStartedAt.AsTime().Equal(start.Add(time.Duration(tc.windows)*24*time.Hour)) || a.UsedTokensInWindow != wantUsed || a.BudgetExhausted != (wantUsed == 10) || a.Revision != 4 {
				t.Fatalf("unexpected budget: %v", a)
			}
			applyTokenUsage(entry, 12, tc.at)
			if a.UsedTokensInWindow != wantUsed+12 || !a.BudgetExhausted {
				t.Fatalf("actual usage lost: %v", a)
			}
			a.Config.DailyTokenBudget = 0
			advanceAutonomyWindow(entry, tc.at)
			if a.BudgetExhausted || a.UsedTokensInWindow != wantUsed+12 {
				t.Fatal("zero limit erased usage or exhausted")
			}
			a.Config.DailyTokenBudget = 1
			advanceAutonomyWindow(entry, tc.at)
			if !a.BudgetExhausted {
				t.Fatal("configuration change reset the active window")
			}
		})
	}
}

func TestAutonomyBudgetLateResultsKeepCancellationAndUseAccountingWindow(t *testing.T) {
	for _, canceled := range []bool{false, true} {
		for _, invalid := range []bool{false, true} {
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			id := testRuntimeAgentLocalRef("agent-alpha")
			start := time.Now().UTC().Add(-25 * time.Hour)
			if err := svc.mutateAgent(id, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
				e.Agent.Autonomy.WindowStartedAt = timestamppb.New(start)
				e.Agent.Autonomy.UsedTokensInWindow = 10
				e.Agent.Autonomy.Config.DailyTokenBudget = 10
				e.Agent.Autonomy.BudgetExhausted = true
				return nil, nil, nil
			}); err != nil {
				t.Fatal(err)
			}
			intent := timeHookIntentForDelay(id, time.Second, "late activity")
			if err := svc.admitPendingHook(id, &runtimev1.PendingHook{Intent: intent, ScheduledFor: timestamppb.New(start), AdmittedAt: timestamppb.New(start)}); err != nil {
				t.Fatal(err)
			}
			if _, err := svc.markHookRunningAt(id, intent.IntentId, start); err != nil {
				t.Fatal(err)
			}
			if canceled {
				if _, err := svc.cancelHook(id, intent.IntentId, "user", "stop"); err != nil {
					t.Fatal(err)
				}
			}
			result := &lifeTurnResult{TokensUsed: 7}
			if invalid {
				result.NextHookIntent = &runtimev1.HookIntent{}
			}
			if _, err := svc.lifeTrackController().applyResult(context.Background(), id, intent.IntentId, result, time.Now().UTC()); err != nil {
				t.Fatal(err)
			}
			e, err := svc.agentByID(id)
			if err != nil {
				t.Fatal(err)
			}
			if e.Agent.Autonomy.UsedTokensInWindow != 7 || e.Agent.Autonomy.BudgetExhausted || !e.Agent.Autonomy.WindowStartedAt.AsTime().Equal(start.Add(24*time.Hour)) {
				t.Fatalf("late accounting: %v", e.Agent.Autonomy)
			}
			if canceled && hookAdmissionState(e.Hooks[intent.IntentId]) != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_CANCELED {
				t.Fatal("late result revived canceled activity")
			}
		}
	}
}

func TestAutonomyBudgetWindowRollbackAndRestart(t *testing.T) {
	path := t.TempDir() + "/runtime-state.json"
	svc, closeSvc := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, path)
	closed := false
	defer func() {
		if !closed {
			closeSvc()
		}
	}()
	id := testRuntimeAgentLocalRef("agent-alpha")
	now := time.Now().UTC()
	start := now.Add(-49 * time.Hour)
	if err := svc.mutateAgent(id, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.WindowStartedAt = timestamppb.New(start)
		e.Agent.Autonomy.UsedTokensInWindow = 20
		e.Agent.Autonomy.Config.DailyTokenBudget = 10
		e.Agent.Autonomy.BudgetExhausted = true
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	before, _ := svc.agentByID(id)
	sequence := svc.sequence
	if _, err := svc.backend.DB().Exec(`CREATE TRIGGER budget_write_failure BEFORE UPDATE ON runtime_local_agent BEGIN SELECT RAISE(FAIL, 'budget write failure'); END`); err != nil {
		t.Fatal(err)
	}
	if err := svc.reconcileAgentCadenceHook(id, now); err == nil {
		t.Fatal("expected persistence failure")
	}
	failed, _ := svc.agentByID(id)
	if !proto.Equal(before.Agent, failed.Agent) || svc.sequence != sequence {
		t.Fatal("failed transaction changed usage or events")
	}
	if _, err := svc.backend.DB().Exec(`DROP TRIGGER budget_write_failure`); err != nil {
		t.Fatal(err)
	}
	if err := svc.reconcileAgentCadenceHook(id, now); err != nil {
		t.Fatal(err)
	}
	after, _ := svc.agentByID(id)
	if after.Agent.Autonomy.UsedTokensInWindow != 0 || after.Agent.Autonomy.BudgetExhausted || !after.Agent.Autonomy.WindowStartedAt.AsTime().Equal(start.Add(48*time.Hour)) {
		t.Fatalf("rollover: %v", after.Agent.Autonomy)
	}
	if after.Agent.Autonomy.Revision != before.Agent.Autonomy.Revision || svc.sequence <= sequence {
		t.Fatal("window changed config revision or omitted budget event")
	}
	closeSvc()
	closed = true
	restarted, closeRestarted := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, path)
	defer closeRestarted()
	restored, err := restarted.agentByID(id)
	if err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(after.Agent.Autonomy, restored.Agent.Autonomy) {
		t.Fatal("restart changed committed window")
	}
}

func TestAutonomyBudgetExpiredAdmissionAndActualResultTime(t *testing.T) {
	for _, expiredAtAdmission := range []bool{false, true} {
		svc := newRuntimeAgentServiceForPublicChatTest(t)
		id := testRuntimeAgentLocalRef("agent-alpha")
		actualNow := time.Now().UTC()
		admissionAt := actualNow.Add(-2 * time.Hour)
		start := actualNow.Add(-25 * time.Hour)
		if expiredAtAdmission {
			admissionAt = actualNow
		}
		if err := svc.mutateAgent(id, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
			e.Agent.Autonomy.Enabled = true
			e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_HIGH
			e.Agent.Autonomy.Config.DailyTokenBudget = 10
			e.Agent.Autonomy.WindowStartedAt = timestamppb.New(start)
			e.Agent.Autonomy.UsedTokensInWindow = 9
			if expiredAtAdmission {
				e.Agent.Autonomy.UsedTokensInWindow = 10
				e.Agent.Autonomy.BudgetExhausted = true
			}
			return nil, nil, nil
		}); err != nil {
			t.Fatal(err)
		}
		intent := timeHookIntentForDelay(id, 0, "budget admission")
		if err := svc.admitPendingHook(id, &runtimev1.PendingHook{Intent: intent, ScheduledFor: timestamppb.New(admissionAt), AdmittedAt: timestamppb.New(admissionAt)}); err != nil {
			t.Fatal(err)
		}
		// Model an activity admitted in the previous window; fixture time is
		// deterministic while the executor's result uses the production clock.
		if err := svc.mutateAgent(id, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
			e.Hooks[intent.IntentId].ScheduledFor = timestamppb.New(admissionAt)
			return nil, nil, nil
		}); err != nil {
			t.Fatal(err)
		}
		called := false
		outcome, err := svc.lifeTrackController().executePendingHook(context.Background(), id, intent.IntentId, admissionAt, func(_ context.Context, req *lifeTurnRequest) (*lifeTurnResult, error) {
			called = true
			if expiredAtAdmission && req.Autonomy.UsedTokensInWindow != 0 {
				t.Fatal("executor saw expired usage")
			}
			return &lifeTurnResult{TokensUsed: 3}, nil
		})
		if err != nil {
			t.Fatal(err)
		}
		if !called || outcome.GetObservedAt().AsTime().Before(actualNow) {
			t.Fatalf("not executed/accounted at result time: %v", outcome)
		}
		e, _ := svc.agentByID(id)
		if e.Agent.Autonomy.UsedTokensInWindow != 3 || e.Agent.Autonomy.BudgetExhausted || !e.Agent.Autonomy.WindowStartedAt.AsTime().Equal(start.Add(24*time.Hour)) {
			t.Fatalf("wrong accounting window: %v", e.Agent.Autonomy)
		}
	}
}
