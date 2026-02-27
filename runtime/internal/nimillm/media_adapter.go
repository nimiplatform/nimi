package nimillm

import (
	"google.golang.org/protobuf/types/known/timestamppb"
)

// MediaAdapterConfig holds the credentials for a specific provider adapter.
type MediaAdapterConfig struct {
	BaseURL string
	APIKey  string
}

// JobStateUpdater allows adapters to update async job polling state
// without depending on the services/ai package.
type JobStateUpdater interface {
	UpdatePollState(jobID string, providerJobID string, retryCount int32, nextPollAt *timestamppb.Timestamp, lastError string)
}
