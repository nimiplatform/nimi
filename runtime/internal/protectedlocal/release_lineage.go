package protectedlocal

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/binary"
	"fmt"
)

const releaseLineageEventKind = "release_lineage_admit"

type ReleaseLineageRecord struct {
	ExecutableRole string
	ReleaseID      string
	Generation     uint64
	ArtifactSHA256 Identifier
}

type releaseLineageRow struct {
	ReleaseLineageRecord
	created   uint64
	recordMAC Identifier
}

func (record ReleaseLineageRecord) validate() error {
	if !canonicalIdentityField(record.ExecutableRole) || !canonicalIdentityField(record.ReleaseID) ||
		record.Generation == 0 || record.ArtifactSHA256 == (Identifier{}) {
		return fmt.Errorf("complete canonical release lineage is required")
	}
	return nil
}

func (ledger *Ledger) AdmitReleaseLineage(ctx context.Context, candidate ReleaseLineageRecord) error {
	if ledger == nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "repair_runtime_service", fmt.Errorf("protected release-lineage ledger is required"))
	}
	if err := candidate.validate(); err != nil {
		return fail(ReasonProtectedLocalLedgerRollbackDetected, false, "reinstall_signed_release", err)
	}
	current, found, err := ledger.latestReleaseLineage(ctx, candidate.ExecutableRole)
	if err != nil {
		return err
	}
	if found {
		if candidate.Generation < current.Generation {
			return fail(ReasonProtectedLocalLedgerRollbackDetected, false, "reinstall_signed_release", fmt.Errorf("protected release generation rollback detected"))
		}
		if candidate.Generation == current.Generation {
			if candidate.ReleaseID != current.ReleaseID ||
				subtle.ConstantTimeCompare(candidate.ArtifactSHA256[:], current.ArtifactSHA256[:]) != 1 {
				return fail(ReasonProtectedLocalLedgerRollbackDetected, false, "reinstall_signed_release", fmt.Errorf("protected release generation was rebound"))
			}
			return nil
		}
	}
	payload := releaseLineagePayload(candidate)
	return ledger.commit(ctx, releaseLineageEventKind, payload, func(tx *sql.Tx, sequence uint64) error {
		row := releaseLineageRow{ReleaseLineageRecord: candidate, created: sequence}
		row.recordMAC = ledger.releaseLineageRecordMAC(row)
		if _, err := tx.ExecContext(ctx, `INSERT INTO protected_release_lineage(executable_role, release_id, release_generation, artifact_sha256, created_commit_sequence, record_hmac) VALUES (?, ?, ?, ?, ?, ?)`,
			candidate.ExecutableRole, candidate.ReleaseID, candidate.Generation, candidate.ArtifactSHA256[:], sequence, row.recordMAC[:]); err != nil {
			return fmt.Errorf("insert protected release lineage: %w", err)
		}
		return nil
	})
}

func (ledger *Ledger) latestReleaseLineage(ctx context.Context, role string) (ReleaseLineageRecord, bool, error) {
	var releaseID string
	var generation int64
	var encodedDigest, encodedMAC []byte
	var created int64
	err := ledger.db.QueryRowContext(ctx, `SELECT release_id, release_generation, artifact_sha256, created_commit_sequence, record_hmac FROM protected_release_lineage WHERE executable_role = ? ORDER BY release_generation DESC LIMIT 1`, role).
		Scan(&releaseID, &generation, &encodedDigest, &created, &encodedMAC)
	if err == sql.ErrNoRows {
		return ReleaseLineageRecord{}, false, nil
	}
	if err != nil {
		return ReleaseLineageRecord{}, false, fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("read protected release lineage: %w", err))
	}
	var digest, recordMAC Identifier
	if generation <= 0 || created < 0 || !copyIdentifier(&digest, encodedDigest) || !copyIdentifier(&recordMAC, encodedMAC) {
		return ReleaseLineageRecord{}, false, ledger.rollbackFailure(fmt.Errorf("decode protected release lineage: invalid field"))
	}
	row := releaseLineageRow{
		ReleaseLineageRecord: ReleaseLineageRecord{ExecutableRole: role, ReleaseID: releaseID, Generation: uint64(generation), ArtifactSHA256: digest},
		created:              uint64(created), recordMAC: recordMAC,
	}
	expectedMAC := ledger.releaseLineageRecordMAC(row)
	if err := row.ReleaseLineageRecord.validate(); err != nil ||
		subtle.ConstantTimeCompare(expectedMAC[:], row.recordMAC[:]) != 1 {
		return ReleaseLineageRecord{}, false, ledger.rollbackFailure(fmt.Errorf("authenticate protected release lineage"))
	}
	return row.ReleaseLineageRecord, true, nil
}

func releaseLineagePayload(record ReleaseLineageRecord) []byte {
	payload := make([]byte, 0, 2+len(record.ExecutableRole)+2+len(record.ReleaseID)+8+IdentifierBytes)
	payload = appendLengthPrefixedReleaseText(payload, record.ExecutableRole)
	payload = appendLengthPrefixedReleaseText(payload, record.ReleaseID)
	var generation [8]byte
	binary.BigEndian.PutUint64(generation[:], record.Generation)
	payload = append(payload, generation[:]...)
	payload = append(payload, record.ArtifactSHA256[:]...)
	return payload
}

func appendLengthPrefixedReleaseText(target []byte, value string) []byte {
	var length [2]byte
	binary.BigEndian.PutUint16(length[:], uint16(len(value)))
	target = append(target, length[:]...)
	return append(target, value...)
}

func (ledger *Ledger) releaseLineageRecordMAC(row releaseLineageRow) Identifier {
	return ledger.recordMAC("release_lineage_record", releaseLineagePayload(row.ReleaseLineageRecord), uint64Bytes(row.created))
}
