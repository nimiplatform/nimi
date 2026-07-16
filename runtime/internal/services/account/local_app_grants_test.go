package account

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"google.golang.org/grpc/metadata"
)

type testLocalAppGrantControl struct {
	challenge      LocalAppGrantChallengeBinding
	controlRef     string
	authorizedRef  string
	bindErr        error
	authorizeErr   error
	bindCalls      int
	authorizeCalls int
}

func (control *testLocalAppGrantControl) BindLocalAppGrantChallenge(_ context.Context, challenge LocalAppGrantChallengeBinding) (string, error) {
	control.bindCalls++
	control.challenge = challenge
	if control.bindErr != nil {
		return "", control.bindErr
	}
	return control.controlRef, nil
}

func (control *testLocalAppGrantControl) AuthorizeLocalAppGrantControl(context.Context) (string, error) {
	control.authorizeCalls++
	if control.authorizeErr != nil {
		return "", control.authorizeErr
	}
	return control.authorizedRef, nil
}

type localAppGrantFixture struct {
	service  *Service
	kernel   *localappkernel.Kernel
	resolver *localAppAuthorizationResolver
	control  *testLocalAppGrantControl
	presence *staticPresenceVerifier
	audit    *auditlog.Store
	now      time.Time
}

func newLocalAppGrantFixture(t *testing.T) *localAppGrantFixture {
	t.Helper()
	now := time.Now().UTC().Truncate(time.Second)
	sid, err := localappkernel.ValidateVerifiedInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatalf("validate test SID: %v", err)
	}
	kernel, err := localappkernel.OpenSQLite(context.Background(), filepath.Join(t.TempDir(), "local-app-kernel.db"), sid, localappkernel.Options{Now: func() time.Time { return now }})
	if err != nil {
		t.Fatalf("open local-app kernel: %v", err)
	}
	t.Cleanup(func() { _ = kernel.Close() })
	principal, err := kernel.Principals().Create(context.Background(), localappkernel.CreatePrincipalInput{
		Kind: localappkernel.PrincipalKindDevelopment, AppID: "sample.nimi.app",
		DevelopmentAuthorizationID: "development-authorization-1", CanonicalProjectFileID: "project-file-1",
	})
	if err != nil {
		t.Fatalf("create local-app principal: %v", err)
	}
	record, err := kernel.Records().Create(context.Background(), localappkernel.CreateRecordInput{
		LocalAppPrincipalID: principal.LocalAppPrincipalID, TrustClass: localappkernel.TrustClassLocalDevelopment,
		ProvenanceAttestationRefs: []string{"development-attestation:1"}, ProvenanceRevision: 1,
		ActiveReleaseOrProjectIdentityRef: "project-identity:1", InstallOrProjectGeneration: 1,
		ActiveCapabilityFingerprint: "capability-fingerprint:1", ExecutionProfileRef: "execution-profile:1",
		HostExecutableDigest: "host-digest:1", PayloadRootDigest: "payload-digest:1", LifecycleState: localappkernel.LifecycleStateActive,
	})
	if err != nil {
		t.Fatalf("create local-app record: %v", err)
	}
	control := &testLocalAppGrantControl{controlRef: "desktop-control-session:1", authorizedRef: "desktop-control-session:1"}
	audit := auditlog.New(32, 32)
	presence := &staticPresenceVerifier{result: PresenceVerification{
		State:         runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_VERIFIED,
		Method:        runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_OS_CREDENTIAL,
		VerifiedUntil: now.Add(time.Minute),
	}}
	service := newHarnessService(t, nil,
		WithClock(func() time.Time { return now }), WithLocalAppKernel(kernel),
		WithLocalAppGrantControlAuthority(control), WithPresenceVerifier(presence), WithAuditStore(audit),
	)
	completeLogin(t, service)
	_, generation, ok := service.AuthenticatedRuntimeSecurityContext(context.Background())
	if !ok {
		t.Fatal("authenticated account context unavailable")
	}
	binding := localAppCallerBindingFixture(t, generation)
	binding.LocalAppPrincipalID = principal.LocalAppPrincipalID
	binding.LocalAppRecordID = record.LocalAppRecordID
	binding.ProvenanceRevision = record.ProvenanceRevision
	binding.ProjectGeneration = record.InstallOrProjectGeneration
	binding.PayloadDigest = record.PayloadRootDigest
	binding.Capabilities = []string{
		"data.scope.read#runtime.artifacts", "runtime.agent.turn.write", "runtime.agent.turn.read",
	}
	resolver := &localAppAuthorizationResolver{binding: binding}
	service.SetLocalAppSessionResolver(resolver)
	return &localAppGrantFixture{service: service, kernel: kernel, resolver: resolver, control: control, presence: presence, audit: audit, now: now}
}

