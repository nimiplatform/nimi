package localappop

import (
	"errors"
	"reflect"
	"testing"
)

func TestCanonicalAppOperationContractIsExactUniqueAndExplicit(t *testing.T) {
	if err := validateContractRows(canonicalAppOperationContract[:]); err != nil {
		t.Fatal(err)
	}
	type expectedRow struct {
		id     string
		class  AuthorityClass
		domain Domain
	}
	got := make([]expectedRow, 0, len(canonicalAppOperationContract))
	for _, row := range canonicalAppOperationContract {
		got = append(got, expectedRow{id: row.id, class: row.class, domain: row.domain})
	}
	want := []expectedRow{
		{id: "runtime.app-storage.json.read", class: AuthorityClassBase},
		{id: "runtime.app-storage.json.write", class: AuthorityClassBase},
		{id: "runtime.app-storage.json.remove", class: AuthorityClassBase},
		{id: "runtime.app-storage.asset.stat", class: AuthorityClassBase},
		{id: "runtime.app-storage.asset.list", class: AuthorityClassBase},
		{id: "runtime.app-storage.asset.write", class: AuthorityClassBase},
		{id: "runtime.app-storage.asset.read", class: AuthorityClassBase},
		{id: "runtime.app-storage.asset.remove", class: AuthorityClassBase},
		{id: "runtime.app-storage.asset.move", class: AuthorityClassBase},
		{id: "runtime.app-storage.asset.reveal", class: AuthorityClassBase},
		{id: "runtime.ai.artifact.adopt-to-app-storage", class: AuthorityClassAppAccess, domain: "runtime.consume"},
		{id: "runtime.ai.app-config.get", class: AuthorityClassAppAccess, domain: "runtime.consume"},
		{id: "runtime.ai.app-config.overwrite", class: AuthorityClassAppAccess, domain: "runtime.consume"},
		{id: "runtime.ai.app-config.options.list", class: AuthorityClassAppAccess, domain: "runtime.consume"},
		{id: "realm.world-core.list", class: AuthorityClassAppAccess, domain: "realm.data"},
		{id: "realm.world-core.create", class: AuthorityClassAppAccess, domain: "realm.data"},
		{id: "realm.persona-character.list-owned", class: AuthorityClassAppAccess, domain: "realm.data"},
		{id: "realm.persona-character.get-owned", class: AuthorityClassAppAccess, domain: "realm.data"},
		{id: "realm.persona-character.create", class: AuthorityClassAppAccess, domain: "realm.data"},
		{id: "realm.persona-character.replace", class: AuthorityClassAppAccess, domain: "realm.data"},
		{id: "realm.persona-character.delete", class: AuthorityClassAppAccess, domain: "realm.data"},
		{id: "runtime.ai.text-candidate.generate", class: AuthorityClassAppAccess, domain: "runtime.consume"},
		{id: "runtime.ai.text-turn.stream", class: AuthorityClassAppAccess, domain: "runtime.consume"},
		{id: "runtime.ai.scenario.execute", class: AuthorityClassAppAccess, domain: "runtime.consume"},
		{id: "runtime.ai.scenario-job.submit", class: AuthorityClassAppAccess, domain: "runtime.consume"},
		{id: "runtime.ai.scenario-job.get", class: AuthorityClassAppAccess, domain: "runtime.consume"},
		{id: "runtime.ai.scenario-job.subscribe", class: AuthorityClassAppAccess, domain: "runtime.consume"},
		{id: "runtime.ai.scenario-job.cancel", class: AuthorityClassAppAccess, domain: "runtime.consume"},
		{id: "runtime.ai.artifact.read", class: AuthorityClassAppAccess, domain: "runtime.consume"},
		{id: "runtime.ai.artifact.upload", class: AuthorityClassAppAccess, domain: "runtime.consume"},
		{id: "runtime.ai.voice-assets.list", class: AuthorityClassAppAccess, domain: "runtime.consume"},
		{id: "runtime.agent.reference.list", class: AuthorityClassAppAccess, domain: "agent.local"},
		{id: "runtime.agent.conversation.open", class: AuthorityClassAppAccess, domain: "agent.local"},
		{id: "runtime.agent.conversation.turn.send", class: AuthorityClassAppAccess, domain: "agent.local"},
		{id: "runtime.agent.conversation.turn.interrupt", class: AuthorityClassAppAccess, domain: "agent.local"},
		{id: "runtime.agent.conversation.events.subscribe", class: AuthorityClassAppAccess, domain: "agent.local"},
		{id: "runtime.agent.conversation.snapshot.get", class: AuthorityClassAppAccess, domain: "agent.local"},
		{id: AppOperationIDConversationAttachmentUpload, class: AuthorityClassAppAccess, domain: "agent.local"},
		{id: AppOperationIDConversationArtifactRead, class: AuthorityClassAppAccess, domain: "agent.local"},
		{id: AppOperationIDConversationVoiceTranscribe, class: AuthorityClassAppAccess, domain: "agent.local"},
		{id: "runtime.agent.ai-config.get", class: AuthorityClassAppAccess, domain: "agent.configure"},
		{id: "runtime.agent.ai-config.overwrite", class: AuthorityClassAppAccess, domain: "agent.configure"},
		{id: "runtime.agent.ai-config.options.list", class: AuthorityClassAppAccess, domain: "agent.configure"},
		{id: "runtime.agent.autonomy.snapshot.get", class: AuthorityClassAppAccess, domain: "agent.configure"},
		{id: "runtime.agent.autonomy.update", class: AuthorityClassAppAccess, domain: "agent.configure"},
		{id: "runtime.agent.presentation.snapshot.get", class: AuthorityClassAppAccess, domain: "agent.configure"},
		{id: "runtime.agent.presentation.commit", class: AuthorityClassAppAccess, domain: "agent.configure"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("canonical App operation map = %#v, want %#v", got, want)
	}

	duplicate := append([]contractRow(nil), canonicalAppOperationContract[:]...)
	duplicate[1].id = duplicate[0].id
	if !errors.Is(validateContractRows(duplicate), ErrContractInvalid) {
		t.Fatal("duplicate AppOperationId was accepted")
	}
	unclassified := append([]contractRow(nil), canonicalAppOperationContract[:]...)
	unclassified[0].class = AuthorityClassUnknown
	if !errors.Is(validateContractRows(unclassified), ErrContractInvalid) {
		t.Fatal("unclassified row was accepted")
	}
}

func TestCanonicalContractRejectsUnknownWithoutDefaultBase(t *testing.T) {
	if _, err := ClassifyIngress(Ingress(255)); !errors.Is(err, ErrOperationUnknown) {
		t.Fatalf("unknown ingress error = %v", err)
	}
	if _, err := ClassifyOperation(Operation(255)); !errors.Is(err, ErrOperationUnknown) {
		t.Fatalf("unknown operation error = %v", err)
	}
}

func TestPresentEmptySnapshotDiffersFromMissingSnapshot(t *testing.T) {
	binding := testSnapshotBinding()
	empty, err := NewEffectiveAppAccessSnapshot(binding, nil)
	if err != nil {
		t.Fatal(err)
	}
	current := CurrentBinding(binding)
	if _, err := Admit(AdmissionInput{Ingress: IngressStorageJSONRead, Snapshot: empty, Current: current}); err != nil {
		t.Fatalf("Base operation with present empty snapshot: %v", err)
	}
	if _, err := Admit(AdmissionInput{Ingress: IngressRealmWorldCoreList, Snapshot: empty, Current: current}); !errors.Is(err, ErrDomainUncovered) {
		t.Fatalf("AppAccess operation with empty snapshot error = %v", err)
	}
	if _, err := Admit(AdmissionInput{Ingress: IngressStorageJSONRead, Current: current}); !errors.Is(err, ErrSnapshotMissing) {
		t.Fatalf("missing snapshot error = %v", err)
	}
}

func TestSnapshotRejectsDeclarationAccountAndRuntimeGenerationChanges(t *testing.T) {
	binding := testSnapshotBinding()
	snapshot, err := NewEffectiveAppAccessSnapshot(binding, []string{"realm.data"})
	if err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*CurrentBinding){
		"declaration": func(current *CurrentBinding) { current.DeclarationGeneration++ },
		"account":     func(current *CurrentBinding) { current.AccountGeneration++ },
		"runtime":     func(current *CurrentBinding) { current.RuntimeGeneration++ },
	} {
		t.Run(name, func(t *testing.T) {
			current := CurrentBinding(binding)
			mutate(&current)
			if _, err := Admit(AdmissionInput{Ingress: IngressRealmWorldCoreList, Snapshot: snapshot, Current: current}); !errors.Is(err, ErrSnapshotStale) {
				t.Fatalf("stale generation error = %v", err)
			}
		})
	}
}

