package realmrealtime

import (
	"context"
	"errors"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

var errRealmConnectionClosed = errors.New("Runtime Realm connection is closed")

// @nimi-authority: rule.nimi.runtime.realm-realtime.r003
// Initial and established connections share the same bounded transport retry
// policy. Authentication, protocol and owner rejections never enter another attempt.
func retryRealmConnection(ctx context.Context, attempt func() error) error {
	backoff := 250 * time.Millisecond
	var failure error
	for index := 0; index < 6; index++ {
		if err := context.Cause(ctx); err != nil {
			return err
		}
		if index > 0 {
			timer := time.NewTimer(backoff)
			select {
			case <-ctx.Done():
				timer.Stop()
				return context.Cause(ctx)
			case <-timer.C:
			}
			if backoff < 4*time.Second {
				backoff *= 2
			}
		}
		failure = attempt()
		if err := context.Cause(ctx); err != nil {
			return err
		}
		if failure == nil || connectionCloseReason(failure) != "unavailable" {
			return failure
		}
	}
	return failure
}

func (s *Service) openingScopeError(ctx context.Context, lease accountservice.RealmRealtimeAccountLease) error {
	if err := context.Cause(ctx); err != nil {
		return err
	}
	if s.lifetime.Err() != nil {
		return errRealmConnectionClosed
	}
	select {
	case <-lease.Invalidated:
		return errSocketAuth
	default:
		return nil
	}
}

// @nimi-authority: rule.nimi.runtime.realm-realtime.r001
// @nimi-authority: rule.nimi.runtime.protected-session.r031
func (s *Service) ensureConnection(ctx context.Context, lease accountservice.RealmRealtimeAccountLease) (*realmConnection, error) {
	if err := s.openingScopeError(ctx, lease); err != nil {
		return nil, err
	}
	// Serialize account connection creation without holding the service mutex
	// over network I/O. Waiting requests and service shutdown remain cancellable.
	select {
	case s.opening <- struct{}{}:
		defer func() { <-s.opening }()
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.lifetime.Done():
		return nil, errRealmConnectionClosed
	case <-lease.Invalidated:
		return nil, errSocketAuth
	}
	if err := s.openingScopeError(ctx, lease); err != nil {
		return nil, err
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, errRealmConnectionClosed
	}
	if current := s.remote; current != nil && current.lease.AccountID == lease.AccountID &&
		current.lease.RealmEnvironmentID == lease.RealmEnvironmentID && current.lease.Generation == lease.Generation && current.ctx.Err() == nil {
		s.mu.Unlock()
		return current, nil
	}
	previous := s.remote
	s.remote = nil
	s.mu.Unlock()
	if previous != nil {
		previous.cancel()
		previous.driver.Close()
	}

	openingCtx, stopOpening := context.WithCancelCause(ctx)
	defer stopOpening(nil)
	stopServiceWatch := context.AfterFunc(s.lifetime, func() { stopOpening(errRealmConnectionClosed) })
	defer stopServiceWatch()
	go func() {
		select {
		case <-lease.Invalidated:
			stopOpening(errSocketAuth)
		case <-openingCtx.Done():
		}
	}()
	connectionCtx, cancel := context.WithCancel(s.lifetime)
	var driver *socketIOClient
	committed := false
	defer func() {
		if !committed {
			cancel()
			if driver != nil {
				driver.Close()
			}
		}
	}()
	currentLease := lease
	err := retryRealmConnection(openingCtx, func() error {
		fresh, err := s.accounts.BindRealmRealtimeAccount(openingCtx)
		if err != nil || fresh.AccountID != lease.AccountID || fresh.RealmEnvironmentID != lease.RealmEnvironmentID || fresh.Generation != lease.Generation {
			return errSocketAuth
		}
		if err := s.openingScopeError(openingCtx, fresh); err != nil {
			return err
		}
		currentLease = fresh
		driver, err = dialSocketIOWithLifetime(openingCtx, connectionCtx, fresh.RealmRealtimeURL, fresh.AccessToken)
		return err
	})
	if err != nil {
		return nil, err
	}
	remote := &realmConnection{
		lease: currentLease, driver: driver, ctx: connectionCtx, cancel: cancel,
		presenceRevision: make(map[string]uint64),
	}
	committed, err = s.accounts.CommitAuthenticatedRuntimeGeneration(openingCtx, lease.AccountID, lease.RealmEnvironmentID, lease.Generation, func() error {
		s.mu.Lock()
		defer s.mu.Unlock()
		if err := s.openingScopeError(openingCtx, currentLease); err != nil {
			return err
		}
		if s.closed {
			return errRealmConnectionClosed
		}
		s.remote = remote
		return nil
	})
	if err != nil {
		committed = false
		if cause := context.Cause(openingCtx); cause != nil {
			return nil, cause
		}
		return nil, err
	}
	if !committed {
		return nil, errSocketAuth
	}
	go s.runConnection(remote)
	go func() {
		select {
		case <-currentLease.Invalidated:
			s.failAccountGeneration(remote)
		case <-connectionCtx.Done():
		}
	}()
	return remote, nil
}

func realmOpeningError(err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return status.FromContextError(err).Err()
	}
	switch connectionCloseReason(err) {
	case "token-expired", "unauthenticated":
		return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	case "denied":
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	case "protocol-failure":
		return grpcerr.WithReasonCode(codes.DataLoss, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	case "closed":
		return status.Error(codes.Canceled, "Realm connection opening was cancelled")
	default:
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_REALM_UNAVAILABLE)
	}
}
