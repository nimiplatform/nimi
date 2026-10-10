package remoteexecution

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"strings"
)

// JobAuthority is transient current authority supplied by the Runtime Job
// owner. It is never reconstructed from a stored ownership tuple.
type JobAuthority interface {
	JobID() string
	WithCurrent(context.Context, func() error) error
}

type jobAuthorityKey struct{}
type asyncJobKey struct{}

func WithAsyncJob(ctx context.Context) context.Context {
	return context.WithValue(ctx, asyncJobKey{}, true)
}
func isAsyncJob(ctx context.Context) bool { value, _ := ctx.Value(asyncJobKey{}).(bool); return value }

func WithJobAuthority(ctx context.Context, authority JobAuthority) context.Context {
	return context.WithValue(WithAsyncJob(ctx), jobAuthorityKey{}, authority)
}

func jobAuthorityFromContext(ctx context.Context) JobAuthority {
	authority, _ := ctx.Value(jobAuthorityKey{}).(JobAuthority)
	return authority
}

func (h *ProviderMediaHost) jobOutboundContext(ctx context.Context, captured connector.ConnectorRecord, audit MediaDispatchAudit) context.Context {
	if !isAsyncJob(ctx) || strings.TrimSpace(captured.CredentialCustodyRef) == "" {
		return ctx
	}
	return nimillm.WithOutboundGate(ctx, func(step context.Context, handoff func() error) error {
		jobID, err := connector.JobIDForCredentialCustodyRef(captured.CredentialCustodyRef)
		if err != nil {
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
		}
		begin := func() error {
			return h.connectors.BeginJobOutbound(step, jobID, audit.AccountID, captured, func() error {
				if mark, _ := ctx.Value(jobDispatchIntentKey{}).(func(context.Context) error); mark != nil {
					if err := mark(step); err != nil {
						return err
					}
				}
				return handoff()
			})
		}
		if authority := jobAuthorityFromContext(ctx); authority != nil {
			if authority.JobID() != jobID {
				return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
			}
			return authority.WithCurrent(step, begin)
		}
		return begin()
	})
}

type jobDispatchIntentKey struct{}

// WithJobDispatchIntent is supplied by the original Job writer for its create
// execution. Query/stop of a retained receipt does not mint another intent.
func WithJobDispatchIntent(ctx context.Context, mark func(context.Context) error) context.Context {
	return context.WithValue(ctx, jobDispatchIntentKey{}, mark)
}
