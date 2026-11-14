package runtimeagent

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestUtopiaDefaultAndRestorationKeepOneAccountRevision(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ctx := context.Background()
	initial, err := svc.readLifeUtopiaSettings(ctx, "user-1")
	if err != nil {
		t.Fatal(err)
	}
	island, err := initial.effective()
	if err != nil || island.Preset != lifeIslandPreset || island.Revision != 1 || !island.allows("bird-hide", "watch-birds") || initial.Public {
		t.Fatalf("default Utopia: %+v, %v", island, err)
	}
	var rows int
	if err := svc.backend.DB().QueryRow(`SELECT count(*) FROM runtime_agent_utopia_settings`).Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("default read wrote settings: %d, %v", rows, err)
	}
	commit := func(ctx context.Context, fn func(context.Context) error) error { return fn(ctx) }
	polar, err := svc.updateLifeUtopia(ctx, "user-1", 1, lifeUtopiaChange{Preset: lifePolarPreset}, commit)
	if err != nil || polar.Revision != 2 {
		t.Fatalf("select polar station: %+v, %v", polar, err)
	}
	restored, err := svc.updateLifeUtopia(ctx, "user-1", 2, lifeUtopiaChange{Restore: true}, commit)
	if err != nil || restored.Revision != 3 {
		t.Fatalf("restored default: %+v, %v", restored, err)
	}
	if _, err := svc.updateLifeUtopia(ctx, "user-1", 1, lifeUtopiaChange{Preset: lifePolarPreset}, commit); !errors.Is(err, errLifeUtopiaRevision) {
		t.Fatalf("stale initial revision was accepted after restoring default: %v", err)
	}
	other, err := svc.readLifeUtopiaSettings(ctx, "user-2")
	if err != nil || other.Revision != 1 || other.Preset != "" {
		t.Fatalf("other account inherited settings: %+v, %v", other, err)
	}
}

func TestUtopiaClosingLocationPreservesEstablishedActivityAndIndependentFuture(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ctx := context.Background()
	commit := func(ctx context.Context, fn func(context.Context) error) error { return fn(ctx) }
	if _, err := svc.updateLifeUtopia(ctx, "user-1", 1, lifeUtopiaChange{Preset: lifePolarPreset}, commit); err != nil {
		t.Fatal(err)
	}
	ref := testRuntimeAgentLocalRef("agent-alpha")
	start := time.Now().UTC().Add(-time.Minute)
	if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Life.StartedAt, e.Life.SettledAt = start, start
		if err := e.Life.acceptFuture([]lifeFrameProposal{
			{Title: "Watch snow outside", Kind: "routine", DurationMinutes: 20, EndProgress: 100, CompletesActivity: true, Place: "outdoor-platform", UtopiaActivity: "observe-snow"},
			{Title: "Organize the workshop", Kind: "routine", DurationMinutes: 20, EndProgress: 100, CompletesActivity: true, Place: "workshop", UtopiaActivity: "organize"},
		}, start, nil, false); err != nil {
			return nil, nil, err
		}
		_, err := e.Life.advance(start)
		return nil, nil, err
	}); err != nil {
		t.Fatal(err)
	}
	before, _ := svc.agentByID(ref)
	closed := false
	failed := errors.New("commit denied")
	if _, err := svc.updateLifeUtopia(ctx, "user-1", 2, lifeUtopiaChange{OutdoorOpen: &closed}, func(context.Context, func(context.Context) error) error { return failed }); !errors.Is(err, failed) {
		t.Fatalf("unexpected write failure: %v", err)
	}
	unchanged, _ := svc.agentByID(ref)
	if !lifeStateEqual(unchanged.Life, before.Life) {
		t.Fatal("a failed settings commit changed activity")
	}
	if _, err := svc.updateLifeUtopia(ctx, "user-1", 2, lifeUtopiaChange{OutdoorOpen: &closed}, commit); err != nil {
		t.Fatal(err)
	}
	after, _ := svc.agentByID(ref)
	if after.Life.Current != nil || len(after.Life.Recent) != 1 || after.Life.Recent[0].ID != before.Life.Current.ID || !after.Life.Recent[0].EndsAt.Before(before.Life.Current.EndsAt) ||
		len(after.Life.Future) != 1 || after.Life.Future[0].ID != before.Life.Future[0].ID || !after.Life.Future[0].StartsAt.Equal(before.Life.Future[0].StartsAt) {
		t.Fatalf("unexpected timeline after closure: %+v", after.Life)
	}
	var currentRows int
	if err := svc.backend.DB().QueryRow(`SELECT count(*) FROM runtime_local_agent_life WHERE local_agent_ref=? AND json_extract(life_json, '$.current') IS NULL`, ref).Scan(&currentRows); err != nil || currentRows != 1 {
		t.Fatalf("current frame wasn't cleared durably: %d, %v", currentRows, err)
	}
}

