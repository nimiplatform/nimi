//go:build !windows && !(darwin && cgo)

package account

import "context"

type unsupportedHostPresenceProvider struct{}

func newPlatformHostPresenceProvider() hostPresenceProvider {
	return unsupportedHostPresenceProvider{}
}

func (unsupportedHostPresenceProvider) RequestHostPresence(context.Context, hostPresenceRequest) (hostPresenceResult, error) {
	return hostPresenceResult{Outcome: hostPresenceUnavailable}, nil
}
