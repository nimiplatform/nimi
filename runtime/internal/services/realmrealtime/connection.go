package realmrealtime

import (
	"context"
	"errors"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/realtimecore"
)

func (s *Service) runConnection(remote *realmConnection) {
	for {
		connectionFailed := false
		select {
		case <-remote.ctx.Done():
			return
		case event, ok := <-remote.driver.Events():
			if !ok {
				connectionFailed = true
			} else if err := s.handleRemoteEvent(remote, event); err != nil {
				s.logger.Warn("Realm realtime event rejected", "event", event.name, "error", err)
				connectionFailed = true
			}
		case <-remote.driver.Errors():
			connectionFailed = true
		}
		if !connectionFailed {
			continue
		}
		remote.driver.Close()
		if remote.ctx.Err() != nil {
			return
		}
		if !s.reconnect(remote) {
			s.failRemote(remote, realtimecore.TerminalOwnerFailed)
			return
		}
	}
}

func (s *Service) reconnect(remote *realmConnection) bool {
	s.transitionRemoteSubscriptions(remote, realtimecore.LifecycleReconnecting, runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_RECONNECTING, "reconnecting")
	backoff := 250 * time.Millisecond
	for attempt := 0; attempt < 6; attempt++ {
		if attempt > 0 {
			timer := time.NewTimer(backoff)
			select {
			case <-remote.ctx.Done():
				timer.Stop()
				return false
			case <-timer.C:
			}
			if backoff < 4*time.Second {
				backoff *= 2
			}
		}
		lease, err := s.accounts.BindRealmRealtimeAccount(remote.ctx)
		if err != nil || lease.AccountID != remote.lease.AccountID || lease.Generation != remote.lease.Generation {
			return false
		}
		driver, err := dialSocketIO(remote.ctx, lease.RealmRealtimeURL, lease.AccessToken)
		if errors.Is(err, errSocketAuth) {
			lease, err = s.accounts.RefreshRealmRealtimeAccount(remote.ctx, remote.lease.Generation, remote.lease.AccessToken)
			if err == nil {
				driver, err = dialSocketIO(remote.ctx, lease.RealmRealtimeURL, lease.AccessToken)
			}
		}
		if err != nil {
			continue
		}
		remote.driver = driver
		remote.lease = lease
		if err := s.restoreRemoteSubscriptions(remote); err != nil {
			driver.Close()
			continue
		}
		return true
	}
	return false
}

func (s *Service) restoreRemoteSubscriptions(remote *realmConnection) error {
	for _, binding := range s.remoteSubscriptions(remote) {
		if binding.subscription.kind == realmSubscriptionPresence {
			_ = binding.subscription.stream.Transition(binding.channel.generation, realtimecore.LifecycleReady)
			if err := s.publishControl(binding.channel, binding.subscription, runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_READY, ""); err != nil {
				s.terminalizeSubscription(binding.channel, binding.subscription, terminalReasonForPublishError(err))
				continue
			}
			continue
		}
		remote.openMu.Lock()
		binding.subscription.mu.Lock()
		binding.subscription.remoteOpening = true
		event := "chat:session.open"
		payload := map[string]any{"chatId": binding.subscription.chatID}
		if binding.subscription.kind == realmSubscriptionInbox {
			event, payload = "chat:inbox.open", map[string]any{}
		} else if binding.subscription.resumeToken != "" {
			payload["resumeToken"] = binding.subscription.resumeToken
		}
		binding.subscription.mu.Unlock()
		operationCtx, cancel := context.WithTimeout(remote.ctx, realmOperationTimeout)
		raw, err := remote.driver.EmitAck(operationCtx, event, payload)
		cancel()
		if err != nil {
			binding.subscription.mu.Lock()
			binding.subscription.remoteOpening = false
			binding.subscription.mu.Unlock()
			remote.openMu.Unlock()
			return err
		}
		result, err := parseOperationResult(raw)
		if err != nil || result.Status != "opened" || strings.TrimSpace(result.SessionID) == "" {
			binding.subscription.mu.Lock()
			binding.subscription.remoteOpening = false
			binding.subscription.mu.Unlock()
			remote.openMu.Unlock()
			s.terminalizeSubscription(binding.channel, binding.subscription, realtimecore.TerminalOwnerFailed)
			continue
		}
		binding.subscription.mu.Lock()
		binding.subscription.remoteSessionID = strings.TrimSpace(result.SessionID)
		binding.subscription.remoteOpening = false
		binding.subscription.mu.Unlock()
		remote.openMu.Unlock()
		if binding.subscription.kind == realmSubscriptionInbox {
			_ = binding.subscription.stream.Transition(binding.channel.generation, realtimecore.LifecycleReady)
			if err := s.publishControl(binding.channel, binding.subscription, runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_READY, "refresh-chat-list"); err != nil {
				s.terminalizeSubscription(binding.channel, binding.subscription, terminalReasonForPublishError(err))
				continue
			}
		}
	}
	return nil
}

