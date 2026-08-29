package runtimeagent

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	localAppEmbodimentProvenanceRuntime = "runtime_agent_owner"
	localAppEmbodimentMaxTimingMillis   = int64((24 * time.Hour) / time.Millisecond)
	localAppEmbodimentSnapshotAttempts  = 8

	localAppEmbodimentEventActivity    = "activity"
	localAppEmbodimentEventEmotion     = "emotion"
	localAppEmbodimentEventPosture     = "posture"
	localAppEmbodimentEventVoiceTiming = "voice_timing"
)

var (
	errLocalAppEmbodimentUnavailable   = errors.New("local-app embodiment owner is unavailable")
	errLocalAppEmbodimentInvalidInput  = errors.New("local-app embodiment input is invalid")
	errLocalAppEmbodimentCursorExpired = errors.New("local-app embodiment event cursor expired")
)

// localAppEmbodimentReadRequest is deliberately smaller than a wire request.
// The protected ingress supplies the current session decision separately; the
// resolver below must bind this opaque handle and exact Conversation anchor to
// that decision before Runtime owner truth can be read.
type localAppEmbodimentReadRequest struct {
	AgentHandle          string
	ConversationAnchorID string
}

type localAppEmbodimentSubscribeRequest struct {
	localAppEmbodimentReadRequest
	AfterSequence uint64
}

type localAppEmbodimentActivity struct {
	Name      string
	Category  string
	Intensity string
	Source    string
	TurnRef   string
}

type localAppEmbodimentEmotion struct {
	Name   string
	Source string
}

type localAppEmbodimentPosture struct {
	ActionFamily  string
	InterruptMode string
}

type localAppEmbodimentVoiceTiming struct {
	Phase                string
	DurationMillis       int64
	DeadlineOffsetMillis int64
	TurnRef              string
	VoiceRef             string
}

type localAppEmbodimentSnapshot struct {
	Sequence    uint64
	ObservedAt  time.Time
	Provenance  string
	Activity    *localAppEmbodimentActivity
	Emotion     *localAppEmbodimentEmotion
	Posture     *localAppEmbodimentPosture
	VoiceTiming *localAppEmbodimentVoiceTiming
}

// localAppEmbodimentEvent is a closed union. Exactly one payload is present;
// renderer mapping, audio materialization, diagnostics and replay are
// structurally absent rather than filtered by a caller-selected option.
type localAppEmbodimentEvent struct {
	Sequence    uint64
	ObservedAt  time.Time
	Provenance  string
	Kind        string
	Activity    *localAppEmbodimentActivity
	Emotion     *localAppEmbodimentEmotion
	Posture     *localAppEmbodimentPosture
	VoiceTiming *localAppEmbodimentVoiceTiming
}

type localAppEmbodimentScope struct {
	localAgentRef        string
	conversationAnchorID string
}

// localAppEmbodimentScopeResolver is the future formal-session composition
// seam. It owns current AppOperation coverage plus opaque-handle and exact
// anchor resolution; Revalidate must reject session, account, App subject,
// handle, Agent lifecycle or anchor changes that occur after Resolve.
type localAppEmbodimentScopeResolver interface {
	ResolveLocalAppEmbodimentScope(context.Context, localAppEmbodimentReadRequest) (localAppEmbodimentScope, error)
	RevalidateLocalAppEmbodimentScope(context.Context, localAppEmbodimentReadRequest, localAppEmbodimentScope) error
}

type localAppEmbodimentSemanticOwner interface {
	SnapshotLocalAppEmbodiment(context.Context, localAppEmbodimentScope) (localAppEmbodimentSnapshot, error)
	SubscribeLocalAppEmbodiment(context.Context, localAppEmbodimentScope, uint64, func(context.Context) error, func(localAppEmbodimentEvent) error) error
}

type localAppEmbodimentReadOwner struct {
	resolver localAppEmbodimentScopeResolver
	owner    localAppEmbodimentSemanticOwner
}

