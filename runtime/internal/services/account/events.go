package account

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) subscribe(req *runtimev1.SubscribeAccountSessionEventsRequest) ([]*runtimev1.AccountSessionEvent, *runtimev1.AccountSessionEvent, subscriber) {
	s.mu.Lock()
	defer s.mu.Unlock()
	after := req.GetAfterSequence()
	replayTruncated := false
	var replay []*runtimev1.AccountSessionEvent
	if after == 0 {
		replay = nil
	} else if len(s.events) > 0 {
		oldest := s.events[0].GetSequence()
		replayTruncated = oldest > after && oldest-after > 1
		if !replayTruncated {
			for _, event := range s.events {
				if event.GetSequence() > after {
					cloned := cloneEvent(event)
					cloned.DeliveryKind = runtimev1.AccountSessionDeliveryKind_ACCOUNT_SESSION_DELIVERY_KIND_REPLAY
					replay = append(replay, cloned)
				}
			}
		}
	} else {
		replay = nil
	}
	snapshot := s.snapshotEventLocked(replayTruncated)
	snapshot.ReplayTruncated = replayTruncated
	s.nextSubscriberID++
	sub := subscriber{id: s.nextSubscriberID, ch: make(chan *runtimev1.AccountSessionEvent, 16)}
	s.subscribers[sub.id] = sub
	return replay, snapshot, sub
}

func (s *Service) removeSubscriber(id uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.subscribers, id)
}

func (s *Service) appendEventLocked(eventType runtimev1.AccountEventType, reason runtimev1.AccountReasonCode, bindingID string) *runtimev1.AccountSessionEvent {
	return s.appendStoredEventLocked(s.newEventLocked(eventType, reason, bindingID))
}

func (s *Service) appendStoredEventLocked(event *runtimev1.AccountSessionEvent) *runtimev1.AccountSessionEvent {
	s.events = append(s.events, event)
	if len(s.events) > s.eventRetention {
		s.events = append([]*runtimev1.AccountSessionEvent(nil), s.events[len(s.events)-s.eventRetention:]...)
	}
	// Delivery happens under the same lock that allocates the sequence and
	// appends the replay record. Publishing after unlocking allows concurrent
	// mutations to deliver n+1 before n, while resolver-only events can be
	// retained without ever reaching a live subscriber. The bounded channel
	// send is non-blocking; a subscriber that cannot keep up is closed so the
	// caller must resynchronize instead of observing a silent gap.
	for id, sub := range s.subscribers {
		select {
		case sub.ch <- cloneEvent(event):
		default:
			close(sub.ch)
			delete(s.subscribers, id)
		}
	}
	return cloneEvent(event)
}

func (s *Service) newEventLocked(eventType runtimev1.AccountEventType, reason runtimev1.AccountReasonCode, bindingID string) *runtimev1.AccountSessionEvent {
	s.nextSequence++
	if eventType == runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS {
		s.stateReason = reason
		s.rebuildRefreshTimerLocked()
	}
	return &runtimev1.AccountSessionEvent{
		EventId:      ulid.Make().String(),
		Sequence:     s.nextSequence,
		EmittedAt:    timestamppb.New(s.now().UTC()),
		EventType:    eventType,
		BindingId:    bindingID,
		DeliveryKind: runtimev1.AccountSessionDeliveryKind_ACCOUNT_SESSION_DELIVERY_KIND_LIVE,
		Snapshot:     s.snapshotLocked(s.nextSequence, reason),
	}
}

func (s *Service) snapshotLocked(sequence uint64, reason runtimev1.AccountReasonCode) *runtimev1.AccountSessionSnapshot {
	return &runtimev1.AccountSessionSnapshot{
		Sequence:          sequence,
		State:             s.state,
		ReasonCode:        commonReason(reason),
		AccountReasonCode: reason,
		AccountProjection: cloneProjection(s.projection),
	}
}

func (s *Service) currentSnapshotLocked() *runtimev1.AccountSessionSnapshot {
	return s.snapshotLocked(s.nextSequence, s.stateReason)
}

