package scheduler

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestAcquireForEndpointIsolatesDistinctPhysicalEndpoints(t *testing.T) {
	sched := New(Config{GlobalConcurrency: 8, PerAppConcurrency: 2})
	sched.SetEndpointCapacity("local:loadout-a", 1)
	sched.SetEndpointCapacity("cloud:connector-b", 2)

	relLocal, _, err := sched.AcquireForEndpoint(context.Background(), "local:loadout-a", PriorityP1Interactive, nil)
	if err != nil {
		t.Fatalf("acquire local: %v", err)
	}
	defer relLocal()

	// Cloud endpoint must proceed immediately without waiting on saturated local:loadout-a.
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	relCloud, _, err := sched.AcquireForEndpoint(ctx, "cloud:connector-b", PriorityP1Interactive, nil)
	if err != nil {
		t.Fatalf("cloud endpoint blocked by local endpoint: %v", err)
	}
	relCloud()
}

func TestAcquireForEndpointReservesP0SlotWhenCapAtLeastTwo(t *testing.T) {
	sched := New(Config{GlobalConcurrency: 8, PerAppConcurrency: 2})
	sched.SetEndpointCapacity("cloud:openai-main", 2)

	relP1, _, err := sched.AcquireForEndpoint(context.Background(), "cloud:openai-main", PriorityP1Interactive, nil)
	if err != nil {
		t.Fatalf("acquire first P1: %v", err)
	}
	defer relP1()

	// Second P1 must wait because slot 2 is reserved for P0 foreground.
	p1BlockedCtx, p1Cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer p1Cancel()
	if rel, _, err := sched.AcquireForEndpoint(p1BlockedCtx, "cloud:openai-main", PriorityP1Interactive, nil); err == nil {
		rel()
		t.Fatal("expected second P1 to wait while P0 reservation slot is active")
	}

	// P0 foreground acquires the reserved slot immediately!
	p0Ctx, p0Cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer p0Cancel()
	relP0, _, err := sched.AcquireForEndpoint(p0Ctx, "cloud:openai-main", PriorityP0Foreground, nil)
	if err != nil {
		t.Fatalf("P0 foreground must acquire reserved slot immediately: %v", err)
	}
	relP0()
}

func TestAcquireForEndpointSingleSlotP0CooperativelyPreemptsP2WithoutDualOccupancy(t *testing.T) {
	sched := New(Config{GlobalConcurrency: 8, PerAppConcurrency: 2})
	sched.SetEndpointCapacity("local:single-gpu", 1)

	var concurrent atomic.Int32
	var maxConcurrent atomic.Int32
	p2Preempted := make(chan struct{})
	p2Exited := make(chan struct{})

	relP2, _, err := sched.AcquireForEndpoint(context.Background(), "local:single-gpu", PriorityP2Background, func() {
		close(p2Preempted)
	})
	if err != nil {
		t.Fatalf("acquire P2: %v", err)
	}
	concurrent.Add(1)
	maxConcurrent.Store(1)

	// Simulate P2 stream cooperatively shutting down only after receiving preempt signal.
	go func() {
		<-p2Preempted
		time.Sleep(40 * time.Millisecond)
		concurrent.Add(-1)
		relP2()
		close(p2Exited)
	}()

	p0Acquired := make(chan struct{})
	var p0Err error
	go func() {
		relP0, _, err := sched.AcquireForEndpoint(context.Background(), "local:single-gpu", PriorityP0Foreground, nil)
		if err != nil {
			p0Err = err
			close(p0Acquired)
			return
		}
		cur := concurrent.Add(1)
		for {
			prev := maxConcurrent.Load()
			if cur <= prev || maxConcurrent.CompareAndSwap(prev, cur) {
				break
			}
		}
		close(p0Acquired)
		time.Sleep(10 * time.Millisecond)
		concurrent.Add(-1)
		relP0()
	}()

	select {
	case <-p2Preempted:
	case <-time.After(time.Second):
		t.Fatal("expected P0 to cooperatively trigger P2 preemption")
	}
	select {
	case <-p0Acquired:
	case <-time.After(time.Second):
		t.Fatal("expected P0 to acquire single slot after P2 exited")
	}
	<-p2Exited
	if p0Err != nil {
		t.Fatalf("P0 acquire error: %v", p0Err)
	}
	if maxConcurrent.Load() != 1 {
		t.Fatalf("dual VRAM occupancy violation: maxConcurrent=%d want 1", maxConcurrent.Load())
	}
}

