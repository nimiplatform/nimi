package app

import (
	"context"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
)

type jobAccountAuthorityOwner interface {
	BindJobAccountAuthority(context.Context, string, uint64) (accountservice.JobAccountAuthority, error)
	WithJobAccountAuthority(context.Context, accountservice.JobAccountAuthority, func() error) error
}

type JobWorkAuthorizer struct {
	account       jobAccountAuthorityOwner
	registrations *localappkernel.RegistrationStore
}

func NewJobWorkAuthorizer(owner jobAccountAuthorityOwner, kernel *localappkernel.Kernel) *JobWorkAuthorizer {
	result := &JobWorkAuthorizer{account: owner}
	if kernel != nil {
		result.registrations = kernel.Registrations()
	}
	return result
}

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-execution-scope
// AdmitJobWork is a constructor-injected private seam, not another App ingress.
// The caller already passed fresh typed protected admission for this operation.
func (s *JobWorkAuthorizer) AdmitJobWork(ctx context.Context, d accountservice.LocalAppCallerDecision) (accountservice.JobWorkAuthority, error) {
	admitted, present := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !present || admitted.AccountID != d.AccountID || admitted.RealmEnvironmentID != d.RealmEnvironmentID || admitted.AccountGeneration != d.AccountGeneration || admitted.RegisteredAppSubject != d.RegisteredAppSubject || admitted.SourceGeneration != d.SourceGeneration || admitted.DeclarationGeneration != d.DeclarationGeneration || admitted.Operation != d.Operation || admitted.SessionID != d.SessionID || admitted.SessionInvalidated == nil {
		return accountservice.JobWorkAuthority{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	// Fresh ingress is required to mint a work permit. After minting, only the
	// true owner fences below govern its lifetime, independently of this signal.
	select {
	case <-admitted.SessionInvalidated:
		return accountservice.JobWorkAuthority{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	default:
	}
	if s == nil || s.account == nil || s.registrations == nil || d.AccountID == "" || d.RegisteredAppSubject == "" || d.AppID == "" {
		return accountservice.JobWorkAuthority{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	switch d.Operation {
	case accountservice.LocalAppOperationScenarioJobSubmit, accountservice.LocalAppOperationScenarioJobGet, accountservice.LocalAppOperationScenarioJobCancel:
	default:
		return accountservice.JobWorkAuthority{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	owner := s.account
	lease, err := owner.BindJobAccountAuthority(ctx, d.AccountID, d.AccountGeneration)
	if err != nil {
		return accountservice.JobWorkAuthority{}, err
	}
	if lease.RealmID != d.RealmEnvironmentID {
		return accountservice.JobWorkAuthority{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED)
	}
	registrationInvalidated, releaseRegistration, err := s.registrations.BindJobRegistrationAuthority(ctx, d.RegisteredAppSubject, d.SourceGeneration, d.DeclarationGeneration)
	if err != nil {
		return accountservice.JobWorkAuthority{}, err
	}
	invalidated := make(chan struct{})
	var once sync.Once
	release := func() { once.Do(func() { close(invalidated); releaseRegistration() }) }
	guard := func(work context.Context, fn func() error) error {
		select {
		case <-invalidated:
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
		default:
		}
		return owner.WithJobAccountAuthority(work, lease, func() error {
			return s.registrations.WithJobRegistrationAuthority(work, d.RegisteredAppSubject, d.SourceGeneration, d.DeclarationGeneration, fn)
		})
	}
	if err := guard(ctx, func() error { return nil }); err != nil {
		release()
		return accountservice.JobWorkAuthority{}, err
	}
	go func() {
		select {
		case <-lease.Invalidated:
		case <-registrationInvalidated:
		case <-invalidated:
		}
		release()
	}()
	return accountservice.JobWorkAuthority{Invalidated: invalidated, WithCurrent: guard, Release: release}, nil
}