func terminalReasonForPublishError(err error) realtimecore.TerminalReason {
	if errors.Is(err, realtimecore.ErrSlowConsumer) {
		return realtimecore.TerminalSlowConsumer
	}
	if errors.Is(err, realtimecore.ErrStaleGeneration) {
		return realtimecore.TerminalStaleGeneration
	}
	return realtimecore.TerminalOwnerFailed
}

type subscriptionBinding struct {
	channel      *realmChannel
	subscription *realmSubscription
}

func (s *Service) remoteSubscriptions(remote *realmConnection) []subscriptionBinding {
	s.mu.Lock()
	channels := make([]*realmChannel, 0, len(s.channels))
	for _, channel := range s.channels {
		if channel.accountID == remote.lease.AccountID && channel.accountGeneration == remote.lease.Generation {
			channels = append(channels, channel)
		}
	}
	s.mu.Unlock()
	bindings := make([]subscriptionBinding, 0)
	for _, channel := range channels {
		channel.mu.Lock()
		for _, subscription := range channel.subscriptions {
			bindings = append(bindings, subscriptionBinding{channel: channel, subscription: subscription})
		}
		channel.mu.Unlock()
	}
	return bindings
}

func (s *Service) transitionRemoteSubscriptions(remote *realmConnection, coreLifecycle realtimecore.Lifecycle, lifecycle runtimev1.RealtimeLifecycle, actionHint string) {
	for _, binding := range s.remoteSubscriptions(remote) {
		_ = binding.subscription.stream.Transition(binding.channel.generation, coreLifecycle)
		if err := s.publishControl(binding.channel, binding.subscription, lifecycle, actionHint); err != nil {
			reason := realtimecore.TerminalOwnerFailed
			if errors.Is(err, realtimecore.ErrSlowConsumer) {
				reason = realtimecore.TerminalSlowConsumer
			}
			s.terminalizeSubscription(binding.channel, binding.subscription, reason)
		}
	}
}

func (s *Service) failRemote(remote *realmConnection, reason realtimecore.TerminalReason) {
	if remote == nil {
		return
	}
	s.mu.Lock()
	if s.remote == remote {
		s.remote = nil
	}
	s.mu.Unlock()
	remote.cancel()
	remote.driver.Close()
	for _, binding := range s.remoteSubscriptions(remote) {
		s.terminalizeSubscription(binding.channel, binding.subscription, reason)
	}
}

func (s *Service) failAccountGeneration(remote *realmConnection) {
	if remote == nil {
		return
	}
	remote.cancel()
	remote.driver.Close()
	s.mu.Lock()
	if s.remote == remote {
		s.remote = nil
	}
	s.mu.Unlock()
	for _, binding := range s.remoteSubscriptions(remote) {
		s.terminalizeSubscription(binding.channel, binding.subscription, realtimecore.TerminalStaleGeneration)
	}
}

