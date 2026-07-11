package app

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistrycatalog"
	"github.com/nimiplatform/nimi/runtime/internal/appreleasecatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

const (
	lifecycleIntentTestAppID      = "com.nimi.intenttest"
	lifecycleIntentTestReleaseRef = "release.intent.v1"
)

var lifecycleIntentTestArtifact = strings.Repeat("ab", protectedlocal.IdentifierBytes)

func TestPrepareAndReadAppLifecycleIntentUsesAnchoredRuntimeTargets(t *testing.T) {
	fixture := newLifecycleIntentHandlerFixture(t)
	request := &runtimev1.PrepareAppLifecycleIntentRequest{
		Action:                 runtimev1.AppLifecycleIntentAction_APP_LIFECYCLE_INTENT_ACTION_INSTALL,
		AppId:                  lifecycleIntentTestAppID,
		ExpectedReleaseRef:     lifecycleIntentTestReleaseRef,
		ExpectedArtifactDigest: lifecycleIntentTestArtifact,
	}
	response, err := fixture.service.PrepareAppLifecycleIntent(fixture.context, request)
	if err != nil {
		t.Fatalf("PrepareAppLifecycleIntent: %v", err)
	}
	if response.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED || len(response.GetIntentId()) != protectedlocal.IdentifierBytes*2 || response.GetDeadline() == nil {
		t.Fatalf("prepare response = %+v", response)
	}
	impact := response.GetCanonicalImpact()
	if impact.GetSchemaVersion() != lifecycleCanonicalImpactSchemaVersion || impact.GetDisplayContractVersion() != lifecycleDisplayContractVersion ||
		impact.GetAction() != request.GetAction() || impact.GetAppId() != lifecycleIntentTestAppID || impact.GetAccountGeneration() != 7 ||
		impact.GetReleaseRef() != lifecycleIntentTestReleaseRef || impact.GetArtifactDigest() != lifecycleIntentTestArtifact || impact.GetAdoptionGeneration() != 0 {
		t.Fatalf("canonical impact = %+v", impact)
	}
	canonical, err := canonicalLifecycleImpactJSON(impact)
	if err != nil {
		t.Fatalf("canonicalize impact: %v", err)
	}
	wantCanonical := `{"account_generation":7,"action":"INSTALL","adoption_generation":0,"app_id":"com.nimi.intenttest","artifact_digest":"` + lifecycleIntentTestArtifact + `","destructive_options":{"delete_durable_data":false,"health_repair_action":0,"target_job_id":""},"display_contract_version":1,"impact_flags":[],"release_ref":"release.intent.v1","schema_version":1}`
	if canonical != wantCanonical {
		t.Fatalf("canonical impact JSON\n got: %s\nwant: %s", canonical, wantCanonical)
	}
	digest := sha256.Sum256([]byte(wantCanonical))
	if response.GetCanonicalImpactDigest() != hex.EncodeToString(digest[:]) {
		t.Fatalf("canonical digest = %q, want %q", response.GetCanonicalImpactDigest(), hex.EncodeToString(digest[:]))
	}

	statusResponse, err := fixture.service.GetAppLifecycleIntentStatus(fixture.context, &runtimev1.GetAppLifecycleIntentStatusRequest{IntentId: response.GetIntentId()})
	if err != nil {
		t.Fatalf("GetAppLifecycleIntentStatus: %v", err)
	}
	if statusResponse.GetIntentId() != response.GetIntentId() || statusResponse.GetStatus() != runtimev1.AppLifecycleIntentStatus_APP_LIFECYCLE_INTENT_STATUS_PREPARED || statusResponse.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("status response = %+v", statusResponse)
	}

	fixture.account.setGeneration(8)
	_, err = fixture.service.GetAppLifecycleIntentStatus(fixture.context, &runtimev1.GetAppLifecycleIntentStatusRequest{IntentId: response.GetIntentId()})
	assertLifecycleIntentReason(t, err, runtimev1.ReasonCode_LIFECYCLE_INTENT_MISMATCH)
}

