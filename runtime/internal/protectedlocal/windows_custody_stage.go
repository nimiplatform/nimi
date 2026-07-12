package protectedlocal

import "errors"

// WindowsCustodyFailureStage is a credential-free projection of the exact
// native custody operation that failed. It never contains a secret name,
// state path, SID, descriptor payload, or native error text.
type WindowsCustodyFailureStage uint32

const WindowsCustodyStartupExitCodeBase uint32 = 0xA900

const (
	WindowsCustodyStageSecretName WindowsCustodyFailureStage = iota + 1
	WindowsCustodyStageStoreCapability
	WindowsCustodyStageStateRoot
	WindowsCustodyStageReadOpen
	WindowsCustodyStageReadIdentity
	WindowsCustodyStageReadACL
	WindowsCustodyStageReadWrapper
	WindowsCustodyStageRead
	WindowsCustodyStageReadClose
	WindowsCustodyStageDecode
	WindowsCustodyStageDescriptorInspect
	WindowsCustodyStageUnprotect
	WindowsCustodyStagePlaintext
	WindowsCustodyStageProtectInput
	WindowsCustodyStageDescriptorEncode
	WindowsCustodyStageDescriptorCreate
	WindowsCustodyStageProtect
	WindowsCustodyStageTemporaryName
	WindowsCustodyStageTemporaryCreate
	WindowsCustodyStageTemporaryACL
	WindowsCustodyStageTemporaryWrapper
	WindowsCustodyStageTemporaryWrite
	WindowsCustodyStageTemporaryFlush
	WindowsCustodyStageTemporaryClose
	WindowsCustodyStageTemporaryPath
	WindowsCustodyStageDestinationPath
	WindowsCustodyStageAtomicReplace
	WindowsCustodyStageStoredReopen
	WindowsCustodyStageStoredIdentity
	WindowsCustodyStageStoredACL
	WindowsCustodyStageDeleteOpen
	WindowsCustodyStageDeleteACL
	WindowsCustodyStageDeleteClose
	WindowsCustodyStageDelete
)

type windowsCustodyStageError struct {
	stage WindowsCustodyFailureStage
	cause error
}

func (failure *windowsCustodyStageError) Error() string { return failure.cause.Error() }
func (failure *windowsCustodyStageError) Unwrap() error { return failure.cause }

func windowsCustodyStageFailure(stage WindowsCustodyFailureStage, cause error) error {
	if cause == nil {
		cause = errors.New("Windows protected custody operation failed")
	}
	return &windowsCustodyStageError{stage: stage, cause: cause}
}

func WindowsCustodyStageFromError(err error) (WindowsCustodyFailureStage, bool) {
	var failure *windowsCustodyStageError
	if !errors.As(err, &failure) || failure.stage < WindowsCustodyStageSecretName || failure.stage > WindowsCustodyStageDelete {
		return 0, false
	}
	return failure.stage, true
}

func WindowsCustodyStartupExitCode(err error) (uint32, bool) {
	stage, ok := WindowsCustodyStageFromError(err)
	if !ok {
		return 0, false
	}
	return WindowsCustodyStartupExitCodeBase + uint32(stage), true
}
