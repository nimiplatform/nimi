// Package protectedprincipal carries Runtime-constructed protected caller truth.
// Values are attached only by native protected transport interceptors and are
// never serialized into gRPC metadata or request DTOs.
package protectedprincipal

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
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
}

type contextKey struct{}

func With(ctx context.Context, principal Principal) context.Context {
	return context.WithValue(ctx, contextKey{}, principal)
}

func FromContext(ctx context.Context) (Principal, bool) {
	if ctx == nil {
		return Principal{}, false
	}
	principal, ok := ctx.Value(contextKey{}).(Principal)
	return principal, ok && principal.Valid()
}

func (principal Principal) Valid() bool {
	if strings.TrimSpace(principal.AppID) == "" || strings.TrimSpace(principal.ProfileID) == "" ||
		strings.TrimSpace(principal.Capability) == "" || strings.TrimSpace(principal.AccountID) == "" ||
		strings.TrimSpace(principal.RealmEnvironment) == "" || principal.AccountGeneration == 0 ||
		principal.BootEpoch == (protectedlocal.Identifier{}) || principal.invalidated == nil {
		return false
	}
	select {
	case <-principal.invalidated:
		return false
	default:
		return true
	}
}

func (principal Principal) Owns(subject string) bool {
	return principal.Valid() && strings.TrimSpace(subject) == principal.AccountID
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