func TestPrepareAppLifecycleIntentFailsClosedOnCallerSelectedOrUnavailableTargets(t *testing.T) {
	fixture := newLifecycleIntentHandlerFixture(t)

	_, err := fixture.service.PrepareAppLifecycleIntent(fixture.context, &runtimev1.PrepareAppLifecycleIntentRequest{
		Action:                 runtimev1.AppLifecycleIntentAction_APP_LIFECYCLE_INTENT_ACTION_INSTALL,
		AppId:                  lifecycleIntentTestAppID,
		ExpectedReleaseRef:     lifecycleIntentTestReleaseRef,
		ExpectedArtifactDigest: strings.Repeat("cd", protectedlocal.IdentifierBytes),
	})
	assertLifecycleIntentReason(t, err, runtimev1.ReasonCode_LIFECYCLE_CHALLENGE_MISMATCH)

	_, err = fixture.service.PrepareAppLifecycleIntent(fixture.context, &runtimev1.PrepareAppLifecycleIntentRequest{
		Action:                     runtimev1.AppLifecycleIntentAction_APP_LIFECYCLE_INTENT_ACTION_ADOPT_LOCAL_APP,
		AppId:                      lifecycleIntentTestAppID,
		ExpectedArtifactDigest:     lifecycleIntentTestArtifact,
		ExpectedAdoptionGeneration: 0,
	})
	assertLifecycleIntentReason(t, err, runtimev1.ReasonCode_LIFECYCLE_CHALLENGE_MISMATCH)

	_, err = fixture.service.PrepareAppLifecycleIntent(context.Background(), &runtimev1.PrepareAppLifecycleIntentRequest{
		Action:                 runtimev1.AppLifecycleIntentAction_APP_LIFECYCLE_INTENT_ACTION_INSTALL,
		AppId:                  lifecycleIntentTestAppID,
		ExpectedReleaseRef:     lifecycleIntentTestReleaseRef,
		ExpectedArtifactDigest: lifecycleIntentTestArtifact,
	})
	assertLifecycleIntentReason(t, err, runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED)
}

func TestPrepareRemoveLocalAdoptionBindsDurableGenerationAndOptions(t *testing.T) {
	fixture := newLifecycleIntentHandlerFixture(t)
	root := t.TempDir()
	adopted, err := fixture.store.commitAdoption(localAppAdoptionRecord{
		AppID:              lifecycleIntentTestAppID,
		RootPath:           root,
		ManifestPath:       filepath.Join(root, "nimi.app.yaml"),
		DisplayName:        "Intent Test App",
		Version:            "1.0.0",
		EntryRef:           "dist/main.js",
		PermissionScopeRef: "account:account.session.read",
		StoragePolicyRef:   "nimi-data-app-roots",
	})
	if err != nil {
		t.Fatalf("seed local adoption: %v", err)
	}
	response, err := fixture.service.PrepareAppLifecycleIntent(fixture.context, &runtimev1.PrepareAppLifecycleIntentRequest{
		Action:                     runtimev1.AppLifecycleIntentAction_APP_LIFECYCLE_INTENT_ACTION_REMOVE_LOCAL_APP_ADOPTION,
		AppId:                      lifecycleIntentTestAppID,
		ExpectedAdoptionGeneration: adopted.Generation,
		DestructiveOptions: &runtimev1.AppLifecycleDestructiveOptions{
			DeleteDurableData: true,
		},
	})
	if err != nil {
		t.Fatalf("prepare remove local adoption: %v", err)
	}
	impact := response.GetCanonicalImpact()
	if impact.GetAdoptionGeneration() != adopted.Generation || !impact.GetDestructiveOptions().GetDeleteDurableData() || impact.GetReleaseRef() != "" || impact.GetArtifactDigest() != "" {
		t.Fatalf("remove-adoption impact = %+v", impact)
	}
	removed, err := fixture.store.remove(lifecycleIntentTestAppID)
	if err != nil {
		t.Fatalf("remove local adoption: %v", err)
	}
	_, err = fixture.service.PrepareAppLifecycleIntent(fixture.context, &runtimev1.PrepareAppLifecycleIntentRequest{
		Action:                     runtimev1.AppLifecycleIntentAction_APP_LIFECYCLE_INTENT_ACTION_REMOVE_LOCAL_APP_ADOPTION,
		AppId:                      lifecycleIntentTestAppID,
		ExpectedAdoptionGeneration: removed.Generation,
	})
	assertLifecycleIntentReason(t, err, runtimev1.ReasonCode_LIFECYCLE_CHALLENGE_MISMATCH)
}

