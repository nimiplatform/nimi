package protectedlocal

import (
	"context"
	"fmt"
	"strings"
)

// @nimi-authority: definition.nimi.platform.app-ecosystem.managed-web-desktop-carrier
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a
const (
	ManagedWebExecutionProfileRef    = "nimi-managed-web-v1"
	ManagedWebLaunchArgument         = "--nimi-managed-web-app"
	ManagedWebPayloadDigestArgPrefix = "--nimi-payload-digest="
	ManagedWebDevLaunchArgument      = "--nimi-managed-web-dev"
)

// ManagedWebCarrier describes the active Nimi shared desktop carrier executable
// verified for the current Runtime cohort or source-development workspace.
type ManagedWebCarrier struct {
	ExecutablePath   string
	ExecutableDigest Identifier
	ArgumentsPrefix  []string
}

func (carrier ManagedWebCarrier) Valid() bool {
	return strings.TrimSpace(carrier.ExecutablePath) != "" && carrier.ExecutableDigest != (Identifier{})
}

type ManagedWebCarrierResolver interface {
	ResolveManagedWebCarrier(context.Context) (ManagedWebCarrier, error)
}

type ManagedWebCarrierResolverFunc func(context.Context) (ManagedWebCarrier, error)

func (fn ManagedWebCarrierResolverFunc) ResolveManagedWebCarrier(ctx context.Context) (ManagedWebCarrier, error) {
	if fn == nil {
		return ManagedWebCarrier{}, fmt.Errorf("managed-web carrier resolver is unavailable")
	}
	return fn(ctx)
}

func BuildManagedWebLaunchArguments(prefix []string, payloadRootDigest string) ([]string, error) {
	if !validManagedWebPayloadDigestRef(payloadRootDigest) {
		return nil, fmt.Errorf("managed-web launch requires canonical sha256 payload digest")
	}
	args := make([]string, 0, len(prefix)+2)
	for _, entry := range prefix {
		trimmed := strings.TrimSpace(entry)
		if trimmed == "" || trimmed != entry {
			return nil, fmt.Errorf("managed-web launch argument prefix contains invalid entry")
		}
		args = append(args, entry)
	}
	args = append(args, ManagedWebLaunchArgument, ManagedWebPayloadDigestArgPrefix+payloadRootDigest)
	return args, nil
}

func validManagedWebPayloadDigestRef(value string) bool {
	const prefix = "sha256:"
	if !strings.HasPrefix(value, prefix) || len(value) != len(prefix)+64 {
		return false
	}
	for _, c := range value[len(prefix):] {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}
