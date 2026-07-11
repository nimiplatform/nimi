package protectedlocal

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"
)

func TestLifecycleIntentPrepareConsumeIsAnchoredAndConnectionBound(t *testing.T) {
	t.Parallel()

	fixture := newLifecycleIntentFixture(t)
	input := fixture.lifecycleInput()
	if _, err := fixture.intents.Prepare(context.Background(), LifecycleChallengeInput{}); !IsReason(err, ReasonDesktopControlTransportRequired) {
		t.Fatalf("invalid public prepare reached request validation before origin gate: %v", err)
	}
	if _, err := fixture.intents.Consume(context.Background(), LifecycleIntentConsumption{}); !IsReason(err, ReasonDesktopControlTransportRequired) {
		t.Fatalf("invalid public consume reached request validation before origin gate: %v", err)
	}
	before := fixture.anchor(t)
	prepared, err := fixture.intents.Prepare(fixture.ctx, input)
	if err != nil {
		t.Fatalf("prepare lifecycle intent: %v", err)
	}
	if prepared.IntentID == (Identifier{}) {
		t.Fatal("prepare returned an empty intent id")
	}
	if want := fixture.clock.now.Add(LifecycleChallengeTTL); !prepared.Deadline.Equal(want) {
		t.Fatalf("deadline = %v, want %v", prepared.Deadline, want)
	}
	afterPrepare := fixture.anchor(t)
	if afterPrepare.CommitSequence != before.CommitSequence+1 {
		t.Fatalf("prepare did not advance anchor exactly once: before=%d after=%d", before.CommitSequence, afterPrepare.CommitSequence)
	}

	status, err := fixture.intents.Status(fixture.ctx, LifecycleIntentStatusQuery{
		IntentID:          prepared.IntentID,
		AccountGeneration: input.AccountGeneration,
	})
	if err != nil {
		t.Fatalf("read prepared status: %v", err)
	}
	if status.Status != LifecycleIntentStatusPrepared {
		t.Fatalf("prepared status = %q", status.Status)
	}
	if _, err := fixture.intents.Status(context.Background(), LifecycleIntentStatusQuery{
		IntentID:          prepared.IntentID,
		AccountGeneration: input.AccountGeneration,
	}); !IsReason(err, ReasonDesktopControlTransportRequired) {
		t.Fatalf("plain context reconstructed status authority: %v", err)
	}

	mismatch := LifecycleIntentConsumption{
		IntentID:              prepared.IntentID,
		AccountGeneration:     input.AccountGeneration,
		Action:                input.Action,
		AppID:                 input.AppID,
		ReleaseRef:            input.ReleaseRef,
		ArtifactDigest:        input.ArtifactDigest,
		DisplayedImpactDigest: identifierFilled(0xe1),
	}
	if _, err := fixture.intents.Consume(fixture.ctx, mismatch); !IsReason(err, ReasonLifecycleIntentMismatch) {
		t.Fatalf("mismatched display digest error = %v", err)
	}
	if got := fixture.anchor(t); got.CommitSequence != afterPrepare.CommitSequence {
		t.Fatalf("mismatch mutated anchor: before=%d after=%d", afterPrepare.CommitSequence, got.CommitSequence)
	}

	consumed, err := fixture.intents.Consume(fixture.ctx, LifecycleIntentConsumption{
		IntentID:              prepared.IntentID,
		AccountGeneration:     input.AccountGeneration,
		Action:                input.Action,
		AppID:                 input.AppID,
		ReleaseRef:            input.ReleaseRef,
		ArtifactDigest:        input.ArtifactDigest,
		DisplayedImpactDigest: input.DisplayedImpactDigest,
	})
	if err != nil {
		t.Fatalf("consume lifecycle intent: %v", err)
	}
	if consumed.Status != LifecycleIntentStatusConsumed || consumed.IntentID != prepared.IntentID {
		t.Fatalf("unexpected consumed projection: %+v", consumed)
	}
	afterConsume := fixture.anchor(t)
	if afterConsume.CommitSequence != afterPrepare.CommitSequence+1 {
		t.Fatalf("consume did not advance anchor exactly once: before=%d after=%d", afterPrepare.CommitSequence, afterConsume.CommitSequence)
	}
	if _, err := fixture.intents.Consume(fixture.ctx, LifecycleIntentConsumption{
		IntentID:              prepared.IntentID,
		AccountGeneration:     input.AccountGeneration,
		Action:                input.Action,
		AppID:                 input.AppID,
		ReleaseRef:            input.ReleaseRef,
		ArtifactDigest:        input.ArtifactDigest,
		DisplayedImpactDigest: input.DisplayedImpactDigest,
	}); !IsReason(err, ReasonLifecycleIntentReplay) {
		t.Fatalf("replayed challenge error = %v", err)
	}
	if got := fixture.anchor(t); got.CommitSequence != afterConsume.CommitSequence {
		t.Fatalf("replay mutated anchor: before=%d after=%d", afterConsume.CommitSequence, got.CommitSequence)
	}

	var statusValue string
	var challengeID, sessionID, processHash, bootEpoch, artifactDigest, displayedDigest []byte
	var accountGeneration int64
	if err := fixture.ledger.db.QueryRowContext(context.Background(), `SELECT intent.status, intent.challenge_id, intent.desktop_session_id, intent.process_tuple_hash, intent.runtime_boot_epoch, intent.account_generation, intent.artifact_digest, intent.displayed_impact_digest FROM protected_lifecycle_intent intent WHERE intent.intent_id = ?`, prepared.IntentID[:]).Scan(
		&statusValue, &challengeID, &sessionID, &processHash, &bootEpoch, &accountGeneration, &artifactDigest, &displayedDigest,
	); err != nil {
		t.Fatalf("read durable lifecycle intent: %v", err)
	}
	if statusValue != string(LifecycleIntentStatusConsumed) ||
		!bytesEqualIdentifier(challengeID, prepared.IntentID) ||
		!bytesEqualIdentifier(sessionID, fixture.sessionID) ||
		!bytesEqualIdentifier(processHash, fixture.processHash) ||
		!bytesEqualIdentifier(bootEpoch, fixture.boot) ||
		accountGeneration != int64(input.AccountGeneration) ||
		!bytesEqualIdentifier(artifactDigest, input.ArtifactDigest) ||
		!bytesEqualIdentifier(displayedDigest, input.DisplayedImpactDigest) {
		t.Fatalf("durable lifecycle binding mismatch: status=%q generation=%d", statusValue, accountGeneration)
	}
}