func TestPrepareHealthRepairResolvesExactRecoverableJob(t *testing.T) {
	fixture := newLifecycleIntentHandlerFixture(t)
	job := fixture.service.installJobs.createJob(jobSpec{
		appID:         lifecycleIntentTestAppID,
		descriptorRef: lifecycleIntentTestReleaseRef,
		version:       "1.0.0",
		kind:          runtimev1.AppLifecycleJobKind_APP_LIFECYCLE_JOB_KIND_INSTALL,
	})
	failed := fixture.service.installJobs.markFailed(job.GetJobId(), runtimev1.ReasonCode_APP_INSTALL_INTERNAL, "synthetic non-product failure")
	if failed == nil || failed.GetState() != runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_FAILED {
		t.Fatalf("failed recoverable job = %+v", failed)
	}

	response, err := fixture.service.PrepareAppLifecycleIntent(fixture.context, &runtimev1.PrepareAppLifecycleIntentRequest{
		Action:                 runtimev1.AppLifecycleIntentAction_APP_LIFECYCLE_INTENT_ACTION_HEALTH_REPAIR,
		AppId:                  lifecycleIntentTestAppID,
		ExpectedReleaseRef:     lifecycleIntentTestReleaseRef,
		ExpectedArtifactDigest: lifecycleIntentTestArtifact,
		DestructiveOptions: &runtimev1.AppLifecycleDestructiveOptions{
			HealthRepairAction: runtimev1.AppHealthRepairAction_APP_HEALTH_REPAIR_ACTION_RETRY,
		},
	})
	if err != nil {
		t.Fatalf("prepare health-repair retry: %v", err)
	}
	if response.GetCanonicalImpact().GetDestructiveOptions().GetTargetJobId() != job.GetJobId() {
		t.Fatalf("resolved target job = %q, want %q", response.GetCanonicalImpact().GetDestructiveOptions().GetTargetJobId(), job.GetJobId())
	}
}

func TestConsumeLifecycleIntentForMutationIsSingleUseAndAccountBound(t *testing.T) {
	fixture := newLifecycleIntentHandlerFixture(t)
	prepare := func() *runtimev1.PrepareAppLifecycleIntentResponse {
		t.Helper()
		response, err := fixture.service.PrepareAppLifecycleIntent(fixture.context, &runtimev1.PrepareAppLifecycleIntentRequest{
			Action:                 runtimev1.AppLifecycleIntentAction_APP_LIFECYCLE_INTENT_ACTION_INSTALL,
			AppId:                  lifecycleIntentTestAppID,
			ExpectedReleaseRef:     lifecycleIntentTestReleaseRef,
			ExpectedArtifactDigest: lifecycleIntentTestArtifact,
		})
		if err != nil {
			t.Fatalf("prepare lifecycle intent: %v", err)
		}
		return response
	}
	consume := func(response *runtimev1.PrepareAppLifecycleIntentResponse) error {
		_, err := fixture.service.consumeLifecycleIntentForMutation(fixture.context, lifecycleIntentMutationRequest{
			action:                protectedlocal.LifecycleActionInstall,
			appID:                 lifecycleIntentTestAppID,
			intentID:              response.GetIntentId(),
			displayedImpactDigest: response.GetCanonicalImpactDigest(),
		})
		return err
	}

	first := prepare()
	if err := consume(first); err != nil {
		t.Fatalf("consume lifecycle intent: %v", err)
	}
	assertLifecycleIntentReason(t, consume(first), runtimev1.ReasonCode_LIFECYCLE_INTENT_REPLAY)

	_, err := fixture.service.consumeLifecycleIntentForMutation(fixture.context, lifecycleIntentMutationRequest{
		action: protectedlocal.LifecycleActionInstall,
		appID:  lifecycleIntentTestAppID,
	})
	assertLifecycleIntentReason(t, err, runtimev1.ReasonCode_LIFECYCLE_INTENT_REQUIRED)

	second := prepare()
	fixture.account.setGeneration(8)
	assertLifecycleIntentReason(t, consume(second), runtimev1.ReasonCode_LIFECYCLE_INTENT_MISMATCH)
}

func TestOpenAppRequiresAnchoredLifecycleIntentInProtectedService(t *testing.T) {
	fixture := newLifecycleIntentHandlerFixture(t)

	_, err := fixture.service.OpenApp(fixture.context, &runtimev1.OpenAppRequest{
		AppId: lifecycleIntentTestAppID,
		Scope: &runtimev1.AppOpenScopeRef{
			Kind:    appOpenScopeKind,
			OwnerId: lifecycleIntentTestAppID,
		},
	})
	assertLifecycleIntentReason(t, err, runtimev1.ReasonCode_LIFECYCLE_INTENT_REQUIRED)
}

