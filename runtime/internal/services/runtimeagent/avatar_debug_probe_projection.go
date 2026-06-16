package runtimeagent

import (
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *Service) appendAvatarDebugProjectionEvents(
	request *runtimev1.AvatarDebugProbeRequestEnvelope,
	result *runtimev1.AvatarDebugProbeResultEnvelope,
	replay *runtimev1.AvatarDebugReplayRef,
) error {
	events := []*runtimev1.AgentEvent{
		s.newEvent(request.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_AVATAR_DEBUG, &runtimev1.AgentEvent_AvatarDebug{
			AvatarDebug: &runtimev1.AgentAvatarDebugEventDetail{
				Family:  runtimev1.AvatarDebugEventFamily_AVATAR_DEBUG_EVENT_FAMILY_PROBE_REQUESTED,
				Request: request,
			},
		}),
		s.newEvent(result.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_AVATAR_DEBUG, &runtimev1.AgentEvent_AvatarDebug{
			AvatarDebug: &runtimev1.AgentAvatarDebugEventDetail{
				Family: runtimev1.AvatarDebugEventFamily_AVATAR_DEBUG_EVENT_FAMILY_PROBE_RESULT,
				Result: result,
			},
		}),
		s.newEvent(request.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_AVATAR_DEBUG, &runtimev1.AgentEvent_AvatarDebug{
			AvatarDebug: &runtimev1.AgentAvatarDebugEventDetail{
				Family: runtimev1.AvatarDebugEventFamily_AVATAR_DEBUG_EVENT_FAMILY_REPLAY_LINKED,
				Replay: replay,
			},
		}),
	}
	s.mu.Lock()
	previousEvents := append([]*runtimev1.AgentEvent(nil), s.events...)
	previousSequence := s.sequence
	committedEvents := s.eventStreamRuntime().appendEventsLocked(events...)
	if err := s.saveStateLocked(); err != nil {
		s.events = previousEvents
		s.sequence = previousSequence
		s.mu.Unlock()
		return err
	}
	targetsByEvent := s.eventStreamRuntime().matchingSubscribersLocked(committedEvents)
	s.mu.Unlock()
	s.eventStreamRuntime().broadcast(committedEvents, targetsByEvent)
	return nil
}

func (s *Service) appendAvatarDebugResultProjectionEvent(result *runtimev1.AvatarDebugProbeResultEnvelope) error {
	event := s.newEvent(result.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_AVATAR_DEBUG, &runtimev1.AgentEvent_AvatarDebug{
		AvatarDebug: &runtimev1.AgentAvatarDebugEventDetail{
			Family: runtimev1.AvatarDebugEventFamily_AVATAR_DEBUG_EVENT_FAMILY_PROBE_RESULT,
			Result: result,
		},
	})
	s.mu.Lock()
	previousEvents := append([]*runtimev1.AgentEvent(nil), s.events...)
	previousSequence := s.sequence
	committedEvents := s.eventStreamRuntime().appendEventsLocked(event)
	if err := s.saveStateLocked(); err != nil {
		s.events = previousEvents
		s.sequence = previousSequence
		s.mu.Unlock()
		return err
	}
	targetsByEvent := s.eventStreamRuntime().matchingSubscribersLocked(committedEvents)
	s.mu.Unlock()
	s.eventStreamRuntime().broadcast(committedEvents, targetsByEvent)
	return nil
}