func TestLifecycleIntentManagerValidateAnchoredRejectsZeroAndMismatchedSessions(t *testing.T) {
	if err := (&LifecycleIntentManager{}).ValidateAnchored(context.Background(), &DesktopSessionManager{}); !IsReason(err, ReasonProtectedLocalLedgerUnavailable) {
		t.Fatalf("zero lifecycle manager validation error = %v", err)
	}
	fixture := newLifecycleIntentFixture(t)
	if err := fixture.intents.ValidateAnchored(context.Background(), fixture.sessions); err != nil {
		t.Fatalf("validate anchored lifecycle manager: %v", err)
	}
	otherSessions, err := NewDesktopSessionManager(fixture.boot, distinctIdentifierReader(0xda, 2), fixture.ledger)
	if err != nil {
		t.Fatalf("create mismatched Desktop sessions: %v", err)
	}
	if err := fixture.intents.ValidateAnchored(context.Background(), otherSessions); !IsReason(err, ReasonProtectedLocalLedgerUnavailable) {
		t.Fatalf("mismatched session authority validation error = %v", err)
	}
}

func TestLifecycleIntentReplacementAtomicallyCancelsPriorChallenge(t *testing.T) {
	t.Parallel()

	fixture := newLifecycleIntentFixture(t)
	input := fixture.lifecycleInput()
	first, err := fixture.intents.Prepare(fixture.ctx, input)
	if err != nil {
		t.Fatalf("prepare first challenge: %v", err)
	}
	second, err := fixture.intents.Prepare(fixture.ctx, input)
	if err != nil {
		t.Fatalf("prepare replacement challenge: %v", err)
	}
	if first.IntentID == second.IntentID {
		t.Fatal("replacement reused challenge identifier")
	}
	firstStatus, err := fixture.intents.Status(fixture.ctx, LifecycleIntentStatusQuery{
		IntentID:          first.IntentID,
		AccountGeneration: input.AccountGeneration,
	})
	if err != nil {
		t.Fatalf("read replaced status: %v", err)
	}
	if firstStatus.Status != LifecycleIntentStatusCancelled {
		t.Fatalf("replaced status = %q", firstStatus.Status)
	}
	if _, err := fixture.intents.Consume(fixture.ctx, fixture.consumption(first.IntentID)); !IsReason(err, ReasonLifecycleIntentReplay) {
		t.Fatalf("replaced challenge replay error = %v", err)
	}
	var outstanding int
	if err := fixture.ledger.db.QueryRowContext(context.Background(), `SELECT COUNT(*) FROM protected_lifecycle_challenge WHERE desktop_session_id = ? AND action = ? AND app_id = ? AND revoked_commit_sequence IS NULL`, fixture.sessionID[:], string(input.Action), input.AppID).Scan(&outstanding); err != nil {
		t.Fatalf("count outstanding challenges: %v", err)
	}
	if outstanding != 1 {
		t.Fatalf("outstanding challenge count = %d", outstanding)
	}
}

