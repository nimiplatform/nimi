package protectedlocal

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDirectLocalAppLaunchIsIdempotentAndPIDReuseSafe(t *testing.T) {
	launches := NewDirectLocalAppLaunches()
	registration := Identifier{1}
	run := Identifier{2}
	hostExecutable := filepath.Join(os.TempDir(), "Nimi", "Host")
	expires := time.Now().Add(time.Minute)
	first, err := launches.Prepare(registration, run, 3, 4, 41, 501, hostExecutable, expires)
	if err != nil {
		t.Fatal(err)
	}
	second, err := launches.Prepare(registration, run, 3, 4, 41, 501, hostExecutable, expires)
	if err != nil {
		t.Fatal(err)
	}
	if second.LaunchID != first.LaunchID {
		t.Fatal("same supervisor run minted a second pending launch")
	}
	if _, err := launches.Prepare(registration, run, 5, 4, 41, 501, hostExecutable, expires); err == nil {
		t.Fatal("changed authority reused an existing supervisor run")
	}
	witness := DirectLocalAppProcessWitness{
		PID: 52, ParentPID: 41, UID: 501,
		StartSeconds: 6, StartMicros: 7, ExecutablePath: hostExecutable,
	}
	deadline := time.Now().Add(10 * time.Second)
	if _, err := launches.Bind(first.LaunchID, witness, 41, 501, deadline); err != nil {
		t.Fatal(err)
	}
	renewedExpiry := expires.Add(time.Minute)
	renewed, err := launches.Prepare(registration, run, 3, 4, 41, 501, hostExecutable, renewedExpiry)
	if err != nil {
		t.Fatal(err)
	}
	if !renewed.ExpiresAt.Equal(renewedExpiry) {
		t.Fatalf("renewed expiry = %v, want %v", renewed.ExpiresAt, renewedExpiry)
	}
	renewedDeadline := deadline.Add(5 * time.Second)
	if got, err := launches.Bind(first.LaunchID, witness, 41, 501, renewedDeadline); err != nil {
		t.Fatal(err)
	} else if !got.Equal(renewedDeadline) {
		t.Fatalf("renewed bind deadline = %v, want %v", got, renewedDeadline)
	}
	reused := witness
	reused.StartMicros++
	if _, err := launches.Bind(first.LaunchID, reused, 41, 501, deadline); err == nil {
		t.Fatal("PID reuse changed the process-start witness")
	}
	if _, err := launches.Consume(witness.PID, 502); err == nil {
		t.Fatal("wrong uid consumed a prepared launch")
	}
	consumed, err := launches.Consume(witness.PID, witness.UID)
	if err != nil {
		t.Fatal(err)
	}
	if consumed.Process != witness {
		t.Fatalf("consumed witness = %+v, want %+v", consumed.Process, witness)
	}
	runtimeGeneration := Identifier{3}
	connection, err := newDirectLocalAppConnection(DirectLocalAppPeer{
		OS: OSMacOS, PID: witness.PID, UID: witness.UID,
	}, consumed, runtimeGeneration)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(connection.Revoke)
	if connection.RuntimeBootEpoch() != runtimeGeneration {
		t.Fatal("direct local-App connection omitted the Runtime generation")
	}
	if _, err := launches.Consume(witness.PID, witness.UID); err == nil {
		t.Fatal("one-time launch was replayed")
	}
}