func TestLocalAppGrantLifecycleAuditFields(t *testing.T) {
	fixture := newLocalAppGrantFixture(t)
	request := &runtimev1.RequestLocalAppGrantRequest{
		OperationId: "runtime_agent.conversation.snapshot",
		ResourceRef: "conversation-anchor:audit",
		Purpose:     "Read the selected conversation snapshot",
	}
	pending, err := fixture.service.RequestLocalAppGrant(context.Background(), request)
	if err != nil || pending.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_PENDING {
		t.Fatalf("request audited grant = (%+v, %v)", pending, err)
	}
	granted, err := fixture.service.DecideLocalAppGrant(protectedDesktopAccountContext(t), &runtimev1.DecideLocalAppGrantRequest{
		RequestId: pending.GetProjection().GetRequestId(), Approved: true,
		PresenceChallengeId: fixture.control.challenge.PresenceChallengeID,
	})
	if err != nil || granted.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_GRANTED {
		t.Fatalf("decide audited grant = (%+v, %v)", granted, err)
	}
	revoked, err := fixture.service.RevokeLocalAppGrant(protectedDesktopAccountContext(t), &runtimev1.RevokeLocalAppGrantRequest{GrantId: granted.GetProjection().GetGrantId()})
	if err != nil || revoked.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_REVOKED {
		t.Fatalf("revoke audited grant = (%+v, %v)", revoked, err)
	}

	listed, err := fixture.audit.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: "runtime.local_app_grant"})
	if err != nil {
		t.Fatalf("list local-app grant audit events: %v", err)
	}
	events := listed.GetEvents()
	if len(events) != 3 {
		t.Fatalf("grant audit transition count = %d, want 3", len(events))
	}
	expected := []struct{ oldState, newState, triggeredBy, operationID string }{
		{"granted", "revoked", "desktop_revoke", "grant.revoke"},
		{"pending", "granted", "desktop_grant_control", request.GetOperationId()},
		{localAppGrantNoGrantState, "pending", "local_app_request", request.GetOperationId()},
	}
	for index, event := range events {
		if event.GetAppId() != "sample.nimi.app" || event.GetSubjectUserId() == "" || event.GetDomain() != "runtime.local_app_grant" || event.GetOperation() != "grant.transition" {
			t.Fatalf("grant audit %d missing K-AUDIT floor: %+v", index, event)
		}
		if event.GetPrincipalId() != fixture.resolver.binding.LocalAppPrincipalID || event.GetPrincipalType() != "local_app" || event.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP || event.GetCallerId() != fixture.resolver.binding.LocalAppPrincipalID {
			t.Fatalf("grant audit %d principal attribution mismatch: %+v", index, event)
		}
		if event.GetCapability() != "runtime.agent.turn.read" || event.GetResourceSelectorHash() == "" || event.GetTokenId() != "" || event.GetTimestamp() == nil || event.GetTimestamp().CheckValid() != nil {
			t.Fatalf("grant audit %d capability/timestamp/token posture mismatch: %+v", index, event)
		}
		payload := event.GetPayload().AsMap()
		if payload["local_app_principal_id"] != fixture.resolver.binding.LocalAppPrincipalID || payload["app_id"] != "sample.nimi.app" || payload["scope_name"] != "runtime.agent.turn.read" || payload["operation_id"] != expected[index].operationID || payload["old_state"] != expected[index].oldState || payload["new_state"] != expected[index].newState || payload["triggered_by"] != expected[index].triggeredBy || payload["timestamp"] == "" {
			t.Fatalf("grant audit %d lifecycle payload mismatch: %+v", index, payload)
		}
		scopeRef, ok := payload["ai_scope_ref"].(map[string]any)
		if !ok || scopeRef["kind"] != "app" || scopeRef["ownerId"] != "sample.nimi.app" {
			t.Fatalf("grant audit %d AIScopeRef mismatch: %+v", index, payload["ai_scope_ref"])
		}
	}
}