func TestOpenAppConsumesAnchoredLifecycleIntentBeforeLaunch(t *testing.T) {
	fixture := newLifecycleIntentHandlerFixture(t)
	prepared, err := fixture.service.PrepareAppLifecycleIntent(fixture.context, &runtimev1.PrepareAppLifecycleIntentRequest{
		Action:                 runtimev1.AppLifecycleIntentAction_APP_LIFECYCLE_INTENT_ACTION_OPEN_APP,
		AppId:                  lifecycleIntentTestAppID,
		ExpectedReleaseRef:     lifecycleIntentTestReleaseRef,
		ExpectedArtifactDigest: lifecycleIntentTestArtifact,
	})
	if err != nil {
		t.Fatalf("PrepareAppLifecycleIntent: %v", err)
	}
	request := &runtimev1.OpenAppRequest{
		AppId: lifecycleIntentTestAppID,
		Scope: &runtimev1.AppOpenScopeRef{
			Kind:    appOpenScopeKind,
			OwnerId: lifecycleIntentTestAppID,
		},
		LifecycleIntentId:     prepared.GetIntentId(),
		DisplayedImpactDigest: prepared.GetCanonicalImpactDigest(),
	}
	if _, err := fixture.service.OpenApp(fixture.context, request); err != nil {
		t.Fatalf("OpenApp with anchored intent: %v", err)
	}
	_, err = fixture.service.OpenApp(fixture.context, request)
	assertLifecycleIntentReason(t, err, runtimev1.ReasonCode_LIFECYCLE_INTENT_REPLAY)
}

func TestRemoveLocalAdoptionAtGenerationFailsClosedOnChange(t *testing.T) {
	fixture := newLifecycleIntentHandlerFixture(t)
	root := t.TempDir()
	adopted, err := fixture.store.commitAdoption(localAppAdoptionRecord{
		AppID:              lifecycleIntentTestAppID,
		RootPath:           root,
		ManifestPath:       filepath.Join(root, "nimi.app.yaml"),
		DisplayName:        "Intent Test App",
		Version:            "1.0.0",
		EntryRef:           "dist/main.js",
		PermissionScopeRef: "account:account.session.read",
		StoragePolicyRef:   "nimi-data-app-roots",
	})
	if err != nil {
		t.Fatalf("seed local adoption: %v", err)
	}
	if _, err := fixture.store.removeAtGeneration(lifecycleIntentTestAppID, adopted.Generation+1); err == nil {
		t.Fatal("removeAtGeneration accepted a stale generation")
	}
	current, found, err := fixture.store.findAdopted(lifecycleIntentTestAppID)
	if err != nil || !found || current.Generation != adopted.Generation {
		t.Fatalf("adoption changed after rejected remove: row=%+v found=%v err=%v", current, found, err)
	}
	removed, err := fixture.store.removeAtGeneration(lifecycleIntentTestAppID, adopted.Generation)
	if err != nil || removed.State != "removed" || removed.Generation <= adopted.Generation {
		t.Fatalf("generation-bound remove = %+v, err=%v", removed, err)
	}
}

type lifecycleIntentTestAccount struct {
	mu         sync.RWMutex
	generation uint64
}

func (account *lifecycleIntentTestAccount) AuthenticatedRuntimeProjection(context.Context) (*runtimev1.AccountProjection, bool) {
	projection, _, ok := account.AuthenticatedRuntimeSecurityContext(context.Background())
	return projection, ok
}

func (account *lifecycleIntentTestAccount) AuthenticatedRuntimeSecurityContext(context.Context) (*runtimev1.AccountProjection, uint64, bool) {
	account.mu.RLock()
	defer account.mu.RUnlock()
	return &runtimev1.AccountProjection{AccountId: "account-intent", RealmEnvironmentId: "realm-intent"}, account.generation, account.generation != 0
}

func (account *lifecycleIntentTestAccount) setGeneration(generation uint64) {
	account.mu.Lock()
	account.generation = generation
	account.mu.Unlock()
}

type lifecycleIntentHandlerFixture struct {
	service *Service
	context context.Context
	account *lifecycleIntentTestAccount
	store   *localAppAdoptionStore
}

