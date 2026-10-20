package runtimeagent

import "time"

// The interaction interval outlives an individual execution slot. The source
// identity fences a late release from an earlier turn; no timer owns state.
type lifeInteraction struct {
	ID             string    `json:"id"`
	SourceID       string    `json:"sourceId"`
	StartedAt      time.Time `json:"startedAt"`
	LastActivityAt time.Time `json:"lastActivityAt"`
}
