package localappkernel

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"
)

const maxBrowseSnapshotBytes = 8 * 1024 * 1024

var (
	ErrVerifiedPolicyNotFound = errors.New("verified App policy verification record not found")
	ErrBrowseSnapshotNotFound = errors.New("public App Catalog browse snapshot not found")
)

type VerifiedPolicyStatus string

const (
	VerifiedPolicyAllowed   VerifiedPolicyStatus = "allowed"
	VerifiedPolicyBlocked   VerifiedPolicyStatus = "policy_blocked"
	VerifiedPolicyRowAbsent VerifiedPolicyStatus = "row_absent"
)

// VerifiedPolicyVerification persists Runtime's last official Registry policy
// verification result for one exact installed verified App target.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
type VerifiedPolicyVerification struct {
	AppID            string
	ReleaseRef       string
	DescriptorID     string
	TargetID         string
	Status           VerifiedPolicyStatus
	PolicyReason     string
	PolicyRevision   uint64
	RegistryRevision string
	VerifiedAt       time.Time
	// ObservedAt is the optional timestamp captured before the official Registry
	// fetch began. When zero, VerifiedAt is used for precedence comparison.
	ObservedAt time.Time
	// OrderedObservation indicates that the installed App coordinator has
	// resolved observation order before writing a row presence or absence.
	// VerifiedAt still records the actual clock time for that observation.
	OrderedObservation bool
}

// PublicCatalogBrowseSnapshot persists Runtime's last validated display-only
// public catalog browse projection for one platform target. It grants no
// install, update, or launch authority.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
type PublicCatalogBrowseSnapshot struct {
	TargetID         string
	OS               string
	Arch             string
	RegistryRevision string
	ProjectionJSON   []byte
	UpdatedAt        time.Time
}

func validateVerifiedPolicyVerification(record VerifiedPolicyVerification) error {
	if requireExactText("app_id", record.AppID) != nil ||
		requireExactText("release_ref", record.ReleaseRef) != nil ||
		requireExactText("descriptor_id", record.DescriptorID) != nil ||
		requireExactText("target_id", record.TargetID) != nil {
		return ErrInvalidArgument
	}
	if record.VerifiedAt.IsZero() || record.VerifiedAt.UnixNano() <= 0 || record.PolicyRevision > math.MaxInt64 {
		return ErrInvalidArgument
	}
	if !record.ObservedAt.IsZero() && record.ObservedAt.UnixNano() <= 0 {
		return ErrInvalidArgument
	}
	if record.RegistryRevision != "" && requireExactText("registry_revision", record.RegistryRevision) != nil {
		return ErrInvalidArgument
	}
	switch record.Status {
	case VerifiedPolicyAllowed:
		if record.PolicyReason != "" || requireExactText("registry_revision", record.RegistryRevision) != nil {
			return ErrInvalidArgument
		}
	case VerifiedPolicyBlocked:
		if requireExactText("policy_reason", record.PolicyReason) != nil {
			return ErrInvalidArgument
		}
	case VerifiedPolicyRowAbsent:
		if record.PolicyReason != "" {
			return ErrInvalidArgument
		}
	default:
		return ErrInvalidArgument
	}
	return nil
}

