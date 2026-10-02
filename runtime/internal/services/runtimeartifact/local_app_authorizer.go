package runtimeartifact

import (
	"context"
	"errors"
	"strings"
	"time"
)

var ErrLocalAppArtifactUnavailable = errors.New("local App artifact is unavailable")

type LocalAppArtifactUse uint8

const (
	LocalAppArtifactUseInlineRead LocalAppArtifactUse = iota + 1
	LocalAppArtifactUseScenarioInput
	LocalAppArtifactUseAdoption
	LocalAppArtifactUseAudioPreparation
)

type LocalAppArtifactOwner struct {
	AccountID            string
	RegisteredAppSubject string
}

// StatAuthorizedLocalAppArtifact validates the same owner before body opening.
// It is used for trusted dialect resource preflight, not an existence oracle.
func StatAuthorizedLocalAppArtifact(ctx context.Context, store Store, artifactID string, owner LocalAppArtifactOwner) (ArtifactRecord, error) {
	if ctx == nil || store == nil || ctx.Err() != nil || strings.TrimSpace(artifactID) == "" || len([]byte(strings.TrimSpace(artifactID))) > 512 || owner.AccountID == "" || owner.RegisteredAppSubject == "" {
		return ArtifactRecord{}, ErrLocalAppArtifactUnavailable
	}
	record, ok := store.Stat(strings.TrimSpace(artifactID))
	if !ok || !localAppArtifactOwnerValid(record, owner) {
		return ArtifactRecord{}, ErrLocalAppArtifactUnavailable
	}
	return record, nil
}

func localAppArtifactOwnerValid(record ArtifactRecord, owner LocalAppArtifactOwner) bool {
	return record.Owner != nil && strings.TrimSpace(record.Owner.SubjectUserID) == strings.TrimSpace(owner.AccountID) && strings.TrimSpace(record.Owner.RegisteredAppSubject) == strings.TrimSpace(owner.RegisteredAppSubject) && (record.MusicRecoveryUntil.IsZero() || time.Now().Before(record.MusicRecoveryUntil))
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
		(use != LocalAppArtifactUseInlineRead && use != LocalAppArtifactUseScenarioInput && use != LocalAppArtifactUseAdoption && use != LocalAppArtifactUseAudioPreparation) {
		return nil, ErrLocalAppArtifactUnavailable
	}
	source, ok := store.Open(ctx, artifactID)
	if !ok || source == nil || source.Body == nil || source.Record.Owner == nil {
		return nil, ErrLocalAppArtifactUnavailable
	}
	if !localAppArtifactOwnerValid(source.Record, owner) {
		_ = source.Body.Close()
		return nil, ErrLocalAppArtifactUnavailable
	}
	return source, nil
}