func newLocalAppEmbodimentReadOwner(
	resolver localAppEmbodimentScopeResolver,
	owner localAppEmbodimentSemanticOwner,
) *localAppEmbodimentReadOwner {
	return &localAppEmbodimentReadOwner{resolver: resolver, owner: owner}
}

func (o *localAppEmbodimentReadOwner) Snapshot(
	ctx context.Context,
	req localAppEmbodimentReadRequest,
) (localAppEmbodimentSnapshot, error) {
	if err := validateLocalAppEmbodimentReadInput(ctx, req); err != nil {
		return localAppEmbodimentSnapshot{}, err
	}
	if o == nil || o.resolver == nil || o.owner == nil {
		return localAppEmbodimentSnapshot{}, errLocalAppEmbodimentUnavailable
	}
	scope, err := o.resolver.ResolveLocalAppEmbodimentScope(ctx, req)
	if err != nil {
		return localAppEmbodimentSnapshot{}, fmt.Errorf("resolve local-app embodiment scope: %w", err)
	}
	if err := validateLocalAppEmbodimentScope(scope, req.ConversationAnchorID); err != nil {
		return localAppEmbodimentSnapshot{}, err
	}
	snapshot, err := o.owner.SnapshotLocalAppEmbodiment(ctx, scope)
	if err != nil {
		return localAppEmbodimentSnapshot{}, fmt.Errorf("read local-app embodiment snapshot: %w", err)
	}
	if err := o.resolver.RevalidateLocalAppEmbodimentScope(ctx, req, scope); err != nil {
		return localAppEmbodimentSnapshot{}, fmt.Errorf("revalidate local-app embodiment scope: %w", err)
	}
	if err := validateLocalAppEmbodimentSnapshot(snapshot); err != nil {
		return localAppEmbodimentSnapshot{}, fmt.Errorf("validate local-app embodiment snapshot: %w", err)
	}
	return cloneLocalAppEmbodimentSnapshot(snapshot), nil
}

func (o *localAppEmbodimentReadOwner) Subscribe(
	ctx context.Context,
	req localAppEmbodimentSubscribeRequest,
	emit func(localAppEmbodimentEvent) error,
) error {
	if err := validateLocalAppEmbodimentReadInput(ctx, req.localAppEmbodimentReadRequest); err != nil {
		return err
	}
	if o == nil || o.resolver == nil || o.owner == nil || emit == nil {
		return errLocalAppEmbodimentUnavailable
	}
	scope, err := o.resolver.ResolveLocalAppEmbodimentScope(ctx, req.localAppEmbodimentReadRequest)
	if err != nil {
		return fmt.Errorf("resolve local-app embodiment subscription scope: %w", err)
	}
	if err := validateLocalAppEmbodimentScope(scope, req.ConversationAnchorID); err != nil {
		return err
	}
	if err := o.resolver.RevalidateLocalAppEmbodimentScope(ctx, req.localAppEmbodimentReadRequest, scope); err != nil {
		return fmt.Errorf("revalidate local-app embodiment subscription scope: %w", err)
	}
	revalidate := func(callCtx context.Context) error {
		return o.resolver.RevalidateLocalAppEmbodimentScope(callCtx, req.localAppEmbodimentReadRequest, scope)
	}
	return o.owner.SubscribeLocalAppEmbodiment(ctx, scope, req.AfterSequence, revalidate, func(event localAppEmbodimentEvent) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := o.resolver.RevalidateLocalAppEmbodimentScope(ctx, req.localAppEmbodimentReadRequest, scope); err != nil {
			return fmt.Errorf("revalidate local-app embodiment subscription scope: %w", err)
		}
		if err := validateLocalAppEmbodimentEvent(event); err != nil {
			return fmt.Errorf("validate local-app embodiment event: %w", err)
		}
		return emit(cloneLocalAppEmbodimentEvent(event))
	})
}

