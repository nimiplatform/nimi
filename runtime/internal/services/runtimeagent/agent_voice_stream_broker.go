package runtimeagent

import (
	"context"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

const (
	agentVoiceStreamTerminalRetention = 2 * time.Minute
	agentVoiceStreamMaxBufferedBytes  = 32 * 1024 * 1024
	agentVoiceStreamMaxBufferedChunks = 512
	agentVoiceStreamSubscriberBuffer  = agentVoiceStreamMaxBufferedChunks + 2
)

type agentVoiceStreamBroker struct {
	mu      sync.Mutex
	streams map[string]*agentVoiceStreamState
}

type agentVoiceStreamState struct {
	events          []*runtimev1.AgentVoiceStreamEvent
	lastEvent       *runtimev1.AgentVoiceStreamEvent
	terminal        *runtimev1.AgentVoiceStreamEvent
	terminalAt      time.Time
	bufferedBytes   int64
	replayTruncated bool
	cancel          context.CancelFunc
	nextSubID       uint64
	subscribers     map[uint64]chan *runtimev1.AgentVoiceStreamEvent
}

func newAgentVoiceStreamBroker() *agentVoiceStreamBroker {
	return &agentVoiceStreamBroker{streams: make(map[string]*agentVoiceStreamState)}
}

func (b *agentVoiceStreamBroker) publish(event *runtimev1.AgentVoiceStreamEvent) {
	if b == nil || event == nil {
		return
	}
	voiceStreamID := strings.TrimSpace(event.GetVoiceStreamId())
	if voiceStreamID == "" {
		return
	}
	now := time.Now()
	cloned := cloneAgentVoiceStreamEvent(event)
	var targets []chan *runtimev1.AgentVoiceStreamEvent
	var closeTargets bool
	b.mu.Lock()
	b.pruneLocked(now)
	state := b.ensureLocked(voiceStreamID)
	if cloned.GetTerminal() {
		if state.terminal != nil {
			b.mu.Unlock()
			return
		}
		cloned.ReplayTruncated = state.replayTruncated || cloned.GetReplayTruncated()
		state.terminal = cloneAgentVoiceStreamEvent(cloned)
		state.lastEvent = cloneAgentVoiceStreamEvent(cloned)
		state.terminalAt = now
		targets = state.subscriberTargetsLocked()
		state.subscribers = make(map[uint64]chan *runtimev1.AgentVoiceStreamEvent)
		closeTargets = true
	} else if state.terminal == nil {
		chunkSize := int64(len(cloned.GetChunk()))
		if len(state.events) >= agentVoiceStreamMaxBufferedChunks || state.bufferedBytes+chunkSize > agentVoiceStreamMaxBufferedBytes {
			state.replayTruncated = true
			cloned.ReplayTruncated = true
		} else {
			state.events = append(state.events, cloneAgentVoiceStreamEvent(cloned))
			state.bufferedBytes += chunkSize
		}
		state.lastEvent = cloneAgentVoiceStreamEvent(cloned)
		targets = state.subscriberTargetsLocked()
	}
	b.mu.Unlock()
	for _, ch := range targets {
		select {
		case ch <- cloneAgentVoiceStreamEvent(cloned):
		default:
		}
		if closeTargets {
			close(ch)
		}
	}
}

func (b *agentVoiceStreamBroker) subscribe(voiceStreamID string, conversationAnchorID string, turnID string) ([]*runtimev1.AgentVoiceStreamEvent, <-chan *runtimev1.AgentVoiceStreamEvent, func(), error) {
	if b == nil {
		return nil, nil, func() {}, status.Error(codes.Unavailable, "agent voice stream broker unavailable")
	}
	trimmedID := strings.TrimSpace(voiceStreamID)
	if trimmedID == "" {
		return nil, nil, func() {}, status.Error(codes.InvalidArgument, "voice_stream_id is required")
	}
	anchorID := strings.TrimSpace(conversationAnchorID)
	trimmedTurnID := strings.TrimSpace(turnID)
	if anchorID == "" || trimmedTurnID == "" {
		return nil, nil, func() {}, status.Error(codes.InvalidArgument, "voice stream subscription requires conversation_anchor_id and turn_id")
	}
	now := time.Now()
	b.mu.Lock()
	b.pruneLocked(now)
	state := b.streams[trimmedID]
	if state == nil || state.lastEvent == nil || !agentVoiceStreamAnchorTurnMatches(state.lastEvent, anchorID, trimmedTurnID) {
		b.mu.Unlock()
		return nil, nil, func() {}, status.Error(codes.NotFound, "agent voice stream not found under referenced turn")
	}
	backlog := make([]*runtimev1.AgentVoiceStreamEvent, 0, len(state.events)+1)
	for _, event := range state.events {
		backlog = append(backlog, cloneAgentVoiceStreamEvent(event))
	}
	if state.terminal != nil {
		if !agentVoiceStreamAnchorTurnMatches(state.terminal, anchorID, trimmedTurnID) {
			b.mu.Unlock()
			return nil, nil, func() {}, status.Error(codes.NotFound, "agent voice stream not found under referenced turn")
		}
		backlog = append(backlog, cloneAgentVoiceStreamEvent(state.terminal))
		b.mu.Unlock()
		return backlog, nil, func() {}, nil
	}
	state.nextSubID++
	subID := state.nextSubID
	ch := make(chan *runtimev1.AgentVoiceStreamEvent, agentVoiceStreamSubscriberBuffer)
	state.subscribers[subID] = ch
	b.mu.Unlock()
	release := func() {
		b.mu.Lock()
		if state, ok := b.streams[trimmedID]; ok {
			delete(state.subscribers, subID)
		}
		b.mu.Unlock()
	}
	return backlog, ch, release, nil
}

func (b *agentVoiceStreamBroker) registerCancel(voiceStreamID string, cancel context.CancelFunc) func() {
	if b == nil || cancel == nil {
		return func() {}
	}
	trimmedID := strings.TrimSpace(voiceStreamID)
	if trimmedID == "" {
		return func() {}
	}
	var cancelNow bool
	now := time.Now()
	b.mu.Lock()
	b.pruneLocked(now)
	state := b.ensureLocked(trimmedID)
	if state.terminal != nil {
		cancelNow = true
	} else {
		state.cancel = cancel
	}
	b.mu.Unlock()
	if cancelNow {
		cancel()
	}
	return func() {
		b.mu.Lock()
		if state := b.streams[trimmedID]; state != nil {
			state.cancel = nil
		}
		b.mu.Unlock()
	}
}

func (b *agentVoiceStreamBroker) interrupt(terminal *runtimev1.AgentVoiceStreamEvent) (*runtimev1.AgentVoiceStreamEvent, bool, error) {
	if b == nil {
		return nil, false, status.Error(codes.Unavailable, "agent voice stream broker unavailable")
	}
	if terminal == nil {
		return nil, false, status.Error(codes.InvalidArgument, "agent voice playback terminal event is required")
	}
	voiceStreamID := strings.TrimSpace(terminal.GetVoiceStreamId())
	if voiceStreamID == "" {
		return nil, false, status.Error(codes.InvalidArgument, "voice_stream_id is required")
	}
	now := time.Now()
	var cancel context.CancelFunc
	var targets []chan *runtimev1.AgentVoiceStreamEvent
	b.mu.Lock()
	b.pruneLocked(now)
	state := b.streams[voiceStreamID]
	if state == nil {
		b.mu.Unlock()
		return nil, false, status.Error(codes.NotFound, "agent voice stream not found")
	}
	if state.terminal != nil {
		if !agentVoiceStreamScopeMatches(state.terminal, terminal) {
			b.mu.Unlock()
			return nil, false, status.Error(codes.NotFound, "agent voice stream not found under referenced turn")
		}
		out := cloneAgentVoiceStreamEvent(state.terminal)
		b.mu.Unlock()
		return out, false, nil
	}
	if state.lastEvent == nil || !agentVoiceStreamScopeMatches(state.lastEvent, terminal) {
		b.mu.Unlock()
		return nil, false, status.Error(codes.NotFound, "agent voice stream not found under referenced turn")
	}
	out := cloneAgentVoiceStreamEvent(terminal)
	if state.lastEvent != nil {
		fillAgentVoiceStreamTerminalFromLastEvent(out, state.lastEvent)
	}
	out.Terminal = true
	if out.VoiceOutputMode == runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_UNSPECIFIED {
		out.VoiceOutputMode = runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM
	}
	out.VoicePlaybackState = runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_INTERRUPTED
	if strings.TrimSpace(out.TerminalReason) == "" {
		out.TerminalReason = "runtime_voice_interrupt_requested"
	}
	out.ReplayTruncated = state.replayTruncated || out.GetReplayTruncated()
	state.terminal = cloneAgentVoiceStreamEvent(out)
	state.lastEvent = cloneAgentVoiceStreamEvent(out)
	state.terminalAt = now
	cancel = state.cancel
	state.cancel = nil
	targets = state.subscriberTargetsLocked()
	state.subscribers = make(map[uint64]chan *runtimev1.AgentVoiceStreamEvent)
	b.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	for _, ch := range targets {
		select {
		case ch <- cloneAgentVoiceStreamEvent(out):
		default:
		}
		close(ch)
	}
	return out, true, nil
}

func (b *agentVoiceStreamBroker) terminalState(voiceStreamID string) runtimev1.VoicePlaybackState {
	if b == nil {
		return runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_UNSPECIFIED
	}
	trimmedID := strings.TrimSpace(voiceStreamID)
	if trimmedID == "" {
		return runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_UNSPECIFIED
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if state := b.streams[trimmedID]; state != nil && state.terminal != nil {
		return state.terminal.GetVoicePlaybackState()
	}
	return runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_UNSPECIFIED
}

func (b *agentVoiceStreamBroker) ensureLocked(voiceStreamID string) *agentVoiceStreamState {
	state := b.streams[voiceStreamID]
	if state == nil {
		state = &agentVoiceStreamState{subscribers: make(map[uint64]chan *runtimev1.AgentVoiceStreamEvent)}
		b.streams[voiceStreamID] = state
	}
	return state
}

func (b *agentVoiceStreamBroker) pruneLocked(now time.Time) {
	for voiceStreamID, state := range b.streams {
		if state == nil {
			delete(b.streams, voiceStreamID)
			continue
		}
		if !state.terminalAt.IsZero() && now.Sub(state.terminalAt) > agentVoiceStreamTerminalRetention {
			delete(b.streams, voiceStreamID)
		}
	}
}

func (s *agentVoiceStreamState) subscriberTargetsLocked() []chan *runtimev1.AgentVoiceStreamEvent {
	if s == nil || len(s.subscribers) == 0 {
		return nil
	}
	out := make([]chan *runtimev1.AgentVoiceStreamEvent, 0, len(s.subscribers))
	for _, ch := range s.subscribers {
		out = append(out, ch)
	}
	return out
}

func cloneAgentVoiceStreamEvent(event *runtimev1.AgentVoiceStreamEvent) *runtimev1.AgentVoiceStreamEvent {
	if event == nil {
		return nil
	}
	return proto.Clone(event).(*runtimev1.AgentVoiceStreamEvent)
}

func fillAgentVoiceStreamTerminalFromLastEvent(terminal *runtimev1.AgentVoiceStreamEvent, last *runtimev1.AgentVoiceStreamEvent) {
	if terminal == nil || last == nil {
		return
	}
	if strings.TrimSpace(terminal.ConversationAnchorId) == "" {
		terminal.ConversationAnchorId = strings.TrimSpace(last.GetConversationAnchorId())
	}
	if strings.TrimSpace(terminal.TurnId) == "" {
		terminal.TurnId = strings.TrimSpace(last.GetTurnId())
	}
	if strings.TrimSpace(terminal.StreamId) == "" {
		terminal.StreamId = strings.TrimSpace(last.GetStreamId())
	}
	if strings.TrimSpace(terminal.MessageId) == "" {
		terminal.MessageId = strings.TrimSpace(last.GetMessageId())
	}
	if strings.TrimSpace(terminal.MimeType) == "" {
		terminal.MimeType = strings.TrimSpace(last.GetMimeType())
	}
	if terminal.VoiceOutputMode == runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_UNSPECIFIED {
		terminal.VoiceOutputMode = last.GetVoiceOutputMode()
	}
	if strings.TrimSpace(terminal.PlaybackTarget) == "" {
		terminal.PlaybackTarget = strings.TrimSpace(last.GetPlaybackTarget())
	}
}

func agentVoiceStreamScopeMatches(actual *runtimev1.AgentVoiceStreamEvent, expected *runtimev1.AgentVoiceStreamEvent) bool {
	if actual == nil || expected == nil {
		return false
	}
	return agentVoiceStreamScopeFieldMatches(actual.GetConversationAnchorId(), expected.GetConversationAnchorId()) &&
		agentVoiceStreamScopeFieldMatches(actual.GetTurnId(), expected.GetTurnId()) &&
		agentVoiceStreamScopeFieldMatches(actual.GetStreamId(), expected.GetStreamId())
}

func agentVoiceStreamScopeFieldMatches(actual string, expected string) bool {
	trimmedActual := strings.TrimSpace(actual)
	trimmedExpected := strings.TrimSpace(expected)
	return trimmedActual != "" && trimmedExpected != "" && trimmedActual == trimmedExpected
}

func agentVoiceStreamAnchorTurnMatches(actual *runtimev1.AgentVoiceStreamEvent, conversationAnchorID string, turnID string) bool {
	if actual == nil {
		return false
	}
	return agentVoiceStreamScopeFieldMatches(actual.GetConversationAnchorId(), conversationAnchorID) &&
		agentVoiceStreamScopeFieldMatches(actual.GetTurnId(), turnID)
}

func (s *Service) publishAgentVoiceStreamEvent(event *runtimev1.AgentVoiceStreamEvent) {
	if s == nil || s.agentVoiceStreams == nil {
		return
	}
	s.agentVoiceStreams.publish(event)
}

func (s *Service) registerAgentVoiceStreamCancel(voiceStreamID string, cancel context.CancelFunc) func() {
	if s == nil || s.agentVoiceStreams == nil {
		return func() {}
	}
	return s.agentVoiceStreams.registerCancel(voiceStreamID, cancel)
}

func (s *Service) interruptAgentVoiceStream(terminal *runtimev1.AgentVoiceStreamEvent) (*runtimev1.AgentVoiceStreamEvent, bool, error) {
	if s == nil || s.agentVoiceStreams == nil {
		return nil, false, status.Error(codes.Unavailable, "agent voice stream broker unavailable")
	}
	return s.agentVoiceStreams.interrupt(terminal)
}

func (s *Service) agentVoiceStreamTerminalState(voiceStreamID string) runtimev1.VoicePlaybackState {
	if s == nil || s.agentVoiceStreams == nil {
		return runtimev1.VoicePlaybackState_VOICE_PLAYBACK_STATE_UNSPECIFIED
	}
	return s.agentVoiceStreams.terminalState(voiceStreamID)
}

func (s *Service) SubscribeAgentVoiceStream(req *runtimev1.SubscribeAgentVoiceStreamRequest, stream runtimev1.RuntimeAgentService_SubscribeAgentVoiceStreamServer) error {
	if s == nil || s.isClosed() {
		return status.Error(codes.FailedPrecondition, "runtime agent service unavailable")
	}
	if req == nil {
		return status.Error(codes.InvalidArgument, "subscribe agent voice stream request is required")
	}
	voiceStreamID := strings.TrimSpace(req.GetVoiceStreamId())
	if voiceStreamID == "" {
		return status.Error(codes.InvalidArgument, "voice_stream_id is required")
	}
	conversationAnchorID := strings.TrimSpace(req.GetConversationAnchorId())
	turnID := strings.TrimSpace(req.GetTurnId())
	if conversationAnchorID == "" || turnID == "" {
		return status.Error(codes.InvalidArgument, "voice stream subscription requires conversation_anchor_id and turn_id")
	}
	if s == nil || s.agentVoiceStreams == nil {
		return status.Error(codes.Unavailable, "agent voice stream broker unavailable")
	}
	if strings.TrimSpace(req.GetAgentId()) != "" {
		return status.Error(codes.InvalidArgument, "agent_id is not part of the scoped voice subscription request")
	}
	identity, _, identityErr := s.agentEntryForIdentityContext(req.GetContext())
	if identityErr != nil {
		return identityErr
	}
	callerAppID := strings.TrimSpace(req.GetContext().GetAppId())
	if callerAppID == "" {
		return status.Error(codes.InvalidArgument, "voice stream subscription requires app_id")
	}
	scopedBinding := req.GetContext().GetScopedBinding()
	if scopedBinding != nil {
		if scopedBindingAttachmentConversationAnchorMismatches(scopedBinding, conversationAnchorID) {
			return status.Error(codes.PermissionDenied, "voice stream scoped binding conversation_anchor_id mismatch")
		}
		if err := s.validateScopedBindingAttachment(scopedBinding, callerAppID, identity.LocalAgentRef, runtimeAgentTurnReadScope); err != nil {
			return err
		}
	}
	session, err := s.resolveVoicePlaybackAnchorScope(callerAppID, identity, conversationAnchorID, scopedBinding, runtimeAgentTurnReadScope)
	if err != nil {
		return err
	}
	backlog, ch, release, err := s.agentVoiceStreams.subscribe(voiceStreamID, session.ConversationAnchorID, turnID)
	if err != nil {
		return err
	}
	defer release()
	if err := stream.SendHeader(metadata.MD{}); err != nil {
		return err
	}
	for _, event := range backlog {
		if err := stream.Send(cloneAgentVoiceStreamEvent(event)); err != nil {
			return err
		}
		if event.GetTerminal() {
			return nil
		}
	}
	for {
		select {
		case <-stream.Context().Done():
			if err := stream.Context().Err(); err != nil {
				return err
			}
			return context.Canceled
		case event, ok := <-ch:
			if !ok {
				return nil
			}
			if err := stream.Send(cloneAgentVoiceStreamEvent(event)); err != nil {
				return err
			}
			if event.GetTerminal() {
				return nil
			}
		}
	}
}