func TestLocalAppGrantMutationFailsClosedWithoutAuditStore(t *testing.T) {
	fixture := newLocalAppGrantFixture(t)
	fixture.service.auditStore = nil
	request := &runtimev1.RequestLocalAppGrantRequest{
		OperationId: "runtime_agent.conversation.open",
		ResourceRef: "agent:no-audit",
		Purpose:     "Open the selected agent conversation",
	}
	response, err := fixture.service.RequestLocalAppGrant(context.Background(), request)
	if err != nil || response.GetProjection().GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("missing audit store did not fail closed: response=%+v err=%v", response, err)
	}
	projection, _, authenticated := fixture.service.AuthenticatedRuntimeSecurityContext(context.Background())
	if !authenticated || projection == nil {
		t.Fatal("test account context unavailable")
	}
	binding, bindErr := localAppGrantOperation(request.GetOperationId(), request.GetResourceRef())
	if bindErr != nil {
		t.Fatal(bindErr)
	}
	if _, getErr := fixture.kernel.Grants().GetCurrent(context.Background(), projection.GetAccountId(), fixture.resolver.binding.LocalAppPrincipalID, binding.fingerprint); !errors.Is(getErr, localappkernel.ErrNotFound) {
		t.Fatalf("grant mutated without audit store: %v", getErr)
	}
}

func TestLocalAppGrantZeroRequestPresenceDecisionAndReplay(t *testing.T) {
	fixture := newLocalAppGrantFixture(t)
	operationID := "runtime_agent.conversation.turn_send"
	resourceRef := "conversation-anchor:agent-1"
	status, err := fixture.service.GetLocalAppGrantStatus(context.Background(), &runtimev1.GetLocalAppGrantStatusRequest{OperationId: operationID, ResourceRef: resourceRef})
	if err != nil || status.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_NO_GRANT || len(status.GetProjection().GetGrantId()) != 0 {
		t.Fatalf("zero-grant status = (%+v, %v)", status, err)
	}
	pending, err := fixture.service.RequestLocalAppGrant(context.Background(), &runtimev1.RequestLocalAppGrantRequest{OperationId: operationID, ResourceRef: resourceRef, Purpose: "Send a turn to this conversation"})
	if err != nil || pending.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_PENDING || len(pending.GetProjection().GetRequestId()) != 32 || len(pending.GetProjection().GetGrantId()) != 32 {
		t.Fatalf("pending grant = (%+v, %v)", pending, err)
	}
	if len(fixture.control.challenge.PresenceChallengeID) != 32 || string(fixture.control.challenge.PresenceChallengeID) == string(pending.GetProjection().GetRequestId()) {
		t.Fatalf("Runtime must issue distinct exact request/challenge ids: %+v", fixture.control.challenge)
	}
	wrongRequestID := append([]byte(nil), pending.GetProjection().GetRequestId()...)
	wrongRequestID[0] ^= 0xff
	wrongRequest, err := fixture.service.DecideLocalAppGrant(protectedDesktopAccountContext(t), &runtimev1.DecideLocalAppGrantRequest{
		RequestId: wrongRequestID, Approved: true, PresenceChallengeId: fixture.control.challenge.PresenceChallengeID,
	})
	if err != nil || wrongRequest.GetProjection().GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_PRESENCE_EXPIRED || fixture.presence.calls != 0 {
		t.Fatalf("wrong request id mutated pending grant: response=%+v err=%v presence_calls=%d", wrongRequest, err, fixture.presence.calls)
	}
	wrongChallenge := append([]byte(nil), fixture.control.challenge.PresenceChallengeID...)
	wrongChallenge[0] ^= 0xff
	wrong, err := fixture.service.DecideLocalAppGrant(protectedDesktopAccountContext(t), &runtimev1.DecideLocalAppGrantRequest{
		RequestId: pending.GetProjection().GetRequestId(), Approved: true, PresenceChallengeId: wrongChallenge,
	})
	if err != nil || wrong.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_PENDING || fixture.presence.calls != 0 {
		t.Fatalf("wrong challenge mutated pending grant: response=%+v err=%v presence_calls=%d", wrong, err, fixture.presence.calls)
	}
	granted, err := fixture.service.DecideLocalAppGrant(protectedDesktopAccountContext(t), &runtimev1.DecideLocalAppGrantRequest{
		RequestId: pending.GetProjection().GetRequestId(), Approved: true, PresenceChallengeId: fixture.control.challenge.PresenceChallengeID,
	})
	if err != nil || granted.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_GRANTED || fixture.presence.calls != 1 {
		t.Fatalf("grant decision = (%+v, %v), presence_calls=%d", granted, err, fixture.presence.calls)
	}
	replay, err := fixture.service.DecideLocalAppGrant(protectedDesktopAccountContext(t), &runtimev1.DecideLocalAppGrantRequest{
		RequestId: pending.GetProjection().GetRequestId(), Approved: true, PresenceChallengeId: fixture.control.challenge.PresenceChallengeID,
	})
	if err != nil || replay.GetProjection().GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_PRESENCE_EXPIRED || fixture.presence.calls != 1 {
		t.Fatalf("replayed challenge = (%+v, %v), presence_calls=%d", replay, err, fixture.presence.calls)
	}
}