func validateLocalAppEmbodimentReadInput(ctx context.Context, req localAppEmbodimentReadRequest) error {
	if ctx == nil {
		return fmt.Errorf("%w: context is required", errLocalAppEmbodimentInvalidInput)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if !validLocalAppAgentHandle(req.AgentHandle) ||
		req.AgentHandle != strings.TrimSpace(req.AgentHandle) ||
		!validLocalAppConversationSelector(req.ConversationAnchorID) ||
		req.ConversationAnchorID != strings.TrimSpace(req.ConversationAnchorID) {
		return errLocalAppEmbodimentInvalidInput
	}
	return nil
}

func validateLocalAppEmbodimentScope(scope localAppEmbodimentScope, requestedAnchor string) error {
	if strings.TrimSpace(scope.localAgentRef) == "" || scope.localAgentRef != strings.TrimSpace(scope.localAgentRef) ||
		!validLocalAppConversationSelector(scope.conversationAnchorID) ||
		scope.conversationAnchorID != requestedAnchor {
		return errLocalAppEmbodimentInvalidInput
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.agent-participation.r159
// @nimi-authority: rule.nimi.runtime.agent-participation.r160
// @nimi-authority: rule.nimi.runtime.agent-service.r032
// runtimeAgentEmbodimentSemanticOwner is direct-test composition only until
// the formal App operation registry and generated transport activate both
// reads in the single WP6 cutover.
type runtimeAgentEmbodimentSemanticOwner struct {
	svc *Service
}

func newRuntimeAgentEmbodimentSemanticOwner(svc *Service) runtimeAgentEmbodimentSemanticOwner {
	return runtimeAgentEmbodimentSemanticOwner{svc: svc}
}

func (o runtimeAgentEmbodimentSemanticOwner) SnapshotLocalAppEmbodiment(
	ctx context.Context,
	scope localAppEmbodimentScope,
) (localAppEmbodimentSnapshot, error) {
	if err := o.validateScope(ctx, scope); err != nil {
		return localAppEmbodimentSnapshot{}, err
	}
	for attempt := 0; attempt < localAppEmbodimentSnapshotAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return localAppEmbodimentSnapshot{}, err
		}
		o.svc.mu.RLock()
		entry := cloneAgentEntry(o.svc.agents[scope.localAgentRef])
		events := cloneAgentEvents(o.svc.events)
		sequence := o.svc.sequence
		o.svc.mu.RUnlock()
		posture, err := o.svc.GetBehavioralPosture(ctx, scope.localAgentRef)
		if err != nil {
			return localAppEmbodimentSnapshot{}, fmt.Errorf("read Runtime posture owner: %w", err)
		}
		o.svc.mu.RLock()
		stable := o.svc.sequence == sequence
		o.svc.mu.RUnlock()
		if !stable {
			continue
		}
		if err := o.validateScope(ctx, scope); err != nil {
			return localAppEmbodimentSnapshot{}, err
		}
		return projectCapturedLocalAppEmbodimentSnapshot(entry, events, sequence, posture, scope)
	}
	return localAppEmbodimentSnapshot{}, errLocalAppEmbodimentUnavailable
}

func projectCapturedLocalAppEmbodimentSnapshot(
	entry *agentEntry,
	events []*runtimev1.AgentEvent,
	sequence uint64,
	posture *BehavioralPosture,
	scope localAppEmbodimentScope,
) (localAppEmbodimentSnapshot, error) {
	if entry == nil || entry.Agent == nil || entry.State == nil ||
		entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
		return localAppEmbodimentSnapshot{}, errLocalAppEmbodimentUnavailable
	}

	snapshot := localAppEmbodimentSnapshot{
		Sequence:   sequence,
		Provenance: localAppEmbodimentProvenanceRuntime,
	}
	if updatedAt := entry.State.GetUpdatedAt(); updatedAt != nil {
		if timestampErr := updatedAt.CheckValid(); timestampErr != nil {
			return localAppEmbodimentSnapshot{}, fmt.Errorf("Runtime Agent state timestamp invalid: %w", timestampErr)
		}
		snapshot.ObservedAt = updatedAt.AsTime().UTC()
	}
	for _, raw := range events {
		if raw == nil || raw.GetAgentId() != scope.localAgentRef || raw.GetSequence() > sequence {
			continue
		}
		projected, admitted, projectErr := projectRuntimeAgentEmbodimentEvent(raw, scope.conversationAnchorID)
		if projectErr != nil {
			return localAppEmbodimentSnapshot{}, projectErr
		}
		if !admitted {
			continue
		}
		if projected.ObservedAt.After(snapshot.ObservedAt) {
			snapshot.ObservedAt = projected.ObservedAt
		}
		switch projected.Kind {
		case localAppEmbodimentEventActivity:
			snapshot.Activity = cloneLocalAppEmbodimentActivity(projected.Activity)
		case localAppEmbodimentEventEmotion:
			snapshot.Emotion = cloneLocalAppEmbodimentEmotion(projected.Emotion)
		case localAppEmbodimentEventPosture:
			snapshot.Posture = cloneLocalAppEmbodimentPosture(projected.Posture)
		case localAppEmbodimentEventVoiceTiming:
			snapshot.VoiceTiming = cloneLocalAppEmbodimentVoiceTiming(projected.VoiceTiming)
		}
	}

	currentEmotion := strings.TrimSpace(entry.State.GetCurrentEmotion())
	if currentEmotion != "" {
		normalized, normalizeErr := normalizeCurrentEmotion(currentEmotion)
		if normalizeErr != nil {
			return localAppEmbodimentSnapshot{}, normalizeErr
		}
		if snapshot.Emotion == nil || snapshot.Emotion.Name != normalized {
			snapshot.Emotion = &localAppEmbodimentEmotion{Name: normalized, Source: "runtime"}
		}
	}
	if posture != nil {
		projected, projectErr := projectRuntimeAgentEmbodimentPosture(posture.ActionFamily, posture.InterruptMode)
		if projectErr != nil {
			return localAppEmbodimentSnapshot{}, projectErr
		}
		snapshot.Posture = projected
		if strings.TrimSpace(posture.UpdatedAt) != "" {
			updatedAt, parseErr := time.Parse(time.RFC3339Nano, posture.UpdatedAt)
			if parseErr != nil {
				return localAppEmbodimentSnapshot{}, fmt.Errorf("Runtime posture timestamp invalid: %w", parseErr)
			}
			if updatedAt.UTC().After(snapshot.ObservedAt) {
				snapshot.ObservedAt = updatedAt.UTC()
			}
		}
	}
	return snapshot, nil
}

