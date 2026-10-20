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
	if err := svc.runLifeFrameSweep(context.Background(), now); err == nil {
		t.Fatal("expected persistence failure")
	}
	failed, _ := svc.agentByID(id)
	if !proto.Equal(before.Agent, failed.Agent) || svc.sequence != sequence {
		t.Fatal("failed transaction changed usage or events")
	}
	if _, err := svc.backend.DB().Exec(`DROP TRIGGER budget_write_failure`); err != nil {
		t.Fatal(err)
	}
	if err := svc.runLifeFrameSweep(context.Background(), now); err != nil {
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
