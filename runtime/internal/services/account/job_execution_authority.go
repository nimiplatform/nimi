package account

import (
	"context"
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// JobAccountAuthority is only an in-process generation binding. A serialized
// Job ownership tuple cannot create one and it never contains bearer material.
type JobAccountAuthority struct {
	AccountID   string
	RealmID     string
	Generation  uint64
	Invalidated <-chan struct{}
}

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-execution-scope
func (s *Service) BindJobAccountAuthority(ctx context.Context, accountID string, generation uint64) (JobAccountAuthority, error) {
	p, current, invalidated, ok := s.BindAuthenticatedRuntimeGeneration(ctx)
	if !ok || p.GetAccountId() != accountID || current != generation {
		return JobAccountAuthority{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED)
	}
	return JobAccountAuthority{AccountID: accountID, RealmID: p.GetRealmEnvironmentId(), Generation: current, Invalidated: invalidated}, nil
}

// WithJobAccountAuthority closes the account-switch/publication race under the
// same identity lock used by account mutations. The callback must not re-enter
// Account Service and must not perform provider or body-transfer IO.
func (s *Service) WithJobAccountAuthority(ctx context.Context, lease JobAccountAuthority, fn func() error) error {
	if s == nil || ctx == nil || fn == nil || lease.AccountID == "" || lease.Generation == 0 {
		return fmt.Errorf("Job account authority is unavailable")
	}
	accepted, err := s.CommitAuthenticatedRuntimeGeneration(ctx, lease.AccountID, lease.RealmID, lease.Generation, fn)
	if !accepted && err == nil {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED)
	}
	return err
}

// JobWorkAuthority carries current guards, not a durable App permission.
type JobWorkAuthority struct {
	Invalidated <-chan struct{}
	WithCurrent func(context.Context, func() error) error
	Release     func()
}