func (s *Service) handleRemoteEvent(remote *realmConnection, event socketEvent) error {
	switch event.name {
	case "chat:session.ready":
		var ready wireChatReady
		if err := decodeStrictJSON(event.payload, &ready); err != nil {
			return errSocketProtocol
		}
		binding := s.findChatSubscription(remote, ready.SessionID, ready.ChatID)
		if binding == nil {
			return nil
		}
		binding.subscription.mu.Lock()
		binding.subscription.remoteSessionID = ready.SessionID
		binding.subscription.remoteOpening = false
		binding.subscription.resumeToken = ready.ResumeToken
		if ready.LastAckSeq > binding.subscription.lastAckCursor {
			binding.subscription.lastAckCursor = ready.LastAckSeq
		}
		if ready.LastAckSeq > binding.subscription.lastCursor {
			binding.subscription.lastCursor = ready.LastAckSeq
		}
		binding.subscription.mu.Unlock()
		_ = binding.subscription.stream.Transition(binding.channel.generation, realtimecore.LifecycleReady)
		return s.publishControl(binding.channel, binding.subscription, runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_READY, "")
	case "chat:event":
		var raw wireChatEvent
		if err := decodeStrictJSON(event.payload, &raw); err != nil {
			return errSocketProtocol
		}
		binding := s.findChatSubscription(remote, raw.SubscriptionID, raw.ChatID)
		if binding == nil {
			return nil
		}
		converted, err := convertWireChatEvent(raw)
		if err != nil {
			return err
		}
		binding.subscription.mu.Lock()
		lastCursor := binding.subscription.lastCursor
		binding.subscription.mu.Unlock()
		if converted.GetCursor() <= lastCursor {
			return nil
		}
		if converted.GetCursor() != lastCursor+1 {
			go s.recoverChatSubscription(remote, *binding, "runtime-gap-detected")
			return nil
		}
		projected := subscriptionEvent(binding.channel, binding.subscription)
		projected.Event = &runtimev1.SubscribeRealmRealtimeEventsResponse_Chat{Chat: converted}
		if _, err := binding.subscription.stream.Publish(binding.channel.generation, projected); err != nil {
			if errors.Is(err, realtimecore.ErrSlowConsumer) {
				s.terminalizeSubscription(binding.channel, binding.subscription, realtimecore.TerminalSlowConsumer)
				return nil
			}
			return err
		}
		binding.subscription.mu.Lock()
		binding.subscription.lastCursor = converted.GetCursor()
		binding.subscription.mu.Unlock()
		return nil
	case "chat:typing":
		var raw wireChatTyping
		if err := decodeStrictJSON(event.payload, &raw); err != nil {
			return errSocketProtocol
		}
		binding := s.findChatSubscription(remote, raw.SubscriptionID, raw.ChatID)
		if binding == nil {
			return nil
		}
		expiresAt, err := parseWireTime(raw.ExpiresAt)
		if err != nil || strings.TrimSpace(raw.UserID) == "" {
			return errSocketProtocol
		}
		projected := subscriptionEvent(binding.channel, binding.subscription)
		projected.Event = &runtimev1.SubscribeRealmRealtimeEventsResponse_Typing{Typing: &runtimev1.RealmChatTypingEvent{
			ChatId: raw.ChatID, UserId: raw.UserID, IsTyping: raw.IsTyping, ExpiresAt: expiresAt,
		}}
		_, err = binding.subscription.stream.Publish(binding.channel.generation, projected)
		if errors.Is(err, realtimecore.ErrSlowConsumer) {
			s.terminalizeSubscription(binding.channel, binding.subscription, realtimecore.TerminalSlowConsumer)
			return nil
		}
		return err
	case "chat:session.sync_required":
		var syncRequired wireChatSyncRequired
		if err := decodeStrictJSON(event.payload, &syncRequired); err != nil {
			return errSocketProtocol
		}
		binding := s.findChatSubscription(remote, syncRequired.SessionID, syncRequired.ChatID)
		if binding != nil {
			go s.recoverChatSubscription(remote, *binding, syncRequired.ReasonCode)
		}
		return nil
	case "status:update":
		var raw wirePresence
		if err := decodeStrictJSON(event.payload, &raw); err != nil || raw.PresenceRevision == 0 || strings.TrimSpace(raw.UserID) == "" {
			return errSocketProtocol
		}
		occurredAt, err := parseWireTime(raw.OccurredAt)
		if err != nil {
			return err
		}
		remote.presenceMu.Lock()
		if raw.PresenceRevision <= remote.presenceRevision[raw.UserID] {
			remote.presenceMu.Unlock()
			return nil
		}
		remote.presenceRevision[raw.UserID] = raw.PresenceRevision
		remote.presenceMu.Unlock()
		for _, binding := range s.remoteSubscriptions(remote) {
			if binding.subscription.kind != realmSubscriptionPresence {
				continue
			}
			projected := subscriptionEvent(binding.channel, binding.subscription)
			projected.Event = &runtimev1.SubscribeRealmRealtimeEventsResponse_Presence{Presence: &runtimev1.RealmPresenceEvent{
				UserId: raw.UserID, IsOnline: raw.IsOnline, PresenceRevision: raw.PresenceRevision, OccurredAt: occurredAt,
			}}
			if _, err := binding.subscription.stream.Publish(binding.channel.generation, projected); err != nil {
				if errors.Is(err, realtimecore.ErrSlowConsumer) {
					s.terminalizeSubscription(binding.channel, binding.subscription, realtimecore.TerminalSlowConsumer)
					continue
				}
				return err
			}
		}
		return nil
	case "chat:inbox":
		var raw wireChatInbox
		if err := decodeStrictJSON(event.payload, &raw); err != nil ||
			strings.TrimSpace(raw.SubscriptionID) == "" || strings.TrimSpace(raw.ChatID) == "" || raw.HighWatermarkSeq == 0 {
			return errSocketProtocol
		}
		occurredAt, err := parseWireTime(raw.OccurredAt)
		if err != nil {
			return err
		}
		for _, binding := range s.remoteSubscriptions(remote) {
			if binding.subscription.kind != realmSubscriptionInbox {
				continue
			}
			binding.subscription.mu.Lock()
			matches := binding.subscription.remoteSessionID == raw.SubscriptionID
			binding.subscription.mu.Unlock()
			if !matches {
				continue
			}
			projected := subscriptionEvent(binding.channel, binding.subscription)
			projected.Event = &runtimev1.SubscribeRealmRealtimeEventsResponse_Inbox{Inbox: &runtimev1.RealmChatInboxEvent{
				ChatId: raw.ChatID, HighWatermarkSeq: raw.HighWatermarkSeq, OccurredAt: occurredAt,
			}}
			if _, err := binding.subscription.stream.Publish(binding.channel.generation, projected); err != nil {
				if errors.Is(err, realtimecore.ErrSlowConsumer) {
					s.terminalizeSubscription(binding.channel, binding.subscription, realtimecore.TerminalSlowConsumer)
					return nil
				}
				return err
			}
		}
		return nil
	default:
		return errSocketProtocol
	}
}

