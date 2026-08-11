package localservice

import (
	"errors"

	"github.com/nimiplatform/nimi/runtime/internal/filedownload"
)

// localEnvironmentDependencyJobFailureKind is an execution-only
// classification. Terminal reason/recovery fields remain the persisted and
// projected contract; human failure detail never determines this value.
type localEnvironmentDependencyJobFailureKind uint8

const (
	localEnvironmentDependencyJobFailureUnspecified localEnvironmentDependencyJobFailureKind = iota
	localEnvironmentDependencyJobFailureTransientInitialNetworkTransfer
)

func localEnvironmentDependencyJobFailureKindFromError(err error) localEnvironmentDependencyJobFailureKind {
	if errors.Is(err, filedownload.ErrTransientAttemptsExhausted) {
		return localEnvironmentDependencyJobFailureTransientInitialNetworkTransfer
	}
	return localEnvironmentDependencyJobFailureUnspecified
}

func (kind localEnvironmentDependencyJobFailureKind) retryable() bool {
	return kind == localEnvironmentDependencyJobFailureTransientInitialNetworkTransfer
}

func (kind localEnvironmentDependencyJobFailureKind) reasonCode() string {
	if kind == localEnvironmentDependencyJobFailureTransientInitialNetworkTransfer {
		return "LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED"
	}
	return ""
}
