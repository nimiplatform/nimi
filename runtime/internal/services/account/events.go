package account

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) subscribe(req *runtimev1.SubscribeAccountSessionEventsRequest) (*runtimev1.AccountSessionEvent, []*runtimev1.AccountSessionEvent, subscriber) {
	s.mu.Lock()
	defer s.mu.Unlock()
	after := req.GetAfterSequence()
	replayTruncated := false
	var replay []*runtimev1.AccountSessionEvent
	if after > 0 && len(s.events) > 0 && s.events[0].GetSequence() > after+1 {
		replayTruncated = true
	} else {
		for _, event := range s.events {
			if event.GetSequence() > after {
				replay = append(replay, cloneEvent(event))
			}
		}
	}
	snapshot := s.newEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "", nil)
	snapshot.ReplayTruncated = replayTruncated
	s.nextSubscriberID++
	sub := subscriber{id: s.nextSubscriberID, ch: make(chan *runtimev1.AccountSessionEvent, 16)}
	s.subscribers[sub.id] = sub
	return snapshot, replay, sub
}

func (s *Service) removeSubscriber(id uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.subscribers, id)
}

func (s *Service) appendEventLocked(eventType runtimev1.AccountEventType, reason runtimev1.AccountReasonCode, bindingID string) *runtimev1.AccountSessionEvent {
	return s.appendStoredEventLocked(s.newEventLocked(eventType, reason, bindingID, nil))
}

func (s *Service) appendBindingEventLocked(eventType runtimev1.AccountEventType, relation *runtimev1.ScopedAppBindingRelation) *runtimev1.AccountSessionEvent {
	return s.appendStoredEventLocked(s.newEventLocked(eventType, relation.GetReasonCode(), relation.GetBindingId(), relation))
}

func (s *Service) appendStoredEventLocked(event *runtimev1.AccountSessionEvent) *runtimev1.AccountSessionEvent {
	s.events = append(s.events, event)
	if len(s.events) > s.eventRetention {
		s.events = append([]*runtimev1.AccountSessionEvent(nil), s.events[len(s.events)-s.eventRetention:]...)
	}
	return cloneEvent(event)
}

func (s *Service) newEventLocked(eventType runtimev1.AccountEventType, reason runtimev1.AccountReasonCode, bindingID string, relation *runtimev1.ScopedAppBindingRelation) *runtimev1.AccountSessionEvent {
	s.nextSequence++
	return &runtimev1.AccountSessionEvent{
		EventId:           ulid.Make().String(),
		Sequence:          s.nextSequence,
		EmittedAt:         timestamppb.New(s.now().UTC()),
		EventType:         eventType,
		State:             s.state,
		ReasonCode:        commonReason(reason),
		AccountReasonCode: reason,
		AccountProjection: cloneProjection(s.projection),
		BindingId:         bindingID,
		BindingRelation:   cloneRelation(relation),
		ReplayTruncated:   false,
	}
}

func (s *Service) publish(event *runtimev1.AccountSessionEvent) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, sub := range s.subscribers {
		select {
		case sub.ch <- cloneEvent(event):
		default:
		}
	}
}

func (s *Service) revokeBindingsLocked(reason runtimev1.AccountReasonCode) []*runtimev1.AccountSessionEvent {
	var events []*runtimev1.AccountSessionEvent
	for id, record := range s.bindings {
		if record.relation.GetState() != runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_ACTIVE &&
			record.relation.GetState() != runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_ISSUED {
			continue
		}
		record.relation.State = runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_REVOKED
		record.relation.ReasonCode = reason
		s.bindings[id] = record
		events = append(events, s.appendBindingEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_REVOKED, record.relation))
	}
	return events
}

func (s *Service) markCustodyUnavailable() {
	s.mu.Lock()
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE
	revoked := s.revokeBindingsLocked(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE)
	s.material = AccountMaterial{}
	s.projection = nil
	custodyEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_CUSTODY_UNAVAILABLE, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE, "")
	statusEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE, "")
	s.mu.Unlock()
	for _, event := range revoked {
		s.publish(event)
	}
	s.publish(custodyEvent)
	s.publish(statusEvent)
}

func (s *Service) transitionToReauthRequired(reason runtimev1.AccountReasonCode) {
	s.mu.Lock()
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED
	revoked := s.revokeBindingsLocked(reason)
	s.material = AccountMaterial{}
	s.projection = nil
	refreshEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_FAILED, reason, "")
	statusEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, reason, "")
	s.mu.Unlock()
	for _, event := range revoked {
		s.publish(event)
	}
	s.publish(refreshEvent)
	s.publish(statusEvent)
}

func (s *Service) currentState() runtimev1.AccountSessionState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.state
}

func (s *Service) rejectedAccountSessionEvent(reason runtimev1.AccountReasonCode) *runtimev1.AccountSessionEvent {
	return &runtimev1.AccountSessionEvent{
		EventId:           ulid.Make().String(),
		EmittedAt:         timestamppb.New(s.now().UTC()),
		EventType:         runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS,
		State:             s.currentState(),
		ReasonCode:        commonReason(reason),
		AccountReasonCode: reason,
	}
}