func (s *Service) findChatSubscription(remote *realmConnection, remoteSessionID string, chatID string) *subscriptionBinding {
	remoteSessionID = strings.TrimSpace(remoteSessionID)
	chatID = strings.TrimSpace(chatID)
	var fallback *subscriptionBinding
	for _, binding := range s.remoteSubscriptions(remote) {
		if binding.subscription.kind != realmSubscriptionChat || binding.subscription.chatID != chatID {
			continue
		}
		binding.subscription.mu.Lock()
		currentRemoteSessionID := binding.subscription.remoteSessionID
		remoteOpening := binding.subscription.remoteOpening
		binding.subscription.mu.Unlock()
		if currentRemoteSessionID == remoteSessionID && remoteSessionID != "" {
			copy := binding
			return &copy
		}
		if currentRemoteSessionID == "" && remoteOpening {
			if fallback != nil {
				return nil
			}
			copy := binding
			fallback = &copy
		}
	}
	return fallback
}

func (s *Service) recoverChatSubscription(remote *realmConnection, binding subscriptionBinding, reason string) {
	if binding.subscription.kind != realmSubscriptionChat {
		return
	}
	binding.subscription.mu.Lock()
	if binding.subscription.recovering {
		binding.subscription.mu.Unlock()
		return
	}
	binding.subscription.recovering = true
	binding.subscription.mu.Unlock()
	defer func() {
		binding.subscription.mu.Lock()
		binding.subscription.recovering = false
		binding.subscription.mu.Unlock()
	}()
	_ = binding.subscription.stream.Transition(binding.channel.generation, realtimecore.LifecycleDegraded)
	if err := s.publishControl(binding.channel, binding.subscription, runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_DEGRADED, "authoritative-snapshot"); err != nil {
		reason := realtimecore.TerminalOwnerFailed
		if errors.Is(err, realtimecore.ErrSlowConsumer) {
			reason = realtimecore.TerminalSlowConsumer
		}
		s.terminalizeSubscription(binding.channel, binding.subscription, reason)
		return
	}
	operationCtx, cancel := context.WithTimeout(remote.ctx, 20*time.Second)
	defer cancel()
	snapshot, err := s.fetchChatSnapshot(operationCtx, remote.lease, binding.subscription.chatID)
	if err != nil {
		s.logger.Warn("Realm Chat snapshot recovery failed", "reason", reason, "error", err)
		s.terminalizeSubscription(binding.channel, binding.subscription, realtimecore.TerminalOwnerFailed)
		return
	}
	projected := subscriptionEvent(binding.channel, binding.subscription)
	projected.Event = &runtimev1.SubscribeRealmRealtimeEventsResponse_Snapshot{Snapshot: snapshot}
	if _, err := binding.subscription.stream.Publish(binding.channel.generation, projected); err != nil {
		if errors.Is(err, realtimecore.ErrSlowConsumer) {
			s.terminalizeSubscription(binding.channel, binding.subscription, realtimecore.TerminalSlowConsumer)
		} else {
			s.terminalizeSubscription(binding.channel, binding.subscription, realtimecore.TerminalOwnerFailed)
		}
		return
	}
	binding.subscription.mu.Lock()
	binding.subscription.lastCursor = snapshot.GetThroughCursor()
	binding.subscription.lastAckCursor = snapshot.GetThroughCursor()
	remoteSessionID := binding.subscription.remoteSessionID
	binding.subscription.mu.Unlock()
	raw, err := remote.driver.EmitAck(operationCtx, "chat:session.sync_applied", map[string]any{
		"chatId": binding.subscription.chatID, "sessionId": remoteSessionID, "throughSeq": snapshot.GetThroughCursor(),
	})
	if err != nil {
		s.terminalizeSubscription(binding.channel, binding.subscription, realtimecore.TerminalOwnerFailed)
		return
	}
	result, err := parseOperationResult(raw)
	if err != nil || result.Status != "ok" {
		s.terminalizeSubscription(binding.channel, binding.subscription, realtimecore.TerminalOwnerFailed)
		return
	}
	_ = binding.subscription.stream.Transition(binding.channel.generation, realtimecore.LifecycleReady)
	if err := s.publishControl(binding.channel, binding.subscription, runtimev1.RealtimeLifecycle_REALTIME_LIFECYCLE_READY, ""); err != nil {
		reason := realtimecore.TerminalOwnerFailed
		if errors.Is(err, realtimecore.ErrSlowConsumer) {
			reason = realtimecore.TerminalSlowConsumer
		}
		s.terminalizeSubscription(binding.channel, binding.subscription, reason)
	}
}
