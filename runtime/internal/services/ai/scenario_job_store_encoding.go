package ai

import "encoding/json"

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-incremental-persistence
// Only rows produced by the writer's validated encoder enter these envelopes.
// json.Marshal(RawMessage) would scan and compact every retained captured body
// again. Append immutable row bytes directly; ordinary JSON encoding still
// escapes all scalar/control values and the on-disk schema stays unchanged.
func encodeScenarioJobSnapshot(snapshot scenarioJobDiskSnapshot, rows [][]byte) ([]byte, error) {
	header, err := json.Marshal(struct {
		RecoveryIncomplete bool `json:"recovery_incomplete,omitempty"`
		Version            int  `json:"version"`
	}{snapshot.RecoveryIncomplete, snapshot.Version})
	if err != nil {
		return nil, err
	}
	controls, err := json.Marshal(struct {
		Idempotency    []scenarioJobDiskIdempotencyEntry `json:"idempotency,omitempty"`
		PendingCustody []scenarioJobDiskPendingCustody   `json:"pending_credential_custody,omitempty"`
	}{snapshot.Idempotency, snapshot.PendingCustody})
	if err != nil {
		return nil, err
	}
	prefix := append(header[:len(header)-1], `,"records":[`...)
	return appendScenarioJobEncodedRows(prefix, rows, controls), nil
}

func encodeScenarioJobJournalEntry(entry scenarioJobJournalEntry) ([]byte, error) {
	if len(entry.Records) == 0 {
		return json.Marshal(entry)
	}
	const prefix = `{"records":[`
	const rowStart = `{"job_id":`
	const rowContent = `,"record":`
	ids := make([][]byte, len(entry.Records))
	size := len(prefix) + 3 + len(entry.Records) - 1 // ]}, commas, and caller's newline
	for i, record := range entry.Records {
		id, err := json.Marshal(record.JobID)
		if err != nil {
			return nil, err
		}
		ids[i] = id
		size += len(rowStart) + len(id) + len(rowContent) + len(record.Record) + 1
	}
	records := entry.Records
	entry.Records = nil
	controls, err := json.Marshal(entry)
	if err != nil {
		return nil, err
	}
	if len(controls) > 2 {
		size += len(controls) - 1
	}
	raw := make([]byte, 0, size)
	raw = append(raw, prefix...)
	for i, record := range records {
		if i > 0 {
			raw = append(raw, ',')
		}
		raw = append(raw, rowStart...)
		raw = append(raw, ids[i]...)
		raw = append(raw, rowContent...)
		raw = append(raw, record.Record...)
		raw = append(raw, '}')
	}
	return appendScenarioJobEncodedControls(raw, controls), nil
}

// controls is a JSON object; its fields follow records in both existing
// formats. Rows are copied, not re-encoded or aliased into the output buffer.
func appendScenarioJobEncodedRows(prefix []byte, rows [][]byte, controls []byte) []byte {
	// Reserve the caller's newline too: growing a full snapshot just to append
	// it would allocate and copy the complete retained document a second time.
	size := len(prefix) + 3 + max(0, len(rows)-1)
	for _, row := range rows {
		size += len(row)
	}
	if len(controls) > 2 {
		size += len(controls) - 1
	}
	raw := make([]byte, 0, size)
	raw = append(raw, prefix...)
	for i, row := range rows {
		if i > 0 {
			raw = append(raw, ',')
		}
		raw = append(raw, row...)
	}
	return appendScenarioJobEncodedControls(raw, controls)
}

func appendScenarioJobEncodedControls(raw, controls []byte) []byte {
	raw = append(raw, ']')
	if len(controls) > 2 {
		raw = append(raw, ',')
		raw = append(raw, controls[1:len(controls)-1]...)
	}
	return append(raw, '}')
}
