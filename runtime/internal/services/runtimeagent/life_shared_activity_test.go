package runtimeagent

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

type sharedDecisionTestExecutor struct {
	inputs []string
}

func (e *sharedDecisionTestExecutor) ExecuteScenario(_ context.Context, request *runtimev1.ExecuteScenarioRequest) (*runtimev1.ExecuteScenarioResponse, error) {
	if _, err := capabilitydriver.OpenAIResponsesTextBehaviorRequestSerializer("gpt-6.1-terra", request.GetSpec().GetTextGenerate(), false); err != nil {
		return nil, fmt.Errorf("serialize public decision: %w", err)
	}
	text := request.GetSpec().GetTextGenerate().GetInput()[0].GetContent()
	e.inputs = append(e.inputs, text)
	return &runtimev1.ExecuteScenarioResponse{
		FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
		Usage:        &runtimev1.UsageStats{InputTokens: 23, OutputTokens: 3},
		Output:       &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextGenerate{TextGenerate: &runtimev1.TextGenerateOutput{Text: `{"choice":1}`}}},
	}, nil
}

func prepareSharedLifeTest(t *testing.T) (*Service, string, string, time.Time) {
	t.Helper()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ctx := context.Background()
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext("agent-beta")}); err != nil {
		t.Fatal(err)
	}
	commit := func(ctx context.Context, fn func(context.Context) error) error { return fn(ctx) }
	if _, err := svc.updateLifeUtopia(ctx, "user-1", 1, lifeUtopiaChange{Preset: lifePolarPreset}, commit); err != nil {
		t.Fatal(err)
	}
	enabled := true
	if _, err := svc.updateLifeUtopia(ctx, "user-1", 2, lifeUtopiaChange{Public: &enabled}, commit); err != nil {
		t.Fatal(err)
	}
	a, b := testRuntimeAgentLocalRef("agent-alpha"), testRuntimeAgentLocalRef("agent-beta")
	now := time.Now().UTC()
	for _, ref := range []string{a, b} {
		if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
			e.Agent.Autonomy.Enabled = true
			e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_HIGH
			e.Life.StartedAt, e.Life.SettledAt = now, now
			if err := e.Life.acceptFuture([]lifeFrameProposal{
				{Title: "private-schedule-canary", Kind: "routine", DurationMinutes: 10, EndProgress: 100, CompletesActivity: true},
				{Title: "Unrelated future", Kind: "routine", DurationMinutes: 10, EndProgress: 100, CompletesActivity: true},
			}, now, nil, false); err != nil {
				return nil, nil, err
			}
			_, err := e.Life.advance(now)
			e.Life.NextCheckAt = now.Add(time.Hour)
			return nil, nil, err
		}); err != nil {
			t.Fatal(err)
		}
	}
	return svc, a, b, now
}

func onlySharedLifeTestRecord(t *testing.T, svc *Service) lifeSharedRecord {
	t.Helper()
	records, err := svc.readLifeSharedRecords(context.Background(), "user-1")
	if err != nil || len(records) != 1 {
		t.Fatalf("expected one shared activity: %v, %+v", err, records)
	}
	return records[0]
}

