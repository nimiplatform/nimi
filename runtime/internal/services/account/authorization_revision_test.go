package account

import (
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/reflect/protoreflect"
)

func authorizationRevisionForTest(snapshot *runtimev1.AccountSessionSnapshot) string {
	field := snapshot.ProtoReflect().Descriptor().Fields().ByName("authorization_revision")
	if field == nil {
		return ""
	}
	return snapshot.ProtoReflect().Get(field).String()
}

func revisionAccountForTest(now *time.Time) *Service {
	return &Service{now: func() time.Time { return *now }, eventRetention: 16, subscribers: make(map[uint64]subscriber)}
}

func installRevisionAccountForTest(t *testing.T, service *Service, accountID, realmID string, expires time.Time) {
	t.Helper()
	service.mu.Lock()
	defer service.mu.Unlock()
	if !service.installAuthenticatedRuntimeIdentityLocked(AccountMaterial{AccountID: accountID, RealmEnvironmentID: realmID, AccessTokenExpires: expires}) {
		t.Fatal("owner identity installation failed")
	}
	service.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED
}

func requireAuthorizationRevisionForTest(t *testing.T, snapshot *runtimev1.AccountSessionSnapshot) string {
	t.Helper()
	revision := authorizationRevisionForTest(snapshot)
	if revision == "" || len([]byte(revision)) > 64 || strings.TrimSpace(revision) != revision || strings.ContainsRune(revision, '\x00') {
		t.Fatal("live Account snapshot lacks its bounded exact authorization revision")
	}
	return revision
}

func TestAccountAuthorizationRevisionWireField(t *testing.T) {
	field := (&runtimev1.AccountSessionSnapshot{}).ProtoReflect().Descriptor().Fields().ByName("authorization_revision")
	if field == nil || field.Number() != 7 || field.Kind() != protoreflect.StringKind {
		t.Fatal("AccountSessionSnapshot must carry string authorization_revision at field 7")
	}
}

func TestAccountAuthorizationRevisionPreservesUnexpiredRefreshAndEvents(t *testing.T) {
	now := time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)
	service := revisionAccountForTest(&now)
	installRevisionAccountForTest(t, service, "account-a", "realm-a", now.Add(time.Hour))
	before := requireAuthorizationRevisionForTest(t, service.currentSnapshotLocked())
	generation, fence := service.accountGeneration, service.accountGenerationInvalidated
	service.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING
	started := service.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_STARTED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED)
	if requireAuthorizationRevisionForTest(t, started.GetSnapshot()) != before {
		t.Fatal("routine refresh start replaced the authorization revision")
	}
	installRevisionAccountForTest(t, service, "account-a", "realm-a", now.Add(2*time.Hour))
	completed := service.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_COMPLETED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED)
	if requireAuthorizationRevisionForTest(t, completed.GetSnapshot()) != before || requireAuthorizationRevisionForTest(t, service.snapshotEventLocked(false).GetSnapshot()) != before {
		t.Fatal("routine refresh completion or status snapshot replaced the revision")
	}
	if service.accountGeneration != generation || service.accountGenerationInvalidated != fence {
		t.Fatal("revision projection changed the existing authorization generation or fence")
	}
	select {
	case <-fence:
		t.Fatal("routine refresh invalidated protected work")
	default:
	}
	replay, snapshot, subscription := service.subscribe(&runtimev1.SubscribeAccountSessionEventsRequest{AfterSequence: started.GetSequence()})
	defer service.removeSubscriber(subscription.id)
	if len(replay) != 1 || requireAuthorizationRevisionForTest(t, replay[0].GetSnapshot()) != before || requireAuthorizationRevisionForTest(t, snapshot.GetSnapshot()) != before {
		t.Fatal("event replay or subscription snapshot lost the owner revision")
	}
	if authorizationRevisionForTest(service.rejectedAccountSessionEvent(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE).GetSnapshot()) != "" {
		t.Fatal("rejected account event exposed privileged continuity metadata")
	}
}

