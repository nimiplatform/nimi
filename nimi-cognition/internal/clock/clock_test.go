package clock

import (
	"testing"
	"time"
)

func TestRealClock_ReturnsUTC(t *testing.T) {
	c := RealClock{}
	now := c.Now()
	if now.Location() != time.UTC {
		t.Errorf("expected UTC, got %v", now.Location())
	}
}

func TestTestClock_FixedTime(t *testing.T) {
	fixed := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	c := NewTestClock(fixed)
	if !c.Now().Equal(fixed) {
		t.Errorf("got %v, want %v", c.Now(), fixed)
	}
	if !c.Now().Equal(fixed) {
		t.Error("repeated call should return same time")
	}
}

func TestTestClock_Advance(t *testing.T) {
	fixed := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	c := NewTestClock(fixed)
	c.Advance(5 * time.Minute)
	want := fixed.Add(5 * time.Minute)
	if !c.Now().Equal(want) {
		t.Errorf("got %v, want %v", c.Now(), want)
	}
}

func TestTestClock_Set(t *testing.T) {
	c := NewTestClock(time.Now())
	target := time.Date(2030, 6, 15, 0, 0, 0, 0, time.UTC)
	c.Set(target)
	if !c.Now().Equal(target) {
		t.Errorf("got %v, want %v", c.Now(), target)
	}
}

func TestTestClock_ConvertsToUTC(t *testing.T) {
	loc, _ := time.LoadLocation("America/New_York")
	local := time.Date(2026, 1, 1, 12, 0, 0, 0, loc)
	c := NewTestClock(local)
	if c.Now().Location() != time.UTC {
		t.Errorf("expected UTC, got %v", c.Now().Location())
	}
}
