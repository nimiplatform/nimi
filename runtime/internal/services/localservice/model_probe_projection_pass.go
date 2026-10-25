package localservice

import (
	"os"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// A single serial GetMachineLoadouts read may share small format facts. This
// never stores a binding, validation result, payload proof, or execution input.
// Large probes keep the existing read path instead of accumulating in memory.
// These are the first successful format observations of this one read. File
// markers reject obvious drift; they do not prove unchanged payload bytes.
// @nimi-authority: rule.nimi.runtime.local-compute.r100
const (
	modelProbePassEntryBytes = 64 << 10
	modelProbePassBytes      = capabilitydriver.MaxAssetFormatProbeBytes
	modelProbePassEntries    = 1024
)

type modelProbePassKey struct {
	contract, recipeRevision, assetID, path, generation, digest string
	implementation                                              capabilitydriver.Identity
	input                                                       capabilitydriver.ModelAssetFormatProbeInput
	limit                                                       int64
}

type modelProbePassEntry struct {
	info  os.FileInfo // Captured from the opened handle, not a lazy path stat.
	probe []byte
}

type modelProbeReadPass struct {
	entries map[modelProbePassKey]modelProbePassEntry
	bytes   int
}

func newModelProbeReadPass() *modelProbeReadPass {
	return &modelProbeReadPass{entries: make(map[modelProbePassKey]modelProbePassEntry)}
}

func sameModelProbeFile(left, right os.FileInfo) bool {
	return left != nil && right != nil && left.Mode().IsRegular() && right.Mode().IsRegular() &&
		left.Size() == right.Size() && left.Mode() == right.Mode() && left.ModTime().Equal(right.ModTime()) && os.SameFile(left, right)
}

func (p *modelProbeReadPass) get(key modelProbePassKey, info os.FileInfo) ([]byte, bool) {
	if p == nil {
		return nil, false
	}
	entry, ok := p.entries[key]
	if !ok || !sameModelProbeFile(entry.info, info) {
		return nil, false
	}
	return append([]byte(nil), entry.probe...), true
}

func (p *modelProbeReadPass) put(key modelProbePassKey, info os.FileInfo, probe []byte) {
	// Unused companion files already need no format bytes. Do not let those
	// empty results crowd out facts that actually avoid another parser read.
	if p == nil || info == nil || len(probe) == 0 || len(probe) > modelProbePassEntryBytes || len(p.entries) >= modelProbePassEntries {
		return
	}
	previous := p.entries[key]
	needed := p.bytes - len(previous.probe) + len(probe)
	if needed > modelProbePassBytes {
		return
	}
	p.entries[key] = modelProbePassEntry{info: info, probe: append([]byte(nil), probe...)}
	p.bytes = needed
}
