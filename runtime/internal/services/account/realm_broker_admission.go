package account

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const realmBrokerProtectedDesktopSourceReadinessProfile = "protected_desktop_source_readiness"

func (operation realmUnaryOperation) admitsCallerMode(mode runtimev1.AccountCallerMode) bool {
	_, ok := operation.allowedCallerModes[mode]
	return ok
}

func (operation realmUnaryOperation) admitsProtectedDesktopSourceReadinessCaller(caller *runtimev1.AccountCaller) bool {
	return caller != nil &&
		operation.authorizationProfile == realmBrokerProtectedDesktopSourceReadinessProfile &&
		caller.GetMode() == runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL &&
		operation.admitsCallerMode(caller.GetMode())
}
