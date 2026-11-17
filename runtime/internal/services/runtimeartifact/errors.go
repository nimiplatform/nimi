package runtimeartifact

import "errors"

// ErrInvalidArtifactID is returned by Store.Put when artifact_id is empty.
// Maps to ARTIFACT_INVALID_INPUT at the gRPC layer.
var ErrInvalidArtifactID = errors.New("runtimeartifact: artifact_id is required")

// ErrInvalidArtifactRecord is returned when required artifact metadata cannot
// be normalized safely.
var ErrInvalidArtifactRecord = errors.New("runtimeartifact: artifact record is invalid")

// ErrArtifactTooLarge reports a body that exceeds its custody or read bound.
var ErrArtifactTooLarge = errors.New("runtimeartifact: artifact body is too large")

var errArtifactUnavailable = errors.New("runtimeartifact: artifact body is unavailable")