func (s *Service) snapshotEventLocked(replayTruncated bool) *runtimev1.AccountSessionEvent {
	return &runtimev1.AccountSessionEvent{
		EventId:         ulid.Make().String(),
		Sequence:        s.nextSequence,
		EmittedAt:       timestamppb.New(s.now().UTC()),
		EventType:       runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS,
		ReplayTruncated: replayTruncated,
		DeliveryKind:    runtimev1.AccountSessionDeliveryKind_ACCOUNT_SESSION_DELIVERY_KIND_SNAPSHOT,
		Snapshot:        s.currentSnapshotLocked(),
	}
}

func (s *Service) revokeWorkspaceBindingsLocked(reason runtimev1.AccountReasonCode) {
	for id, record := range s.workspaceBindings {
		if record.relation.GetState() != runtimev1.WorkspaceBindingState_WORKSPACE_BINDING_STATE_ACTIVE &&
			record.relation.GetState() != runtimev1.WorkspaceBindingState_WORKSPACE_BINDING_STATE_ISSUED {
			continue
		}
		record.relation.State = runtimev1.WorkspaceBindingState_WORKSPACE_BINDING_STATE_REVOKED
		record.relation.ReasonCode = workspaceBindingReasonForAccountRevocation(reason)
		s.workspaceBindings[id] = record
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_REVOKED, reason, id)
	}
}

func workspaceBindingReasonForAccountRevocation(reason runtimev1.AccountReasonCode) runtimev1.ReasonCode {
	switch reason {
	case runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED:
		return runtimev1.ReasonCode_WORKSPACE_BINDING_REVOKED
	default:
		return runtimev1.ReasonCode_WORKSPACE_BINDING_ACCOUNT_UNAVAILABLE
	}
}

func (s *Service) revokeWorkspaceBindingsWithoutActiveMembershipLocked() {
	for id, record := range s.workspaceBindings {
		if record.relation.GetState() != runtimev1.WorkspaceBindingState_WORKSPACE_BINDING_STATE_ACTIVE &&
			record.relation.GetState() != runtimev1.WorkspaceBindingState_WORKSPACE_BINDING_STATE_ISSUED {
			continue
		}
		if s.hasActiveWorkspaceMembershipLocked(record.relation.GetWorkspaceId(), record.relation.GetRealmEnvironmentId()) {
			continue
		}
		record.relation.State = runtimev1.WorkspaceBindingState_WORKSPACE_BINDING_STATE_REVOKED
		record.relation.ReasonCode = runtimev1.ReasonCode_WORKSPACE_BINDING_ACCOUNT_UNAVAILABLE
		s.workspaceBindings[id] = record
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_REVOKED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, id)
	}
}

func (s *Service) markCustodyUnavailable() {
	s.mu.Lock()
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE
	s.revokeWorkspaceBindingsLocked(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE)
	s.clearAuthenticatedRuntimeIdentityLocked()
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_CUSTODY_UNAVAILABLE, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE, "")
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE, "")
	s.mu.Unlock()
}

func (s *Service) transitionToReauthRequired(reason runtimev1.AccountReasonCode) {
	s.mu.Lock()
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED
	s.revokeWorkspaceBindingsLocked(reason)
	s.clearAuthenticatedRuntimeIdentityLocked()
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_FAILED, reason, "")
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, reason, "")
	s.mu.Unlock()
}

func (s *Service) currentState() runtimev1.AccountSessionState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.state
}

func (s *Service) rejectedAccountSessionEvent(reason runtimev1.AccountReasonCode) *runtimev1.AccountSessionEvent {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return &runtimev1.AccountSessionEvent{
		EventId:      ulid.Make().String(),
		Sequence:     s.nextSequence,
		EmittedAt:    timestamppb.New(s.now().UTC()),
		EventType:    runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS,
		DeliveryKind: runtimev1.AccountSessionDeliveryKind_ACCOUNT_SESSION_DELIVERY_KIND_SNAPSHOT,
		Snapshot: &runtimev1.AccountSessionSnapshot{
			Sequence:          s.nextSequence,
			State:             s.state,
			ReasonCode:        commonReason(reason),
			AccountReasonCode: reason,
		},
	}
}
