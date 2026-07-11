package protectedlocal

import (
	"context"
	"testing"
	"time"
)

func TestLifecycleIntentPrepareConsumeIsBootScopedAndConnectionBound(t *testing.T) {
	t.Parallel()
	fixture := newLifecycleIntentFixture(t)
	input := fixture.lifecycleInput()

	if _, err := fixture.intents.Prepare(context.Background(), input); !IsReason(err, ReasonDesktopControlTransportRequired) {
		t.Fatalf("plain context reconstructed prepare authority: %v", err)
	}
	prepared, err := fixture.intents.Prepare(fixture.ctx, input)
	if err != nil {
		t.Fatalf("prepare lifecycle intent: %v", err)
	}
	if prepared.IntentID == (Identifier{}) || !prepared.Deadline.Equal(fixture.clock.now.Add(LifecycleChallengeTTL)) {
		t.Fatalf("invalid prepared projection: %+v", prepared)
	}
	status, err := fixture.intents.Status(fixture.ctx, LifecycleIntentStatusQuery{IntentID: prepared.IntentID, AccountGeneration: input.AccountGeneration})
	if err != nil || status.Status != LifecycleIntentStatusPrepared {
		t.Fatalf("prepared status = %+v, error = %v", status, err)
	}

	mismatch := fixture.consumption(prepared.IntentID)
	mismatch.DisplayedImpactDigest = identifierFilled(0xe1)
	if _, err := fixture.intents.Consume(fixture.ctx, mismatch); !IsReason(err, ReasonLifecycleIntentMismatch) {
		t.Fatalf("mismatched binding error = %v", err)
	}
	consumed, err := fixture.intents.Consume(fixture.ctx, fixture.consumption(prepared.IntentID))
	if err != nil || consumed.Status != LifecycleIntentStatusConsumed {
		t.Fatalf("consume projection = %+v, error = %v", consumed, err)
	}
	if _, err := fixture.intents.Consume(fixture.ctx, fixture.consumption(prepared.IntentID)); !IsReason(err, ReasonLifecycleIntentReplay) {
		t.Fatalf("single-use replay error = %v", err)
	}
}

