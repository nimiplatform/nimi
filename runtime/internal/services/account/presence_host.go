package account

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type hostPresenceOutcome int

const (
	hostPresenceUnavailable hostPresenceOutcome = iota
	hostPresenceRejected
	hostPresenceVerified
)

type hostPresenceRequest struct {
	AccountID       string
	DisplayName     string
	Purpose         string
	BrowserLauncher presenceBrowserLauncher
}

type hostPresenceResult struct {
	Outcome hostPresenceOutcome
	Method  runtimev1.PresenceVerificationMethod
}

type hostPresenceProvider interface {
	RequestHostPresence(ctx context.Context, request hostPresenceRequest) (hostPresenceResult, error)
}

type hostPresenceVerifier struct {
	providers []hostPresenceProvider
}

func newHostPresenceVerifier(providers ...hostPresenceProvider) PresenceVerifier {
	if len(providers) == 0 {
		providers = append(providers, newPlatformHostPresenceProvider())
	}
	return hostPresenceVerifier{providers: compactHostPresenceProviders(providers)}
}

func (h hostPresenceVerifier) RequestPresenceVerification(ctx context.Context, request PresenceVerificationRequest) (PresenceVerification, error) {
	if len(h.providers) == 0 ||
		strings.TrimSpace(request.Account.AccountID) == "" ||
		strings.TrimSpace(request.Purpose) == "" ||
		request.RequestedTTL <= 0 {
		return PresenceVerification{}, ErrPresenceVerificationUnavailable
	}
	hostRequest := hostPresenceRequest{
		AccountID:       strings.TrimSpace(request.Account.AccountID),
		DisplayName:     strings.TrimSpace(request.Account.DisplayName),
		Purpose:         strings.TrimSpace(request.Purpose),
		BrowserLauncher: presenceBrowserLauncherFromContext(ctx),
	}

	for _, provider := range h.providers {
		result, err := provider.RequestHostPresence(ctx, hostRequest)
		if err != nil && result.Outcome != hostPresenceUnavailable {
			return PresenceVerification{}, ErrPresenceVerificationUnavailable
		}
		method := result.Method
		if method == runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_UNSPECIFIED {
			method = runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_OS_CREDENTIAL
		}
		switch result.Outcome {
		case hostPresenceVerified:
			now := request.Now.UTC()
			if now.IsZero() {
				now = time.Now().UTC()
			}
			return PresenceVerification{
				State:         runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_VERIFIED,
				Method:        method,
				VerifiedUntil: now.Add(request.RequestedTTL),
			}, nil
		case hostPresenceRejected:
			return PresenceVerification{
				State:  runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_REJECTED,
				Method: method,
			}, nil
		case hostPresenceUnavailable:
			continue
		default:
			return PresenceVerification{}, ErrPresenceVerificationUnavailable
		}
	}

	return PresenceVerification{}, ErrPresenceVerificationUnavailable
}

func compactHostPresenceProviders(in []hostPresenceProvider) []hostPresenceProvider {
	out := make([]hostPresenceProvider, 0, len(in))
	for _, provider := range in {
		if provider != nil {
			out = append(out, provider)
		}
	}
	return out
}
