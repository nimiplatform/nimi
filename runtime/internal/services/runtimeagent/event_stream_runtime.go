package runtimeagent

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type eventStreamRuntime struct {
	svc *Service
}

func (s *Service) eventStreamRuntime() eventStreamRuntime {
	return eventStreamRuntime{svc: s}
}

func (r eventStreamRuntime) subscribe(req *runtimev1.SubscribeAgentEventsRequest, stream runtimev1.RuntimeAgentService_SubscribeAgentEventsServer) error {
	if req == nil {
		return status.Error(codes.InvalidArgument, "subscribe agent events request is required")
	}
	identity, _, err := r.svc.agentEntryForIdentityContext(req.GetContext())
	if err != nil {
		return err
	}
	_, protectedAccount, principalErr := protectedAccountProductPrincipal(stream.Context(), "runtime.agent.read")
	if principalErr != nil {
		return principalErr
	}
	if err := r.svc.authorizeCurrentAccountLocalAgent(stream.Context(), req.GetContext(), identity, "runtime.agent.read"); err != nil {
		return err
	}
	localAgentRef := identity.LocalAgentRef
	filterMap := make(map[runtimev1.AgentEventType]struct{}, len(req.GetEventFilters()))
	for _, filter := range req.GetEventFilters() {
		if filter != runtimev1.AgentEventType_AGENT_EVENT_TYPE_UNSPECIFIED {
			filterMap[filter] = struct{}{}
		}
	}
	cursor, err := decodeCursor(req.GetCursor())
	if err != nil {
		return err
	}
	sub := &subscriber{
		agentID:               localAgentRef,
		eventFilters:          filterMap,
		bundledAvatarIdentity: nil,
		ch:                    make(chan *runtimev1.AgentEvent, subscriberBuffer),
	}
	if protectedAccount {
		identityCopy := identity
		sub.bundledAvatarIdentity = &identityCopy
	}
	r.svc.mu.Lock()
	r.svc.nextSubscriberID++
	sub.id = r.svc.nextSubscriberID
	r.svc.subscribers[sub.id] = sub
	backlog := make([]*runtimev1.AgentEvent, 0, len(r.svc.events))
	for _, event := range r.svc.events {
		if event.GetSequence() <= cursor {
			continue
		}
		if subscriberMatchesEvent(sub, event) {
			backlog = append(backlog, cloneAgentEvent(event))
		}
	}
	r.svc.mu.Unlock()
	defer r.removeSubscriber(sub.id)

	if err := stream.SendHeader(metadata.MD{}); err != nil {
		return err
	}
	for _, event := range backlog {
		if err := r.validateSubscriberAccess(stream.Context(), sub); err != nil {
			return err
		}
		if err := stream.Send(event); err != nil {
			return err
		}
	}
	for {
		select {
		case <-stream.Context().Done():
			return stream.Context().Err()
		case event, ok := <-sub.ch:
			if !ok {
				return nil
			}
			if err := r.validateSubscriberAccess(stream.Context(), sub); err != nil {
				return err
			}
			if err := stream.Send(cloneAgentEvent(event)); err != nil {
				return err
			}
		}
	}
}

func (r eventStreamRuntime) validateSubscriberAccess(ctx context.Context, sub *subscriber) error {
	if sub == nil {
		return nil
	}
	if sub.bundledAvatarIdentity != nil {
		return r.svc.revalidateProtectedAccountIdentity(ctx, *sub.bundledAvatarIdentity)
	}
	return nil
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
