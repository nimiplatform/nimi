package apppermission

import (
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

func TestEvaluatePostureUsesOnlyActiveGrantTruth(t *testing.T) {
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	key := postureTestKey()
	grant := &localappkernel.PermissionGrant{Key: key, State: localappkernel.PermissionGrantStateGranted, Revision: 7}
	if got := EvaluatePosture(now, true, true, key, grant); got.Posture != PostureGranted || !got.Usable {
		t.Fatalf("active grant evaluation = %+v", got)
	}
	malformed := *grant
	malformed.State = localappkernel.PermissionGrantStateRevoked
	if got := EvaluatePosture(now, true, true, key, &malformed); got.Posture != PostureDenied || got.Usable || got.Reason != PostureReasonBindingInvalid {
		t.Fatalf("non-active row did not fail closed = %+v", got)
	}
	if got := EvaluatePosture(now, true, true, key, nil); got.Posture != PosturePrompt || got.Usable {
		t.Fatalf("missing owner decision = %+v", got)
	}
	if got := EvaluatePosture(now, false, true, key, nil); got.Posture != PostureUnavailable {
		t.Fatalf("reserved permission = %+v", got)
	}
}

func TestEvaluatePostureFailsClosedAcrossAccountAnchorAndExpiryChanges(t *testing.T) {
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	key := postureTestKey()
	expiresAt := now.Add(time.Minute)
	grant := &localappkernel.PermissionGrant{
		Key: key, State: localappkernel.PermissionGrantStateGranted, Revision: 2, ExpiresAt: &expiresAt,
	}
	if got := EvaluatePosture(now, true, true, key, grant); !got.Usable {
		t.Fatalf("current grant denied: %+v", got)
	}
	accountChanged := key
	accountChanged.AccountID = "account-two"
	if got := EvaluatePosture(now, true, true, accountChanged, grant); got.Posture != PostureDenied || got.Usable || got.Reason != PostureReasonBindingInvalid {
		t.Fatalf("account-switched grant = %+v", got)
	}
	anchorChanged := key
	anchorChanged.LocalOSUserAnchor = "loua_v1_other"
	if got := EvaluatePosture(now, true, true, anchorChanged, grant); got.Posture != PostureDenied || got.Usable || got.Reason != PostureReasonBindingInvalid {
		t.Fatalf("OS-user-switched grant = %+v", got)
	}
	if got := EvaluatePosture(expiresAt, true, true, key, grant); got.Posture != PostureDenied || got.Usable || got.Reason != PostureReasonGrantExpired {
		t.Fatalf("expired grant = %+v", got)
	}
}

func postureTestKey() localappkernel.PermissionGrantKey {
	return localappkernel.PermissionGrantKey{
		LocalOSUserAnchor: "loua_v1_one", AccountID: "account-one", LocalAppPrincipalID: "lap_v1_one",
		PermissionID: "agents.interact", OwnerSelectorDigest: "selector-digest-one",
	}
}