func TestLifecycleIntentExpiryIsDurableAndCannotReplay(t *testing.T) {
	t.Parallel()

	fixture := newLifecycleIntentFixture(t)
	input := fixture.lifecycleInput()
	prepared, err := fixture.intents.Prepare(fixture.ctx, input)
	if err != nil {
		t.Fatalf("prepare lifecycle intent: %v", err)
	}
	fixture.clock.now = prepared.Deadline
	before := fixture.anchor(t)
	mismatch := fixture.consumption(prepared.IntentID)
	mismatch.DisplayedImpactDigest = identifierFilled(0xe2)
	if _, err := fixture.intents.Consume(fixture.ctx, mismatch); !IsReason(err, ReasonLifecycleIntentMismatch) {
		t.Fatalf("expired mismatched challenge error = %v", err)
	}
	if got := fixture.anchor(t); got.CommitSequence != before.CommitSequence {
		t.Fatalf("mismatched caller expired challenge: before=%d after=%d", before.CommitSequence, got.CommitSequence)
	}
	status, err := fixture.intents.Status(fixture.ctx, LifecycleIntentStatusQuery{
		IntentID:          prepared.IntentID,
		AccountGeneration: input.AccountGeneration,
	})
	if err != nil {
		t.Fatalf("expire lifecycle intent: %v", err)
	}
	if status.Status != LifecycleIntentStatusExpired {
		t.Fatalf("expired status = %q", status.Status)
	}
	if got := fixture.anchor(t); got.CommitSequence != before.CommitSequence+1 {
		t.Fatalf("expiration did not anchor exactly once: before=%d after=%d", before.CommitSequence, got.CommitSequence)
	}
	if _, err := fixture.intents.Consume(fixture.ctx, fixture.consumption(prepared.IntentID)); !IsReason(err, ReasonLifecycleIntentExpired) {
		t.Fatalf("expired challenge replay error = %v", err)
	}
}

func TestLifecycleIntentRejectsRevokedStaleAndMismatchedAuthority(t *testing.T) {
	t.Parallel()

	fixture := newLifecycleIntentFixture(t)
	input := fixture.lifecycleInput()
	prepared, err := fixture.intents.Prepare(fixture.ctx, input)
	if err != nil {
		t.Fatalf("prepare lifecycle intent: %v", err)
	}
	mismatch := fixture.consumption(prepared.IntentID)
	mismatch.AccountGeneration++
	if _, err := fixture.intents.Consume(fixture.ctx, mismatch); !IsReason(err, ReasonLifecycleIntentMismatch) {
		t.Fatalf("account-generation mismatch error = %v", err)
	}
	if _, err := fixture.ledger.StartRuntime(context.Background()); err != nil {
		t.Fatalf("start replacement runtime epoch: %v", err)
	}
	if _, err := fixture.intents.Consume(fixture.ctx, fixture.consumption(prepared.IntentID)); !IsReason(err, ReasonProtectedLocalBootEpochMismatch) {
		t.Fatalf("stale boot epoch error = %v", err)
	}

	revokedFixture := newLifecycleIntentFixture(t)
	revokedInput := revokedFixture.lifecycleInput()
	revoked, err := revokedFixture.intents.Prepare(revokedFixture.ctx, revokedInput)
	if err != nil {
		t.Fatalf("prepare revocation fixture: %v", err)
	}
	revokedFixture.connection.Revoke()
	if _, err := revokedFixture.intents.Status(revokedFixture.ctx, LifecycleIntentStatusQuery{
		IntentID:          revoked.IntentID,
		AccountGeneration: revokedInput.AccountGeneration,
	}); !IsReason(err, ReasonDesktopProcessVerificationUnavailable) {
		t.Fatalf("revoked connection status error = %v", err)
	}
}