func TestLocalAppGrantApprovalConsumesProtectedPresenceBrowserMetadata(t *testing.T) {
	fixture := newLocalAppGrantFixture(t)
	pending, err := fixture.service.RequestLocalAppGrant(context.Background(), &runtimev1.RequestLocalAppGrantRequest{
		OperationId: "runtime_agent.conversation.open", ResourceRef: "agent:browser", Purpose: "Open this agent conversation",
	})
	if err != nil || pending.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_PENDING {
		t.Fatalf("request grant = (%+v, %v)", pending, err)
	}
	ctx := metadata.NewIncomingContext(protectedDesktopAccountContext(t), metadata.Pairs(
		presenceBrowserLauncherMetadata,
		"http://127.0.0.1:4567/v1/presence-browser/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
	))
	granted, err := fixture.service.DecideLocalAppGrant(ctx, &runtimev1.DecideLocalAppGrantRequest{
		RequestId: pending.GetProjection().GetRequestId(), Approved: true,
		PresenceChallengeId: fixture.control.challenge.PresenceChallengeID,
	})
	if err != nil || granted.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_GRANTED || !fixture.presence.launcherBound {
		t.Fatalf("protected browser metadata was not consumed: response=%+v err=%v launcher=%v", granted, err, fixture.presence.launcherBound)
	}
}

func TestLocalAppGrantRequiresSessionAndExactDesktopControl(t *testing.T) {
	fixture := newLocalAppGrantFixture(t)
	fixture.service.SetLocalAppSessionResolver(nil)
	status, err := fixture.service.GetLocalAppGrantStatus(context.Background(), &runtimev1.GetLocalAppGrantStatusRequest{OperationId: "artifacts.read_runtime_bytes", ResourceRef: "artifact:1"})
	if err != nil || status.GetProjection().GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED {
		t.Fatalf("missing session status = (%+v, %v)", status, err)
	}
	fixture.service.SetLocalAppSessionResolver(fixture.resolver)
	pending, err := fixture.service.RequestLocalAppGrant(context.Background(), &runtimev1.RequestLocalAppGrantRequest{OperationId: "artifacts.read_runtime_bytes", ResourceRef: "artifact:1", Purpose: "Read one runtime artifact"})
	if err != nil || pending.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_PENDING {
		t.Fatalf("request grant = (%+v, %v)", pending, err)
	}
	unprotected, err := fixture.service.DecideLocalAppGrant(context.Background(), &runtimev1.DecideLocalAppGrantRequest{RequestId: pending.GetProjection().GetRequestId(), Approved: true, PresenceChallengeId: fixture.control.challenge.PresenceChallengeID})
	if err != nil || unprotected.GetProjection().GetReasonCode() != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("unprotected decision = (%+v, %v)", unprotected, err)
	}
	fixture.control.authorizedRef = "desktop-control-session:other"
	wrongControl, err := fixture.service.DecideLocalAppGrant(protectedDesktopAccountContext(t), &runtimev1.DecideLocalAppGrantRequest{RequestId: pending.GetProjection().GetRequestId(), Approved: true, PresenceChallengeId: fixture.control.challenge.PresenceChallengeID})
	if err != nil || wrongControl.GetProjection().GetReasonCode() != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH || fixture.presence.calls != 0 {
		t.Fatalf("wrong Desktop control decision = (%+v, %v), presence_calls=%d", wrongControl, err, fixture.presence.calls)
	}
}