func TestUtopiaClosingLocationRetiresDependentFutureAndKeepsIndependentWork(t *testing.T) {
	settings := lifeUtopiaSettings{Revision: 1, Preset: lifePolarPreset}
	closed := false
	settings.OutdoorOpen = &closed
	utopia, err := settings.effective()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	life := newAgentLifeState()
	ref := "snow-study"
	life.Activities[ref] = &lifeActivity{Ref: ref, Title: "Snow study", Kind: "project", Phase: lifePlanned}
	if err := life.acceptFuture([]lifeFrameProposal{
		{ActivityRef: ref, Title: "Collect references", Kind: "project", Place: "outdoor-platform", UtopiaActivity: "observe-snow", DurationMinutes: 15, EndProgress: 50},
		{ActivityRef: ref, Title: "Draw from references", Kind: "project", Place: "workshop", UtopiaActivity: "sketch", DurationMinutes: 15, EndProgress: 100, CompletesActivity: true},
		{Title: "Read a book", Kind: "routine", Place: "workshop", UtopiaActivity: "read", DurationMinutes: 15, EndProgress: 100, CompletesActivity: true},
	}, now.Add(time.Minute), nil, false); err != nil {
		t.Fatal(err)
	}
	independent := life.Future[2]
	if changed, err := life.revalidateUtopia(utopia, false, now); err != nil || !changed {
		t.Fatalf("close Utopia location: changed=%t, err=%v", changed, err)
	}
	if len(life.Future) != 1 || life.Future[0].ID != independent.ID || life.Future[0].StartsAt != independent.StartsAt || life.Activities[ref].Progress != 0 {
		t.Fatalf("kept invalid progress or lost the independent frame: %+v", life.Future)
	}
}

func TestNextPersonalPlanReadsChangedUtopiaOnce(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ctx := context.Background()
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
	ai := &fakeLifeTurnAI{response: &runtimev1.ExecuteScenarioResponse{
		FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
		Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextGenerate{
			TextGenerate: &runtimev1.TextGenerateOutput{Text: `{"past":[],"future":[],"next_check_minutes":60}`},
		}},
	}}
	svc.aiBridge.lifeFrameAI = ai
	for pass := 0; pass < 3; pass++ {
		if pass == 1 {
			if _, err := svc.updateLifeUtopia(ctx, "user-1", 1, lifeUtopiaChange{Preset: lifePolarPreset}, func(ctx context.Context, fn func(context.Context) error) error { return fn(ctx) }); err != nil {
				t.Fatal(err)
			}
		}
		if pass > 0 {
			entry, err := svc.agentByID(ref)
			if err != nil {
				t.Fatal(err)
			}
			now = maxTime(entry.Life.NextCheckAt, entry.Life.LastLifeAttempt.Add(lifeMinimumAttemptInterval(entry))).Add(time.Second)
		}
		if err := svc.runLifeFrameSweep(ctx, now); err != nil {
			t.Fatal(err)
		}
		svc.lifeFrameWG.Wait()
		if len(ai.requests) != pass+1 {
			t.Fatalf("pass %d dispatched %d model calls", pass, len(ai.requests))
		}
		prompt := ai.requests[pass].GetSpec().GetTextGenerate().GetInput()[0].GetContent()
		var modelUtopia struct {
			Current  lifeUtopia                    `json:"current"`
			Previous *lifeUtopiaPlanningConditions `json:"previous_if_changed"`
		}
		var value string
		for _, line := range strings.Split(prompt, "\n") {
			encoded, found := strings.CutPrefix(line, "content_json_string=")
			if !found {
				continue
			}
			section, _ := strconv.Unquote(encoded)
			if _, tail, ok := strings.Cut(section, "\nutopia="); ok {
				value, _ = strconv.Unquote(tail)
				break
			}
		}
		if err := json.Unmarshal([]byte(value), &modelUtopia); err != nil {
			t.Fatalf("missing Utopia context on pass %d", pass)
		}
		current, previous := lifeIslandPreset, ""
		if pass > 0 {
			current = lifePolarPreset
		}
		if pass == 1 {
			previous = lifeIslandPreset
		}
		if modelUtopia.Current.Preset != current || (modelUtopia.Previous == nil) != (previous == "") || modelUtopia.Previous != nil && modelUtopia.Previous.Preset != previous {
			t.Fatalf("wrong Utopia context on pass %d", pass)
		}
	}
	var saved string
	if err := svc.backend.DB().QueryRow(`SELECT json_extract(life_json, '$.lastPlannedUtopia.preset') FROM runtime_local_agent_life WHERE local_agent_ref=?`, ref).Scan(&saved); err != nil || saved != lifePolarPreset {
		t.Fatalf("accepted current conditions were not stored: %q, %v", saved, err)
	}
}

