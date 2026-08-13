// Package protectedprincipal carries Runtime-constructed protected caller truth.
// Values are attached only by native protected transport interceptors and are
// never serialized into gRPC metadata or request DTOs.
package protectedprincipal

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
)

type Principal struct {
	AppID             string
	ProfileID         string
	Capability        string
	AccountID         string
	RealmEnvironment  string
	AccountGeneration uint64
	BootEpoch         protectedlocal.Identifier
	invalidated       <-chan struct{}
	transportDone     <-chan struct{}
	directTransport   bool
}

type contextKey struct{}
type authorizedAppOwnerDecisionContextKey struct{}

func With(ctx context.Context, principal Principal) context.Context {
	return context.WithValue(ctx, contextKey{}, principal)
}

func FromContext(ctx context.Context) (Principal, bool) {
	principal, ok := AttachedToContext(ctx)
	return principal, ok && principal.Valid()
}

// AttachedToContext reports transport-attached principal presence even after
// lifecycle invalidation, so a stale protected call cannot degrade into an
// ordinary caller path.
func AttachedToContext(ctx context.Context) (Principal, bool) {
	if ctx == nil {
		return Principal{}, false
	}
	principal, ok := ctx.Value(contextKey{}).(Principal)
	return principal, ok
}

// ContextWithAuthorizedAppOwnerDecision attaches the exact registered App
// owner admitted by the protected Desktop ingress for one request. AI services
// consume this decision without reaching into the App registration kernel.
func ContextWithAuthorizedAppOwnerDecision(ctx context.Context, appID string) context.Context {
	return context.WithValue(ctx, authorizedAppOwnerDecisionContextKey{}, strings.TrimSpace(appID))
}

func AuthorizedAppOwnerDecisionFromContext(ctx context.Context) (string, bool) {
	if ctx == nil {
		return "", false
	}
	appID, ok := ctx.Value(authorizedAppOwnerDecisionContextKey{}).(string)
	return appID, ok && appID != "" && strings.TrimSpace(appID) == appID
}

func (principal Principal) Valid() bool {
	if strings.TrimSpace(principal.AppID) == "" || strings.TrimSpace(principal.ProfileID) == "" ||
		strings.TrimSpace(principal.Capability) == "" || strings.TrimSpace(principal.AccountID) == "" ||
		strings.TrimSpace(principal.RealmEnvironment) == "" || principal.AccountGeneration == 0 ||
		principal.invalidated == nil ||
		(!principal.directTransport && principal.BootEpoch == (protectedlocal.Identifier{})) ||
		(principal.directTransport && principal.transportDone == nil) {
		return false
	}
	select {
	case <-principal.invalidated:
		return false
	default:
	}
	if principal.directTransport {
		select {
		case <-principal.transportDone:
			return false
		default:
		}
	}
	return true
}

func (principal Principal) Owns(subject string) bool {
	return principal.Valid() && strings.TrimSpace(subject) == principal.AccountID
}

func (principal Principal) IsDesktopAccountProduct() bool {
	return principal.AppID == envelope.ProtectedDesktopAppID &&
		principal.ProfileID == protectedlocal.DesktopAccountProductProfileID
}

func (principal Principal) Done() <-chan struct{} {
	return principal.invalidated
}

func New(
	appID string,
	profileID string,
	capability string,
	projection *runtimev1.AccountProjection,
	generation uint64,
	bootEpoch protectedlocal.Identifier,
	invalidated <-chan struct{},
) Principal {
	principal := Principal{
		AppID: strings.TrimSpace(appID), ProfileID: strings.TrimSpace(profileID),
		Capability: strings.TrimSpace(capability), AccountGeneration: generation,
		BootEpoch: bootEpoch, invalidated: invalidated,
	}
	if projection != nil {
		principal.AccountID = strings.TrimSpace(projection.GetAccountId())
		principal.RealmEnvironment = strings.TrimSpace(projection.GetRealmEnvironmentId())
	}
	return principal
}

func NewDesktopAccountProduct(
	projection *runtimev1.AccountProjection,
	generation uint64,
	bootEpoch protectedlocal.Identifier,
	invalidated <-chan struct{},
) Principal {
	return New(
		envelope.ProtectedDesktopAppID,
		protectedlocal.DesktopAccountProductProfileID,
		protectedlocal.DesktopAccountProductProfileID,
		projection,
		generation,
		bootEpoch,
		invalidated,
	)
}

func NewDirect(
	appID string,
	profileID string,
	capability string,
	projection *runtimev1.AccountProjection,
	generation uint64,
	invalidated <-chan struct{},
	transportDone <-chan struct{},
) Principal {
	principal := Principal{
		AppID: strings.TrimSpace(appID), ProfileID: strings.TrimSpace(profileID),
		Capability: strings.TrimSpace(capability), AccountGeneration: generation,
		invalidated: invalidated, transportDone: transportDone, directTransport: true,
	}
	if projection != nil {
		principal.AccountID = strings.TrimSpace(projection.GetAccountId())
		principal.RealmEnvironment = strings.TrimSpace(projection.GetRealmEnvironmentId())
	}
	return principal
}

func NewDirectDesktopAccountProduct(
	projection *runtimev1.AccountProjection,
	generation uint64,
	invalidated <-chan struct{},
	transportDone <-chan struct{},
) Principal {
	return NewDirect(
		envelope.ProtectedDesktopAppID,
		protectedlocal.DesktopAccountProductProfileID,
		protectedlocal.DesktopAccountProductProfileID,
		projection,
		generation,
		invalidated,
		transportDone,
	)
}