func TestLocalAppGrantRevokeIsExactAndObservedByNextStatus(t *testing.T) {
	fixture := newLocalAppGrantFixture(t)
	request := &runtimev1.RequestLocalAppGrantRequest{OperationId: "runtime_agent.conversation.snapshot", ResourceRef: "conversation-anchor:1", Purpose: "Read conversation snapshot"}
	pending, _ := fixture.service.RequestLocalAppGrant(context.Background(), request)
	granted, _ := fixture.service.DecideLocalAppGrant(protectedDesktopAccountContext(t), &runtimev1.DecideLocalAppGrantRequest{RequestId: pending.GetProjection().GetRequestId(), Approved: true, PresenceChallengeId: fixture.control.challenge.PresenceChallengeID})
	if granted.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_GRANTED {
		t.Fatalf("grant not established: %+v", granted)
	}
	unprotected, err := fixture.service.RevokeLocalAppGrant(context.Background(), &runtimev1.RevokeLocalAppGrantRequest{GrantId: granted.GetProjection().GetGrantId()})
	if err != nil || unprotected.GetProjection().GetReasonCode() != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("unprotected revoke = (%+v, %v)", unprotected, err)
	}
	wrongGrantID := append([]byte(nil), granted.GetProjection().GetGrantId()...)
	wrongGrantID[0] ^= 0xff
	wrongGrant, err := fixture.service.RevokeLocalAppGrant(protectedDesktopAccountContext(t), &runtimev1.RevokeLocalAppGrantRequest{GrantId: wrongGrantID})
	if err != nil || wrongGrant.GetProjection().GetState() == runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_REVOKED {
		t.Fatalf("wrong exact grant id revoked authority: response=%+v err=%v", wrongGrant, err)
	}
	revoked, err := fixture.service.RevokeLocalAppGrant(protectedDesktopAccountContext(t), &runtimev1.RevokeLocalAppGrantRequest{GrantId: granted.GetProjection().GetGrantId()})
	if err != nil || revoked.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_REVOKED {
		t.Fatalf("revoke = (%+v, %v)", revoked, err)
	}
	status, err := fixture.service.GetLocalAppGrantStatus(context.Background(), &runtimev1.GetLocalAppGrantStatusRequest{OperationId: request.GetOperationId(), ResourceRef: request.GetResourceRef()})
	if err != nil || status.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_REVOKED || status.GetProjection().GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_GRANT_REVOKED {
		t.Fatalf("post-revoke status = (%+v, %v)", status, err)
	}
	binding, _ := localAppGrantOperation(request.GetOperationId(), request.GetResourceRef())
	if _, err := fixture.kernel.Grants().GetCurrent(context.Background(), "acct-other", fixture.resolver.binding.LocalAppPrincipalID, binding.fingerprint); !errors.Is(err, localappkernel.ErrNotFound) {
		t.Fatalf("account switch must not transfer grant, got %v", err)
	}
}

func TestLocalAppGrantExplicitDenialConsumesChallengeWithoutPresence(t *testing.T) {
	fixture := newLocalAppGrantFixture(t)
	pending, _ := fixture.service.RequestLocalAppGrant(context.Background(), &runtimev1.RequestLocalAppGrantRequest{
		OperationId: "runtime_agent.conversation.open", ResourceRef: "agent:deny", Purpose: "Open this agent conversation",
	})
	denied, err := fixture.service.DecideLocalAppGrant(protectedDesktopAccountContext(t), &runtimev1.DecideLocalAppGrantRequest{
		RequestId: pending.GetProjection().GetRequestId(), Approved: false, PresenceChallengeId: fixture.control.challenge.PresenceChallengeID,
	})
	if err != nil || denied.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_DENIED || fixture.presence.calls != 0 {
		t.Fatalf("explicit denial = (%+v, %v), presence_calls=%d", denied, err, fixture.presence.calls)
	}
	replay, _ := fixture.service.DecideLocalAppGrant(protectedDesktopAccountContext(t), &runtimev1.DecideLocalAppGrantRequest{
		RequestId: pending.GetProjection().GetRequestId(), Approved: true, PresenceChallengeId: fixture.control.challenge.PresenceChallengeID,
	})
	if replay.GetProjection().GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_PRESENCE_EXPIRED || fixture.presence.calls != 0 {
		t.Fatalf("denied challenge replay = %+v presence_calls=%d", replay, fixture.presence.calls)
	}
}

