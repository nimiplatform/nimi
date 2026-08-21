package account

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const realmBrokerProtectedDesktopSourceReadinessProfile = "protected_desktop_source_readiness"
const realmBrokerProtectedDesktopProductProfile = "protected_desktop_product"
const realmBrokerProtectedDesktopSensitiveProfile = "protected_desktop_sensitive"
const realmBrokerProtectedDesktopCommerceProfile = "protected_desktop_commerce"
const realmBrokerProtectedBundledAvatarSourceReadinessProfile = "protected_bundled_avatar_source_readiness"
const realmBrokerProtectedLocalAppWorldCoreProfile = "protected_local_app_world_core"
const realmBrokerProtectedLocalAppPersonaCharacterOwnerProfile = "protected_local_app_persona_character_owner"

func (operation realmUnaryOperation) admitsCallerMode(mode runtimev1.AccountCallerMode) bool {
	_, ok := operation.allowedCallerModes[mode]
	return ok
}

func (operation realmUnaryOperation) admitsProtectedDesktopCaller(caller *runtimev1.AccountCaller) bool {
	if caller == nil || !operation.admitsCallerMode(caller.GetMode()) {
		return false
	}
	switch caller.GetMode() {
	case runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL:
		return operation.authorizationProfile == realmBrokerProtectedDesktopSourceReadinessProfile ||
			operation.authorizationProfile == realmBrokerProtectedDesktopProductProfile ||
			operation.authorizationProfile == realmBrokerProtectedDesktopSensitiveProfile ||
			operation.authorizationProfile == realmBrokerProtectedDesktopCommerceProfile ||
			operation.authorizationProfile == realmBrokerProtectedBundledAvatarSourceReadinessProfile ||
			operation.authorizationProfile == realmBrokerProtectedLocalAppPersonaCharacterOwnerProfile
	case runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_AVATAR_NATIVE_HOST:
		return operation.authorizationProfile == realmBrokerProtectedBundledAvatarSourceReadinessProfile ||
			operation.authorizationProfile == realmBrokerProtectedLocalAppPersonaCharacterOwnerProfile
	default:
		return false
	}
}

func (operation realmUnaryOperation) admitsProtectedLocalAppCaller() bool {
	return operation.admitsCallerMode(runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_APP) &&
		(operation.authorizationProfile == realmBrokerProtectedLocalAppWorldCoreProfile ||
			operation.authorizationProfile == realmBrokerProtectedLocalAppPersonaCharacterOwnerProfile)
}