func TestSharedLifeConflictingInvitationConsumesPublicOpportunity(t *testing.T) {
	svc, winner, recipient, now := prepareSharedLifeTest(t)
	ctx := context.Background()
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext("agent-gamma")}); err != nil {
		t.Fatal(err)
	}
	loser := testRuntimeAgentLocalRef("agent-gamma")
	if err := svc.mutateAgent(loser, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Enabled = true
		e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_HIGH
		e.Life.StartedAt, e.Life.SettledAt, e.Life.NextCheckAt = now, now, now.Add(time.Hour)
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	actor, err := svc.agentByID(loser)
	if err != nil {
		t.Fatal(err)
	}
	other, err := svc.agentByID(recipient)
	if err != nil {
		t.Fatal(err)
	}
	start := sharedLifeWindowStart(other.Life, now.Add(6*time.Minute))
	option := lifePublicOption{
		Action: "invite", Place: lifeSharedPlace, Activity: lifeSharedActivity,
		recipient: recipient, Deadline: now.Add(5 * time.Minute), StartsAt: start, EndsAt: start.Add(lifePublicDuration),
	}
	_, account, ready := svc.currentLifeAccount(ctx)
	if !ready {
		t.Fatal("missing active account")
	}
	settings, err := svc.readLifeUtopiaSettings(ctx, "user-1")
	if err != nil {
		t.Fatal(err)
	}
	utopia, err := settings.effective()
	if err != nil {
		t.Fatal(err)
	}
	input := lifePublicInput{Utopia: utopia, Options: []lifePublicOption{option}, account: account}
	winActor, err := svc.agentByID(winner)
	if err != nil {
		t.Fatal(err)
	}
	winWork := svc.claimAgentBackgroundFor(ctx, winner, lifePublicPurpose)
	loseWork := svc.claimAgentBackgroundFor(ctx, loser, lifePublicPurpose)
	if winWork == nil || loseWork == nil {
		t.Fatal("both decisions should be in flight")
	}
	defer svc.releaseAgentBackground(winner, winWork)
	defer svc.releaseAgentBackground(loser, loseWork)
	if err := svc.admitPublicLifeCall(winWork, winActor, input, 1000); err != nil {
		t.Fatal(err)
	}
	if err := svc.admitPublicLifeCall(loseWork, actor, input, 1000); err != nil {
		t.Fatal(err)
	}
	svc.commitPublicLifeChoice(winWork, winActor, input, 1, 26, nil)
	svc.commitPublicLifeChoice(loseWork, actor, input, 1, 26, nil)
	record := onlySharedLifeTestRecord(t, svc)
	if record.Initiator != winner || record.Recipient != recipient || record.State != "invited" {
		t.Fatalf("colliding choice changed the admitted invitation: %+v", record)
	}
	after, err := svc.agentByID(loser)
	if err != nil {
		t.Fatal(err)
	}
	if after.Agent.GetAutonomy().GetUsedTokensInWindow() != actor.Agent.GetAutonomy().GetUsedTokensInWindow()+26 {
		t.Fatal("the losing model call was not charged exactly once")
	}
	if !after.Life.NextCheckAt.Equal(actor.Life.NextCheckAt) || len(after.Life.Future) != len(actor.Life.Future) {
		t.Fatal("a lost invitation affected the personal plan")
	}
	retryAt := after.Life.LastLifeAttempt.Add(lifeMinimumAttemptInterval(after))
	if !after.Life.NextPublicAt.After(retryAt) {
		t.Fatal("a lost invitation can retry as soon as the minimum attempt interval passes")
	}
	svc.mu.RLock()
	choose, _ := svc.publicLifeOpportunityLocked(after, "user-1", settings, utopia, []lifeSharedRecord{record}, retryAt, false)
	svc.mu.RUnlock()
	if choose {
		t.Fatal("the scan offered another public decision during cooldown")
	}
}

