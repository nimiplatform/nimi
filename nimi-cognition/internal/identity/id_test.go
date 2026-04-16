package identity

import (
	"testing"
	"time"
)

func TestNewID_Format(t *testing.T) {
	id, err := NewID()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(id) != 26 {
		t.Errorf("expected 26 chars, got %d: %q", len(id), id)
	}
	if !ValidateID(id) {
		t.Errorf("generated ID fails validation: %q", id)
	}
}

func TestNewID_Unique(t *testing.T) {
	ids := make(map[string]struct{})
	for i := 0; i < 1000; i++ {
		id, err := NewID()
		if err != nil {
			t.Fatalf("iter %d: %v", i, err)
		}
		if _, dup := ids[id]; dup {
			t.Fatalf("duplicate at iter %d: %s", i, id)
		}
		ids[id] = struct{}{}
	}
}

func TestNewIDAt_Deterministic_Timestamp(t *testing.T) {
	ts := time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC)
	id1, _ := NewIDAt(ts)
	id2, _ := NewIDAt(ts)

	// Same timestamp prefix (first 10 chars) but different random suffix
	if id1[:10] != id2[:10] {
		t.Errorf("same timestamp should produce same prefix: %q vs %q", id1[:10], id2[:10])
	}
	if id1 == id2 {
		t.Error("different calls should produce different IDs due to randomness")
	}
}

func TestNewIDAt_Sortable(t *testing.T) {
	t1 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	t2 := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)

	id1, _ := NewIDAt(t1)
	id2, _ := NewIDAt(t2)

	if id1 >= id2 {
		t.Errorf("earlier timestamp should sort before later: %q >= %q", id1, id2)
	}
}

func TestNewPrefixed(t *testing.T) {
	id, err := NewPrefixed("rule")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(id) < 31 { // "rule_" + 26
		t.Errorf("expected at least 31 chars, got %d: %q", len(id), id)
	}
	if id[:5] != "rule_" {
		t.Errorf("expected 'rule_' prefix, got %q", id[:5])
	}
	if !ValidateID(id) {
		t.Errorf("prefixed ID fails validation: %q", id)
	}
}

func TestValidateID_Valid(t *testing.T) {
	cases := []string{
		"01ARZ3NDEKTSV4RRFFQ69G5FAV", // canonical ULID
		"00000000000000000000000000", // all zeros
		"7ZZZZZZZZZZZZZZZZZZZZZZZZZ", // max
	}
	for _, c := range cases {
		if !ValidateID(c) {
			t.Errorf("expected valid: %q", c)
		}
	}
}

func TestValidateID_Invalid(t *testing.T) {
	cases := []string{
		"",
		"too-short",
		"01ARZ3NDEKTSV4RRFFQ69G5FA",   // 25 chars
		"01ARZ3NDEKTSV4RRFFQ69G5FAVX", // 27 chars
		"01ARZ3NDEKTSV4RRFFQ69G5FAI",  // 'I' not in Crockford
		"01ARZ3NDEKTSV4RRFFQ69G5FAL",  // 'L' not in Crockford
		"01ARZ3NDEKTSV4RRFFQ69G5FAO",  // 'O' not in Crockford
		"01ARZ3NDEKTSV4RRFFQ69G5FAU",  // 'U' not in Crockford
	}
	for _, c := range cases {
		if ValidateID(c) {
			t.Errorf("expected invalid: %q", c)
		}
	}
}

func TestValidateID_PrefixedValid(t *testing.T) {
	id, _ := NewPrefixed("mem")
	if !ValidateID(id) {
		t.Errorf("prefixed ID should validate: %q", id)
	}
}