func TestLifecycleIntentLedgerReopensWithAuthenticatedRecords(t *testing.T) {
	t.Parallel()

	directory := t.TempDir()
	anchor := newTestAnchorStore()
	options := testLedgerOptions(directory, anchor)
	options.Random = distinctIdentifierReader(0xa0, 16)
	clock := &lifecycleTestClock{now: time.Date(2026, 7, 11, 1, 2, 3, 0, time.UTC)}
	options.Now = clock.Now
	ledger, err := OpenLedger(context.Background(), options)
	if err != nil {
		t.Fatalf("open ledger: %v", err)
	}
	fixture := newLifecycleIntentFixtureWithLedger(t, ledger, clock)
	input := fixture.lifecycleInput()
	prepared, err := fixture.intents.Prepare(fixture.ctx, input)
	if err != nil {
		t.Fatalf("prepare lifecycle intent: %v", err)
	}
	if _, err := fixture.intents.Consume(fixture.ctx, fixture.consumption(prepared.IntentID)); err != nil {
		t.Fatalf("consume lifecycle intent: %v", err)
	}
	fixture.connection.Revoke()
	if err := ledger.Close(); err != nil {
		t.Fatalf("close lifecycle ledger: %v", err)
	}
	reopened, err := OpenLedger(context.Background(), testLedgerOptions(directory, anchor))
	if err != nil {
		t.Fatalf("reopen authenticated lifecycle ledger: %v", err)
	}
	if err := reopened.Close(); err != nil {
		t.Fatalf("close reopened lifecycle ledger: %v", err)
	}
}

func TestLifecycleIntentConsumeRecoversOnlyAdmittedAnchorWindows(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name                  string
		phase                 commitPhase
		wantAnchorAdvance     uint64
		wantLiveChallenges    int
		wantDurableIntentRows int
	}{
		{name: "discard unadvanced consume", phase: commitPhasePendingDurable, wantLiveChallenges: 1},
		{name: "complete anchor-advanced consume", phase: commitPhaseAnchorAdvanced, wantAnchorAdvance: 1, wantDurableIntentRows: 1},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			directory := t.TempDir()
			anchorStore := newTestAnchorStore()
			options := testLedgerOptions(directory, anchorStore)
			options.Random = distinctIdentifierReader(0x91, 16)
			clock := &lifecycleTestClock{now: time.Date(2026, 7, 11, 2, 3, 4, 0, time.UTC)}
			options.Now = clock.Now
			ledger, err := OpenLedger(context.Background(), options)
			if err != nil {
				t.Fatalf("open lifecycle crash ledger: %v", err)
			}
			fixture := newLifecycleIntentFixtureWithLedger(t, ledger, clock)
			prepared, err := fixture.intents.Prepare(fixture.ctx, fixture.lifecycleInput())
			if err != nil {
				t.Fatalf("prepare lifecycle crash challenge: %v", err)
			}
			before := fixture.anchor(t)
			ledger.commitHook = func(phase commitPhase) error {
				if phase == test.phase {
					return errors.New("injected lifecycle commit crash")
				}
				return nil
			}
			if _, err := fixture.intents.Consume(fixture.ctx, fixture.consumption(prepared.IntentID)); err == nil {
				t.Fatal("expected injected lifecycle consume crash")
			}
			if err := ledger.Close(); err != nil {
				t.Fatalf("close crashed lifecycle ledger: %v", err)
			}

			recoveryOptions := testLedgerOptions(directory, anchorStore)
			recoveryOptions.Random = distinctIdentifierReader(0xb1, 16)
			recoveryOptions.Now = clock.Now
			recovered, err := OpenLedger(context.Background(), recoveryOptions)
			if err != nil {
				t.Fatalf("recover lifecycle ledger: %v", err)
			}
			defer recovered.Close()
			after, err := recovered.Anchor(context.Background())
			if err != nil {
				t.Fatalf("read recovered lifecycle anchor: %v", err)
			}
			if after.CommitSequence != before.CommitSequence+test.wantAnchorAdvance {
				t.Fatalf("recovered anchor sequence = %d, want %d", after.CommitSequence, before.CommitSequence+test.wantAnchorAdvance)
			}
			var liveChallenges, intents int
			if err := recovered.db.QueryRowContext(context.Background(), `SELECT COUNT(*) FROM protected_lifecycle_challenge WHERE challenge_id = ? AND revoked_commit_sequence IS NULL`, prepared.IntentID[:]).Scan(&liveChallenges); err != nil {
				t.Fatalf("count recovered live challenges: %v", err)
			}
			if err := recovered.db.QueryRowContext(context.Background(), `SELECT COUNT(*) FROM protected_lifecycle_intent WHERE intent_id = ?`, prepared.IntentID[:]).Scan(&intents); err != nil {
				t.Fatalf("count recovered durable intents: %v", err)
			}
			if liveChallenges != test.wantLiveChallenges || intents != test.wantDurableIntentRows {
				t.Fatalf("recovered lifecycle state: live_challenges=%d intents=%d", liveChallenges, intents)
			}
		})
	}
}

