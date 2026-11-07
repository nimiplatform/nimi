package ai

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"sync"
)

func newNativeMediaWorkAuthorizer(account, app, subject string) *nativeMediaWorkAuthorizer {
	return &nativeMediaWorkAuthorizer{account: account, app: app, subject: subject}
}

// Explicit, revocable engineering authority. Production checks remain enabled;
// an authorized ingress decision alone is not a detached Job work permit.
type nativeMediaWorkAuthorizer struct {
	account, app, subject string
	mu                    sync.Mutex
	revoked               bool
	live                  map[chan struct{}]bool
}

func (a *nativeMediaWorkAuthorizer) AdmitJobWork(_ context.Context, d accountservice.LocalAppCallerDecision) (accountservice.JobWorkAuthority, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	denied := func() error {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	if a.revoked || d.AccountID != a.account || d.AppID != a.app || d.RegisteredAppSubject != a.subject {
		return accountservice.JobWorkAuthority{}, denied()
	}
	if a.live == nil {
		a.live = map[chan struct{}]bool{}
	}
	done := make(chan struct{})
	a.live[done] = true
	return accountservice.JobWorkAuthority{Invalidated: done, WithCurrent: func(ctx context.Context, fn func() error) error {
		a.mu.Lock()
		defer a.mu.Unlock()
		if a.revoked || !a.live[done] || ctx.Err() != nil {
			return denied()
		}
		return fn()
	}, Release: func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		if a.live[done] {
			delete(a.live, done)
		}
	}}, nil
}

func (a *nativeMediaWorkAuthorizer) revoke() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.revoked = true
	for done := range a.live {
		delete(a.live, done)
		close(done)
	}
}
