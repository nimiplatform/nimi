package connector

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

const (
	// A configuration read waits only briefly for a renewal and for the
	// account model list; slower work finishes on its own for a later read.
	chatGPTPlanAvailabilityRenewalWait = 4 * time.Second
	chatGPTPlanAvailabilityListWait    = 3 * time.Second
	// A list read that outlives the wait keeps its own deadline.
	chatGPTPlanAvailabilityListTimeout = 20 * time.Second
	// After an unreadable list, configuration reads skip the lookup briefly.
	chatGPTPlanAvailabilityRetry = 30 * time.Second
)

// errChatGPTPlanAvailabilityPending reports work that outlived a read's wait.
var errChatGPTPlanAvailabilityPending = errors.New("ChatGPT plan account availability is still being read")

// AccountModelAvailability reports which provider models the Connector's
// current account lists. known is false when the list cannot be read now;
// configuration surfaces then keep their catalog state and the exact
// dispatch gate still decides execution.
type AccountModelAvailability interface {
	ListedModels(ctx context.Context, record ConnectorRecord) (listed map[string]struct{}, known bool)
}

// SetAccountModelAvailability wires the Runtime-owned account availability
// fact used by AIConfig options and effective selections.
func (s *ConnectorStore) SetAccountModelAvailability(availability AccountModelAvailability) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.accountAvailability = availability
}

func (s *ConnectorStore) accountListedModels(ctx context.Context, record ConnectorRecord) (map[string]struct{}, bool) {
	if s == nil {
		return nil, false
	}
	s.mu.Lock()
	availability := s.accountAvailability
	s.mu.Unlock()
	if availability == nil {
		return nil, false
	}
	return availability.ListedModels(ctx, record)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.chatgpt-plan-connector-route
// AIConfigAccountModelBlocked reports whether an exact Cloud target's model is
// known to be missing from its Connector's current account list.
func AIConfigAccountModelBlocked(ctx context.Context, store *ConnectorStore, record ConnectorRecord, providerModelID string) bool {
	listed, known := store.accountListedModels(ctx, record)
	if !known {
		return false
	}
	_, offered := listed[strings.TrimSpace(providerModelID)]
	return !offered
}

// AIConfigAccountModelMissingReason is the typed reason for a target that the
// Connector's current account does not list.
const AIConfigAccountModelMissingReason = runtimev1.ReasonCode_AI_MODEL_NOT_FOUND

// chatGPTPlanAccountLister reads one credential's list-visible model slugs.
type chatGPTPlanAccountLister interface {
	ChatGPTPlanAccountModels(ctx context.Context, target *nimillm.RemoteTarget) (map[string]struct{}, error)
}

type chatGPTPlanAccountAvailability struct {
	store       *ConnectorStore
	lister      chatGPTPlanAccountLister
	renewalWait time.Duration
	listWait    time.Duration

	mu           sync.Mutex
	unknownUntil map[string]time.Time
}

// NewChatGPTPlanAccountAvailability reads the list-visible models of an SIWC
// Connector's current account through the same inventory reuse as dispatch.
// Like the Connector model listing it renews an expiring credential first. A
// configuration read waits for renewal and listing only briefly; work still
// running then completes on its own, in custody and in the shared inventory
// cache, for a later read.
func NewChatGPTPlanAccountAvailability(store *ConnectorStore, cloud *nimillm.CloudProvider) AccountModelAvailability {
	availability := &chatGPTPlanAccountAvailability{
		store: store, renewalWait: chatGPTPlanAvailabilityRenewalWait, listWait: chatGPTPlanAvailabilityListWait,
		unknownUntil: map[string]time.Time{},
	}
	if cloud != nil {
		availability.lister = cloud
	}
	return availability
}

func (availability *chatGPTPlanAccountAvailability) ListedModels(ctx context.Context, record ConnectorRecord) (map[string]struct{}, bool) {
	if availability == nil || availability.store == nil || availability.lister == nil || !IsChatGPTPlanRecord(record) ||
		!record.HasCredential || record.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE {
		return nil, false
	}
	connectorID := strings.TrimSpace(record.ConnectorID)
	now := availability.store.now()
	availability.mu.Lock()
	skip := now.Before(availability.unknownUntil[connectorID])
	availability.mu.Unlock()
	if skip {
		return nil, false
	}
	accessToken, ok := availability.store.peekChatGPTPlanAccessToken(connectorID, now)
	if !ok {
		// The same serialized renewal as a listing or dispatch.
		token, err := awaitChatGPTPlanAvailability(ctx, availability.renewalWait, func(detached context.Context) (string, error) {
			return availability.store.OpenChatGPTPlanAccessToken(detached, connectorID)
		})
		if err != nil {
			availability.unknownAfter(connectorID, now, err)
			return nil, false
		}
		accessToken = token
	}
	models, err := awaitChatGPTPlanAvailability(ctx, availability.listWait, func(detached context.Context) (map[string]struct{}, error) {
		listCtx, cancel := context.WithTimeout(detached, chatGPTPlanAvailabilityListTimeout)
		defer cancel()
		return availability.lister.ChatGPTPlanAccountModels(listCtx, chatGPTPlanTarget(record, accessToken))
	})
	if err != nil {
		availability.unknownAfter(connectorID, now, err)
		return nil, false
	}
	availability.mu.Lock()
	delete(availability.unknownUntil, connectorID)
	availability.mu.Unlock()
	return models, true
}

// unknownAfter skips further lookups briefly after a failed read; work that
// is still running is not a failure.
func (availability *chatGPTPlanAccountAvailability) unknownAfter(connectorID string, now time.Time, err error) {
	if errors.Is(err, errChatGPTPlanAvailabilityPending) {
		return
	}
	availability.mu.Lock()
	availability.unknownUntil[connectorID] = now.Add(chatGPTPlanAvailabilityRetry)
	availability.mu.Unlock()
}

// awaitChatGPTPlanAvailability runs work apart from the caller's cancellation
// and waits for it at most wait, so a renewal is never abandoned mid-exchange
// and a slow list read still fills the shared cache.
func awaitChatGPTPlanAvailability[T any](ctx context.Context, wait time.Duration, work func(context.Context) (T, error)) (T, error) {
	type outcome struct {
		value T
		err   error
	}
	result := make(chan outcome, 1)
	go func() {
		value, err := work(context.WithoutCancel(ctx))
		result <- outcome{value: value, err: err}
	}()
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case done := <-result:
		return done.value, done.err
	case <-timer.C:
	case <-ctx.Done():
	}
	var pending T
	return pending, errChatGPTPlanAvailabilityPending
}

// peekChatGPTPlanAccessToken returns the committed access token without
// renewal or custody writes, only while it stays valid past the renewal window.
func (s *ConnectorStore) peekChatGPTPlanAccessToken(connectorID string, now time.Time) (string, bool) {
	_, credential, err := s.loadChatGPTPlanCredential(connectorID)
	if err != nil || credential.State != chatGPTPlanStateActive {
		return "", false
	}
	if !time.Unix(credential.AccessExpiresAt, 0).After(now.Add(chatGPTPlanRenewalWindow)) {
		return "", false
	}
	return credential.AccessToken, true
}