func TestSharedLifeUndispatchedResponseDoesNotDelayPersonalPlanning(t *testing.T) {
	svc, a, b, now := prepareSharedLifeTest(t)
	ctx := context.Background()
	ai := &sharedDecisionTestExecutor{}
	svc.aiBridge.lifeFrameAI = ai
	work := svc.claimAgentBackgroundFor(ctx, a, lifePublicPurpose)
	svc.runPublicLifeChoice(work, a, now)
	svc.releaseAgentBackground(a, work)
	before := onlySharedLifeTestRecord(t, svc)
	if err := svc.mutateAgent(b, func(entry *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		// The response cannot fit, but the window has not reached its actual token count.
		entry.Agent.Autonomy.Config.DailyTokenBudget = 1
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	entry, _ := svc.agentByID(b)
	if err := svc.runLifeFrameSweep(ctx, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	svc.lifeFrameWG.Wait()
	after := onlySharedLifeTestRecord(t, svc)
	actual, _ := svc.agentByID(b)
	if len(ai.inputs) != 1 || after != before || !actual.Life.NextCheckAt.Equal(entry.Life.NextCheckAt) {
		t.Fatalf("undispatched response changed the invitation or personal schedule: calls=%d state=%s", len(ai.inputs), after.State)
	}
	if !actual.Life.LastLifeAttempt.After(entry.Life.LastLifeAttempt) {
		t.Fatal("the due response can reclaim the slot on every sweep")
	}
}

func TestSharedLifeCanStartAfterAnInteractionHasGoneQuiet(t *testing.T) {
	svc, a, b, now := prepareSharedLifeTest(t)
	ctx := context.Background()
	ai := &sharedDecisionTestExecutor{}
	svc.aiBridge.lifeFrameAI = ai
	work := svc.claimAgentBackgroundFor(ctx, a, lifePublicPurpose)
	svc.runPublicLifeChoice(work, a, now)
	svc.releaseAgentBackground(a, work)
	if err := svc.runLifeFrameSweep(ctx, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	svc.lifeFrameWG.Wait()
	accepted := onlySharedLifeTestRecord(t, svc)
	if accepted.State != "accepted" {
		t.Fatalf("expected an accepted arrangement, got %s", accepted.State)
	}
	if err := svc.mutateAgent(b, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		_, err := e.Life.beginInteraction("earlier-chat", accepted.StartsAt.Add(-lifeInteractionSilence-time.Second), true)
		return nil, nil, err
	}); err != nil {
		t.Fatal(err)
	}
	for _, when := range []time.Time{accepted.StartsAt, accepted.StartsAt.Add(time.Second)} {
		if err := svc.runLifeFrameSweep(ctx, when); err != nil {
			t.Fatal(err)
		}
		svc.lifeFrameWG.Wait()
	}
	if active := onlySharedLifeTestRecord(t, svc); active.State != "active" || active.OccurredFrom.Before(accepted.StartsAt) {
		t.Fatalf("an already-quiet chat prevented the arrangement: %s", active.State)
	}
}

func TestSharedLifeSettlementSkipsIdleWriter(t *testing.T) {
	svc, a, b, now := prepareSharedLifeTest(t)
	commit := func(ctx context.Context, fn func(context.Context) error) error { return fn(ctx) }
	enabled := false
	if _, err := svc.updateLifeUtopia(context.Background(), "user-1", 3, lifeUtopiaChange{Public: &enabled}, commit); err != nil {
		t.Fatal(err)
	}
	closed := lifeSharedRecord{
		Ref: "shared_closed", Initiator: a, Recipient: b, State: "expired", ClosedAt: now,
		Deadline: now.Add(-time.Minute), StartsAt: now.Add(time.Minute), EndsAt: now.Add(2 * time.Minute),
	}
	if err := svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error { return persistSharedLifeTx(tx, "user-1", closed) }); err != nil {
		t.Fatal(err)
	}
	owner := &lifeAccountTestOwner{generation: 1, invalid: make(chan struct{})}
	svc.SetRuntimeAccountProjectionProvider(owner)
	held, release := make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- svc.backend.WriteTx(context.Background(), func(*sql.Tx) error {
			close(held)
			<-release
			return nil
		})
	}()
	<-held
	sweep := make(chan error, 1)
	go func() {
		_, _, _, _, err := svc.maintainCurrentUtopia(context.Background(), now.Add(time.Second))
		sweep <- err
	}()
	var sweepErr error
	waitedForWriter := false
	select {
	case sweepErr = <-sweep:
	case <-time.After(time.Second):
		waitedForWriter = true
	}
	close(release)
	if writeErr := <-done; writeErr != nil {
		t.Fatal(writeErr)
	}
	if waitedForWriter {
		sweepErr = <-sweep
		if sweepErr != nil {
			t.Fatal(sweepErr)
		}
		t.Fatal("retained history blocked the sweep on an unrelated writer")
	}
	if sweepErr != nil {
		t.Fatal(sweepErr)
	}
}

func TestSharedLifeClockDoesNotSettleAcrossAccountInactivity(t *testing.T) {
	svc, a, b, now := prepareSharedLifeTest(t)
	ctx := context.Background()
	owner := &lifeAccountTestOwner{generation: 1, invalid: make(chan struct{})}
	svc.SetRuntimeAccountProjectionProvider(owner)
	ai := &sharedDecisionTestExecutor{}
	svc.aiBridge.lifeFrameAI = ai
	work := svc.claimAgentBackgroundFor(ctx, a, lifePublicPurpose)
	svc.runPublicLifeChoice(work, a, now)
	svc.releaseAgentBackground(a, work)
	if err := svc.runLifeFrameSweep(ctx, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	svc.lifeFrameWG.Wait()
	accepted := onlySharedLifeTestRecord(t, svc)
	if accepted.State != "accepted" {
		t.Fatalf("expected accepted arrangement, got %s", accepted.State)
	}
	// Move the entire fixture interval before the real-clock snapshot call.
	accepted.AcceptedAt, accepted.Deadline = now.Add(-4*time.Minute), now.Add(-3*time.Minute)
	accepted.StartsAt, accepted.EndsAt = now.Add(-2*time.Minute), now.Add(8*time.Minute)
	for _, ref := range []string{a, b} {
		if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
			life := newAgentLifeState()
			life.StartedAt, life.SettledAt = accepted.AcceptedAt, accepted.AcceptedAt
			if err := life.reserveSharedLife(accepted); err != nil {
				return nil, nil, err
			}
			e.Life = life
			return nil, nil, nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	if err := svc.backend.WriteTx(ctx, func(tx *sql.Tx) error { return persistSharedLifeTx(tx, "user-1", accepted) }); err != nil {
		t.Fatal(err)
	}
	if _, _, _, _, err := svc.maintainCurrentUtopia(ctx, accepted.StartsAt); err != nil {
		t.Fatal(err)
	}
	active := onlySharedLifeTestRecord(t, svc)
	if active.State != "active" {
		t.Fatalf("shared activity never started: %s", active.State)
	}
	owner.mu.Lock()
	close(owner.invalid)
	owner.generation++
	owner.invalid = make(chan struct{})
	owner.mu.Unlock()
	decision := accountservice.LocalAppCallerDecision{AppID: "nimi.test-utopia", AccountID: "user-1", AccountGeneration: 2, RegisteredAppSubject: "utopia-subject",
		Operation: localappop.OperationAgentUtopiaSnapshotGet, OperationCapability: "agent.utopia.read", AuthorityClass: localappop.AuthorityClassAppAccess}
	decision.SessionID[0] = 1
	readCtx := accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision)
	snapshot, err := svc.GetLocalAppAgentUtopiaSnapshot(readCtx, &runtimev1.GetLocalAppAgentUtopiaSnapshotRequest{})
	if err != nil || len(snapshot.GetOccupancy()) != 0 || len(snapshot.GetSharedActivities()) != 0 {
		t.Fatalf("an old account generation leaked live activity into the new projection: %v", err)
	}
	for _, resident := range snapshot.GetResidents() {
		if resident.GetCurrent() != nil {
			t.Fatal("new account generation saw an old shared frame as current")
		}
	}
	if _, _, _, _, err := svc.maintainCurrentUtopia(ctx, accepted.EndsAt); err != nil {
		t.Fatal(err)
	}
	if record := onlySharedLifeTestRecord(t, svc); record.State != "interrupted" || !record.OccurredTo.IsZero() {
		t.Fatalf("account replacement was counted as uninterrupted participation: %+v", record)
	}
}

func TestSharedLifeInvitationAndIndependentResponseDuringPersonalLife(t *testing.T) {
	for _, interruption := range []string{"", "foreground", "restart", "write-failure", "environment"} {
		name := interruption
		if name == "" {
			name = "completed"
		}
		t.Run(name, func(t *testing.T) {
			svc, a, b, now := prepareSharedLifeTest(t)
			ctx := context.Background()
			ai := &sharedDecisionTestExecutor{}
			svc.aiBridge.lifeFrameAI = ai
			// Give the initiator one opportunity, then use the normal scan for the independent response.
			work := svc.claimAgentBackgroundFor(ctx, a, lifePublicPurpose)
			svc.runPublicLifeChoice(work, a, now)
			svc.releaseAgentBackground(a, work)
			invited := onlySharedLifeTestRecord(t, svc)
			if invited.State != "invited" || invited.Recipient != b {
				t.Fatalf("invitation: %+v", invited)
			}
			before, _ := svc.agentByID(b)
			if len(before.Life.Future) != 1 || before.Life.Current == nil {
				t.Fatal("invitation reserved or replaced the recipient's plans")
			}
			if interruption == "write-failure" {
				if err := svc.backend.WriteTx(ctx, func(tx *sql.Tx) error {
					_, err := tx.Exec(`CREATE TRIGGER fail_shared_accept BEFORE UPDATE ON runtime_agent_utopia_shared WHEN json_extract(NEW.record_json,'$.state')='accepted' BEGIN SELECT RAISE(ABORT,'accept write failed'); END`)
					return err
				}); err != nil {
					t.Fatal(err)
				}
			}
			if err := svc.runLifeFrameSweep(ctx, now.Add(time.Second)); err != nil {
				t.Fatal(err)
			}
			svc.lifeFrameWG.Wait()
			accepted := onlySharedLifeTestRecord(t, svc)
			if len(ai.inputs) != 2 || !strings.Contains(ai.inputs[1], `"invitation":`) || strings.Contains(ai.inputs[1], "private-schedule-canary") {
				t.Fatalf("recipient had no qualified independent opportunity: calls=%d", len(ai.inputs))
			}
			if interruption == "write-failure" {
				if accepted.State != "invited" || !accepted.ReplyStarted {
					t.Fatalf("failed acceptance: %+v", accepted)
				}
				for _, ref := range []string{a, b} {
					entry, _ := svc.agentByID(ref)
					if len(entry.Life.Future) != 1 {
						t.Fatal("failed acceptance reserved one participant")
					}
				}
				return
			}
			if accepted.State != "accepted" {
				t.Fatalf("response: %+v", accepted)
			}
			for _, ref := range []string{a, b} {
				entry, _ := svc.agentByID(ref)
				if entry.Life.Current == nil || len(entry.Life.Future) != 2 || entry.Life.Future[1].SharedRef != accepted.Ref || entry.Agent.Autonomy.UsedTokensInWindow != 26 {
					t.Fatalf("incorrect atomic reservation or usage for %s: %v", ref, entry.Life)
				}
			}
			if interruption == "foreground" {
				if err := svc.mutateAgent(b, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
					_, err := e.Life.beginInteraction("test-user-turn", accepted.StartsAt.Add(-time.Minute), true)
					return nil, nil, err
				}); err != nil {
					t.Fatal(err)
				}
			}
			if interruption == "environment" {
				if _, err := svc.updateLifeUtopia(ctx, "user-1", 3, lifeUtopiaChange{Restore: true}, func(ctx context.Context, fn func(context.Context) error) error { return fn(ctx) }); err != nil {
					t.Fatal(err)
				}
				if record := onlySharedLifeTestRecord(t, svc); record.State != "missed" || !record.OccurredFrom.IsZero() {
					t.Fatalf("environment cutover: %+v", record)
				}
				for _, ref := range []string{a, b} {
					entry, _ := svc.agentByID(ref)
					if len(entry.Life.Future) != 1 || entry.Life.Future[0].SharedRef != "" {
						t.Fatal("environment change left an invalid reservation")
					}
				}
				return
			}
			sweepSharedLifeTestWindow(t, svc, a, b, accepted, interruption)
			settled := onlySharedLifeTestRecord(t, svc)
			want := "completed"
			if interruption == "foreground" {
				want = "missed"
			}
			if interruption == "restart" {
				want = "interrupted"
			}
			if settled.State != want || len(ai.inputs) != 2 {
				t.Fatalf("closure=%+v model calls=%d", settled, len(ai.inputs))
			}
			if want == "completed" && !settled.OccurredTo.Equal(accepted.EndsAt) {
				t.Fatal("completion lacks established overlap")
			}
			if want != "completed" && !settled.OccurredTo.IsZero() {
				t.Fatal("unobserved time was established")
			}
			if want == "completed" {
				verifySharedRecordExpiry(t, svc, settled)
			}
		})
	}
}

func verifySharedRecordExpiry(t *testing.T, svc *Service, settled lifeSharedRecord) {
	t.Helper()
	ctx := context.Background()
	// Check retention across the exact boundary with the normal maintenance
	// path. Use a historical closure so current-time direct reads are expired.
	settled.ClosedAt = time.Now().UTC().Add(-lifeSharedRetention)
	if err := svc.backend.WriteTx(ctx, func(tx *sql.Tx) error { return persistSharedLifeTx(tx, "user-1", settled) }); err != nil {
		t.Fatal(err)
	}
	decision := accountservice.LocalAppCallerDecision{AppID: "nimi.test-utopia", AccountID: "user-1", RegisteredAppSubject: "utopia-subject",
		Operation: localappop.OperationAgentUtopiaSnapshotGet, OperationCapability: "agent.utopia.read", AuthorityClass: localappop.AuthorityClassAppAccess}
	decision.SessionID[0] = 1
	readCtx := accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision)
	snapshot, err := svc.GetLocalAppAgentUtopiaSnapshot(readCtx, &runtimev1.GetLocalAppAgentUtopiaSnapshotRequest{})
	if err != nil || len(snapshot.GetSharedActivities()) != 0 {
		t.Fatalf("expired activity was readable: %+v, %v", snapshot, err)
	}
	anchor := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	message := &runtimev1.ChatMessage{Role: "user", Content: "We talked about watching the snow. I also always prefer unsweetened tea."}
	if err := svc.commitPublicChatTurnTranscript(anchor, message, "Unsweetened tea it is."); err != nil {
		t.Fatal(err)
	}
	expiry := settled.ClosedAt.Add(lifeSharedRetention)
	if _, _, _, _, err := svc.maintainCurrentUtopia(ctx, expiry.Add(-time.Nanosecond)); err != nil {
		t.Fatal(err)
	}
	if record := onlySharedLifeTestRecord(t, svc); record.Ref != settled.Ref {
		t.Fatal("maintenance did not preserve the record before its deadline")
	}
	if _, _, _, _, err := svc.maintainCurrentUtopia(ctx, expiry); err != nil {
		t.Fatal(err)
	}
	records, err := svc.readLifeSharedRecords(ctx, "user-1")
	if err != nil || len(records) != 0 {
		t.Fatalf("expired record was not reclaimed: %+v, %v", records, err)
	}
	ref := testRuntimeAgentLocalRef("agent-alpha")
	turns, _, _, err := svc.lifeConversationInput(ref)
	if err != nil || len(turns) != 1 || turns[0].UserText != message.Content || turns[0].AssistantText != "Unsweetened tea it is." {
		t.Fatalf("shared record expiry changed ordinary Conversation input: %v", err)
	}
}

func sweepSharedLifeTestWindow(t *testing.T, svc *Service, a, b string, accepted lifeSharedRecord, interruption string) {
	t.Helper()
	ctx := context.Background()
	for _, ref := range []string{a, b} {
		if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
			_, err := e.Life.advance(accepted.StartsAt)
			return nil, nil, err
		}); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, _, _, err := svc.maintainCurrentUtopia(ctx, accepted.StartsAt); err != nil {
		t.Fatal(err)
	}
	if interruption == "foreground" {
		return
	}
	if r := onlySharedLifeTestRecord(t, svc); r.State != "active" {
		t.Fatal(fmt.Sprint(r))
	}
	for _, ref := range []string{a, b} {
		entry, _ := svc.agentByID(ref)
		if !entry.Life.sharedLifeCurrent(accepted.Ref) {
			t.Fatal("joint start did not occupy both current timelines")
		}
	}
	if interruption == "restart" {
		if err := svc.recoverSharedLife(ctx, accepted.StartsAt.Add(time.Minute)); err != nil {
			t.Fatal(err)
		}
	} else if _, _, _, _, err := svc.maintainCurrentUtopia(ctx, accepted.EndsAt); err != nil {
		t.Fatal(err)
	}
}