func TestLifecycleIntentReplacementRecoversOnlyAdmittedAnchorWindows(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name              string
		phase             commitPhase
		wantAdvance       uint64
		wantChallenges    int
		wantLive          int
		wantCancelledRows int
	}{
		{name: "discard unadvanced replacement", phase: commitPhasePendingDurable, wantChallenges: 1, wantLive: 1},
		{name: "complete anchor-advanced replacement", phase: commitPhaseAnchorAdvanced, wantAdvance: 1, wantChallenges: 2, wantLive: 1, wantCancelledRows: 1},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			directory := t.TempDir()
			anchorStore := newTestAnchorStore()
			options := testLedgerOptions(directory, anchorStore)
			options.Random = distinctIdentifierReader(0x71, 16)
			clock := &lifecycleTestClock{now: time.Date(2026, 7, 11, 4, 5, 6, 0, time.UTC)}
			options.Now = clock.Now
			ledger, err := OpenLedger(context.Background(), options)
			if err != nil {
				t.Fatalf("open lifecycle replacement ledger: %v", err)
			}
			fixture := newLifecycleIntentFixtureWithLedger(t, ledger, clock)
			input := fixture.lifecycleInput()
			if _, err := fixture.intents.Prepare(fixture.ctx, input); err != nil {
				t.Fatalf("prepare initial replacement challenge: %v", err)
			}
			before := fixture.anchor(t)
			ledger.commitHook = func(phase commitPhase) error {
				if phase == test.phase {
					return errors.New("injected lifecycle replacement crash")
				}
				return nil
			}
			if _, err := fixture.intents.Prepare(fixture.ctx, input); err == nil {
				t.Fatal("expected injected lifecycle replacement crash")
			}
			if err := ledger.Close(); err != nil {
				t.Fatalf("close crashed lifecycle replacement ledger: %v", err)
			}

			recoveryOptions := testLedgerOptions(directory, anchorStore)
			recoveryOptions.Random = distinctIdentifierReader(0x91, 16)
			recoveryOptions.Now = clock.Now
			recovered, err := OpenLedger(context.Background(), recoveryOptions)
			if err != nil {
				t.Fatalf("recover lifecycle replacement ledger: %v: %v", err, errors.Unwrap(err))
			}
			defer recovered.Close()
			after, err := recovered.Anchor(context.Background())
			if err != nil {
				t.Fatalf("read recovered replacement anchor: %v", err)
			}
			if after.CommitSequence != before.CommitSequence+test.wantAdvance {
				t.Fatalf("replacement anchor sequence = %d, want %d", after.CommitSequence, before.CommitSequence+test.wantAdvance)
			}
			var challenges, live, cancelled int
			if err := recovered.db.QueryRowContext(context.Background(), `SELECT COUNT(*), SUM(CASE WHEN revoked_commit_sequence IS NULL THEN 1 ELSE 0 END) FROM protected_lifecycle_challenge`).Scan(&challenges, &live); err != nil {
				t.Fatalf("read recovered replacement challenges: %v", err)
			}
			if err := recovered.db.QueryRowContext(context.Background(), `SELECT COUNT(*) FROM protected_lifecycle_intent WHERE status = 'CANCELLED'`).Scan(&cancelled); err != nil {
				t.Fatalf("read recovered cancelled replacement: %v", err)
			}
			if challenges != test.wantChallenges || live != test.wantLive || cancelled != test.wantCancelledRows {
				t.Fatalf("recovered replacement state: challenges=%d live=%d cancelled=%d", challenges, live, cancelled)
			}
		})
	}
}

