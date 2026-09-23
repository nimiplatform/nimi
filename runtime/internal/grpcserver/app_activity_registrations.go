package grpcserver

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/services/appactivity"
)

// kernelActivityRegistrations projects the current canonical registration of
// a Registered App Subject into the App activity owner's source facts. The
// subject and registration handle stay inside Runtime.
type kernelActivityRegistrations struct {
	registrations *localappkernel.RegistrationStore
}

func (resolver kernelActivityRegistrations) ActivitySource(ctx context.Context, subject string) (appactivity.SourceFacts, error) {
	registration, err := resolver.registrations.GetBySubject(ctx, subject)
	if errors.Is(err, localappkernel.ErrNotFound) || errors.Is(err, localappkernel.ErrRegistrationUnavailable) {
		return appactivity.SourceFacts{}, nil
	}
	if err != nil {
		return appactivity.SourceFacts{}, err
	}
	selector := []byte(registration.RegistrationHandle)
	if registration.SourceClass == localappkernel.SourceClassLocalDevelopment {
		selector, err = activityDevelopmentLaunchSelector(registration.RegistrationHandle)
		if err != nil {
			return appactivity.SourceFacts{}, err
		}
	}
	return appactivity.SourceFacts{
		AppID: registration.AppID, DisplayName: registration.DisplayName,
		Active:         registration.State == localappkernel.RegistrationStateActive,
		SourceClass:    string(registration.SourceClass),
		LaunchSelector: selector,
	}, nil
}

// Decode protected registration material at the transport composition boundary;
// the activity owner consumes only the resulting Host-private launch selector.
func activityDevelopmentLaunchSelector(handle string) ([]byte, error) {
	const prefix = "rar_v1_"
	if !strings.HasPrefix(handle, prefix) {
		return nil, appactivity.ErrUnavailable
	}
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(handle, prefix))
	if err != nil || len(decoded) != protectedlocal.IdentifierBytes {
		return nil, appactivity.ErrUnavailable
	}
	return decoded, nil
}

// unavailableActivityRegistrations serves non-protected Runtime topologies
// without a registration owner; every App source projects as unavailable.
type unavailableActivityRegistrations struct{}

func (unavailableActivityRegistrations) ActivitySource(context.Context, string) (appactivity.SourceFacts, error) {
	return appactivity.SourceFacts{}, nil
}
