package protectedlocal

import (
	"errors"
	"fmt"
)

// WindowsPipeFailureStage is a credential-free projection of the native
// Desktop endpoint construction step that failed. It never exposes a SID,
// session identifier, endpoint name, token detail, or native error text.
type WindowsPipeFailureStage uint32

const WindowsPipeStartupExitCodeBase uint32 = 0xAA00

const (
	WindowsPipeStageContext WindowsPipeFailureStage = iota + 1
	WindowsPipeStagePrincipalCapability
	WindowsPipeStageProcessCapability
	WindowsPipeStageProcessBinding
	WindowsPipeStageActiveSession
	WindowsPipeStageActiveToken
	WindowsPipeStageDesktopUser
	WindowsPipeStageDesktopSession
	WindowsPipeStageDesktopTokenType
	WindowsPipeStageDesktopGroups
	WindowsPipeStageDesktopInteractiveGroup
	WindowsPipeStageDesktopLogonSID
	WindowsPipeStageDesktopLogonLUID
	WindowsPipeStageDesktopIdentity
	WindowsPipeStageEndpointName
	WindowsPipeStageDescriptorSID
	WindowsPipeStageDescriptorBuild
	WindowsPipeStageEndpointEncode
	WindowsPipeStageCreate
	WindowsPipeStageACLRead
	WindowsPipeStageACLControl
	WindowsPipeStageACLEntries
	WindowsPipeStageACLServiceACE
	WindowsPipeStageACLClientACE
	WindowsPipeStageACLPrincipals
	WindowsPipeStageActiveTokenPrivilege
	WindowsPipeStageActiveTokenAccess
	WindowsPipeStageCreateAccess
	WindowsPipeStageCreateConflict
	WindowsPipeStageCreateInvalidParameter
	WindowsPipeStageACLReadAccess
	WindowsPipeStageActiveSessionInfo
	WindowsPipeStageActiveAccountSID
	WindowsPipeStageActiveSessionMarker
	WindowsPipeStageActiveSessionInfoAccess
	WindowsPipeStageActiveLogonData
	WindowsPipeStageActiveLogonDataAccess
	WindowsPipeStageActiveLogonCorrelation
	WindowsPipeStageClientPID
	WindowsPipeStageClientProcessOpen
	WindowsPipeStageClientTokenOpen
	WindowsPipeStageClientLiveness
)

type windowsPipeStageError struct {
	stage WindowsPipeFailureStage
	cause error
}

func (failure *windowsPipeStageError) Error() string { return failure.cause.Error() }
func (failure *windowsPipeStageError) Unwrap() error { return failure.cause }

func windowsPipeStageFailure(stage WindowsPipeFailureStage, cause error) error {
	if cause == nil {
		cause = errors.New("Windows protected Desktop endpoint operation failed")
	}
	return &windowsPipeStageError{stage: stage, cause: cause}
}

func WindowsPipeStageFromError(err error) (WindowsPipeFailureStage, bool) {
	var failure *windowsPipeStageError
	if !errors.As(err, &failure) || failure.stage < WindowsPipeStageContext || failure.stage > WindowsPipeStageClientLiveness {
		return 0, false
	}
	return failure.stage, true
}

func WindowsPipeStartupExitCode(err error) (uint32, bool) {
	stage, ok := WindowsPipeStageFromError(err)
	if !ok {
		return 0, false
	}
	return WindowsPipeStartupExitCodeBase + uint32(stage), true
}

func windowsPipeFailure(operation string, cause error) error {
	if cause == nil {
		cause = fmt.Errorf("required Windows named-pipe primitive unavailable")
	}
	return fail(
		ReasonDesktopProcessVerificationUnavailable,
		true,
		"restart_desktop",
		fmt.Errorf("%s: %w", operation, cause),
	)
}
