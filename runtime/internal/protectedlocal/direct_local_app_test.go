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