func TestLifecycleIntentTargetBindingRulesAndConsumptionMismatch(t *testing.T) {
	t.Parallel()

	fixture := newLifecycleIntentFixture(t)
	base := fixture.lifecycleInput()
	invalid := []LifecycleChallengeInput{
		func() LifecycleChallengeInput { value := base; value.ExpectedAdoptionGeneration = 7; return value }(),
		func() LifecycleChallengeInput {
			value := base
			value.DestructiveOptions.DeleteDurableData = true
			return value
		}(),
		func() LifecycleChallengeInput {
			value := base
			value.DestructiveOptions.HealthRepairAction = LifecycleHealthRepairActionRepair
			return value
		}(),
		func() LifecycleChallengeInput {
			value := base
			value.DestructiveOptions.TargetJobID = "job-1"
			return value
		}(),
	}
	before := fixture.anchor(t)
	for index, input := range invalid {
		if _, err := fixture.intents.Prepare(fixture.ctx, input); !IsReason(err, ReasonLifecycleChallengeMismatch) {
			t.Fatalf("invalid target binding %d error = %v", index, err)
		}
	}
	if got := fixture.anchor(t); got.CommitSequence != before.CommitSequence {
		t.Fatalf("invalid target bindings mutated anchor: before=%d after=%d", before.CommitSequence, got.CommitSequence)
	}

	adopt := base
	adopt.Action = LifecycleActionAdoptLocalApp
	adopt.ReleaseRef = ""
	adopt.ExpectedAdoptionGeneration = 17
	preparedAdopt, err := fixture.intents.Prepare(fixture.ctx, adopt)
	if err != nil {
		t.Fatalf("prepare adoption binding: %v", err)
	}
	adoptMismatch := consumptionFromInput(preparedAdopt.IntentID, adopt)
	adoptMismatch.ExpectedAdoptionGeneration++
	if _, err := fixture.intents.Consume(fixture.ctx, adoptMismatch); !IsReason(err, ReasonLifecycleIntentMismatch) {
		t.Fatalf("adoption generation mismatch error = %v", err)
	}
	if _, err := fixture.intents.Consume(fixture.ctx, consumptionFromInput(preparedAdopt.IntentID, adopt)); err != nil {
		t.Fatalf("consume exact adoption binding: %v", err)
	}

	uninstall := base
	uninstall.Action = LifecycleActionUninstall
	uninstall.AppID = "persona.nimi.app"
	uninstall.DestructiveOptions.DeleteDurableData = true
	preparedUninstall, err := fixture.intents.Prepare(fixture.ctx, uninstall)
	if err != nil {
		t.Fatalf("prepare uninstall binding: %v", err)
	}
	deleteMismatch := consumptionFromInput(preparedUninstall.IntentID, uninstall)
	deleteMismatch.DestructiveOptions.DeleteDurableData = false
	if _, err := fixture.intents.Consume(fixture.ctx, deleteMismatch); !IsReason(err, ReasonLifecycleIntentMismatch) {
		t.Fatalf("delete durable data mismatch error = %v", err)
	}
	if _, err := fixture.intents.Consume(fixture.ctx, consumptionFromInput(preparedUninstall.IntentID, uninstall)); err != nil {
		t.Fatalf("consume exact uninstall binding: %v", err)
	}

	repair := base
	repair.Action = LifecycleActionHealthRepair
	repair.AppID = "parentos.nimi.app"
	repair.DestructiveOptions = LifecycleDestructiveOptions{HealthRepairAction: LifecycleHealthRepairActionCancel, TargetJobID: "install-job-7"}
	preparedRepair, err := fixture.intents.Prepare(fixture.ctx, repair)
	if err != nil {
		t.Fatalf("prepare health repair binding: %v", err)
	}
	actionMismatch := consumptionFromInput(preparedRepair.IntentID, repair)
	actionMismatch.DestructiveOptions.HealthRepairAction = LifecycleHealthRepairActionRetry
	if _, err := fixture.intents.Consume(fixture.ctx, actionMismatch); !IsReason(err, ReasonLifecycleIntentMismatch) {
		t.Fatalf("health repair action mismatch error = %v", err)
	}
	targetMismatch := consumptionFromInput(preparedRepair.IntentID, repair)
	targetMismatch.DestructiveOptions.TargetJobID = "install-job-8"
	if _, err := fixture.intents.Consume(fixture.ctx, targetMismatch); !IsReason(err, ReasonLifecycleIntentMismatch) {
		t.Fatalf("health repair target job mismatch error = %v", err)
	}
	if _, err := fixture.intents.Consume(fixture.ctx, consumptionFromInput(preparedRepair.IntentID, repair)); err != nil {
		t.Fatalf("consume exact health repair binding: %v", err)
	}

	var adoptionGeneration, deleteDurableData, healthRepairAction int64
	var targetJobID string
	if err := fixture.ledger.db.QueryRowContext(context.Background(), `SELECT expected_adoption_generation FROM protected_lifecycle_intent WHERE intent_id = ?`, preparedAdopt.IntentID[:]).Scan(&adoptionGeneration); err != nil {
		t.Fatalf("read durable adoption generation: %v", err)
	}
	if err := fixture.ledger.db.QueryRowContext(context.Background(), `SELECT delete_durable_data FROM protected_lifecycle_intent WHERE intent_id = ?`, preparedUninstall.IntentID[:]).Scan(&deleteDurableData); err != nil {
		t.Fatalf("read durable delete-data option: %v", err)
	}
	if err := fixture.ledger.db.QueryRowContext(context.Background(), `SELECT health_repair_action, target_job_id FROM protected_lifecycle_intent WHERE intent_id = ?`, preparedRepair.IntentID[:]).Scan(&healthRepairAction, &targetJobID); err != nil {
		t.Fatalf("read durable health-repair options: %v", err)
	}
	if adoptionGeneration != int64(adopt.ExpectedAdoptionGeneration) || deleteDurableData != 1 ||
		healthRepairAction != int64(LifecycleHealthRepairActionCancel) || targetJobID != repair.DestructiveOptions.TargetJobID {
		t.Fatalf("durable target binding mismatch: adoption=%d delete=%d repair=%d target=%q", adoptionGeneration, deleteDurableData, healthRepairAction, targetJobID)
	}
}