func newLifecycleIntentHandlerFixture(t *testing.T) lifecycleIntentHandlerFixture {
	t.Helper()
	directory := t.TempDir()
	anchor, err := protectedlocal.NewFileAnchorStore(filepath.Join(directory, "protected_local.anchor"), bytes.Repeat([]byte{0xd1}, protectedlocal.IdentifierBytes))
	if err != nil {
		t.Fatalf("new lifecycle intent anchor: %v", err)
	}
	ledger, err := protectedlocal.OpenLedger(context.Background(), protectedlocal.LedgerOptions{
		Path:         filepath.Join(directory, protectedlocal.LedgerFilename),
		AnchorStore:  anchor,
		RecordMACKey: bytes.Repeat([]byte{0xd2}, protectedlocal.IdentifierBytes),
		Random:       rand.Reader,
	})
	if err != nil {
		t.Fatalf("open lifecycle intent ledger: %v", err)
	}
	t.Cleanup(func() { _ = ledger.Close() })
	boot, err := ledger.StartRuntime(context.Background())
	if err != nil {
		t.Fatalf("start lifecycle intent Runtime: %v", err)
	}
	sessions, err := protectedlocal.NewDesktopSessionManager(boot, rand.Reader)
	if err != nil {
		t.Fatalf("new lifecycle session manager: %v", err)
	}
	manager, err := protectedlocal.NewLifecycleIntentManager(protectedlocal.LifecycleIntentManagerOptions{Sessions: sessions})
	if err != nil {
		t.Fatalf("new lifecycle intent manager: %v", err)
	}
	liveness := &lifecycleIntentTestLiveness{revoked: make(chan struct{})}
	connection, err := protectedlocal.EstablishDesktopConnection(context.Background(), lifecycleIntentTestVerifier{peers: protectedlocal.VerifiedDesktopPeers{
		Client:             lifecycleIntentTestProcessTuple(9101, "desktop", "desktop-user", 0xd3),
		Server:             lifecycleIntentTestProcessTuple(9201, "runtime", "runtime-service", 0xd4),
		ClientLiveness:     liveness,
		RuntimeBootEpoch:   boot,
		EndpointInstanceID: lifecycleIntentTestIdentifier(0xd5),
		TranscriptNonce:    lifecycleIntentTestIdentifier(0xd6),
	}}, rand.Reader)
	if err != nil {
		t.Fatalf("establish lifecycle Desktop connection: %v", err)
	}
	t.Cleanup(connection.Revoke)
	protectedContext := protectedlocal.ContextWithDesktopConnection(context.Background(), connection)
	if _, err := sessions.Open(protectedContext); err != nil {
		t.Fatalf("open lifecycle Desktop session: %v", err)
	}

	account := &lifecycleIntentTestAccount{generation: 7}
	store := newLocalAppAdoptionStoreForTest(filepath.Join(directory, ".nimi"))
	install := &installRuntime{
		registry: &appregistrycatalog.Registry{Apps: []appregistrycatalog.App{{
			AppID:                lifecycleIntentTestAppID,
			ReleaseDescriptorRef: lifecycleIntentTestReleaseRef,
			AdmissionStatus:      appregistrycatalog.AdmissionStatusAdmitted,
		}}},
		releaseCatalog: &appreleasecatalog.Catalog{Descriptors: []appreleasecatalog.Descriptor{{
			DescriptorID: lifecycleIntentTestReleaseRef,
			AppID:        lifecycleIntentTestAppID,
			Artifact: appreleasecatalog.Artifact{
				DigestAlgorithm: "sha256",
				SHA256:          lifecycleIntentTestArtifact,
			},
		}}},
	}
	service := New(testLogger(),
		WithInstallRuntime(install),
		WithRuntimeAccountProjectionProvider(account),
		WithLifecycleIntentManager(manager),
		WithLocalAppAdoptionStoreForTest(store),
	)
	return lifecycleIntentHandlerFixture{service: service, context: protectedContext, account: account, store: store}
}

type lifecycleIntentTestLiveness struct {
	revoked chan struct{}
	once    sync.Once
}

func (liveness *lifecycleIntentTestLiveness) Revoked() <-chan struct{} { return liveness.revoked }
func (liveness *lifecycleIntentTestLiveness) Close() error {
	liveness.once.Do(func() { close(liveness.revoked) })
	return nil
}

type lifecycleIntentTestVerifier struct {
	peers protectedlocal.VerifiedDesktopPeers
}

func (verifier lifecycleIntentTestVerifier) VerifyDesktopPeers(context.Context) (protectedlocal.VerifiedDesktopPeers, error) {
	return verifier.peers, nil
}

func lifecycleIntentTestProcessTuple(pid uint32, marker string, principal string, digest byte) protectedlocal.ProcessTuple {
	return protectedlocal.ProcessTuple{
		OS:                          protectedlocal.OSWindows,
		PID:                         pid,
		CreationMarker:              marker + "-creation",
		OSLoginSession:              marker + "-session",
		SecurityPrincipal:           principal,
		CanonicalExecutableIdentity: marker + "-executable",
		ExecutableDigest:            lifecycleIntentTestIdentifier(digest),
		ExecutableTrustSetID:        marker + "-trust-v1",
	}
}

func lifecycleIntentTestIdentifier(value byte) protectedlocal.Identifier {
	var identifier protectedlocal.Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}

func assertLifecycleIntentReason(t *testing.T, err error, expected runtimev1.ReasonCode) {
	t.Helper()
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != expected {
		t.Fatalf("reason = %v (present=%v), want %v; err=%v", reason, ok, expected, err)
	}
}
