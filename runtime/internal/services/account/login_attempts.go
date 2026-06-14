package account

import "strings"

func loginAttemptMatchesRequest(attempt LoginAttempt, redirectURI string, callbackOrigin string) bool {
	return strings.TrimSpace(attempt.RedirectURI) == strings.TrimSpace(redirectURI) &&
		strings.TrimSpace(attempt.CallbackOrigin) == strings.TrimSpace(callbackOrigin)
}
