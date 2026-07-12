package protectedlocal

import (
	"errors"
	"testing"
)

func TestWindowsCustodyStartupExitCodesAreStableUniqueAndPreserveCauses(t *testing.T) {
	stages := []WindowsCustodyFailureStage{
		WindowsCustodyStageSecretName,
		WindowsCustodyStageStoreCapability,
		WindowsCustodyStageStateRoot,
		WindowsCustodyStageReadOpen,
		WindowsCustodyStageReadIdentity,
		WindowsCustodyStageReadACL,
		WindowsCustodyStageReadWrapper,
		WindowsCustodyStageRead,
		WindowsCustodyStageReadClose,
		WindowsCustodyStageDecode,
		WindowsCustodyStageDescriptorInspect,
		WindowsCustodyStageUnprotect,
		WindowsCustodyStagePlaintext,
		WindowsCustodyStageProtectInput,
		WindowsCustodyStageDescriptorEncode,
		WindowsCustodyStageDescriptorCreate,
		WindowsCustodyStageProtect,
		WindowsCustodyStageTemporaryName,
		WindowsCustodyStageTemporaryCreate,
		WindowsCustodyStageTemporaryACL,
		WindowsCustodyStageTemporaryWrapper,
		WindowsCustodyStageTemporaryWrite,
		WindowsCustodyStageTemporaryFlush,
		WindowsCustodyStageTemporaryClose,
		WindowsCustodyStageTemporaryPath,
		WindowsCustodyStageDestinationPath,
		WindowsCustodyStageAtomicReplace,
		WindowsCustodyStageStoredReopen,
		WindowsCustodyStageStoredIdentity,
		WindowsCustodyStageStoredACL,
		WindowsCustodyStageDeleteOpen,
		WindowsCustodyStageDeleteACL,
		WindowsCustodyStageDeleteClose,
		WindowsCustodyStageDelete,
	}
	seen := make(map[uint32]struct{}, len(stages))
	for _, stage := range stages {
		err := windowsCustodyStageFailure(stage, ErrProtectedSecretNotFound)
		projected, ok := WindowsCustodyStageFromError(err)
		if !ok || projected != stage {
			t.Fatalf("custody stage = (%v, %v), want %v", projected, ok, stage)
		}
		code, ok := WindowsCustodyStartupExitCode(err)
		if !ok || code != WindowsCustodyStartupExitCodeBase+uint32(stage) {
			t.Fatalf("custody exit code = (%x, %v), want %x", code, ok, WindowsCustodyStartupExitCodeBase+uint32(stage))
		}
		if _, exists := seen[code]; exists {
			t.Fatalf("duplicate custody exit code %x", code)
		}
		seen[code] = struct{}{}
		if !errors.Is(err, ErrProtectedSecretNotFound) {
			t.Fatal("custody stage wrapper hid the not-found sentinel")
		}
	}
}

func TestWindowsCustodyStageWrapperPreservesTypedFailureReason(t *testing.T) {
	err := windowsCustodyStageFailure(
		WindowsCustodyStageProtect,
		fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", errors.New("private failure")),
	)
	if !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
		t.Fatalf("typed custody reason lost: %v", err)
	}
}

func TestWindowsCustodyStageSurvivesSecurityStateWrapping(t *testing.T) {
	err := windowsSecurityStateStageFailure(
		WindowsSecurityStateStageRecordMACKey,
		windowsCustodyStageFailure(WindowsCustodyStageProtect, errors.New("private failure")),
	)
	code, ok := WindowsCustodyStartupExitCode(err)
	if !ok || code != WindowsCustodyStartupExitCodeBase+uint32(WindowsCustodyStageProtect) {
		t.Fatalf("wrapped custody exit code = (%x, %v)", code, ok)
	}
}
