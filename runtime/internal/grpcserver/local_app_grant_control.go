package grpcserver

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"sync"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

type localAppGrantControlBridge struct {
	sessions *protectedlocal.DesktopSessionManager
	mu       sync.Mutex
	pending  map[string]map[string]accountservice.LocalAppGrantChallengeBinding
}

func newLocalAppGrantControlBridge(sessions *protectedlocal.DesktopSessionManager) *localAppGrantControlBridge {
	return &localAppGrantControlBridge{sessions: sessions, pending: make(map[string]map[string]accountservice.LocalAppGrantChallengeBinding)}
}

func (bridge *localAppGrantControlBridge) BindLocalAppGrantChallenge(_ context.Context, challenge accountservice.LocalAppGrantChallengeBinding) (string, error) {
	if bridge == nil || bridge.sessions == nil || len(challenge.RequestID) != 32 || len(challenge.PresenceChallengeID) != 32 || challenge.ExpiresAt.IsZero() {
		return "", fmt.Errorf("local-app grant challenge is incomplete")
	}
	controlRef, err := bridge.sessions.SoleLocalAppControlSessionRef()
	if err != nil {
		return "", err
	}
	key := base64.RawURLEncoding.EncodeToString(challenge.RequestID)
	cloned := challenge
	cloned.RequestID = append([]byte(nil), challenge.RequestID...)
	cloned.PresenceChallengeID = append([]byte(nil), challenge.PresenceChallengeID...)
	bridge.mu.Lock()
	if bridge.pending[controlRef] == nil {
		bridge.pending[controlRef] = make(map[string]accountservice.LocalAppGrantChallengeBinding)
	}
	bridge.pending[controlRef][key] = cloned
	bridge.mu.Unlock()
	return controlRef, nil
}

func (bridge *localAppGrantControlBridge) AuthorizeLocalAppGrantControl(ctx context.Context) (string, error) {
	if bridge == nil || bridge.sessions == nil {
		return "", fmt.Errorf("local-app grant control is unavailable")
	}
	return bridge.sessions.LocalAppControlSessionRef(ctx)
}

func (bridge *localAppGrantControlBridge) PendingLocalAppGrantChallenge(ctx context.Context) (accountservice.LocalAppGrantChallengeBinding, bool, error) {
	controlRef, err := bridge.AuthorizeLocalAppGrantControl(ctx)
	if err != nil {
		return accountservice.LocalAppGrantChallengeBinding{}, false, err
	}
	now := time.Now().UTC()
	bridge.mu.Lock()
	defer bridge.mu.Unlock()
	entries := bridge.pending[controlRef]
	var selected accountservice.LocalAppGrantChallengeBinding
	found := false
	for key, candidate := range entries {
		if !now.Before(candidate.ExpiresAt) {
			delete(entries, key)
			continue
		}
		if !found || candidate.IssuedAt.Before(selected.IssuedAt) {
			selected = candidate
			found = true
		}
	}
	if !found {
		return accountservice.LocalAppGrantChallengeBinding{}, false, nil
	}
	selected.RequestID = append([]byte(nil), selected.RequestID...)
	selected.PresenceChallengeID = append([]byte(nil), selected.PresenceChallengeID...)
	return selected, true, nil
}

func (bridge *localAppGrantControlBridge) CompleteLocalAppGrantChallenge(requestID []byte) {
	if bridge == nil || len(requestID) == 0 {
		return
	}
	key := base64.RawURLEncoding.EncodeToString(requestID)
	bridge.mu.Lock()
	defer bridge.mu.Unlock()
	for controlRef, entries := range bridge.pending {
		if candidate, ok := entries[key]; ok && bytes.Equal(candidate.RequestID, requestID) {
			delete(entries, key)
		}
		if len(entries) == 0 {
			delete(bridge.pending, controlRef)
		}
	}
}

var _ accountservice.LocalAppGrantControlAuthority = (*localAppGrantControlBridge)(nil)
var _ accountservice.LocalAppGrantChallengeInbox = (*localAppGrantControlBridge)(nil)
