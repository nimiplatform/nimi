package runtimeagent

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
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
	agentID := strings.TrimSpace(req.GetAgentId())
	if agentID == "" {
		return status.Error(codes.InvalidArgument, "agent_id is required")
	}
	requestContext := req.GetContext()
	scopedBinding := requestContext.GetScopedBinding()
	if scopedBinding == nil && strings.TrimSpace(requestContext.GetAppId()) != "" && strings.TrimSpace(requestContext.GetSubjectUserId()) == "" {
		return runtimeAgentBindingError(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND)
	}
	if scopedBinding != nil {
		if err := r.svc.validateScopedBindingAttachment(scopedBinding, requestContext.GetAppId(), agentID, runtimeAgentEventReadScope); err != nil {
			return err
		}
	}
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
		agentID:       agentID,
		eventFilters:  filterMap,
		scopedBinding: cloneScopedBindingAttachment(scopedBinding),
		ch:            make(chan *runtimev1.AgentEvent, subscriberBuffer),
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

	for _, event := range backlog {
		if err := r.validateSubscriberBinding(sub, requestContext.GetAppId()); err != nil {
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
			if err := r.validateSubscriberBinding(sub, requestContext.GetAppId()); err != nil {
				return err
			}
			if err := stream.Send(cloneAgentEvent(event)); err != nil {
				return err
			}
		}
	}
}

func (r eventStreamRuntime) validateSubscriberBinding(sub *subscriber, fallbackRuntimeAppID string) error {
	if sub == nil || sub.scopedBinding == nil {
		return nil
	}
	return r.svc.validateScopedBindingAttachment(sub.scopedBinding, fallbackRuntimeAppID, sub.agentID, runtimeAgentEventReadScope)
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
			cloned := cloneAgentEvent(event)
			select {
			case sub.ch <- cloned:
				continue
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
	}
}

func (r eventStreamRuntime) removeSubscriber(id uint64) {
	r.svc.mu.Lock()
	sub := r.svc.subscribers[id]
	delete(r.svc.subscribers, id)
	r.svc.mu.Unlock()
	if sub != nil {
		close(sub.ch)
	}
}
