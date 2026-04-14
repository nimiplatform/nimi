package memoryengine

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type TruthRecord struct {
	TruthID           string
	Dimension         string
	NormalizedKey     string
	Statement         string
	Confidence        float64
	SourceCount       int32
	ReviewCount       int32
	FirstReviewAt     string
	LastReviewAt      string
	Status            string
	SupersedesTruthID string
	SourceMemoryIDs   []string
}

type NarrativeRecord struct {
	NarrativeID     string
	Topic           string
	Content         string
	SourceVersion   string
	Status          string
	SourceMemoryIDs []string
}

type RelationRecord struct {
	RelationID   string
	SourceID     string
	TargetID     string
	RelationType string
	Confidence   float64
	CreatedBy    string
}

type ReviewCheckpoint struct {
	BankLocatorKey string
	LastReviewRun  string
	Checkpoint     string
	UpdatedAt      string
}

type ReviewOutcomes struct {
	Narratives []NarrativeRecord
	Truths     []TruthRecord
	Relations  []RelationRecord
	Summary    string
}

type CommitCanonicalReviewRequest struct {
	ReviewRunID     string
	Scope           ScopeDescriptor
	CheckpointBasis string
	Outcomes        ReviewOutcomes
}

type CanonicalReviewStore interface {
	ListAdmittedTruths(ctx context.Context, scope ScopeDescriptor) ([]TruthRecord, error)
	ListNarrativeContext(ctx context.Context, scope ScopeDescriptor, query string, limit int) ([]*runtimev1.NarrativeRecallHit, error)
	ListCanonicalReviewInputs(ctx context.Context, scope ScopeDescriptor, checkpoint string, limit int) ([]*runtimev1.MemoryRecord, error)
	GetReviewCheckpoint(ctx context.Context, scope ScopeDescriptor) (*ReviewCheckpoint, error)
	CommitCanonicalReview(ctx context.Context, req CommitCanonicalReviewRequest) error
}
