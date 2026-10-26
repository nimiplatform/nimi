package memoryv1

import (
	"database/sql"
	"slices"
	"sort"
	"testing"
)

func TestMemoryVectorDecodeConsumesReusedSQLRawBytesBeforeNext(t *testing.T) {
	f := newRecallScaleFixture(t, 16, 768)
	// Core publishes canonical JSON as BLOBs. A TEXT projection of the same
	// real SQLite rows exercises database/sql's reusable RawBytes buffer without
	// changing the stored schema or the production query. Current modernc BLOB
	// values already own a fresh driver buffer, so that path alone cannot expose
	// accidental retention across Next.
	rows, err := f.core.db.Query(`SELECT m.memory_ref, CAST(v.vector_json AS TEXT)
		FROM memory_vector_items v JOIN memories m ON m.memory_ref = v.memory_ref
		WHERE v.generation_ref = ? ORDER BY m.memory_ref`, "scale-build")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var priorAddress *byte
	var reused bool
	var scratch []float64
	var candidates []scoredMemory
	queryNorm := vectorNorm(f.port.query)
	for rows.Next() {
		var ref string
		var raw sql.RawBytes
		if err := rows.Scan(&ref, &raw); err != nil {
			t.Fatal(err)
		}
		if len(raw) == 0 {
			t.Fatal("empty stored vector")
		}
		if priorAddress == &raw[0] {
			reused = true
		}
		priorAddress = &raw[0] // Observe addresses, never read a prior row's bytes.
		var valid bool
		scratch, valid = decodeMemoryVector(raw, scratch, f.port.dimension)
		if !valid {
			t.Fatal("actual SQLite vector was not decoded")
		}
		if score := cosineWithNorm(f.port.query, scratch, queryNorm); score >= 0.35 {
			candidates = append(candidates, scoredMemory{memory: Memory{MemoryRef: ref}, score: score})
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !reused {
		t.Fatal("test did not observe real database/sql buffer reuse")
	}
	sort.Slice(candidates, func(i, j int) bool { return betterMemory(candidates[i], candidates[j]) })
	refs := make([]string, len(f.expected))
	for index := range refs {
		refs[index] = candidates[index].memory.MemoryRef
	}
	if !slices.Equal(refs, f.expected) {
		t.Fatal("later rows corrupted previously scored top-eight candidates")
	}
}
