package account

import (
	"context"
	"fmt"
	"strings"

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

type agentVoiceJobOriginKey struct{}
type agentVoiceJobOrigin struct {
	decision       LocalAppCallerDecision
	executionAppID string
}

// @nimi-authority: rule.nimi.runtime.agent-participation.r181
// ContextWithAgentVoiceJobOrigin retains the resolved Conversation caller for
// a Runtime-owned speech Job. It does not grant ScenarioJobSubmit or mint a
// work permit: the Job authorizer still checks live account and registration.
// The execution App may own a selected VoiceAsset; it is not the Job authority.
func ContextWithAgentVoiceJobOrigin(ctx, ingress context.Context, executionAppID, accountID, agentID string) context.Context {
	if ctx == nil || ingress == nil {
		return ctx
	}
	d, ok := AuthorizedLocalAppDecisionFromContext(ingress)
	if !ok || strings.TrimSpace(executionAppID) == "" || d.AccountID != accountID || agentID == "" || d.LocalAgentID != agentID || d.RegisteredAppSubject == "" || d.SessionInvalidated == nil {
		return ctx
	}
	if d.Operation != LocalAppOperationSendConversationTurn && d.Operation != LocalAppOperationConversationVoiceRender {
		return ctx
	}
	select {
	case <-d.SessionInvalidated:
		return ctx
	default:
	}
	ctx = ContextWithAuthorizedLocalAppDecision(ctx, d)
	return context.WithValue(ctx, agentVoiceJobOriginKey{}, agentVoiceJobOrigin{decision: d, executionAppID: executionAppID})
}

// AgentVoiceJobExecutionApp returns only a process-private, unchanged origin.
// No public request, metadata field or persisted Job can construct this scope.
func AgentVoiceJobExecutionApp(ctx context.Context) (string, bool) {
	if ctx == nil {
		return "", false
	}
	origin, ok := ctx.Value(agentVoiceJobOriginKey{}).(agentVoiceJobOrigin)
	d, admitted := AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok || !admitted || d != origin.decision {
		return "", false
	}
	return origin.executionAppID, true
}