func TestAdmissionRejectsEveryCallerAssertion(t *testing.T) {
	binding := testSnapshotBinding()
	snapshot, err := NewEffectiveAppAccessSnapshot(binding, nil)
	if err != nil {
		t.Fatal(err)
	}
	assertions := []CallerAssertions{
		{AppOperationID: "forged"},
		{AppAccessDomainID: "forged"},
		{Classification: "base"},
		{RegisteredSubject: "forged"},
		{RegistrationHandle: "forged"},
		{AccountID: "forged"},
		{SessionID: "forged"},
		{SnapshotID: "forged"},
		{Credential: "forged"},
		{PeerProof: "forged"},
		{Generation: 1},
	}
	for index, assertion := range assertions {
		_, err := Admit(AdmissionInput{
			Ingress: IngressStorageJSONRead, Snapshot: snapshot,
			Current: CurrentBinding(binding), CallerAssertions: assertion,
		})
		if !errors.Is(err, ErrCallerAssertion) {
			t.Fatalf("assertion %d error = %v", index, err)
		}
	}
}

func testSnapshotBinding() SnapshotBinding {
	var launch [32]byte
	launch[0] = 1
	return SnapshotBinding{
		LaunchCorrelation: launch, RegistrationHandle: "registration-1", RegisteredAppSubject: "subject-1",
		SourceGeneration: 1, DeclarationGeneration: 1, AccountID: "account-1",
		AccountGeneration: 1, RuntimeGeneration: 1,
	}
}