func TestLifecycleIntentReplacementCancelsPriorIntent(t *testing.T) {
	t.Parallel()
	fixture := newLifecycleIntentFixture(t)
	input := fixture.lifecycleInput()
	first, err := fixture.intents.Prepare(fixture.ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := fixture.intents.Prepare(fixture.ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if first.IntentID == second.IntentID {
		t.Fatal("replacement reused intent identifier")
	}
	status, err := fixture.intents.Status(fixture.ctx, LifecycleIntentStatusQuery{IntentID: first.IntentID, AccountGeneration: input.AccountGeneration})
	if err != nil || status.Status != LifecycleIntentStatusCancelled {
		t.Fatalf("replaced status = %+v, error = %v", status, err)
	}
	if _, err := fixture.intents.Consume(fixture.ctx, fixture.consumption(first.IntentID)); !IsReason(err, ReasonLifecycleIntentReplay) {
		t.Fatalf("replaced intent replay error = %v", err)
	}
}

func TestLifecycleIntentExpiryAndProcessRevocationFailClosed(t *testing.T) {
	t.Parallel()
	fixture := newLifecycleIntentFixture(t)
	input := fixture.lifecycleInput()
	prepared, err := fixture.intents.Prepare(fixture.ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	fixture.clock.now = prepared.Deadline
	status, err := fixture.intents.Status(fixture.ctx, LifecycleIntentStatusQuery{IntentID: prepared.IntentID, AccountGeneration: input.AccountGeneration})
	if err != nil || status.Status != LifecycleIntentStatusExpired {
		t.Fatalf("expired status = %+v, error = %v", status, err)
	}
	if _, err := fixture.intents.Consume(fixture.ctx, fixture.consumption(prepared.IntentID)); !IsReason(err, ReasonLifecycleIntentExpired) {
		t.Fatalf("expired intent error = %v", err)
	}

	live := newLifecycleIntentFixture(t)
	prepared, err = live.intents.Prepare(live.ctx, live.lifecycleInput())
	if err != nil {
		t.Fatal(err)
	}
	live.connection.Revoke()
	if _, err := live.intents.Status(live.ctx, LifecycleIntentStatusQuery{IntentID: prepared.IntentID, AccountGeneration: live.lifecycleInput().AccountGeneration}); !IsReason(err, ReasonDesktopProcessVerificationUnavailable) {
		t.Fatalf("revoked process status error = %v", err)
	}
}

func TestLifecycleIntentValidatesExactTargetAndDestructiveOptions(t *testing.T) {
	t.Parallel()
	fixture := newLifecycleIntentFixture(t)
	input := LifecycleChallengeInput{
		AccountGeneration:     22,
		Action:                LifecycleActionUninstall,
		AppID:                 "persona.nimi.app",
		ReleaseRef:            "release-22",
		ArtifactDigest:        identifierFilled(0x31),
		DisplayedImpactDigest: identifierFilled(0x32),
		DestructiveOptions:    LifecycleDestructiveOptions{DeleteDurableData: true},
	}
	prepared, err := fixture.intents.Prepare(fixture.ctx, input)
	if err != nil {
		t.Fatalf("prepare uninstall intent: %v", err)
	}
	mismatch := consumptionFromInput(prepared.IntentID, input)
	mismatch.DestructiveOptions.DeleteDurableData = false
	if _, err := fixture.intents.Consume(fixture.ctx, mismatch); !IsReason(err, ReasonLifecycleIntentMismatch) {
		t.Fatalf("destructive option mismatch error = %v", err)
	}
	if _, err := fixture.intents.Consume(fixture.ctx, consumptionFromInput(prepared.IntentID, input)); err != nil {
		t.Fatalf("consume exact uninstall intent: %v", err)
	}

	invalid := input
	invalid.Action = LifecycleActionUpdate
	if _, err := fixture.intents.Prepare(fixture.ctx, invalid); !IsReason(err, ReasonLifecycleChallengeMismatch) {
		t.Fatalf("invalid destructive option error = %v", err)
	}
}

func TestLifecycleIntentManagerRejectsMismatchedSessionOwner(t *testing.T) {
	fixture := newLifecycleIntentFixture(t)
	if err := fixture.intents.ValidateBootScoped(context.Background(), fixture.sessions); err != nil {
		t.Fatalf("validate boot-scoped lifecycle manager: %v", err)
	}
	other, err := NewDesktopSessionManager(fixture.boot, distinctIdentifierReader(0xda, 2))
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.intents.ValidateBootScoped(context.Background(), other); !IsReason(err, ReasonProtectedLocalLedgerUnavailable) {
		t.Fatalf("mismatched session owner error = %v", err)
	}
}

type lifecycleIntentFixture struct {
	boot       Identifier
	sessions   *DesktopSessionManager
	connection *Connection
	ctx        context.Context
	intents    *LifecycleIntentManager
	clock      *lifecycleTestClock
}

func newLifecycleIntentFixture(t *testing.T) *lifecycleIntentFixture {
	t.Helper()
	boot := identifierFilled(0xa0)
	connection, err := EstablishDesktopConnection(context.Background(), fixedDesktopVerifier{peers: desktopPeers(boot)}, distinctIdentifierReader(0xc1, 1))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(connection.Revoke)
	sessions, err := NewDesktopSessionManager(boot, distinctIdentifierReader(0xc2, 2))
	if err != nil {
		t.Fatal(err)
	}
	ctx := ContextWithDesktopConnection(context.Background(), connection)
	if _, err := sessions.Open(ctx); err != nil {
		t.Fatal(err)
	}
	clock := &lifecycleTestClock{now: time.Date(2026, 7, 11, 1, 2, 3, 0, time.UTC)}
	intents, err := NewLifecycleIntentManager(LifecycleIntentManagerOptions{Sessions: sessions, Random: distinctIdentifierReader(0xc4, 16), Now: clock.Now})
	if err != nil {
		t.Fatal(err)
	}
	return &lifecycleIntentFixture{boot: boot, sessions: sessions, connection: connection, ctx: ctx, intents: intents, clock: clock}
}

func (fixture *lifecycleIntentFixture) lifecycleInput() LifecycleChallengeInput {
	return LifecycleChallengeInput{AccountGeneration: 19, Action: LifecycleActionUpdate, AppID: "world.nimi.app", ReleaseRef: "release-2026.07.11", ArtifactDigest: identifierFilled(0xd1), DisplayedImpactDigest: identifierFilled(0xd2)}
}

func (fixture *lifecycleIntentFixture) consumption(intentID Identifier) LifecycleIntentConsumption {
	return consumptionFromInput(intentID, fixture.lifecycleInput())
}

func consumptionFromInput(intentID Identifier, input LifecycleChallengeInput) LifecycleIntentConsumption {
	return LifecycleIntentConsumption{IntentID: intentID, AccountGeneration: input.AccountGeneration, Action: input.Action, AppID: input.AppID, ReleaseRef: input.ReleaseRef, ArtifactDigest: input.ArtifactDigest, DisplayedImpactDigest: input.DisplayedImpactDigest, ExpectedAdoptionGeneration: input.ExpectedAdoptionGeneration, DestructiveOptions: input.DestructiveOptions}
}

type lifecycleTestClock struct{ now time.Time }

func (clock *lifecycleTestClock) Now() time.Time { return clock.now }
