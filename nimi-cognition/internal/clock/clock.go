// Package clock provides a time abstraction for testability.
package clock

import "time"

// Clock provides the current time. Use RealClock in production
// and TestClock in tests.
type Clock interface {
	Now() time.Time
}

// RealClock returns real wall-clock time in UTC.
type RealClock struct{}

// Now returns the current UTC time.
func (RealClock) Now() time.Time { return time.Now().UTC() }

// TestClock returns a fixed or manually advanced time for testing.
type TestClock struct {
	current time.Time
}

// NewTestClock creates a TestClock starting at the given time.
func NewTestClock(start time.Time) *TestClock {
	return &TestClock{current: start.UTC()}
}

// Now returns the current test time.
func (c *TestClock) Now() time.Time { return c.current }

// Advance moves the clock forward by the given duration.
func (c *TestClock) Advance(d time.Duration) { c.current = c.current.Add(d) }

// Set sets the clock to a specific time.
func (c *TestClock) Set(t time.Time) { c.current = t.UTC() }
