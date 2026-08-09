package runtimeartifact

import (
	"context"
	"errors"
	"strings"
)

var ErrLocalAppArtifactUnavailable = errors.New("local App artifact is unavailable")

type LocalAppArtifactUse uint8

const (
	LocalAppArtifactUseInlineRead LocalAppArtifactUse = iota + 1
	LocalAppArtifactUseScenarioInput
	LocalAppArtifactUseAdoption
)

type LocalAppArtifactOwner struct {
	AccountID            string
	RegisteredAppSubject string
}

// OpenAuthorizedLocalAppArtifact is the single account-plus-registration
// authorizer for every Local App artifact consumer. The exact use is selected
// by Runtime code, never by the caller. AppID is intentionally absent.
func OpenAuthorizedLocalAppArtifact(
	ctx context.Context,
	store Store,
	artifactID string,
	owner LocalAppArtifactOwner,
	use LocalAppArtifactUse,
) (*ArtifactSource, error) {
	artifactID = strings.TrimSpace(artifactID)
	owner.AccountID = strings.TrimSpace(owner.AccountID)
	owner.RegisteredAppSubject = strings.TrimSpace(owner.RegisteredAppSubject)
	if ctx == nil || store == nil || artifactID == "" || len([]byte(artifactID)) > 512 ||
		owner.AccountID == "" || owner.RegisteredAppSubject == "" ||
		(use != LocalAppArtifactUseInlineRead && use != LocalAppArtifactUseScenarioInput && use != LocalAppArtifactUseAdoption) {
		return nil, ErrLocalAppArtifactUnavailable
	}
	source, ok := store.Open(ctx, artifactID)
	if !ok || source == nil || source.Body == nil || source.Record.Owner == nil {
		return nil, ErrLocalAppArtifactUnavailable
	}
	artifactOwner := source.Record.Owner
	if strings.TrimSpace(artifactOwner.SubjectUserID) != owner.AccountID ||
		strings.TrimSpace(artifactOwner.RegisteredAppSubject) != owner.RegisteredAppSubject {
		_ = source.Body.Close()
		return nil, ErrLocalAppArtifactUnavailable
	}
	return source, nil
}