func TestLifecycleIntentLedgerRejectsAuthenticatedBindingTamper(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name      string
		statement string
	}{
		{name: "adoption generation", statement: `UPDATE protected_lifecycle_challenge SET expected_adoption_generation = expected_adoption_generation + 1 WHERE challenge_id = ?`},
		{name: "delete durable data", statement: `UPDATE protected_lifecycle_intent SET delete_durable_data = 1 WHERE intent_id = ?`},
		{name: "health repair action", statement: `UPDATE protected_lifecycle_challenge SET health_repair_action = 2 WHERE challenge_id = ?`},
		{name: "target job id", statement: `UPDATE protected_lifecycle_intent SET target_job_id = target_job_id || '-tampered' WHERE intent_id = ?`},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			directory := t.TempDir()
			anchorStore := newTestAnchorStore()
			options := testLedgerOptions(directory, anchorStore)
			options.Random = distinctIdentifierReader(0x81, 16)
			clock := &lifecycleTestClock{now: time.Date(2026, 7, 11, 3, 4, 5, 0, time.UTC)}
			options.Now = clock.Now
			ledger, err := OpenLedger(context.Background(), options)
			if err != nil {
				t.Fatalf("open lifecycle tamper ledger: %v", err)
			}
			fixture := newLifecycleIntentFixtureWithLedger(t, ledger, clock)
			input := fixture.lifecycleInput()
			input.Action = LifecycleActionHealthRepair
			input.DestructiveOptions = LifecycleDestructiveOptions{HealthRepairAction: LifecycleHealthRepairActionCancel, TargetJobID: "install-job-9"}
			prepared, err := fixture.intents.Prepare(fixture.ctx, input)
			if err != nil {
				t.Fatalf("prepare lifecycle tamper challenge: %v", err)
			}
			if _, err := fixture.intents.Consume(fixture.ctx, consumptionFromInput(prepared.IntentID, input)); err != nil {
				t.Fatalf("consume lifecycle tamper intent: %v", err)
			}
			if _, err := ledger.db.ExecContext(context.Background(), test.statement, prepared.IntentID[:]); err != nil {
				t.Fatalf("tamper lifecycle target binding: %v", err)
			}
			if err := ledger.Close(); err != nil {
				t.Fatalf("close tampered lifecycle ledger: %v", err)
			}
			reopenOptions := testLedgerOptions(directory, anchorStore)
			if _, err := OpenLedger(context.Background(), reopenOptions); !IsReason(err, ReasonProtectedLocalLedgerRollbackDetected) {
				t.Fatalf("tampered lifecycle binding error = %v", err)
			}
		})
	}
}