func TestPublicLifeChoiceRunsWhilePersonalActivityRemainsValid(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ctx := context.Background()
	ref := testRuntimeAgentLocalRef("agent-alpha")
	enabled := true
	if _, err := svc.updateLifeUtopia(ctx, "user-1", 1, lifeUtopiaChange{Public: &enabled}, func(ctx context.Context, fn func(context.Context) error) error { return fn(ctx) }); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Enabled = true
		e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW
		e.Life.StartedAt, e.Life.SettledAt = now, now
		if err := e.Life.acceptFuture([]lifeFrameProposal{
			{Title: "private-intention-canary", Kind: "routine", DurationMinutes: 20, EndProgress: 100, CompletesActivity: true},
		}, now, nil, false); err != nil {
			return nil, nil, err
		}
		_, err := e.Life.advance(now)
		e.Life.NextCheckAt = now.Add(time.Hour)
		return nil, nil, err
	}); err != nil {
		t.Fatal(err)
	}
	ai := &fakeLifeTurnAI{response: &runtimev1.ExecuteScenarioResponse{
		FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
		Usage:        &runtimev1.UsageStats{InputTokens: 100, OutputTokens: 4},
		Output:       &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextGenerate{TextGenerate: &runtimev1.TextGenerateOutput{Text: `{"choice":1}`}}},
	}}
	svc.aiBridge.lifeFrameAI = ai
	if err := svc.runLifeFrameSweep(ctx, now); err != nil {
		t.Fatal(err)
	}
	svc.lifeFrameWG.Wait()
	result, _ := svc.agentByID(ref)
	if len(ai.requests) != 1 || result.Life.Current == nil || result.Life.Current.Title != "private-intention-canary" || len(result.Life.Future) != 1 || !result.Life.Future[0].Public || result.Life.Future[0].Place != "bird-hide" {
		t.Fatalf("public choice did not preserve the personal timeline: calls=%d, %+v", len(ai.requests), result.Life)
	}
	msg := ai.requests[0].GetSpec().GetTextGenerate().GetInput()[0].GetContent()
	if strings.Contains(msg, "private-intention-canary") || result.Agent.Autonomy.UsedTokensInWindow != 104 {
		t.Fatalf("public input or usage exceeded its boundary: usage=%d", result.Agent.Autonomy.UsedTokensInWindow)
	}
	settings, _ := svc.readLifeUtopiaSettings(ctx, "user-1")
	utopia, _ := settings.effective()
	svc.mu.RLock()
	before := svc.currentPublicLifeLocked("user-1", settings, utopia, nil, now)
	svc.mu.RUnlock()
	if len(before) != 0 {
		t.Fatal("tentative public activity was presented as current presence")
	}
	confirmedAt := result.Life.Future[0].StartsAt
	if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		_, err := e.Life.advance(confirmedAt)
		return nil, nil, err
	}); err != nil {
		t.Fatal(err)
	}
	svc.mu.RLock()
	present := svc.currentPublicLifeLocked("user-1", settings, utopia, nil, confirmedAt)
	svc.mu.RUnlock()
	if len(present) != 1 || present[0].Place != "bird-hide" || len(present[0].AgentRefs) != 1 || present[0].AgentRefs[0] != ref {
		t.Fatalf("current occupancy: %+v", present)
	}
}

func TestPolarTownWithoutPublicOptionsDoesNotSuppressDueContact(t *testing.T) {
	svc, a, b, now := prepareSharedLifeTest(t)
	ctx := context.Background()
	if err := svc.mutateAgent(a, func(entry *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		entry.Agent.Autonomy.Config.FreeContactEnabled = true
		entry.Agent.Autonomy.Config.MaxFreeContactsPerDay = 2
		entry.Agent.Autonomy.Config.DailyTokenBudget = 0
		entry.Life.ContactNextAt = now.Add(-time.Second)
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := svc.mutateAgent(b, func(entry *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		entry.Agent.Autonomy.SuspendedUntil = timestamppb.New(now.Add(time.Hour))
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	model := &fakeLifeTurnAI{response: &runtimev1.ExecuteScenarioResponse{
		FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
		Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextGenerate{
			TextGenerate: &runtimev1.TextGenerateOutput{Text: `{"contact":"","next_check_minutes":360}`},
		}},
	}}
	svc.aiBridge.lifeFrameAI = model
	if err := svc.runLifeFrameSweep(ctx, now); err != nil {
		t.Fatal(err)
	}
	svc.lifeFrameWG.Wait()
	if len(model.requests) != 1 || model.requests[0].GetSpec().GetTextGenerate().GetResponseFormat().GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT {
		t.Fatalf("empty public options suppressed a due contact judgment: %d model calls", len(model.requests))
	}
}

func TestUtopiaReadsCorruptStateAsUnavailable(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ctx := context.Background()
	if err := svc.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO runtime_agent_utopia_settings(account_id, settings_json) VALUES ('user-1', '{"revision":2,"unknown":true}')`)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.readLifeUtopiaSettings(ctx, "user-1"); err == nil {
		t.Fatal("invalid stored settings were treated as missing")
	}
}
