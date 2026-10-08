package integration

import (
	"context"
	"encoding/json"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

// @nimi-authority: rule.nimi.runtime.integration.native-messaging
func (s *Service) readNativeUpdates(ctx context.Context, t target, secret, input string) (string, error) {
	var params struct {
		Cursor        string   `json:"cursor"`
		WaitMS        int      `json:"waitMs"`
		Conversations []string `json:"conversations"`
	}
	if json.Unmarshal([]byte(input), &params) != nil || params.WaitMS < 0 || params.WaitMS > 25000 || len(params.Conversations) > 64 {
		return "", adapterError("INTEGRATION_INPUT_INVALID")
	}
	seen := map[string]bool{}
	for _, id := range params.Conversations {
		if id == "" || len(id) > 512 || seen[id] {
			return "", adapterError("INTEGRATION_INPUT_INVALID")
		}
		seen[id] = true
	}
	d, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	call, bound := ctx.Value(invocationContextKey{}).(*invocation)
	if !ok || !bound || call == nil || !sameScope(d, call.decision) || !s.scopeLive(ctx, d, localappop.IngressIntegrationCallInvoke) {
		return "", adapterError("INTEGRATION_SCOPE_ENDED")
	}
	drainDeadline := time.Now().Add(5 * time.Second)
	for {
		s.mu.Lock()
		receiver := s.nativeReceivers[t.Public.TargetRef]
		if receiver == nil || receiver.ctx.Err() == nil || closed(receiver.done) {
			break // retain s.mu for admission below
		}
		s.mu.Unlock()
		remaining := time.Until(drainDeadline)
		if remaining <= 0 {
			return "", adapterError("INTEGRATION_RECEIVER_DRAINING")
		}
		timer := time.NewTimer(remaining)
		select {
		case <-receiver.done:
			timer.Stop()
		case <-ctx.Done():
			timer.Stop()
			return "", ctx.Err()
		case <-timer.C:
			return "", adapterError("INTEGRATION_RECEIVER_DRAINING")
		}
		if !s.scopeLive(ctx, d, localappop.IngressIntegrationCallInvoke) {
			return "", adapterError("INTEGRATION_SCOPE_ENDED")
		}
	}
	adapter := s.adapters[t.Public.Kind]
	if s.closed || s.quiesced.Load() || s.removing[t.Public.TargetRef] || adapter.receive == nil || !s.permitted(ctx, d.AccountID, d.RegisteredAppSubject, t.Public.TargetRef, t.Public.Kind+".updates.read") {
		s.mu.Unlock()
		return "", adapterError("INTEGRATION_RECEIVER_UNAVAILABLE")
	}
	receiver := s.nativeReceivers[t.Public.TargetRef]
	effectiveCursor := params.Cursor
	if receiver == nil || receiver.ctx.Err() != nil {
		feed := newNativeFeed()
		if receiver != nil && receiver.generation == t.CredentialGeneration {
			feed = receiver.feed
			feed.mu.Lock()
			feed.gap = "reconnect"
			feed.err = nil
			feed.mu.Unlock()
		}
		feed.publish = func(commit func() error) error { return s.commitNativeFeed(feed, commit) }
		ownerCtx, cancel := context.WithCancel(s.ctx)
		receiver = &nativeReceiver{feed: feed, ctx: ownerCtx, cancel: cancel, done: make(chan struct{}), generation: t.CredentialGeneration}
		s.nativeReceivers[t.Public.TargetRef] = receiver
		receiver.feed.mu.Lock()
		receiver.feed.readers++
		receiver.feed.leases[call] = struct{}{}
		if effectiveCursor == "" {
			effectiveCursor = receiver.feed.cursor(nativeBinding(d, t, params.Conversations), receiver.feed.next)
		}
		receiver.feed.mu.Unlock()
		s.workers.Add(1)
		go func(r *nativeReceiver) {
			defer s.workers.Done()
			defer close(r.done)
			if err := adapter.receive(r.ctx, t, secret, r.feed); err != nil {
				r.feed.fail(err)
			}
			r.cancel()
		}(receiver)
	} else {
		receiver.feed.mu.Lock()
		receiver.feed.readers++
		receiver.feed.leases[call] = struct{}{}
		if effectiveCursor == "" {
			effectiveCursor = receiver.feed.cursor(nativeBinding(d, t, params.Conversations), receiver.feed.next)
		}
		receiver.feed.mu.Unlock()
	}
	s.mu.Unlock()
	defer func() {
		receiver.feed.mu.Lock()
		receiver.feed.readers--
		delete(receiver.feed.leases, call)
		if receiver.feed.readers == 0 {
			receiver.cancel()
		}
		receiver.feed.notifyLocked()
		receiver.feed.mu.Unlock()
	}()
	return receiver.feed.read(ctx, d, t, params.Conversations, effectiveCursor, time.Duration(params.WaitMS)*time.Millisecond)
}

// The Integration permission lock precedes the feed lock. The exact protected
// session fence encloses buffer insertion, using one still-admitted reader.
func (s *Service) commitNativeFeed(feed *nativeFeed, commit func() error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	feed.mu.Lock()
	leases := make([]*invocation, 0, len(feed.leases))
	for call := range feed.leases {
		leases = append(leases, call)
	}
	feed.mu.Unlock()
	for _, call := range leases {
		err := s.withCallCommitLocked(call, func(context.Context) error {
			feed.mu.Lock()
			defer feed.mu.Unlock()
			if _, present := feed.leases[call]; !present {
				return context.Canceled
			}
			return commit()
		})
		if err == nil {
			return nil
		}
	}
	return context.Canceled
}