func TestAccountAuthorizationRevisionExpiresAndChangesAfterUnobservedGap(t *testing.T) {
	for _, observeExpiry := range []bool{false, true} {
		now := time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)
		service := revisionAccountForTest(&now)
		installRevisionAccountForTest(t, service, "account-a", "realm-a", now.Add(time.Minute))
		before := requireAuthorizationRevisionForTest(t, service.currentSnapshotLocked())
		generation, fence := service.accountGeneration, service.accountGenerationInvalidated
		service.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING
		now = now.Add(2 * time.Minute)
		if observeExpiry {
			if authorizationRevisionForTest(service.currentSnapshotLocked()) != "" {
				t.Fatal("expired pending authorization exposed a live revision")
			}
			if service.accountGeneration != generation || service.accountGenerationInvalidated != fence {
				t.Fatal("read-only revision projection mutated the authorization fence")
			}
		}
		installRevisionAccountForTest(t, service, "account-a", "realm-a", now.Add(time.Hour))
		if requireAuthorizationRevisionForTest(t, service.currentSnapshotLocked()) == before {
			t.Fatal("replacement retained an expired authorization revision")
		}
		select {
		case <-fence:
		default:
			t.Fatal("existing expiry fence was not closed on replacement")
		}
	}
}

func TestAccountAuthorizationRevisionDoesNotSurviveIdentityOrRuntimeReplacement(t *testing.T) {
	now := time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)
	service := revisionAccountForTest(&now)
	installRevisionAccountForTest(t, service, "account-a", "realm-a", now.Add(time.Hour))
	before := requireAuthorizationRevisionForTest(t, service.currentSnapshotLocked())
	restarted := revisionAccountForTest(&now)
	installRevisionAccountForTest(t, restarted, "account-a", "realm-a", now.Add(time.Hour))
	if restarted.accountGeneration != service.accountGeneration || requireAuthorizationRevisionForTest(t, restarted.currentSnapshotLocked()) == before {
		t.Fatal("equal numeric generations across Runtime instances must have different public revisions")
	}
	installRevisionAccountForTest(t, service, "account-b", "realm-a", now.Add(time.Hour))
	accountChanged := requireAuthorizationRevisionForTest(t, service.currentSnapshotLocked())
	if accountChanged == before {
		t.Fatal("account replacement retained the authorization revision")
	}
	installRevisionAccountForTest(t, service, "account-b", "realm-b", now.Add(time.Hour))
	if requireAuthorizationRevisionForTest(t, service.currentSnapshotLocked()) == accountChanged {
		t.Fatal("Realm replacement retained the authorization revision")
	}
}

func TestAccountAuthorizationRevisionIsEmptyWithoutLiveAuthorization(t *testing.T) {
	now := time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)
	service := revisionAccountForTest(&now)
	service.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING
	service.projection = &runtimev1.AccountProjection{AccountId: "account-a", RealmEnvironmentId: "realm-a"}
	if authorizationRevisionForTest(service.currentSnapshotLocked()) != "" {
		t.Fatal("initial pending display projection became authorization")
	}
	installRevisionAccountForTest(t, service, "account-a", "realm-a", now.Add(time.Minute))
	requireAuthorizationRevisionForTest(t, service.currentSnapshotLocked())
	generation, fence := service.accountGeneration, service.accountGenerationInvalidated
	now = now.Add(2 * time.Minute)
	if snapshot := service.currentSnapshotLocked(); snapshot.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED || authorizationRevisionForTest(snapshot) != "" {
		t.Fatal("clock-expired authenticated state projected live authorization")
	}
	if service.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED || service.accountGeneration != generation || service.accountGenerationInvalidated != fence {
		t.Fatal("status projection changed the underlying state machine")
	}
	service.clearAuthenticatedRuntimeIdentityLocked()
	service.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED
	if authorizationRevisionForTest(service.currentSnapshotLocked()) != "" {
		t.Fatal("invalidated authorization retained a revision")
	}
}
