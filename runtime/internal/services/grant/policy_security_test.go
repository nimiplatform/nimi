package grant

import (
	"io"
	"log/slog"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grantlifecycle"
)

func TestValidateProtectedCapabilityIdentityReturnsRuntimeOwnedSubject(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.tokens["token-1"] = tokenRecord{
		TokenID:            "token-1",
		AppID:              "nimi.zhiyu",
		SubjectUserID:      "user-001",
		IssuedScopeCatalog: "sdk-v2",
		Scopes:             []string{"runtime.agent.write"},
		LifecycleState:     grantlifecycle.GrantStateGranted,
		IssuedAt:           time.Now().UTC().Add(-time.Minute),
		ExpiresAt:          time.Now().UTC().Add(time.Hour),
		Secret:             "secret-1",
	}

	reason, _, subjectUserID, ok := svc.ValidateProtectedCapabilityIdentity(
		"nimi.zhiyu",
		"token-1",
		"secret-1",
		"runtime.agent.write",
	)
	if !ok || reason != runtimev1.ReasonCode_ACTION_EXECUTED || subjectUserID != "user-001" {
		t.Fatalf("protected identity = reason %v subject %q ok %v", reason, subjectUserID, ok)
	}
}
