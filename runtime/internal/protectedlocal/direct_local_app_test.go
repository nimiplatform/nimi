package protectedlocal

import (
	"testing"
	"time"
)

func TestDirectLocalAppLaunchIsIdempotentAndPIDReuseSafe(t *testing.T) {
	launches := NewDirectLocalAppLaunches()
	registration := Identifier{1}
	run := Identifier{2}
	expires := time.Now().Add(time.Minute)
	first, err := launches.Prepare(registration, run, 3, 4, 41, 501, "/Applications/Host", expires)
	if err != nil {
		t.Fatal(err)
	}
	second, err := launches.Prepare(registration, run, 3, 4, 41, 501, "/Applications/Host", expires)
	if err != nil {
		t.Fatal(err)
	}
	if second.LaunchID != first.LaunchID {
		t.Fatal("same supervisor run minted a second pending launch")
	}
	if _, err := launches.Prepare(registration, run, 5, 4, 41, 501, "/Applications/Host", expires); err == nil {
		t.Fatal("changed authority reused an existing supervisor run")
	}
	witness := DirectLocalAppProcessWitness{
		PID: 52, ParentPID: 41, UID: 501,
		StartSeconds: 6, StartMicros: 7, ExecutablePath: "/Applications/Host",
	}
	deadline := time.Now().Add(10 * time.Second)
	if _, err := launches.Bind(first.LaunchID, witness, 41, 501, deadline); err != nil {
		t.Fatal(err)
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
	if _, err := launches.Consume(witness.PID, witness.UID); err == nil {
		t.Fatal("one-time launch was replayed")
	}
}

func TestDirectLocalAppLaunchRenewsAfterConsumeAndExpiry(t *testing.T) {
	launches := NewDirectLocalAppLaunches()
	now := time.Now().UTC()
	launches.now = func() time.Time { return now }
	registration := Identifier{1}
	run := Identifier{2}
	witness := DirectLocalAppProcessWitness{
		PID: 52, ParentPID: 41, UID: 501,
		StartSeconds: 6, StartMicros: 7, ExecutablePath: "/Applications/Host",
	}
	prepareAndBind := func() (DirectLocalAppLaunch, error) {
		launch, err := launches.Prepare(registration, run, 3, 4, 41, 501, "/Applications/Host", now.Add(30*time.Second))
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
