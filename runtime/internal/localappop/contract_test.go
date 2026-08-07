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
	got := make([]string, 0, len(canonicalAppOperationContract))
	for _, row := range canonicalAppOperationContract {
		got = append(got, row.id)
	}
	want := []string{
		"runtime.app-storage.json.read",
		"runtime.app-storage.json.write",
		"runtime.app-storage.json.remove",
		"runtime.ai.app-config.get",
		"runtime.ai.app-config.overwrite",
		"realm.world-core.list",
		"realm.world-core.create",
		"runtime.ai.text-candidate.generate",
		"runtime.agent.reference.list",
		"runtime.agent.conversation.open",
		"runtime.agent.conversation.turn.send",
		"runtime.agent.conversation.turn.interrupt",
		"runtime.agent.conversation.events.subscribe",
		"runtime.agent.conversation.snapshot.get",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("canonical AppOperationIds = %#v", got)
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
