package account

import (
	"context"
	"fmt"
	"strings"
)

type RealmRealtimeAccountLease struct {
	AccountID          string
	RealmEnvironmentID string
	Generation         uint64
	Invalidated        <-chan struct{}
	AccessToken        string
	RealmBaseURL       string
	RealmRealtimeURL   string
}

// @nimi-authority: rule.nimi.runtime.realm-realtime.r001
// BindRealmRealtimeAccount is Runtime-private credential custody. The returned
// token must never cross a public RPC, SDK, Desktop, or App boundary.
func (s *Service) BindRealmRealtimeAccount(ctx context.Context) (RealmRealtimeAccountLease, error) {
	if s == nil {
		return RealmRealtimeAccountLease{}, fmt.Errorf("Realm account service is unavailable")
	}
	projection, generation, invalidated, ok := s.BindAuthenticatedRuntimeGeneration(ctx)
	if !ok || projection == nil {
		return RealmRealtimeAccountLease{}, fmt.Errorf("authenticated Realm account is unavailable")
	}
	accessToken, _, accepted, err := s.realmUnaryAccessToken(ctx, nil)
	if err != nil {
		return RealmRealtimeAccountLease{}, err
	}
	if !accepted || strings.TrimSpace(accessToken) == "" {
		return RealmRealtimeAccountLease{}, fmt.Errorf("Realm credential is unavailable")
	}
	current, currentGeneration, currentInvalidated, currentOK := s.BindAuthenticatedRuntimeGeneration(ctx)
	if !currentOK || current == nil || currentGeneration != generation || currentInvalidated != invalidated {
		return RealmRealtimeAccountLease{}, fmt.Errorf("Realm account generation changed during credential capture")
	}
	baseURL := strings.TrimRight(strings.TrimSpace(s.realmBaseURL), "/")
	realtimeURL := strings.TrimRight(strings.TrimSpace(s.realmRealtimeURL), "/")
	if baseURL == "" || realtimeURL == "" {
		return RealmRealtimeAccountLease{}, fmt.Errorf("Realm endpoints are unavailable")
	}
	return RealmRealtimeAccountLease{
		AccountID:          strings.TrimSpace(current.GetAccountId()),
		RealmEnvironmentID: strings.TrimSpace(current.GetRealmEnvironmentId()),
		Generation:         generation,
		Invalidated:        invalidated,
		AccessToken:        strings.TrimSpace(accessToken),
		RealmBaseURL:       baseURL,
		RealmRealtimeURL:   realtimeURL,
	}, nil
}

func (s *Service) RefreshRealmRealtimeAccount(ctx context.Context, generation uint64, rejectedAccessToken string) (RealmRealtimeAccountLease, error) {
	if s == nil || generation == 0 {
		return RealmRealtimeAccountLease{}, fmt.Errorf("Realm account generation is unavailable")
	}
	_, currentGeneration, _, ok := s.BindAuthenticatedRuntimeGeneration(ctx)
	if !ok || currentGeneration != generation {
		return RealmRealtimeAccountLease{}, fmt.Errorf("Realm account generation is stale")
	}
	result, err := s.refreshAccountSessionAfterUnauthorized(ctx, rejectedAccessToken)
	if err != nil {
		return RealmRealtimeAccountLease{}, err
	}
	if result == nil || !result.accepted {
		return RealmRealtimeAccountLease{}, fmt.Errorf("Realm credential refresh was rejected")
	}
	lease, err := s.BindRealmRealtimeAccount(ctx)
	if err != nil {
		return RealmRealtimeAccountLease{}, err
	}
	if lease.Generation != generation {
		return RealmRealtimeAccountLease{}, fmt.Errorf("Realm account generation changed during refresh")
	}
	return lease, nil
}