func (o runtimeAgentEmbodimentSemanticOwner) SubscribeLocalAppEmbodiment(
	ctx context.Context,
	scope localAppEmbodimentScope,
	afterSequence uint64,
	revalidate func(context.Context) error,
	emit func(localAppEmbodimentEvent) error,
) error {
	if revalidate == nil || emit == nil {
		return errLocalAppEmbodimentUnavailable
	}
	if err := o.validateScope(ctx, scope); err != nil {
		return err
	}

	sub := &subscriber{
		agentID: scope.localAgentRef,
		eventFilters: map[runtimev1.AgentEventType]struct{}{
			runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE:        {},
			runtimev1.AgentEventType_AGENT_EVENT_TYPE_PRESENTATION: {},
		},
		ch: make(chan *runtimev1.AgentEvent, subscriberBuffer),
	}
	o.svc.mu.Lock()
	if afterSequence > o.svc.sequence {
		o.svc.mu.Unlock()
		return fmt.Errorf("%w: cursor exceeds Runtime sequence", errLocalAppEmbodimentInvalidInput)
	}
	if len(o.svc.events) > 0 {
		firstRetained := o.svc.events[0].GetSequence()
		if firstRetained > 1 && afterSequence < firstRetained-1 {
			o.svc.mu.Unlock()
			return errLocalAppEmbodimentCursorExpired
		}
	}
	o.svc.nextSubscriberID++
	sub.id = o.svc.nextSubscriberID
	o.svc.subscribers[sub.id] = sub
	highWater := o.svc.sequence
	backlog := make([]*runtimev1.AgentEvent, 0, len(o.svc.events))
	for _, event := range o.svc.events {
		if event.GetSequence() > afterSequence && event.GetSequence() <= highWater && subscriberMatchesEvent(sub, event) {
			backlog = append(backlog, cloneAgentEvent(event))
		}
	}
	o.svc.mu.Unlock()
	defer o.svc.removeSubscriber(sub.id)

	deliver := func(raw *runtimev1.AgentEvent) error {
		if err := revalidate(ctx); err != nil {
			return err
		}
		if err := o.validateScope(ctx, scope); err != nil {
			return err
		}
		if raw == nil || raw.GetAgentId() != scope.localAgentRef {
			return errLocalAppEmbodimentUnavailable
		}
		projected, admitted, err := projectRuntimeAgentEmbodimentEvent(raw, scope.conversationAnchorID)
		if err != nil || !admitted {
			return err
		}
		return emit(projected)
	}
	for _, event := range backlog {
		if err := deliver(event); err != nil {
			return err
		}
	}
	lastScannedSequence := highWater
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case event, ok := <-sub.ch:
			if !ok {
				return errLocalAppEmbodimentUnavailable
			}
			if event == nil || event.GetSequence() <= lastScannedSequence {
				continue
			}
			// The shared Runtime event subscriber is bounded and may coalesce a
			// burst by retaining only its newest notification. Recover every
			// retained semantic event through that notification sequence so the
			// embodiment union remains ordered; fail closed if the durable cursor
			// window has already expired.
			retained, err := o.retainedEventsAfterThrough(scope, lastScannedSequence, event.GetSequence())
			if err != nil {
				return err
			}
			for _, candidate := range retained {
				if err := deliver(candidate); err != nil {
					return err
				}
			}
			lastScannedSequence = event.GetSequence()
		}
	}
}

