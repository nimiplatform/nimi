package runtimeagent

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var errEmbodimentTestScopeStale = errors.New("embodiment test scope is stale")

type embodimentTestScopeResolver struct {
	handle          string
	anchorID        string
	localAgentRef   string
	stale           atomic.Bool
	revalidationCnt atomic.Int32
}

type blockingEmbodimentPostureRead struct {
	delegate behavioralPosturePersistence
	blocked  atomic.Bool
	started  chan struct{}
	release  chan struct{}
}

func (p *blockingEmbodimentPostureRead) PutBehavioralPosture(ctx context.Context, posture BehavioralPosture) error {
	return p.delegate.PutBehavioralPosture(ctx, posture)
}

func (p *blockingEmbodimentPostureRead) GetBehavioralPosture(ctx context.Context, agentID string) (*BehavioralPosture, error) {
	posture, err := p.delegate.GetBehavioralPosture(ctx, agentID)
	if err != nil || !p.blocked.CompareAndSwap(false, true) {
		return posture, err
	}
	close(p.started)
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-p.release:
		return posture, nil
	}
}

func (r *embodimentTestScopeResolver) ResolveLocalAppEmbodimentScope(
	ctx context.Context,
	req localAppEmbodimentReadRequest,
) (localAppEmbodimentScope, error) {
	if err := ctx.Err(); err != nil {
		return localAppEmbodimentScope{}, err
	}
	if r == nil || req.AgentHandle != r.handle || req.ConversationAnchorID != r.anchorID || r.stale.Load() {
		return localAppEmbodimentScope{}, errEmbodimentTestScopeStale
	}
	return localAppEmbodimentScope{
		localAgentRef:        r.localAgentRef,
		conversationAnchorID: r.anchorID,
	}, nil
}

func (r *embodimentTestScopeResolver) RevalidateLocalAppEmbodimentScope(
	ctx context.Context,
	req localAppEmbodimentReadRequest,
	scope localAppEmbodimentScope,
) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if r == nil || req.AgentHandle != r.handle || req.ConversationAnchorID != r.anchorID ||
		scope.localAgentRef != r.localAgentRef || scope.conversationAnchorID != r.anchorID || r.stale.Load() {
		return errEmbodimentTestScopeStale
	}
	r.revalidationCnt.Add(1)
	return nil
}

type embodimentTestComposition struct {
	svc      *Service
	owner    *localAppEmbodimentReadOwner
	resolver *embodimentTestScopeResolver
	request  localAppEmbodimentReadRequest
	agentRef string
	anchorID string
}

func newEmbodimentTestComposition(t *testing.T) embodimentTestComposition {
	t.Helper()
	svc := newRuntimeAgentTestService(t)
	result, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-embodiment"),
	})
	if err != nil {
		t.Fatalf("materialize embodiment test Agent: %v", err)
	}
	agent := result.GetAgent()
	agentRef := agent.GetLocalAgentRef()
	anchorID := "agent_anchor_embodiment"
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID] = &publicChatAnchorState{
		ConversationAnchorID: anchorID,
		AgentID:              agentRef,
		LocalAgentRef:        agentRef,
		OwnerUserID:          agent.GetOwnerUserId(),
		RuntimeSourceRef:     agent.GetRuntimeSourceRef(),
		SubjectUserID:        agent.GetOwnerUserId(),
		Status:               runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_ACTIVE,
	}
	svc.chatSurfaceMu.Unlock()
	handle := localAppAgentHandlePrefix + strings.Repeat("a", 43)
	resolver := &embodimentTestScopeResolver{
		handle: handle, anchorID: anchorID, localAgentRef: agentRef,
	}
	return embodimentTestComposition{
		svc:      svc,
		owner:    newLocalAppEmbodimentReadOwner(resolver, newRuntimeAgentEmbodimentSemanticOwner(svc)),
		resolver: resolver,
		request: localAppEmbodimentReadRequest{
			AgentHandle: handle, ConversationAnchorID: anchorID,
		},
		agentRef: agentRef,
		anchorID: anchorID,
	}
}

