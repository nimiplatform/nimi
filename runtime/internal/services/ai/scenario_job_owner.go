package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
)

// localAppJobOwner is immutable Runtime-private Job ownership captured from
// protected ingress. ProducerAppID is catalog metadata only and is never
// compared by authorization.
type localAppJobOwner struct {
	AccountID            string
	RegisteredAppSubject string
	ProducerAppID        string
}

func localAppJobOwnerFromContext(ctx context.Context) *localAppJobOwner {
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok {
		return nil
	}
	owner := &localAppJobOwner{
		AccountID:            strings.TrimSpace(decision.AccountID),
		RegisteredAppSubject: strings.TrimSpace(decision.RegisteredAppSubject),
		ProducerAppID:        strings.TrimSpace(decision.AppID),
	}
	if !owner.valid() {
		return nil
	}
	return owner
}

func (owner *localAppJobOwner) valid() bool {
	return owner != nil && owner.AccountID != "" && owner.RegisteredAppSubject != "" && owner.ProducerAppID != ""
}

func cloneLocalAppJobOwner(owner *localAppJobOwner) *localAppJobOwner {
	if !owner.valid() {
		return nil
	}
	cloned := *owner
	return &cloned
}

func authorizeLocalAppJobOwner(ctx context.Context, owner *localAppJobOwner) error {
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok || !owner.valid() || strings.TrimSpace(decision.AccountID) != owner.AccountID ||
		strings.TrimSpace(decision.RegisteredAppSubject) != owner.RegisteredAppSubject {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	return nil
}
