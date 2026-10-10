package ai

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const maxScenarioJobDocumentBytes int64 = 2*scenarioJobMachineBytes + (8 << 20)

// The document remains one JSON base plus newline-delimited mutations. Read
// only a bounded file; no alternate carrier or historical snapshot is selected.
func readScenarioJobDocument(path string) ([]byte, error) {
	// Experimental WIP carriers require an explicit, data-preserving cutover.
	// Recognize only their signature; never read an alternate state or migrate.
	for _, candidate := range []string{path, filepath.Join(filepath.Dir(path), ".scenario-jobs.capacity")} {
		file, err := os.Open(candidate)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		prefix := make([]byte, 8)
		_, _ = file.ReadAt(prefix, 0)
		if prefix[0] == 0 {
			// An interrupted experimental first write may have only its second
			// header. Ordinary JSON cannot begin with a NUL byte.
			_, _ = file.ReadAt(prefix, 4096)
		}
		file.Close()
		if string(prefix) == "NIMIJS01" || string(prefix) == "NIMIJE01" {
			return nil, fmt.Errorf("experimental ScenarioJob carrier requires an explicit data-preserving conversion before startup")
		}
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > maxScenarioJobDocumentBytes {
		return nil, fmt.Errorf("ScenarioJob document exceeds its supported storage bound")
	}
	return io.ReadAll(io.LimitReader(file, maxScenarioJobDocumentBytes+1))
}

// Test hooks are local to one writer; normal IO uses the actual file methods.
type scenarioJobFileIO struct {
	writeAt func(*os.File, []byte, int64) (int, error)
	sync    func(*os.File) error
}

func (ops *scenarioJobFileIO) write(file *os.File, data []byte, offset int64) error {
	var n int
	var err error
	if ops != nil && ops.writeAt != nil {
		n, err = ops.writeAt(file, data, offset)
	} else {
		n, err = file.WriteAt(data, offset)
	}
	if err == nil && n != len(data) {
		err = io.ErrShortWrite
	}
	return err
}
func (ops *scenarioJobFileIO) flush(file *os.File) error {
	if ops != nil && ops.sync != nil {
		return ops.sync(file)
	}
	return file.Sync()
}

func appendScenarioJobStoreLine(path string, acknowledgedBytes int64, line []byte, ops *scenarioJobFileIO) (restored bool, err error) {
	file, err := openScenarioJobStoreForAppend(path)
	if errors.Is(err, os.ErrNotExist) {
		return true, errScenarioJobStoreDrift
	}
	if err != nil {
		return true, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return true, err
	}
	if info.Size() != acknowledgedBytes {
		return true, errScenarioJobStoreDrift
	}
	if acknowledgedBytes < 0 || int64(len(line)) > maxScenarioJobDocumentBytes-acknowledgedBytes {
		return true, errScenarioJobCapacity
	}
	err = ops.write(file, line, acknowledgedBytes)
	if err == nil {
		err = ops.flush(file)
	}
	if err == nil {
		return true, nil
	}
	// Only an unacknowledged append is removed. A failed rollback marks the
	// writer stale; the next mutation rewrites its last trustworthy live facts.
	restored = file.Truncate(acknowledgedBytes) == nil && file.Sync() == nil
	if !restored {
		// The original descriptor may itself have failed. Retrying rollback on
		// one fresh handle does not retry the mutation or acknowledge it.
		if rollback, openErr := openScenarioJobStoreForAppend(path); openErr == nil {
			restored = rollback.Truncate(acknowledgedBytes) == nil && rollback.Sync() == nil
			_ = rollback.Close()
		}
	}
	return restored, err
}
