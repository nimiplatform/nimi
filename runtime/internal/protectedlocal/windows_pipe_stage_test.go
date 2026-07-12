package protectedlocal

import (
	"errors"
	"testing"
)

func TestWindowsPipeStartupExitCodesAreStableUniqueAndPreserveReasons(t *testing.T) {
	stages := []WindowsPipeFailureStage{
		WindowsPipeStageContext,
		WindowsPipeStagePrincipalCapability,
		WindowsPipeStageProcessCapability,
		WindowsPipeStageProcessBinding,
		WindowsPipeStageActiveSession,
		WindowsPipeStageActiveToken,
		WindowsPipeStageDesktopUser,
		WindowsPipeStageDesktopSession,
		WindowsPipeStageDesktopTokenType,
		WindowsPipeStageDesktopGroups,
		WindowsPipeStageDesktopInteractiveGroup,
		WindowsPipeStageDesktopLogonSID,
		WindowsPipeStageDesktopLogonLUID,
		WindowsPipeStageDesktopIdentity,
		WindowsPipeStageEndpointName,
		WindowsPipeStageDescriptorSID,
		WindowsPipeStageDescriptorBuild,
		WindowsPipeStageEndpointEncode,
		WindowsPipeStageCreate,
		WindowsPipeStageACLRead,
		WindowsPipeStageACLControl,
		WindowsPipeStageACLEntries,
		WindowsPipeStageACLServiceACE,
		WindowsPipeStageACLClientACE,
		WindowsPipeStageACLPrincipals,
		WindowsPipeStageActiveTokenPrivilege,
		WindowsPipeStageActiveTokenAccess,
		WindowsPipeStageCreateAccess,
		WindowsPipeStageCreateConflict,
		WindowsPipeStageCreateInvalidParameter,
		WindowsPipeStageACLReadAccess,
		WindowsPipeStageActiveSessionInfo,
		WindowsPipeStageActiveAccountSID,
		WindowsPipeStageActiveSessionMarker,
		WindowsPipeStageActiveSessionInfoAccess,
		WindowsPipeStageActiveLogonData,
		WindowsPipeStageActiveLogonDataAccess,
		WindowsPipeStageActiveLogonCorrelation,
		WindowsPipeStageClientPID,
		WindowsPipeStageClientProcessOpen,
		WindowsPipeStageClientTokenOpen,
		WindowsPipeStageClientLiveness,
	}
	seen := make(map[uint32]struct{}, len(stages))
	for _, stage := range stages {
		err := windowsPipeStageFailure(stage, windowsPipeFailure("private operation", errors.New("private detail")))
		projected, ok := WindowsPipeStageFromError(err)
		if !ok || projected != stage {
			t.Fatalf("pipe stage = (%v, %v), want %v", projected, ok, stage)
		}
		code, ok := WindowsPipeStartupExitCode(err)
		if !ok || code != WindowsPipeStartupExitCodeBase+uint32(stage) {
			t.Fatalf("pipe exit code = (%x, %v), want %x", code, ok, WindowsPipeStartupExitCodeBase+uint32(stage))
		}
		if _, exists := seen[code]; exists {
			t.Fatalf("duplicate pipe exit code %x", code)
		}
		seen[code] = struct{}{}
		if !IsReason(err, ReasonDesktopProcessVerificationUnavailable) {
			t.Fatalf("pipe stage hid typed reason: %v", err)
		}
	}
}

func TestWindowsPipeStageSurvivesSecurityStateWrapping(t *testing.T) {
	err := windowsSecurityStateStageFailure(
		WindowsSecurityStateStageDesktopPipeOpen,
		windowsPipeStageFailure(WindowsPipeStageCreate, errors.New("private failure")),
	)
	code, ok := WindowsPipeStartupExitCode(err)
	if !ok || code != WindowsPipeStartupExitCodeBase+uint32(WindowsPipeStageCreate) {
		t.Fatalf("wrapped pipe exit code = (%x, %v)", code, ok)
	}
}