func TestDirectInstalledBindingPreservesVerifiedSourceGenerationsAndOneUse(t *testing.T) {
	launches := NewDirectLocalAppLaunches()
	registration := Identifier{11}
	handle := "rar_v1_" + base64.RawURLEncoding.EncodeToString(registration[:])
	executable := filepath.Join(os.TempDir(), "installed", "app.exe")
	parent := localAppRegistryProcess(7101, 0x72)
	process := localAppRegistryProcess(7102, 0x73)
	process.CreationMarker = "1234"
	process.CanonicalExecutablePath = executable
	policy := InstalledAppProcessPolicy{RegistrationHandle: handle, SourceGeneration: 3, DeclarationGeneration: 4,
		HostExecutablePath: executable, HostExecutableDigest: process.ExecutableDigest, ExecutionProfileRef: "windows-user-mode-as-invoker-v1", SupervisorProcess: parent}
	prepared, err := launches.Prepare(registration, Identifier{12}, 3, 4, parent.PID, 1, executable, time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	wrong := process
	wrong.ExecutableDigest = Identifier{13}
	if _, err := launches.BindInstalled(prepared.LaunchID, policy, wrong, 1, time.Now().Add(time.Second)); err == nil {
		t.Fatal("mismatched installed executable bound")
	}
	if _, err := launches.BindInstalled(prepared.LaunchID, policy, process, 1, time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	bound, err := launches.Consume(process.PID, 1)
	if err != nil {
		t.Fatal(err)
	}
	connection, err := newDirectLocalAppConnection(DirectLocalAppPeer{OS: OSWindows, PID: process.PID, UID: 1}, bound, Identifier{14})
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Revoke()
	actual, ok := connection.InstalledRegistrationHandle()
	if !ok || actual != handle || connection.TrustClass() != LocalAppTrustVerified || connection.Process() != process {
		t.Fatal("installed binding became development or lost exact process")
	}
	source, declaration, ok := connection.InstalledLaunchGenerations()
	if !ok || source != 3 || declaration != 4 {
		t.Fatal("installed generations were lost")
	}
	if _, err := launches.Consume(process.PID, 1); err == nil {
		t.Fatal("installed peer replay succeeded")
	}
}

func TestDirectLocalAppLaunchRenewsAfterConsumeAndExpiry(t *testing.T) {
	launches := NewDirectLocalAppLaunches()
	now := time.Now().UTC()
	launches.now = func() time.Time { return now }
	registration := Identifier{1}
	run := Identifier{2}
	hostExecutable := filepath.Join(os.TempDir(), "Nimi", "Host")
	witness := DirectLocalAppProcessWitness{
		PID: 52, ParentPID: 41, UID: 501,
		StartSeconds: 6, StartMicros: 7, ExecutablePath: hostExecutable,
	}
	prepareAndBind := func() (DirectLocalAppLaunch, error) {
		launch, err := launches.Prepare(registration, run, 3, 4, 41, 501, hostExecutable, now.Add(30*time.Second))
		if err != nil {
			return DirectLocalAppLaunch{}, err
		}
		if _, err := launches.Bind(launch.LaunchID, witness, 41, 501, now.Add(10*time.Second)); err != nil {
			return DirectLocalAppLaunch{}, err
		}
		return launch, nil
	}

	// First Runtime loss and rebind: the still-running Host consumes its
	// one-shot witness.
	first, err := prepareAndBind()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := launches.Consume(witness.PID, witness.UID); err != nil {
		t.Fatal(err)
	}

	// Consecutive loss on the same Host: renewal mints a fresh one-shot launch
	// and the same verified process binds and consumes again.
	second, err := prepareAndBind()
	if err != nil {
		t.Fatalf("same-Host renewal failed: %v", err)
	}
	if second.LaunchID == first.LaunchID {
		t.Fatal("renewal reused a consumed one-shot launch")
	}
	if _, err := launches.Consume(witness.PID, witness.UID); err != nil {
		t.Fatal(err)
	}

	// Abrupt crash-style loss: the witness is never consumed and expires at its
	// bind deadline; a late Consume fails closed.
	third, err := prepareAndBind()
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(11 * time.Second)
	if _, err := launches.Consume(witness.PID, witness.UID); err == nil {
		t.Fatal("expired launch was consumed")
	}

	// Renewal after expiry admits the same still-running Host again.
	fourth, err := prepareAndBind()
	if err != nil {
		t.Fatalf("post-expiry renewal failed: %v", err)
	}
	if fourth.LaunchID == third.LaunchID {
		t.Fatal("post-expiry renewal reused an expired launch")
	}
	if _, err := launches.Consume(witness.PID, witness.UID); err != nil {
		t.Fatal(err)
	}
}