func TestLifecycleLedgerSchemaV1FailsClosedWithoutMigration(t *testing.T) {
	t.Parallel()

	anchorStore := newTestAnchorStore()
	options := testLedgerOptions(t.TempDir(), anchorStore)
	ledger, err := OpenLedger(context.Background(), options)
	if err != nil {
		t.Fatalf("open schema-v2 ledger: %v", err)
	}
	if _, err := ledger.db.ExecContext(context.Background(), `PRAGMA user_version = 1`); err != nil {
		t.Fatalf("label fixture as schema v1: %v", err)
	}
	if err := ledger.Close(); err != nil {
		t.Fatalf("close schema-v1 fixture: %v", err)
	}
	if _, err := OpenLedger(context.Background(), options); !IsReason(err, ReasonProtectedLocalLedgerUnavailable) {
		t.Fatalf("schema-v1 reopen error = %v", err)
	}
	raw, err := sql.Open("sqlite", "file:"+options.Path)
	if err != nil {
		t.Fatalf("open schema version probe: %v", err)
	}
	defer raw.Close()
	var version int
	if err := raw.QueryRowContext(context.Background(), `PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatalf("read rejected schema version: %v", err)
	}
	if version != 1 {
		t.Fatalf("schema-v1 fixture was migrated to %d", version)
	}
}

type lifecycleIntentFixture struct {
	ledger      *Ledger
	boot        Identifier
	sessions    *DesktopSessionManager
	connection  *Connection
	ctx         context.Context
	intents     *LifecycleIntentManager
	clock       *lifecycleTestClock
	sessionID   Identifier
	processHash Identifier
}

func newLifecycleIntentFixture(t *testing.T) *lifecycleIntentFixture {
	t.Helper()
	clock := &lifecycleTestClock{now: time.Date(2026, 7, 11, 1, 2, 3, 0, time.UTC)}
	options := testLedgerOptions(t.TempDir(), newTestAnchorStore())
	options.Random = distinctIdentifierReader(0xa0, 16)
	options.Now = clock.Now
	ledger, err := OpenLedger(context.Background(), options)
	if err != nil {
		t.Fatalf("open lifecycle ledger: %v", err)
	}
	t.Cleanup(func() { _ = ledger.Close() })
	return newLifecycleIntentFixtureWithLedger(t, ledger, clock)
}

func newLifecycleIntentFixtureWithLedger(t *testing.T, ledger *Ledger, clock *lifecycleTestClock) *lifecycleIntentFixture {
	t.Helper()
	boot, err := ledger.StartRuntime(context.Background())
	if err != nil {
		t.Fatalf("start lifecycle runtime: %v", err)
	}
	connection, err := EstablishDesktopConnection(
		context.Background(),
		fixedDesktopVerifier{peers: desktopPeers(boot)},
		distinctIdentifierReader(0xc1, 1),
	)
	if err != nil {
		t.Fatalf("establish lifecycle desktop connection: %v", err)
	}
	t.Cleanup(connection.Revoke)
	sessions, err := NewDesktopSessionManager(boot, distinctIdentifierReader(0xc2, 2), ledger)
	if err != nil {
		t.Fatalf("new lifecycle desktop session manager: %v", err)
	}
	ctx := ContextWithDesktopConnection(context.Background(), connection)
	projection, err := sessions.Open(ctx)
	if err != nil {
		t.Fatalf("open lifecycle desktop session: %v", err)
	}
	var sessionID Identifier
	copy(sessionID[:], projection.DesktopSessionID)
	intents, err := NewLifecycleIntentManager(LifecycleIntentManagerOptions{
		Sessions: sessions,
		Ledger:   ledger,
		Random:   distinctIdentifierReader(0xc4, 16),
		Now:      clock.Now,
	})
	if err != nil {
		t.Fatalf("new lifecycle intent manager: %v", err)
	}
	return &lifecycleIntentFixture{
		ledger:      ledger,
		boot:        boot,
		sessions:    sessions,
		connection:  connection,
		ctx:         ctx,
		intents:     intents,
		clock:       clock,
		sessionID:   sessionID,
		processHash: connection.origin.processHash,
	}
}

func (fixture *lifecycleIntentFixture) lifecycleInput() LifecycleChallengeInput {
	return LifecycleChallengeInput{
		AccountGeneration:     19,
		Action:                LifecycleActionUpdate,
		AppID:                 "world.nimi.app",
		ReleaseRef:            "release-2026.07.11",
		ArtifactDigest:        identifierFilled(0xd1),
		DisplayedImpactDigest: identifierFilled(0xd2),
	}
}

func (fixture *lifecycleIntentFixture) consumption(intentID Identifier) LifecycleIntentConsumption {
	return consumptionFromInput(intentID, fixture.lifecycleInput())
}

func consumptionFromInput(intentID Identifier, input LifecycleChallengeInput) LifecycleIntentConsumption {
	return LifecycleIntentConsumption{
		IntentID:                   intentID,
		AccountGeneration:          input.AccountGeneration,
		Action:                     input.Action,
		AppID:                      input.AppID,
		ReleaseRef:                 input.ReleaseRef,
		ArtifactDigest:             input.ArtifactDigest,
		DisplayedImpactDigest:      input.DisplayedImpactDigest,
		ExpectedAdoptionGeneration: input.ExpectedAdoptionGeneration,
		DestructiveOptions:         input.DestructiveOptions,
	}
}

func (fixture *lifecycleIntentFixture) anchor(t *testing.T) Anchor {
	t.Helper()
	anchor, err := fixture.ledger.Anchor(context.Background())
	if err != nil {
		t.Fatalf("read lifecycle anchor: %v", err)
	}
	return anchor
}

type lifecycleTestClock struct {
	now time.Time
}

func (clock *lifecycleTestClock) Now() time.Time { return clock.now }

func bytesEqualIdentifier(encoded []byte, expected Identifier) bool {
	if len(encoded) != IdentifierBytes {
		return false
	}
	for index := range expected {
		if encoded[index] != expected[index] {
			return false
		}
	}
	return true
}
