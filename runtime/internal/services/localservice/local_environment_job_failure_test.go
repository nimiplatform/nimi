package localservice

import (
	"errors"
	"fmt"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/filedownload"
)

func TestLocalEnvironmentDependencyJobFailureKindUsesTypedNetworkMarker(t *testing.T) {
	typed := fmt.Errorf("materializer download: %w", filedownload.ErrTransientAttemptsExhausted)
	kind := localEnvironmentDependencyJobFailureKindFromError(typed)
	if kind != localEnvironmentDependencyJobFailureTransientInitialNetworkTransfer || !kind.retryable() {
		t.Fatalf("typed transient initial transfer classified as kind=%v retryable=%t", kind, kind.retryable())
	}
}

func TestLocalEnvironmentDependencyJobFailureKindDoesNotParseDiagnosticText(t *testing.T) {
	for _, detail := range []string{
		"verify frozen sync: unexpected EOF",
		"verify import: context deadline exceeded",
		"verify Torch allocation: connection reset by peer",
	} {
		kind := localEnvironmentDependencyJobFailureKindFromError(errors.New(detail))
		if kind != localEnvironmentDependencyJobFailureUnspecified || kind.retryable() {
			t.Fatalf("diagnostic %q classified as kind=%v retryable=%t", detail, kind, kind.retryable())
		}
	}
}
