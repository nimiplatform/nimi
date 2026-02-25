package main

type providerSnapshot struct {
	Name                string `json:"name"`
	State               string `json:"state"`
	Reason              string `json:"reason"`
	ConsecutiveFailures int64  `json:"consecutive_failures"`
	LastChangedAt       string `json:"last_changed_at"`
	LastCheckedAt       string `json:"last_checked_at"`
}

type runtimeHealthSnapshot struct {
	Status              string
	StatusCode          int32
	Reason              string
	QueueDepth          int32
	ActiveWorkflows     int32
	ActiveInferenceJobs int32
	CPUMilli            int64
	MemoryBytes         int64
	VRAMBytes           int64
	SampledAt           string
}

type runtimeHealthChange struct {
	Field  string `json:"field"`
	Before string `json:"before"`
	After  string `json:"after"`
}

type providerChange struct {
	Name   string            `json:"name"`
	Type   string            `json:"type"`
	Before *providerSnapshot `json:"before,omitempty"`
	After  *providerSnapshot `json:"after,omitempty"`
}

const (
	providerSourceHTTP = "http"
	providerSourceGRPC = "grpc"
)
