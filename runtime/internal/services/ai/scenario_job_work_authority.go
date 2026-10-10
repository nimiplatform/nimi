package ai

import (
	"context"
	"errors"
	"sync/atomic"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
)

type JobWorkAuthorizer interface {
	AdmitJobWork(context.Context, accountservice.LocalAppCallerDecision) (accountservice.JobWorkAuthority, error)
}

type JobExecutionOption func(*Service)

func WithJobWorkAuthorizer(owner JobWorkAuthorizer) JobExecutionOption {
	return func(s *Service) { s.jobWorkAuthorizer = owner }
}

type jobWorkPermitKey struct{}

// A transient capability, never a serialized permission. The writer adopts
// this permit only after its complete admitted record has committed.
type jobWorkPermit struct {
	authority accountservice.JobWorkAuthority
	adopted   atomic.Bool
	jobID     string
}

type jobAuthorityContext struct {
	context.Context
	permit *jobWorkPermit
}

func (c jobAuthorityContext) Done() <-chan struct{} { return c.permit.authority.Invalidated }
func (c jobAuthorityContext) Err() error {
	select {
	case <-c.Done():
		return context.Canceled
	default:
		return nil
	}
}

func (p *jobWorkPermit) context() context.Context {
	return remoteexecution.WithJobAuthority(context.WithValue(jobAuthorityContext{Context: context.Background(), permit: p}, jobWorkPermitKey{}, p), p)
}

func (p *jobWorkPermit) JobID() string { return p.jobID }
func (p *jobWorkPermit) WithCurrent(ctx context.Context, fn func() error) error {
	return p.authority.WithCurrent(ctx, fn)
}

func jobWorkPermitFromContext(ctx context.Context) *jobWorkPermit {
	p, _ := ctx.Value(jobWorkPermitKey{}).(*jobWorkPermit)
	return p
}

func (s *Service) admitJobSubmissionWork(ctx context.Context) (context.Context, func(), error) {
	d, protected := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !protected || s.jobWorkAuthorizer == nil {
		if s.requireJobWorkAuthority {
			return nil, nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
		}
		return ctx, func() {}, nil
	}
	permission, err := s.jobWorkAuthorizer.AdmitJobWork(ctx, d)
	if err != nil {
		return nil, nil, err
	}
	if permission.Invalidated == nil || permission.WithCurrent == nil || permission.Release == nil {
		if permission.Release != nil {
			permission.Release()
		}
		return nil, nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	permit := &jobWorkPermit{authority: permission}
	return context.WithValue(ctx, jobWorkPermitKey{}, permit), func() {
		if !permit.adopted.Load() {
			permission.Release()
		}
	}, nil
}

func (s *scenarioJobStore) withJobWorkAuthority(jobID string, commit func() error) error {
	s.mu.RLock()
	record := s.jobs[jobID]
	var permit *jobWorkPermit
	if record != nil && record.localAppOwner != nil {
		permit = record.localAppOwner.workPermit
	}
	s.mu.RUnlock()
	if permit == nil {
		return commit()
	}
	return permit.authority.WithCurrent(permit.context(), commit)
}

// True owner withdrawal closes result publication locally; it never sends a
// provider stop/delete using a detached historical permission.
func (s *scenarioJobStore) failJobWorkAuthority(jobID string, cause error, work ...context.Context) {
	reason, ok := grpcerr.ExtractReasonCode(cause)
	if !ok {
		reason = runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN
	}
	_, _, err := s.transition(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED, func(job *runtimev1.ScenarioJob) {
		job.ReasonCode = reason
		job.ReasonDetail = "Job execution authority was withdrawn"
		job.ReasonMetadata = nil
	}, work...)
	if errors.Is(err, errNativeJobClaimLost) {
		return
	}
	if err != nil {
		s.recordPersistenceIssue(jobID)
	}
	s.mu.RLock()
	record := s.jobs[jobID]
	var cancel context.CancelFunc
	var release func()
	if record != nil {
		cancel = record.cancel
		if !record.executionStarted && record.localAppOwner != nil && record.localAppOwner.workPermit != nil {
			release = record.localAppOwner.workPermit.authority.Release
		}
	}
	s.mu.RUnlock()
	if cancel != nil {
		cancel()
	}
	if release != nil {
		release()
	}
}