func TestEndpointBucketCapGe2P0BypassesQueuedP1IntoReservedSlot(t *testing.T) {
	sched := New(Config{GlobalConcurrency: 8, PerAppConcurrency: 8})
	sched.SetEndpointCapacity("cloud:openai-shared", 2)

	// Occupy slot 1 with P1.
	relP1First, _, err := sched.AcquireForEndpoint(context.Background(), "cloud:openai-shared", PriorityP1Interactive, nil)
	if err != nil {
		t.Fatalf("P1 #1 acquire: %v", err)
	}
	defer relP1First()

	// Queue P1 #2 (blocked because slot 2 is reserved for P0) and KEEP it queued!
	p1SecondCtx, cancelP1Second := context.WithCancel(context.Background())
	defer cancelP1Second()
	p1SecondDone := make(chan struct{})
	go func() {
		defer close(p1SecondDone)
		rel, _, err := sched.AcquireForEndpoint(p1SecondCtx, "cloud:openai-shared", PriorityP1Interactive, nil)
		if err == nil && rel != nil {
			rel()
		}
	}()
	// Wait until P1 #2 is actually queued in bucket.waiters.
	deadline := time.Now().Add(time.Second)
	for sched.EndpointSnapshot("cloud:openai-shared").Queued == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if snap := sched.EndpointSnapshot("cloud:openai-shared"); snap.Queued != 1 {
		t.Fatalf("expected P1 #2 queued, got %+v", snap)
	}

	// P0 MUST acquire the free reserved slot immediately EVEN WHILE P1 #2 is waiting!
	p0Ctx, cancelP0 := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancelP0()
	relP0, _, err := sched.AcquireForEndpoint(p0Ctx, "cloud:openai-shared", PriorityP0Foreground, nil)
	if err != nil {
		t.Fatalf("P0 blocked behind queued P1 despite free reserved slot: %v", err)
	}
	relP0()
	cancelP1Second()
	<-p1SecondDone
}

func TestEndpointBucketSingleSlotQueuedP2HasPreemptInstalledAtomically(t *testing.T) {
	sched := New(Config{GlobalConcurrency: 8, PerAppConcurrency: 8})
	sched.SetEndpointCapacity("local:atomic-preempt", 1)

	// Hold slot 1 initially with P1.
	relP1, _, err := sched.AcquireForEndpoint(context.Background(), "local:atomic-preempt", PriorityP1Interactive, nil)
	if err != nil {
		t.Fatal(err)
	}
	preempted := make(chan struct{})
	p2Started := make(chan struct{})
	p2Done := make(chan struct{})
	go func() {
		defer close(p2Done)
		relP2, _, err := sched.AcquireForEndpoint(context.Background(), "local:atomic-preempt", PriorityP2Background, func() {
			close(preempted)
		})
		if err != nil {
			return
		}
		close(p2Started)
		<-preempted
		relP2()
	}()
	// Wait until P2 is queued.
	deadline := time.Now().Add(time.Second)
	for sched.EndpointSnapshot("local:atomic-preempt").Queued == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	// Release P1 -> dispatchLocked atomically promotes P2 WITH preempt installed.
	relP1()
	// Immediately request P0 right after relP1 (zero sleep!) -> preempt MUST fire!
	p0Ctx, cancelP0 := context.WithTimeout(context.Background(), time.Second)
	defer cancelP0()
	relP0, _, err := sched.AcquireForEndpoint(p0Ctx, "local:atomic-preempt", PriorityP0Foreground, nil)
	if err != nil {
		t.Fatalf("expected P0 to preempt queued->granted P2 immediately, got %v", err)
	}
	relP0()
	<-p2Started
	<-p2Done
}