func upsertVerifiedPolicyTx(ctx context.Context, tx *sql.Tx, record VerifiedPolicyVerification) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO verified_app_policy_verification(
		app_id, source_class, release_ref, descriptor_id, target_id,
		policy_status, policy_reason, policy_revision, registry_revision, verified_unix_nano
	) VALUES (?, 'verified', ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(app_id, source_class) DO UPDATE SET
		release_ref = excluded.release_ref,
		descriptor_id = excluded.descriptor_id,
		target_id = excluded.target_id,
		policy_status = excluded.policy_status,
		policy_reason = excluded.policy_reason,
		policy_revision = excluded.policy_revision,
		registry_revision = excluded.registry_revision,
		verified_unix_nano = excluded.verified_unix_nano`,
		record.AppID, record.ReleaseRef, record.DescriptorID, record.TargetID,
		string(record.Status), record.PolicyReason, int64(record.PolicyRevision),
		record.RegistryRevision, record.VerifiedAt.UTC().UnixNano())
	if err != nil {
		return fmt.Errorf("write verified App policy verification: %w", err)
	}
	return nil
}

// RecordVerifiedPolicy durably stores the outcome of an official Registry
// policy check bound to the currently committed exact verified release and
// returns the actual effective VerifiedPolicyVerification stored in SQLite
// after transactional reconciliation.
// Precedence is strictly monotonic so stale out-of-order allow results never
// overwrite newer deny outcomes or roll verification timestamps backward.
// Non-registration metadata commits without invalidating active job authorities.
func (store *PackageLifecycleStore) RecordVerifiedPolicy(ctx context.Context, record VerifiedPolicyVerification) (VerifiedPolicyVerification, error) {
	if store == nil || store.kernel == nil {
		return VerifiedPolicyVerification{}, ErrInvalidArgument
	}
	if err := validateVerifiedPolicyVerification(record); err != nil {
		return VerifiedPolicyVerification{}, err
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return VerifiedPolicyVerification{}, fmt.Errorf("begin verified App policy transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var found int
	err = tx.QueryRowContext(ctx, `SELECT 1 FROM committed_app_release
		WHERE app_id = ? AND source_class = 'verified' AND release_ref = ?`,
		record.AppID, record.ReleaseRef).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return VerifiedPolicyVerification{}, ErrCommittedReleaseNotFound
	}
	if err != nil {
		return VerifiedPolicyVerification{}, fmt.Errorf("verify committed App release for policy record: %w", err)
	}
	var existing VerifiedPolicyVerification
	var statusText string
	var policyRevision, verifiedNano int64
	err = tx.QueryRowContext(ctx, `SELECT app_id, release_ref, descriptor_id, target_id,
		policy_status, policy_reason, policy_revision, registry_revision, verified_unix_nano
		FROM verified_app_policy_verification
		WHERE app_id = ? AND source_class = 'verified'`, record.AppID).Scan(
		&existing.AppID, &existing.ReleaseRef, &existing.DescriptorID, &existing.TargetID,
		&statusText, &existing.PolicyReason, &policyRevision, &existing.RegistryRevision, &verifiedNano,
	)
	if err == nil {
		if policyRevision >= 0 && verifiedNano > 0 {
			existing.Status = VerifiedPolicyStatus(statusText)
			existing.PolicyRevision = uint64(policyRevision)
			existing.VerifiedAt = time.Unix(0, verifiedNano).UTC()
			if validateVerifiedPolicyVerification(existing) == nil &&
				existing.ReleaseRef == record.ReleaseRef &&
				existing.DescriptorID == record.DescriptorID &&
				existing.TargetID == record.TargetID {
				next, shouldWrite := reconcileVerifiedPolicy(existing, record)
				if !shouldWrite {
					return next, nil
				}
				record = next
			}
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return VerifiedPolicyVerification{}, fmt.Errorf("read existing verified App policy verification: %w", err)
	}
	if err := upsertVerifiedPolicyTx(ctx, tx, record); err != nil {
		return VerifiedPolicyVerification{}, err
	}
	if err := tx.Commit(); err != nil {
		return VerifiedPolicyVerification{}, fmt.Errorf("commit verified App policy verification: %w", err)
	}
	effective := record
	effective.VerifiedAt = time.Unix(0, record.VerifiedAt.UTC().UnixNano()).UTC()
	effective.ObservedAt = time.Time{}
	effective.OrderedObservation = false
	return effective, nil
}

// reconcileVerifiedPolicy enforces monotonic D1 precedence for the same exact
// (release_ref, descriptor_id, target_id):
// - Strictly higher PolicyRevision wins; incoming allow with lower revision never overwrites.
// - On equal PolicyRevision, policy_blocked is never overwritten by allow (a real lift increments revision).
// - The installed App coordinator orders row presence and absence by its own sequence.
// - Without that ordering, an observed row restoration must have a strictly newer timestamp.
// - A kill-switch deny supersedes allow with an equal or lower policy revision.
// - allowed -> allowed at same PolicyRevision advances VerifiedAt only monotonically forward.
func reconcileVerifiedPolicy(existing, incoming VerifiedPolicyVerification) (VerifiedPolicyVerification, bool) {
	incomingObs := incoming.ObservedAt.UTC()
	if incomingObs.IsZero() {
		incomingObs = incoming.VerifiedAt.UTC()
	}
	incomingAt := incoming.VerifiedAt.UTC()
	existingAt := existing.VerifiedAt.UTC()

	switch incoming.Status {
	case VerifiedPolicyAllowed:
		if incoming.PolicyRevision < existing.PolicyRevision {
			return existing, false
		}
		switch existing.Status {
		case VerifiedPolicyBlocked:
			if incoming.PolicyRevision == existing.PolicyRevision {
				return existing, false
			}
			return incoming, true
		case VerifiedPolicyRowAbsent:
			if !incoming.OrderedObservation && !incomingObs.After(existingAt) {
				return existing, false
			}
			return incoming, true
		case VerifiedPolicyAllowed:
			if incoming.PolicyRevision > existing.PolicyRevision {
				if incomingAt.Before(existingAt) {
					incoming.VerifiedAt = existingAt
				}
				return incoming, true
			}
			if incomingAt.Before(existingAt) || incomingObs.Before(existingAt) {
				return existing, false
			}
			if incomingAt.Equal(existingAt) && incoming.RegistryRevision == existing.RegistryRevision {
				return existing, false
			}
			return incoming, true
		default:
			return incoming, true
		}

	case VerifiedPolicyBlocked:
		if incoming.PolicyRevision < existing.PolicyRevision {
			return existing, false
		}
		switch existing.Status {
		case VerifiedPolicyAllowed:
			return incoming, true
		case VerifiedPolicyBlocked:
			if incoming.PolicyRevision > existing.PolicyRevision {
				return incoming, true
			}
			if incomingAt.Before(existingAt) {
				return existing, false
			}
			if incoming.RegistryRevision == "" && existing.RegistryRevision != "" {
				incoming.RegistryRevision = existing.RegistryRevision
			}
			return incoming, true
		case VerifiedPolicyRowAbsent:
			if incoming.PolicyRevision > existing.PolicyRevision || !incomingObs.Before(existingAt) {
				return incoming, true
			}
			return existing, false
		default:
			return incoming, true
		}

	case VerifiedPolicyRowAbsent:
		// An absent row supplies no kill-switch revision or lift. Keep any
		// explicit block until a higher-revision official approval is observed.
		if existing.Status == VerifiedPolicyBlocked {
			return existing, false
		}
		if incoming.OrderedObservation {
			return incoming, true
		}
		switch existing.Status {
		case VerifiedPolicyAllowed:
			if !incomingObs.Before(existingAt) {
				return incoming, true
			}
			return existing, false
		case VerifiedPolicyRowAbsent:
			if incomingAt.Before(existingAt) {
				return existing, false
			}
			return incoming, true
		default:
			return incoming, true
		}

	default:
		return existing, false
	}
}

// DeleteVerifiedPolicy removes a persisted verified App policy verification
// record for one exact target. Used as a best-effort fail-closed invalidation
// if persisting a newer deny outcome fails on disk.
func (store *PackageLifecycleStore) DeleteVerifiedPolicy(
	ctx context.Context,
	appID, releaseRef, descriptorID, targetID string,
) error {
	if store == nil || store.kernel == nil ||
		requireExactText("app_id", appID) != nil ||
		requireExactText("release_ref", releaseRef) != nil ||
		requireExactText("descriptor_id", descriptorID) != nil ||
		requireExactText("target_id", targetID) != nil {
		return ErrInvalidArgument
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	if _, err := store.kernel.db.ExecContext(ctx, `DELETE FROM verified_app_policy_verification
		WHERE app_id = ? AND source_class = 'verified'
		  AND release_ref = ? AND descriptor_id = ? AND target_id = ?`,
		appID, releaseRef, descriptorID, targetID); err != nil {
		return fmt.Errorf("delete verified App policy verification: %w", err)
	}
	return nil
}

// GetVerifiedPolicy returns the last persisted official Registry policy
// verification for the exact committed verified target.
func (store *PackageLifecycleStore) GetVerifiedPolicy(
	ctx context.Context,
	appID, releaseRef, descriptorID, targetID string,
) (VerifiedPolicyVerification, error) {
	if store == nil || store.kernel == nil ||
		requireExactText("app_id", appID) != nil ||
		requireExactText("release_ref", releaseRef) != nil ||
		requireExactText("descriptor_id", descriptorID) != nil ||
		requireExactText("target_id", targetID) != nil {
		return VerifiedPolicyVerification{}, ErrInvalidArgument
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	var record VerifiedPolicyVerification
	var statusText string
	var policyRevision, verifiedNano int64
	err := store.kernel.db.QueryRowContext(ctx, `SELECT v.app_id, v.release_ref, v.descriptor_id, v.target_id,
		v.policy_status, v.policy_reason, v.policy_revision, v.registry_revision, v.verified_unix_nano
		FROM verified_app_policy_verification v
		JOIN committed_app_release r
		  ON r.app_id = v.app_id AND r.source_class = v.source_class AND r.release_ref = v.release_ref
		WHERE v.app_id = ? AND v.source_class = 'verified'
		  AND v.release_ref = ? AND v.descriptor_id = ? AND v.target_id = ?`,
		appID, releaseRef, descriptorID, targetID).Scan(
		&record.AppID, &record.ReleaseRef, &record.DescriptorID, &record.TargetID,
		&statusText, &record.PolicyReason, &policyRevision, &record.RegistryRevision, &verifiedNano,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return VerifiedPolicyVerification{}, ErrVerifiedPolicyNotFound
	}
	if err != nil {
		return VerifiedPolicyVerification{}, fmt.Errorf("read verified App policy verification: %w", err)
	}
	if policyRevision < 0 || verifiedNano <= 0 {
		return VerifiedPolicyVerification{}, ErrVerifiedPolicyNotFound
	}
	record.Status = VerifiedPolicyStatus(statusText)
	record.PolicyRevision = uint64(policyRevision)
	record.VerifiedAt = time.Unix(0, verifiedNano).UTC()
	if err := validateVerifiedPolicyVerification(record); err != nil {
		return VerifiedPolicyVerification{}, ErrVerifiedPolicyNotFound
	}
	return record, nil
}

// SavePublicCatalogBrowseSnapshot persists one validated public catalog browse
// projection for display-only offline fallback.
func (store *PackageLifecycleStore) SavePublicCatalogBrowseSnapshot(ctx context.Context, snapshot PublicCatalogBrowseSnapshot) error {
	if store == nil || store.kernel == nil ||
		requireExactText("target_id", snapshot.TargetID) != nil ||
		requireExactText("os", snapshot.OS) != nil ||
		requireExactText("arch", snapshot.Arch) != nil {
		return ErrInvalidArgument
	}
	if snapshot.RegistryRevision != "" {
		if snapshot.RegistryRevision != strings.TrimSpace(snapshot.RegistryRevision) ||
			!utf8.ValidString(snapshot.RegistryRevision) || len(snapshot.RegistryRevision) > 128 {
			return ErrInvalidArgument
		}
	}
	if len(snapshot.ProjectionJSON) == 0 || len(snapshot.ProjectionJSON) > maxBrowseSnapshotBytes || !json.Valid(snapshot.ProjectionJSON) {
		return ErrInvalidArgument
	}
	if snapshot.UpdatedAt.IsZero() || snapshot.UpdatedAt.UnixNano() <= 0 {
		return ErrInvalidArgument
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	_, err := store.kernel.db.ExecContext(ctx, `INSERT INTO public_app_catalog_browse_snapshot(
		target_id, os, arch, registry_revision, projection_json, updated_unix_nano
	) VALUES (?, ?, ?, ?, ?, ?)
	ON CONFLICT(target_id, os, arch) DO UPDATE SET
		registry_revision = excluded.registry_revision,
		projection_json = excluded.projection_json,
		updated_unix_nano = excluded.updated_unix_nano`,
		snapshot.TargetID, snapshot.OS, snapshot.Arch, snapshot.RegistryRevision,
		snapshot.ProjectionJSON, snapshot.UpdatedAt.UTC().UnixNano())
	if err != nil {
		return fmt.Errorf("write public App Catalog browse snapshot: %w", err)
	}
	return nil
}

// ReadPublicCatalogBrowseSnapshot returns the last persisted display-only
// public catalog browse projection for the exact platform target.
func (store *PackageLifecycleStore) ReadPublicCatalogBrowseSnapshot(
	ctx context.Context,
	targetID, osName, arch string,
) (PublicCatalogBrowseSnapshot, error) {
	if store == nil || store.kernel == nil ||
		requireExactText("target_id", targetID) != nil ||
		requireExactText("os", osName) != nil ||
		requireExactText("arch", arch) != nil {
		return PublicCatalogBrowseSnapshot{}, ErrInvalidArgument
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	var snapshot PublicCatalogBrowseSnapshot
	var updatedNano int64
	err := store.kernel.db.QueryRowContext(ctx, `SELECT target_id, os, arch, registry_revision, projection_json, updated_unix_nano
		FROM public_app_catalog_browse_snapshot
		WHERE target_id = ? AND os = ? AND arch = ?`, targetID, osName, arch).Scan(
		&snapshot.TargetID, &snapshot.OS, &snapshot.Arch,
		&snapshot.RegistryRevision, &snapshot.ProjectionJSON, &updatedNano,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return PublicCatalogBrowseSnapshot{}, ErrBrowseSnapshotNotFound
	}
	if err != nil {
		return PublicCatalogBrowseSnapshot{}, fmt.Errorf("read public App Catalog browse snapshot: %w", err)
	}
	if updatedNano <= 0 || len(snapshot.ProjectionJSON) == 0 {
		return PublicCatalogBrowseSnapshot{}, ErrBrowseSnapshotNotFound
	}
	snapshot.ProjectionJSON = bytes.Clone(snapshot.ProjectionJSON)
	snapshot.UpdatedAt = time.Unix(0, updatedNano).UTC()
	return snapshot, nil
}
