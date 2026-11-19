package runtimeagent

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"reflect"
)

// OfflinePartitionRow describes only a proposed derived binding. No private source text is exported.
type OfflinePartitionRow struct {
	Agent    string `json:"agent"`
	Snapshot string `json:"snapshot"`
	Previous string `json:"previous"`
	Next     string `json:"next"`
}

type OfflinePartitionPlan struct {
	Checked   int                   `json:"checked"`
	InputHash string                `json:"inputHash"`
	Changes   []OfflinePartitionRow `json:"changes"`
}

// ReviewSourcePartitions reads the same canonical, column- and provenance-bound rows as restart.
// An optional visitor receives canonical before/after bytes for the offline tool. This owner only reads.
func ReviewSourcePartitions(ctx context.Context, tx *sql.Tx, visit func(agent string, original, updated []byte)) (OfflinePartitionPlan, error) {
	plan := OfflinePartitionPlan{Changes: []OfflinePartitionRow{}}
	rows, err := tx.QueryContext(ctx, realmSourceSnapshotV2SelectColumns+" ORDER BY snapshot.local_agent_ref")
	if err != nil {
		return plan, err
	}
	defer func() { _ = rows.Close() }()
	digest := sha256.New()
	for rows.Next() {
		s, found, err := scanRealmSourceSnapshotV2Row(rows)
		if err != nil {
			return plan, err
		}
		if !found {
			return plan, fmt.Errorf("offline snapshot disappeared")
		}
		original, err := encodeLocalAgentSourceSnapshotV2(s)
		if err != nil {
			return plan, err
		}
		sum := sha256.Sum256(original)
		digest.Write(sum[:])
		plan.Checked++
		part, err := projectLocalAgentSourcePartitionV1(s)
		if err != nil {
			return plan, err
		}
		next := part.binding()
		if !reflect.DeepEqual(s.Partition.Lorebook, next.Lorebook) {
			return plan, fmt.Errorf("offline partition: lorebook mismatch for %s", s.LocalAgentRef)
		}
		if reflect.DeepEqual(s.Partition, next) {
			continue
		}
		plan.Changes = append(plan.Changes, OfflinePartitionRow{Agent: s.LocalAgentRef, Snapshot: s.SnapshotHash, Previous: s.Partition.PartitionHash, Next: next.PartitionHash})
		if visit != nil {
			s.Partition = next
			updated, err := encodeLocalAgentSourceSnapshotV2(s)
			if err != nil {
				return plan, err
			}
			visit(s.LocalAgentRef, original, updated)
		}
	}
	if err := rows.Err(); err != nil {
		return plan, err
	}
	if err := rows.Close(); err != nil {
		return plan, err
	}
	var count int
	if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM runtime_local_agent_source_provenance_v3").Scan(&count); err != nil {
		return plan, err
	}
	if count != plan.Checked {
		return plan, fmt.Errorf("offline partition: snapshot/provenance membership mismatch")
	}
	plan.InputHash = hex.EncodeToString(digest.Sum(nil))
	return plan, nil
}