func (o runtimeAgentEmbodimentSemanticOwner) retainedEventsAfterThrough(
	scope localAppEmbodimentScope,
	afterSequence uint64,
	throughSequence uint64,
) ([]*runtimev1.AgentEvent, error) {
	if o.svc == nil || throughSequence <= afterSequence {
		return nil, nil
	}
	o.svc.mu.RLock()
	defer o.svc.mu.RUnlock()
	if throughSequence > o.svc.sequence {
		return nil, errLocalAppEmbodimentUnavailable
	}
	if len(o.svc.events) > 0 {
		firstRetained := o.svc.events[0].GetSequence()
		if firstRetained > 1 && afterSequence < firstRetained-1 {
			return nil, errLocalAppEmbodimentCursorExpired
		}
	}
	events := make([]*runtimev1.AgentEvent, 0)
	for _, event := range o.svc.events {
		if event.GetSequence() <= afterSequence || event.GetSequence() > throughSequence ||
			event.GetAgentId() != scope.localAgentRef {
			continue
		}
		switch event.GetEventType() {
		case runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE,
			runtimev1.AgentEventType_AGENT_EVENT_TYPE_PRESENTATION:
			events = append(events, cloneAgentEvent(event))
		}
	}
	return events, nil
}

func (o runtimeAgentEmbodimentSemanticOwner) validateScope(ctx context.Context, scope localAppEmbodimentScope) error {
	if ctx == nil {
		return errLocalAppEmbodimentInvalidInput
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if o.svc == nil || o.svc.isClosed() || validateLocalAppEmbodimentScope(scope, scope.conversationAnchorID) != nil {
		return errLocalAppEmbodimentUnavailable
	}
	o.svc.mu.RLock()
	entry := o.svc.agents[scope.localAgentRef]
	active := entry != nil && entry.Agent != nil &&
		entry.Agent.GetLifecycleStatus() == runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE
	o.svc.mu.RUnlock()
	if !active {
		return errLocalAppEmbodimentUnavailable
	}
	o.svc.chatSurfaceMu.Lock()
	anchor := o.svc.chatAnchors[scope.conversationAnchorID]
	validAnchor := anchor != nil && conversationAnchorIsResumable(anchor.Status) &&
		anchor.AgentID == scope.localAgentRef && anchor.LocalAgentRef == scope.localAgentRef
	o.svc.chatSurfaceMu.Unlock()
	if !validAnchor {
		return errLocalAppEmbodimentUnavailable
	}
	return nil
}

func projectRuntimeAgentEmbodimentEvent(
	raw *runtimev1.AgentEvent,
	conversationAnchorID string,
) (localAppEmbodimentEvent, bool, error) {
	if raw == nil || raw.GetSequence() == 0 || strings.TrimSpace(raw.GetAgentId()) == "" {
		return localAppEmbodimentEvent{}, false, errLocalAppEmbodimentUnavailable
	}
	observedAt := raw.GetTimestamp()
	if observedAt == nil {
		return localAppEmbodimentEvent{}, false, errLocalAppEmbodimentUnavailable
	}
	if err := observedAt.CheckValid(); err != nil {
		return localAppEmbodimentEvent{}, false, fmt.Errorf("Runtime embodiment event timestamp invalid: %w", err)
	}
	projected := localAppEmbodimentEvent{
		Sequence:   raw.GetSequence(),
		ObservedAt: observedAt.AsTime().UTC(),
		Provenance: localAppEmbodimentProvenanceRuntime,
	}

	switch raw.GetEventType() {
	case runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE:
		detail := raw.GetState()
		if detail == nil {
			return localAppEmbodimentEvent{}, false, errLocalAppEmbodimentUnavailable
		}
		originAnchor := strings.TrimSpace(detail.GetConversationAnchorId())
		if originAnchor != "" && originAnchor != conversationAnchorID {
			return localAppEmbodimentEvent{}, false, nil
		}
		switch detail.GetFamily() {
		case runtimev1.AgentStateEventFamily_AGENT_STATE_EVENT_FAMILY_EMOTION_CHANGED:
			emotion, err := normalizeCurrentEmotion(detail.GetCurrentEmotion())
			if err != nil {
				return localAppEmbodimentEvent{}, false, err
			}
			source, err := normalizeEmotionSource(detail.GetEmotionSource())
			if err != nil {
				return localAppEmbodimentEvent{}, false, err
			}
			projected.Kind = localAppEmbodimentEventEmotion
			projected.Emotion = &localAppEmbodimentEmotion{Name: emotion, Source: source}
		case runtimev1.AgentStateEventFamily_AGENT_STATE_EVENT_FAMILY_POSTURE_CHANGED:
			posture := detail.GetCurrentPosture()
			if posture == nil {
				return localAppEmbodimentEvent{}, false, errLocalAppEmbodimentUnavailable
			}
			var err error
			projected.Posture, err = projectRuntimeAgentEmbodimentPosture(posture.GetActionFamily(), posture.GetInterruptMode())
			if err != nil {
				return localAppEmbodimentEvent{}, false, err
			}
			projected.Kind = localAppEmbodimentEventPosture
		default:
			return localAppEmbodimentEvent{}, false, nil
		}
	case runtimev1.AgentEventType_AGENT_EVENT_TYPE_PRESENTATION:
		detail := raw.GetPresentation()
		if detail == nil {
			return localAppEmbodimentEvent{}, false, errLocalAppEmbodimentUnavailable
		}
		if strings.TrimSpace(detail.GetConversationAnchorId()) != conversationAnchorID {
			return localAppEmbodimentEvent{}, false, nil
		}
		if err := validatePresentationDetail(detail); err != nil {
			return localAppEmbodimentEvent{}, false, err
		}
		switch detail.GetFamily() {
		case runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_ACTIVITY_REQUESTED:
			if err := validateActivityProjectionFields(
				detail.GetActivityName(),
				detail.GetActivityCategory(),
				detail.GetActivityIntensity(),
				detail.GetActivitySource(),
			); err != nil {
				return localAppEmbodimentEvent{}, false, err
			}
			if !validLocalAppConversationSelector(detail.GetTurnId()) {
				return localAppEmbodimentEvent{}, false, fmt.Errorf("Runtime embodiment activity correlation is invalid")
			}
			projected.Kind = localAppEmbodimentEventActivity
			projected.Activity = &localAppEmbodimentActivity{
				Name:      strings.TrimSpace(detail.GetActivityName()),
				Category:  strings.TrimSpace(detail.GetActivityCategory()),
				Intensity: strings.TrimSpace(detail.GetActivityIntensity()),
				Source:    "runtime",
				TurnRef:   strings.TrimSpace(detail.GetTurnId()),
			}
		case runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_VOICE_PLAYBACK_REQUESTED,
			runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_VOICE_STREAM_CHUNK_AVAILABLE,
			runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_VOICE_PLAYBACK_TERMINAL:
			voiceTiming, err := projectRuntimeAgentEmbodimentVoiceTiming(detail)
			if err != nil {
				return localAppEmbodimentEvent{}, false, err
			}
			projected.Kind = localAppEmbodimentEventVoiceTiming
			projected.VoiceTiming = voiceTiming
		default:
			// expression_requested, lipsync, debug and every Avatar-specific
			// carrier remain outside the common embodiment contract.
			return localAppEmbodimentEvent{}, false, nil
		}
	default:
		return localAppEmbodimentEvent{}, false, nil
	}
	if err := validateLocalAppEmbodimentEvent(projected); err != nil {
		return localAppEmbodimentEvent{}, false, err
	}
	return projected, true, nil
}

func projectRuntimeAgentEmbodimentPosture(actionFamily, interruptMode string) (*localAppEmbodimentPosture, error) {
	actionFamily = normalizeBehavioralActionFamily(actionFamily)
	interruptMode = normalizeBehavioralInterruptMode(interruptMode)
	if _, ok := allowedBehavioralActionFamilies[actionFamily]; !ok {
		return nil, fmt.Errorf("Runtime embodiment posture action family is invalid")
	}
	if _, ok := allowedBehavioralInterruptModes[interruptMode]; !ok {
		return nil, fmt.Errorf("Runtime embodiment posture interrupt mode is invalid")
	}
	return &localAppEmbodimentPosture{ActionFamily: actionFamily, InterruptMode: interruptMode}, nil
}

func projectRuntimeAgentEmbodimentVoiceTiming(
	detail *runtimev1.AgentPresentationEventDetail,
) (*localAppEmbodimentVoiceTiming, error) {
	if detail == nil || detail.GetDurationMs() < 0 || detail.GetDurationMs() > localAppEmbodimentMaxTimingMillis ||
		detail.GetDeadlineOffsetMs() < 0 || detail.GetDeadlineOffsetMs() > localAppEmbodimentMaxTimingMillis {
		return nil, fmt.Errorf("Runtime embodiment voice timing is invalid")
	}
	voiceRef := firstNonEmpty(
		strings.TrimSpace(detail.GetVoiceStreamId()),
		strings.TrimSpace(detail.GetAudioArtifactId()),
		strings.TrimSpace(detail.GetFinalArtifactId()),
	)
	if !validLocalAppConversationSelector(voiceRef) || !validLocalAppConversationSelector(detail.GetTurnId()) {
		return nil, fmt.Errorf("Runtime embodiment voice correlation is incomplete")
	}
	phase := ""
	switch detail.GetVoicePlaybackState() {
	case runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_ACTIVE:
		phase = "active"
	case runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_COMPLETED:
		phase = "completed"
	case runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_FAILED:
		phase = "failed"
	case runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_INTERRUPTED:
		phase = "interrupted"
	case runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_CANCELED:
		phase = "canceled"
	default:
		return nil, fmt.Errorf("Runtime embodiment voice phase is invalid")
	}
	return &localAppEmbodimentVoiceTiming{
		Phase:                phase,
		DurationMillis:       detail.GetDurationMs(),
		DeadlineOffsetMillis: detail.GetDeadlineOffsetMs(),
		TurnRef:              strings.TrimSpace(detail.GetTurnId()),
		VoiceRef:             voiceRef,
	}, nil
}

func validateLocalAppEmbodimentSnapshot(snapshot localAppEmbodimentSnapshot) error {
	if snapshot.Sequence == 0 || snapshot.ObservedAt.IsZero() || snapshot.Provenance != localAppEmbodimentProvenanceRuntime {
		return errLocalAppEmbodimentUnavailable
	}
	return nil
}

func validateLocalAppEmbodimentEvent(event localAppEmbodimentEvent) error {
	if event.Sequence == 0 || event.ObservedAt.IsZero() ||
		event.Provenance != localAppEmbodimentProvenanceRuntime {
		return errLocalAppEmbodimentUnavailable
	}
	payloads := 0
	if event.Activity != nil {
		payloads++
	}
	if event.Emotion != nil {
		payloads++
	}
	if event.Posture != nil {
		payloads++
	}
	if event.VoiceTiming != nil {
		payloads++
	}
	if payloads != 1 {
		return errLocalAppEmbodimentUnavailable
	}
	switch event.Kind {
	case localAppEmbodimentEventActivity:
		if event.Activity == nil {
			return errLocalAppEmbodimentUnavailable
		}
	case localAppEmbodimentEventEmotion:
		if event.Emotion == nil {
			return errLocalAppEmbodimentUnavailable
		}
	case localAppEmbodimentEventPosture:
		if event.Posture == nil {
			return errLocalAppEmbodimentUnavailable
		}
	case localAppEmbodimentEventVoiceTiming:
		if event.VoiceTiming == nil {
			return errLocalAppEmbodimentUnavailable
		}
	default:
		return errLocalAppEmbodimentUnavailable
	}
	return nil
}

func cloneLocalAppEmbodimentSnapshot(input localAppEmbodimentSnapshot) localAppEmbodimentSnapshot {
	input.Activity = cloneLocalAppEmbodimentActivity(input.Activity)
	input.Emotion = cloneLocalAppEmbodimentEmotion(input.Emotion)
	input.Posture = cloneLocalAppEmbodimentPosture(input.Posture)
	input.VoiceTiming = cloneLocalAppEmbodimentVoiceTiming(input.VoiceTiming)
	return input
}

func cloneLocalAppEmbodimentEvent(input localAppEmbodimentEvent) localAppEmbodimentEvent {
	input.Activity = cloneLocalAppEmbodimentActivity(input.Activity)
	input.Emotion = cloneLocalAppEmbodimentEmotion(input.Emotion)
	input.Posture = cloneLocalAppEmbodimentPosture(input.Posture)
	input.VoiceTiming = cloneLocalAppEmbodimentVoiceTiming(input.VoiceTiming)
	return input
}

func cloneLocalAppEmbodimentActivity(input *localAppEmbodimentActivity) *localAppEmbodimentActivity {
	if input == nil {
		return nil
	}
	copy := *input
	return &copy
}

func cloneLocalAppEmbodimentEmotion(input *localAppEmbodimentEmotion) *localAppEmbodimentEmotion {
	if input == nil {
		return nil
	}
	copy := *input
	return &copy
}

func cloneLocalAppEmbodimentPosture(input *localAppEmbodimentPosture) *localAppEmbodimentPosture {
	if input == nil {
		return nil
	}
	copy := *input
	return &copy
}

func cloneLocalAppEmbodimentVoiceTiming(input *localAppEmbodimentVoiceTiming) *localAppEmbodimentVoiceTiming {
	if input == nil {
		return nil
	}
	copy := *input
	return &copy
}