func TestLocalAppGrantPreflightExactSharedGrantProjection(t *testing.T) {
	fixture := newLocalAppGrantFixture(t)
	const resourceRef = "agent:agent-a/conversation:anchor-a"
	pending, err := fixture.service.RequestLocalAppGrant(context.Background(), &runtimev1.RequestLocalAppGrantRequest{
		OperationId: "runtime_agent.conversation.turn_subscribe", ResourceRef: resourceRef, Purpose: "Subscribe to conversation events",
	})
	if err != nil || pending.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_PENDING {
		t.Fatalf("subscribe pending grant = (%+v, %v)", pending, err)
	}
	shared, err := fixture.service.GetLocalAppGrantStatus(context.Background(), &runtimev1.GetLocalAppGrantStatusRequest{
		OperationId: "runtime_agent.conversation.snapshot", ResourceRef: resourceRef,
	})
	if err != nil || shared.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_PENDING ||
		shared.GetProjection().GetOperationId() != "runtime_agent.conversation.snapshot" ||
		string(shared.GetProjection().GetGrantId()) != string(pending.GetProjection().GetGrantId()) {
		t.Fatalf("shared pending projection = (%+v, %v)", shared, err)
	}
}

func TestLocalAppGrantOperationMapIsClosedAndDeterministic(t *testing.T) {
	writeOpen, err := localAppGrantOperation("runtime_agent.conversation.open", "agent:1")
	if err != nil {
		t.Fatal(err)
	}
	writeSend, err := localAppGrantOperation("runtime_agent.conversation.turn_send", "agent:1")
	if err != nil {
		t.Fatal(err)
	}
	if writeOpen.capability != "runtime.agent.turn.write" || writeOpen.fingerprint != writeSend.fingerprint {
		t.Fatalf("write operation mapping mismatch: open=%+v send=%+v", writeOpen, writeSend)
	}
	read, err := localAppGrantOperation("runtime_agent.conversation.turn_subscribe", "agent:1")
	if err != nil || read.capability != "runtime.agent.turn.read" || read.fingerprint == writeOpen.fingerprint {
		t.Fatalf("read operation mapping mismatch: %+v err=%v", read, err)
	}
	if _, err := localAppGrantOperation("runtime_agent.unadmitted", "agent:1"); !errors.Is(err, ErrLocalAppOperationNotAdmitted) {
		t.Fatalf("unadmitted operation error = %v", err)
	}
	storageRead, err := localAppGrantOperation("app_storage.json.read", "storage:state/value.json")
	if err != nil || storageRead.capability != "file.read.scoped#app-local-drafts" {
		t.Fatalf("storage read mapping = %+v err=%v", storageRead, err)
	}
	storageWrite, err := localAppGrantOperation("app_storage.json.write", "storage:state/value.json")
	if err != nil || storageWrite.capability != "file.write.scoped#app-local-drafts" {
		t.Fatalf("storage write mapping = %+v err=%v", storageWrite, err)
	}
	storageRemove, err := localAppGrantOperation("app_storage.json.remove", "storage:state/value.json")
	if err != nil || storageRemove.capability != "file.write.scoped#app-local-drafts" {
		t.Fatalf("storage remove mapping = %+v err=%v", storageRemove, err)
	}
	if storageRead.fingerprint == storageWrite.fingerprint || storageRead.fingerprint == storageRemove.fingerprint || storageWrite.fingerprint == storageRemove.fingerprint {
		t.Fatalf("storage operation fingerprints are not distinct: read=%q write=%q remove=%q", storageRead.fingerprint, storageWrite.fingerprint, storageRemove.fingerprint)
	}
	if _, err := localAppGrantOperation("app_storage.json.read", "storage:../secret.json"); err == nil {
		t.Fatal("invalid storage resource was admitted")
	}
}