func (s *Service) listAvatarDebugAuditProjection(agentID string, anchorID string, probeKind runtimev1.AvatarDebugProbeKind) ([]*runtimev1.AvatarDebugProbeResultEnvelope, []*runtimev1.AvatarDebugReplayRef, error) {
	events, err := s.listAvatarDebugAuditEvents()
	if err != nil {
		return nil, nil, err
	}
	resultsByProbe := map[string]*runtimev1.AvatarDebugProbeResultEnvelope{}
	replays := make([]*runtimev1.AvatarDebugReplayRef, 0)
	for _, event := range events {
		switch strings.TrimSpace(event.GetOperation()) {
		case avatarDebugResultOperation:
			result, ok := avatarDebugResultFromAuditEvent(event)
			if !ok || result.GetAgentId() != agentID || result.GetConversationAnchorId() != anchorID {
				continue
			}
			if probeKind != runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_UNSPECIFIED && result.GetProbeKind() != probeKind {
				continue
			}
			if current := resultsByProbe[result.GetProbeId()]; current == nil || avatarDebugResultObservedAt(result).After(avatarDebugResultObservedAt(current)) {
				resultsByProbe[result.GetProbeId()] = result
			}
		case avatarDebugReplayLinkOperation:
			replay, ok := avatarDebugReplayFromAuditEvent(event)
			if !ok {
				continue
			}
			if event.GetPrincipalId() != agentID || event.GetResourceSelectorHash() != anchorID {
				continue
			}
			replays = append(replays, replay)
		}
	}
	results := make([]*runtimev1.AvatarDebugProbeResultEnvelope, 0, len(resultsByProbe))
	for _, result := range resultsByProbe {
		results = append(results, result)
	}
	sort.SliceStable(results, func(i, j int) bool {
		left := avatarDebugResultObservedAt(results[i])
		right := avatarDebugResultObservedAt(results[j])
		if left.Equal(right) {
			return results[i].GetProbeId() < results[j].GetProbeId()
		}
		return left.After(right)
	})
	return results, replays, nil
}

func (s *Service) findAvatarDebugReplay(agentID string, anchorID string, probeID string) (*runtimev1.AvatarDebugProbeRequestEnvelope, *runtimev1.AvatarDebugProbeResultEnvelope, *runtimev1.AvatarDebugReplayRef, error) {
	events, err := s.listAvatarDebugAuditEvents()
	if err != nil {
		return nil, nil, nil, err
	}
	var request *runtimev1.AvatarDebugProbeRequestEnvelope
	var result *runtimev1.AvatarDebugProbeResultEnvelope
	var replay *runtimev1.AvatarDebugReplayRef
	for _, event := range events {
		if event.GetTraceId() != probeID || event.GetPrincipalId() != agentID || event.GetResourceSelectorHash() != anchorID {
			continue
		}
		switch strings.TrimSpace(event.GetOperation()) {
		case avatarDebugRequestOperation:
			if parsed, ok := avatarDebugRequestFromAuditEvent(event); ok {
				request = parsed
			}
		case avatarDebugResultOperation:
			if parsed, ok := avatarDebugResultFromAuditEvent(event); ok {
				if result == nil || avatarDebugResultObservedAt(parsed).After(avatarDebugResultObservedAt(result)) {
					result = parsed
				}
			}
		case avatarDebugReplayLinkOperation:
			if parsed, ok := avatarDebugReplayFromAuditEvent(event); ok {
				replay = parsed
			}
		}
	}
	if request == nil || result == nil || replay == nil {
		return nil, nil, nil, status.Error(codes.NotFound, "avatar debug replay audit lineage not found")
	}
	return request, result, replay, nil
}

func (s *Service) listAvatarDebugAuditEvents() ([]*runtimev1.AuditEventRecord, error) {
	if s == nil || s.auditStore == nil {
		return nil, status.Error(codes.FailedPrecondition, "runtime audit store is required for avatar debug replay")
	}
	req := &runtimev1.ListAuditEventsRequest{
		Domain:   avatarDebugAuditDomain,
		PageSize: 200,
	}
	var events []*runtimev1.AuditEventRecord
	for {
		resp, err := s.auditStore.ListEvents(req)
		if err != nil {
			return nil, err
		}
		events = append(events, resp.GetEvents()...)
		if strings.TrimSpace(resp.GetNextPageToken()) == "" {
			break
		}
		req.PageToken = resp.GetNextPageToken()
	}
	return events, nil
}
