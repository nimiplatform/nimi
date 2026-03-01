package idempotency

import (
	"testing"
	"time"
)

func TestStoreBasicSaveAndLoad(t *testing.T) {
	s := New(time.Hour, 100)
	s.Save("method", "app1", "user1", "key1", "hash1", "response1")

	resp, hit, conflict := s.Load("method", "app1", "user1", "key1", "hash1")
	if !hit {
		t.Fatal("expected hit")
	}
	if conflict {
		t.Fatal("unexpected conflict")
	}
	if resp != "response1" {
		t.Fatalf("got %v, want response1", resp)
	}
}

func TestStoreConflictDetection(t *testing.T) {
	s := New(time.Hour, 100)
	s.Save("method", "app1", "user1", "key1", "hash1", "response1")

	_, hit, conflict := s.Load("method", "app1", "user1", "key1", "different-hash")
	if hit {
		t.Fatal("should not hit with different hash")
	}
	if !conflict {
		t.Fatal("expected conflict")
	}
}

func TestStoreMiss(t *testing.T) {
	s := New(time.Hour, 100)

	_, hit, conflict := s.Load("method", "app1", "user1", "key1", "hash1")
	if hit || conflict {
		t.Fatal("expected miss")
	}
}

func TestStoreTTLExpiration(t *testing.T) {
	s := New(1*time.Millisecond, 100)
	s.Save("method", "app1", "user1", "key1", "hash1", "response1")
	time.Sleep(5 * time.Millisecond)

	_, hit, _ := s.Load("method", "app1", "user1", "key1", "hash1")
	if hit {
		t.Fatal("entry should have expired")
	}
}

func TestStoreLRUEviction(t *testing.T) {
	s := New(time.Hour, 3) // capacity=3

	s.Save("m", "a", "u", "k1", "h1", "r1")
	s.Save("m", "a", "u", "k2", "h2", "r2")
	s.Save("m", "a", "u", "k3", "h3", "r3")

	// All 3 should be present.
	for _, k := range []string{"k1", "k2", "k3"} {
		_, hit, _ := s.Load("m", "a", "u", k, "h"+k[1:])
		if !hit {
			t.Fatalf("expected hit for %s", k)
		}
	}

	// Add a 4th entry, should evict the LRU (k1, since k2/k3 were accessed by Load).
	// But Load refreshes LRU, so k1 was also refreshed. Let's test without Load refresh.
	s2 := New(time.Hour, 3)
	s2.Save("m", "a", "u", "k1", "h1", "r1")
	s2.Save("m", "a", "u", "k2", "h2", "r2")
	s2.Save("m", "a", "u", "k3", "h3", "r3")
	// Don't Load (no LRU refresh), add k4 — k1 should be evicted.
	s2.Save("m", "a", "u", "k4", "h4", "r4")

	_, hit, _ := s2.Load("m", "a", "u", "k1", "h1")
	if hit {
		t.Fatal("k1 should have been evicted")
	}
	_, hit, _ = s2.Load("m", "a", "u", "k4", "h4")
	if !hit {
		t.Fatal("k4 should be present")
	}
}

func TestStoreLRURefreshOnLoad(t *testing.T) {
	s := New(time.Hour, 3)

	s.Save("m", "a", "u", "k1", "h1", "r1")
	s.Save("m", "a", "u", "k2", "h2", "r2")
	s.Save("m", "a", "u", "k3", "h3", "r3")

	// Access k1 to move it to back of LRU.
	s.Load("m", "a", "u", "k1", "h1")

	// Add k4 — k2 should be evicted (oldest unaccessed).
	s.Save("m", "a", "u", "k4", "h4", "r4")

	_, hit, _ := s.Load("m", "a", "u", "k2", "h2")
	if hit {
		t.Fatal("k2 should have been evicted")
	}
	_, hit, _ = s.Load("m", "a", "u", "k1", "h1")
	if !hit {
		t.Fatal("k1 should still be present (was refreshed)")
	}
}

func TestStoreCapacityDefault(t *testing.T) {
	s := New(time.Hour, 0) // should default to 10000
	if s.capacity != 10000 {
		t.Fatalf("default capacity should be 10000, got %d", s.capacity)
	}
}
