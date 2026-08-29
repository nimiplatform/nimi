package runtimeagent

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

type eventStreamRuntime struct {
	svc *Service
}

func (s *Service) eventStreamRuntime() eventStreamRuntime {
	return eventStreamRuntime{svc: s}
}

func (r eventStreamRuntime) appendEventsLocked(events ...*runtimev1.AgentEvent) []*runtimev1.AgentEvent {
	committed := make([]*runtimev1.AgentEvent, 0, len(events))
	for _, event := range events {
		if event == nil {
			continue
		}
		cloned := cloneAgentEvent(event)
		r.svc.sequence++
		cloned.Sequence = r.svc.sequence
		r.svc.events = append(r.svc.events, cloned)
		if len(r.svc.events) > maxEventLogSize {
			r.svc.events = append([]*runtimev1.AgentEvent(nil), r.svc.events[len(r.svc.events)-maxEventLogSize:]...)
		}
		committed = append(committed, cloned)
	}
	return committed
}

func (r eventStreamRuntime) matchingSubscribersLocked(events []*runtimev1.AgentEvent) [][]*subscriber {
	targetsByEvent := make([][]*subscriber, 0, len(events))
	for _, event := range events {
		targets := make([]*subscriber, 0, len(r.svc.subscribers))
		for _, sub := range r.svc.subscribers {
			if subscriberMatchesEvent(sub, event) {
				targets = append(targets, sub)
			}
		}
		targetsByEvent = append(targetsByEvent, targets)
	}
	return targetsByEvent
}

func (r eventStreamRuntime) broadcast(events []*runtimev1.AgentEvent, targetsByEvent [][]*subscriber) {
	for i, event := range events {
		if i >= len(targetsByEvent) {
			return
		}
		for _, sub := range targetsByEvent[i] {
			sendSubscriberEvent(sub, event)
		}
	}
}

func (r eventStreamRuntime) removeSubscriber(id uint64) {
	r.svc.mu.Lock()
	sub := r.svc.subscribers[id]
	delete(r.svc.subscribers, id)
	r.svc.mu.Unlock()
	if sub != nil {
		sub.mu.Lock()
		if sub.closed {
			sub.mu.Unlock()
			return
		}
		sub.closed = true
		close(sub.ch)
		sub.mu.Unlock()
	}
}

func sendSubscriberEvent(sub *subscriber, event *runtimev1.AgentEvent) {
	if sub == nil || event == nil {
		return
	}
	sub.mu.Lock()
	defer sub.mu.Unlock()
	if sub.closed {
		return
	}
	cloned := cloneAgentEvent(event)
	select {
	case sub.ch <- cloned:
		return
	default:
	}
	select {
	case <-sub.ch:
	default:
	}
	select {
	case sub.ch <- cloned:
	default:
	}
}