func TestLocalAppEmbodimentSnapshotProjectsOnlyBoundedRuntimeTruth(t *testing.T) {
	composition := newEmbodimentTestComposition(t)
	ctx := context.Background()
	entry, err := composition.svc.agentByID(composition.agentRef)
	if err != nil {
		t.Fatalf("load embodiment test Agent: %v", err)
	}
	now := time.Now().UTC()
	emotionEvent, err := composition.svc.applyCurrentEmotionTransition(
		entry,
		"happy",
		"runtime",
		stateEventOrigin{ConversationAnchorID: composition.anchorID, OriginatingTurnID: "turn-opaque"},
		now,
	)
	if err != nil {
		t.Fatalf("apply emotion: %v", err)
	}
	posture, err := normalizeBehavioralPosture(composition.agentRef, BehavioralPosture{
		PostureClass:  "engaged",
		ActionFamily:  postureActionFamilySupport,
		InterruptMode: postureInterruptCautious,
		StatusText:    "Listening",
		UpdatedAt:     now.Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatalf("normalize posture: %v", err)
	}
	postureEvents, err := composition.svc.applyBehavioralPostureUpdate(
		ctx,
		entry,
		posture,
		stateEventOrigin{ConversationAnchorID: composition.anchorID, OriginatingTurnID: "turn-opaque"},
		now.Add(time.Millisecond),
	)
	if err != nil {
		t.Fatalf("apply posture: %v", err)
	}
	entry.State.StatusText = posture.StatusText
	activityEvent, err := composition.svc.emitPresentationActivityEvent(
		composition.agentRef,
		composition.anchorID,
		"turn-opaque",
		"stream-private",
		"thinking",
		"interaction",
		"",
		"runtime",
		now.Add(2*time.Millisecond),
	)
	if err != nil {
		t.Fatalf("build activity: %v", err)
	}
	voiceEvent := composition.svc.newEventAt(
		composition.agentRef,
		runtimev1.AgentEventType_AGENT_EVENT_TYPE_PRESENTATION,
		&runtimev1.AgentEvent_Presentation{Presentation: &runtimev1.AgentPresentationEventDetail{
			Family:               runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_VOICE_TIMING_READY,
			ConversationAnchorId: composition.anchorID,
			TurnId:               "turn-opaque",
			StreamId:             "stream-private",
			MessageId:            "voice-opaque",
			AudioArtifactId:      "raw-artifact-must-not-project",
			AudioMimeType:        "audio/opus",
			DurationMs:           640,
			DeadlineOffsetMs:     80,
			VoiceTimingPhase:     runtimev1.AgentVoiceTimingPhase_AGENT_VOICE_TIMING_PHASE_ACTIVE,
			Reason:               "private-backend-reason",
		}},
		now.Add(3*time.Millisecond),
	)
	if err := composition.svc.updateAgent(entry, append([]*runtimev1.AgentEvent{emotionEvent}, append(postureEvents, activityEvent, voiceEvent)...)...); err != nil {
		t.Fatalf("commit embodiment owner truth: %v", err)
	}

	// A running Conversation turn does not become an independently owned
	// companion state merely because the old special projection called it one.
	composition.svc.chatSurfaceMu.Lock()
	composition.svc.chatAnchors[composition.anchorID].ActiveTurnID = "turn-opaque"
	composition.svc.chatTurns["turn-opaque"] = &publicChatTurnState{
		ConversationAnchorID: composition.anchorID,
		TurnID:               "turn-opaque",
		Projection: &publicChatTurnProjectionState{
			TurnID: "turn-opaque", Status: publicChatTurnStatusStreaming,
		},
	}
	composition.svc.chatSurfaceMu.Unlock()

	snapshot, err := composition.owner.Snapshot(ctx, composition.request)
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if snapshot.Sequence == 0 || snapshot.Provenance != localAppEmbodimentProvenanceRuntime || snapshot.ObservedAt.IsZero() {
		t.Fatalf("snapshot sequence/provenance missing: %+v", snapshot)
	}
	if snapshot.Activity == nil || snapshot.Activity.Name != "thinking" || snapshot.Activity.Category != "interaction" || snapshot.Activity.TurnRef != "turn-opaque" {
		t.Fatalf("bounded activity projection mismatch: %+v", snapshot.Activity)
	}
	if snapshot.Emotion == nil || snapshot.Emotion.Name != "happy" || snapshot.Emotion.Source != "runtime" {
		t.Fatalf("bounded emotion projection mismatch: %+v", snapshot.Emotion)
	}
	if snapshot.Posture == nil || snapshot.Posture.ActionFamily != postureActionFamilySupport || snapshot.Posture.InterruptMode != postureInterruptCautious {
		t.Fatalf("bounded posture projection mismatch: %+v", snapshot.Posture)
	}
	if snapshot.VoiceTiming == nil || snapshot.VoiceTiming.Phase != "active" || snapshot.VoiceTiming.TurnRef != "turn-opaque" ||
		snapshot.VoiceTiming.CorrelationRef != "voice-opaque" || snapshot.VoiceTiming.DurationMillis != 640 || snapshot.VoiceTiming.DeadlineOffsetMillis != 80 {
		t.Fatalf("bounded voice timing mismatch: %+v", snapshot.VoiceTiming)
	}
	rendered := fmt.Sprintf("%+v", snapshot)
	for _, forbidden := range []string{
		composition.agentRef,
		entry.Agent.GetOwnerUserId(),
		entry.Agent.GetRuntimeSourceRef(),
		"raw-artifact-must-not-project",
		"audio/opus",
		"avatar_autoplay",
		"private-backend-reason",
		"stream-private",
		"companion_participation",
	} {
		if strings.Contains(rendered, forbidden) {
			t.Fatalf("snapshot exposed forbidden private or renderer fact %q: %s", forbidden, rendered)
		}
	}
}

func TestLocalAppEmbodimentSnapshotDoesNotHideConcurrentPostureEvent(t *testing.T) {
	composition := newEmbodimentTestComposition(t)
	ctx := context.Background()
	entry, err := composition.svc.agentByID(composition.agentRef)
	if err != nil {
		t.Fatal(err)
	}
	initial, err := normalizeBehavioralPosture(composition.agentRef, BehavioralPosture{
		PostureClass: "observing", ActionFamily: postureActionFamilyObserve,
		InterruptMode: postureInterruptWelcome, StatusText: "Observing", UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatal(err)
	}
	initialEvents, err := composition.svc.applyBehavioralPostureUpdate(
		ctx, entry, initial, stateEventOrigin{ConversationAnchorID: composition.anchorID}, time.Now().UTC(),
	)
	if err != nil {
		t.Fatal(err)
	}
	entry.State.StatusText = initial.StatusText
	if err := composition.svc.updateAgent(entry, initialEvents...); err != nil {
		t.Fatal(err)
	}

	blocking := &blockingEmbodimentPostureRead{
		delegate: composition.svc.postures, started: make(chan struct{}), release: make(chan struct{}),
	}
	composition.svc.postures = blocking
	type snapshotResult struct {
		snapshot localAppEmbodimentSnapshot
		err      error
	}
	result := make(chan snapshotResult, 1)
	go func() {
		snapshot, snapshotErr := composition.owner.Snapshot(ctx, composition.request)
		result <- snapshotResult{snapshot: snapshot, err: snapshotErr}
	}()
	select {
	case <-blocking.started:
	case <-time.After(time.Second):
		t.Fatal("snapshot did not pause on posture read")
	}

	next, err := normalizeBehavioralPosture(composition.agentRef, BehavioralPosture{
		PostureClass: "assisting", ActionFamily: postureActionFamilyAssist,
		InterruptMode: postureInterruptFocused, StatusText: "Assisting", UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatal(err)
	}
	nextEvents, err := composition.svc.applyBehavioralPostureUpdate(
		ctx, entry, next, stateEventOrigin{ConversationAnchorID: composition.anchorID}, time.Now().UTC(),
	)
	if err != nil {
		t.Fatal(err)
	}
	entry.State.StatusText = next.StatusText
	if err := composition.svc.updateAgent(entry, nextEvents...); err != nil {
		t.Fatal(err)
	}
	composition.svc.mu.RLock()
	wantSequence := composition.svc.sequence
	composition.svc.mu.RUnlock()
	close(blocking.release)

	select {
	case got := <-result:
		if got.err != nil {
			t.Fatal(got.err)
		}
		if got.snapshot.Sequence != wantSequence || got.snapshot.Posture == nil ||
			got.snapshot.Posture.ActionFamily != postureActionFamilyAssist ||
			got.snapshot.Posture.InterruptMode != postureInterruptFocused {
			t.Fatalf("snapshot hid concurrent posture event: got=%+v want sequence=%d posture=%s/%s", got.snapshot, wantSequence, postureActionFamilyAssist, postureInterruptFocused)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("snapshot did not finish after concurrent posture commit")
	}
}

func TestLocalAppEmbodimentReadsFailClosedOnScopeMismatchStaleAndCancel(t *testing.T) {
	composition := newEmbodimentTestComposition(t)

	badRequest := composition.request
	badRequest.ConversationAnchorID = "agent_anchor_other"
	if _, err := composition.owner.Snapshot(context.Background(), badRequest); !errors.Is(err, errEmbodimentTestScopeStale) {
		t.Fatalf("anchor mismatch error = %v, want stale scope", err)
	}

	composition.resolver.stale.Store(true)
	if _, err := composition.owner.Snapshot(context.Background(), composition.request); !errors.Is(err, errEmbodimentTestScopeStale) {
		t.Fatalf("stale session error = %v, want stale scope", err)
	}
	composition.resolver.stale.Store(false)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := composition.owner.Snapshot(ctx, composition.request); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled snapshot error = %v, want context.Canceled", err)
	}
	emitted := 0
	if err := composition.owner.Subscribe(ctx, localAppEmbodimentSubscribeRequest{
		localAppEmbodimentReadRequest: composition.request,
	}, func(localAppEmbodimentEvent) error {
		emitted++
		return nil
	}); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled subscription error = %v, want context.Canceled", err)
	}
	if emitted != 0 {
		t.Fatalf("canceled subscription emitted %d events", emitted)
	}

	foreignResolver := &embodimentTestScopeResolver{
		handle:        composition.resolver.handle,
		anchorID:      composition.resolver.anchorID,
		localAgentRef: testRuntimeAgentLocalRef("foreign-agent"),
	}
	foreignOwner := newLocalAppEmbodimentReadOwner(foreignResolver, newRuntimeAgentEmbodimentSemanticOwner(composition.svc))
	if _, err := foreignOwner.Snapshot(context.Background(), composition.request); !errors.Is(err, errLocalAppEmbodimentUnavailable) {
		t.Fatalf("owner/anchor mismatch error = %v, want unavailable", err)
	}
}

func TestLocalAppEmbodimentSubscriptionIsOrderedFilteredAndRevalidated(t *testing.T) {
	composition := newEmbodimentTestComposition(t)
	snapshot, err := composition.owner.Snapshot(context.Background(), composition.request)
	if err != nil {
		t.Fatalf("initial Snapshot: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var mu sync.Mutex
	received := make([]localAppEmbodimentEvent, 0, 2)
	done := make(chan error, 1)
	go func() {
		done <- composition.owner.Subscribe(ctx, localAppEmbodimentSubscribeRequest{
			localAppEmbodimentReadRequest: composition.request,
			AfterSequence:                 snapshot.Sequence,
		}, func(event localAppEmbodimentEvent) error {
			mu.Lock()
			received = append(received, event)
			count := len(received)
			mu.Unlock()
			if count == 2 {
				cancel()
			}
			return nil
		})
	}()
	waitForRuntimeAgentCondition(t, time.Second, func() bool {
		composition.svc.mu.RLock()
		defer composition.svc.mu.RUnlock()
		return len(composition.svc.subscribers) == 1
	})

	now := time.Now().UTC()
	foreignActivity, err := composition.svc.emitPresentationActivityEvent(
		composition.agentRef,
		"agent_anchor_foreign",
		"turn-foreign",
		"stream-foreign",
		"thinking",
		"interaction",
		"",
		"runtime",
		now,
	)
	if err != nil {
		t.Fatalf("build foreign activity: %v", err)
	}
	expression, err := composition.svc.emitPresentationExpressionEvent(
		composition.agentRef,
		composition.anchorID,
		"turn-opaque",
		"stream-private",
		"renderer-expression-must-stay-local",
		500,
		now.Add(time.Millisecond),
	)
	if err != nil {
		t.Fatalf("build excluded expression: %v", err)
	}
	activity, err := composition.svc.emitPresentationActivityEvent(
		composition.agentRef,
		composition.anchorID,
		"turn-opaque",
		"stream-private",
		"thinking",
		"interaction",
		"",
		"runtime",
		now.Add(2*time.Millisecond),
	)
	if err != nil {
		t.Fatalf("build admitted activity: %v", err)
	}
	emotion := composition.svc.stateEmotionChangedEvent(
		composition.agentRef,
		"excited",
		"neutral",
		"runtime",
		stateEventOrigin{ConversationAnchorID: composition.anchorID, OriginatingTurnID: "turn-opaque"},
		now.Add(3*time.Millisecond),
	)
	if err := composition.svc.commitAgentEvents(foreignActivity, expression, activity, emotion); err != nil {
		t.Fatalf("commit subscription events: %v", err)
	}

	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("Subscribe returned %v, want context.Canceled", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Subscribe did not finish after receiving admitted events")
	}
	mu.Lock()
	got := append([]localAppEmbodimentEvent(nil), received...)
	mu.Unlock()
	if len(got) != 2 || got[0].Kind != localAppEmbodimentEventActivity || got[1].Kind != localAppEmbodimentEventEmotion || got[0].Sequence >= got[1].Sequence {
		t.Fatalf("ordered filtered union mismatch: %+v", got)
	}
	if composition.resolver.revalidationCnt.Load() < 4 {
		t.Fatalf("scope was not revalidated around subscription delivery: %d", composition.resolver.revalidationCnt.Load())
	}

	staleCtx, staleCancel := context.WithCancel(context.Background())
	defer staleCancel()
	staleDone := make(chan error, 1)
	emitted := atomic.Int32{}
	composition.svc.mu.RLock()
	staleCursor := composition.svc.sequence
	composition.svc.mu.RUnlock()
	go func() {
		staleDone <- composition.owner.Subscribe(staleCtx, localAppEmbodimentSubscribeRequest{
			localAppEmbodimentReadRequest: composition.request,
			AfterSequence:                 staleCursor,
		}, func(localAppEmbodimentEvent) error {
			emitted.Add(1)
			return nil
		})
	}()
	waitForRuntimeAgentCondition(t, time.Second, func() bool {
		composition.svc.mu.RLock()
		defer composition.svc.mu.RUnlock()
		return len(composition.svc.subscribers) == 1
	})
	composition.resolver.stale.Store(true)
	ignoredExpression, err := composition.svc.emitPresentationExpressionEvent(
		composition.agentRef,
		composition.anchorID,
		"turn-late",
		"stream-private",
		"renderer-expression-must-stay-local",
		500,
		time.Now().UTC(),
	)
	if err != nil {
		t.Fatalf("build ignored stale-session event: %v", err)
	}
	if err := composition.svc.commitAgentEvents(ignoredExpression); err != nil {
		t.Fatalf("commit ignored stale-session event: %v", err)
	}
	select {
	case err := <-staleDone:
		if !errors.Is(err, errEmbodimentTestScopeStale) {
			t.Fatalf("stale subscription returned %v, want stale scope", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("stale subscription did not fail closed")
	}
	if emitted.Load() != 0 {
		t.Fatalf("stale subscription emitted %d events", emitted.Load())
	}
}

func TestLocalAppEmbodimentSubscriptionFailsClosedWhileIdle(t *testing.T) {
	composition := newEmbodimentTestComposition(t)
	composition.svc.mu.RLock()
	afterSequence := composition.svc.sequence
	composition.svc.mu.RUnlock()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- composition.owner.Subscribe(ctx, localAppEmbodimentSubscribeRequest{
			localAppEmbodimentReadRequest: composition.request,
			AfterSequence:                 afterSequence,
		}, func(localAppEmbodimentEvent) error {
			t.Error("idle stale subscription emitted an event")
			return nil
		})
	}()
	waitForRuntimeAgentCondition(t, time.Second, func() bool {
		composition.svc.mu.RLock()
		defer composition.svc.mu.RUnlock()
		return len(composition.svc.subscribers) == 1
	})
	composition.resolver.stale.Store(true)
	select {
	case err := <-done:
		if !errors.Is(err, errEmbodimentTestScopeStale) {
			t.Fatalf("idle stale subscription returned %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("idle stale subscription was not revalidated")
	}
}

func TestLocalAppEmbodimentProjectionRejectsMalformedSemanticCarrier(t *testing.T) {
	badTimestamp := &runtimev1.AgentEvent{
		Sequence:  1,
		AgentId:   testRuntimeAgentLocalRef("agent-malformed"),
		EventType: runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE,
		Timestamp: &timestamppb.Timestamp{Seconds: 253402300800},
		Detail: &runtimev1.AgentEvent_State{State: &runtimev1.AgentStateEventDetail{
			Family:         runtimev1.AgentStateEventFamily_AGENT_STATE_EVENT_FAMILY_EMOTION_CHANGED,
			CurrentEmotion: "happy",
			EmotionSource:  "runtime",
		}},
	}
	if _, admitted, err := projectRuntimeAgentEmbodimentEvent(badTimestamp, "agent_anchor_embodiment"); err == nil || admitted {
		t.Fatalf("invalid timestamp carrier admitted=%v err=%v", admitted, err)
	}

	rawRendererExpression := &runtimev1.AgentEvent{
		Sequence:  2,
		AgentId:   testRuntimeAgentLocalRef("agent-malformed"),
		EventType: runtimev1.AgentEventType_AGENT_EVENT_TYPE_PRESENTATION,
		Timestamp: timestamppb.Now(),
		Detail: &runtimev1.AgentEvent_Presentation{Presentation: &runtimev1.AgentPresentationEventDetail{
			Family:               runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_EXPRESSION_REQUESTED,
			ConversationAnchorId: "agent_anchor_embodiment",
			TurnId:               "turn-opaque",
			StreamId:             "stream-private",
			ExpressionId:         "renderer-expression-must-stay-local",
		}},
	}
	if projected, admitted, err := projectRuntimeAgentEmbodimentEvent(rawRendererExpression, "agent_anchor_embodiment"); err != nil || admitted || projected.Kind != "" {
		t.Fatalf("renderer expression carrier leaked: projected=%+v admitted=%v err=%v", projected, admitted, err)
	}

	unboundedVoiceTiming := &runtimev1.AgentEvent{
		Sequence:  3,
		AgentId:   testRuntimeAgentLocalRef("agent-malformed"),
		EventType: runtimev1.AgentEventType_AGENT_EVENT_TYPE_PRESENTATION,
		Timestamp: timestamppb.Now(),
		Detail: &runtimev1.AgentEvent_Presentation{Presentation: &runtimev1.AgentPresentationEventDetail{
			Family:               runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_VOICE_TIMING_READY,
			ConversationAnchorId: "agent_anchor_embodiment",
			TurnId:               "turn-opaque",
			StreamId:             "stream-private",
			MessageId:            "voice-opaque",
			DurationMs:           localAppEmbodimentMaxTimingMillis + 1,
			VoiceTimingPhase:     runtimev1.AgentVoiceTimingPhase_AGENT_VOICE_TIMING_PHASE_ACTIVE,
		}},
	}
	if _, admitted, err := projectRuntimeAgentEmbodimentEvent(unboundedVoiceTiming, "agent_anchor_embodiment"); err == nil || admitted {
		t.Fatalf("unbounded voice timing admitted=%v err=%v", admitted, err)
	}
}
