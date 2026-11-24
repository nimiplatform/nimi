package ggufmeta

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

const (
	magicHeader                = "GGUF"
	maxMetadataStringBytes     = 1 << 20
	maxMetadataEntries         = 1 << 20
	maxTensorEntries           = 1 << 20
	maxTensorDimensions        = 16
	maxWatchedProtocolTokenLen = 32

	llamaTokenTypeControl     = 3
	llamaTokenTypeUserDefined = 4
)

// watchedProtocolTokens lists the exact control/special and BOS/EOS token
// strings consumed by pinned llama.cpp b12648 chat templates and PEG parsers
// (common/chat.cpp, common/parsers/{gemma4,qwen3-coder,lfm2}.cpp) for Tier 1
// Text Behavior cohorts. Inspecting only these strings during the bounded KV
// walk avoids allocating the full 150k-512k vocabulary in memory.
var watchedProtocolTokens = map[string]struct{}{
	"<bos>":               {},
	"<|startoftext|>":     {},
	"<|turn>":             {},
	"<turn|>":             {},
	"<|channel>":          {},
	"<channel|>":          {},
	"<|tool_call>":        {},
	"<tool_call|>":        {},
	"<|\"|>":              {},
	"<think>":             {},
	"</think>":            {},
	"<tool_call>":         {},
	"</tool_call>":        {},
	"<|im_start|>":        {},
	"<|im_end|>":          {},
	"<|tool_list_start|>": {},
	"<|tool_list_end|>":   {},
	"<|tool_call_start|>": {},
	"<|tool_call_end|>":   {},
}

// TokenizerFacts captures the bounded subset of GGUF vocabulary facts that
// pinned llama.cpp b12648 consumes when building chat templates and PEG
// tool/reasoning parsers (common/chat.cpp:982-1012, common/peg-parser.cpp:211-221).
type TokenizerFacts struct {
	BOSToken      string   `json:"bosToken,omitempty"`
	EOSToken      string   `json:"eosToken,omitempty"`
	SpecialTokens []string `json:"specialTokens,omitempty"`
}

type ValueType uint32

const (
	ValueTypeUint8   ValueType = 0
	ValueTypeInt8    ValueType = 1
	ValueTypeUint16  ValueType = 2
	ValueTypeInt16   ValueType = 3
	ValueTypeUint32  ValueType = 4
	ValueTypeInt32   ValueType = 5
	ValueTypeFloat32 ValueType = 6
	ValueTypeBool    ValueType = 7
	ValueTypeString  ValueType = 8
	ValueTypeArray   ValueType = 9
	ValueTypeUint64  ValueType = 10
	ValueTypeInt64   ValueType = 11
	ValueTypeFloat64 ValueType = 12
)

type MetadataEntry struct {
	Key            string
	Type           ValueType
	StringValue    string
	HasStringValue bool
	Uint64Value    uint64
	HasUint64Value bool
	BoolValue      bool
	HasBoolValue   bool
}

type Summary struct {
	Magic        string
	Version      uint32
	TensorCount  uint64
	KVCount      uint64
	Entries      []MetadataEntry
	TensorNames  []string
	TensorShapes map[string][]uint64
	Tokenizer    TokenizerFacts
}

// IsGGUFExtension reports whether path carries a GGUF file extension admitted
// by pinned llama.cpp (both standard .gguf and community .gguf_file names).
func IsGGUFExtension(path string) bool {
	ext := strings.ToLower(filepath.Ext(strings.TrimSpace(path)))
	return ext == ".gguf" || ext == ".gguf_file"
}

func InspectPath(path string) (Summary, error) {
	file, err := os.Open(strings.TrimSpace(path))
	if err != nil {
		return Summary{}, err
	}
	defer func() { _ = file.Close() }()
	return Inspect(file)
}

func Inspect(reader io.Reader) (Summary, error) {
	summary, err := readSummaryHeader(reader)
	if err != nil {
		return Summary{}, err
	}

	summary.Entries = make([]MetadataEntry, 0, summary.KVCount)
	for i := uint64(0); i < summary.KVCount; i++ {
		entry, err := readMetadataEntry(reader, i)
		if err != nil {
			return Summary{}, err
		}
		summary.Entries = append(summary.Entries, entry)
	}
	if err := readTensorHeaders(reader, &summary, nil); err != nil {
		return Summary{}, err
	}
	return summary, nil
}

func readTensorHeaders(reader io.Reader, summary *Summary, validate func([]uint64, uint32, uint64) error) error {
	summary.TensorNames = make([]string, 0, summary.TensorCount)
	summary.TensorShapes = make(map[string][]uint64, summary.TensorCount)
	for i := uint64(0); i < summary.TensorCount; i++ {
		name, err := readGGUFString(reader)
		if err != nil {
			return fmt.Errorf("read gguf tensor name %d: %w", i, err)
		}
		var dimensions uint32
		if err := binary.Read(reader, binary.LittleEndian, &dimensions); err != nil {
			return fmt.Errorf("read gguf tensor dimensions %q: %w", name, err)
		}
		if dimensions > maxTensorDimensions {
			return fmt.Errorf("gguf tensor %q has too many dimensions: %d", name, dimensions)
		}
		shape := make([]uint64, dimensions)
		for dim := uint32(0); dim < dimensions; dim++ {
			var size uint64
			if err := binary.Read(reader, binary.LittleEndian, &size); err != nil {
				return fmt.Errorf("read gguf tensor shape %q: %w", name, err)
			}
			shape[dim] = size
		}
		var tensorType uint32
		if err := binary.Read(reader, binary.LittleEndian, &tensorType); err != nil {
			return fmt.Errorf("read gguf tensor type %q: %w", name, err)
		}
		var offset uint64
		if err := binary.Read(reader, binary.LittleEndian, &offset); err != nil {
			return fmt.Errorf("read gguf tensor offset %q: %w", name, err)
		}
		if validate != nil {
			if strings.TrimSpace(name) == "" {
				return fmt.Errorf("gguf tensor %d has no name", i)
			}
			if err := validate(shape, tensorType, offset); err != nil {
				return fmt.Errorf("gguf tensor %q: %w", name, err)
			}
		}
		if strings.TrimSpace(name) != "" {
			if _, exists := summary.TensorShapes[name]; exists {
				return fmt.Errorf("duplicate gguf tensor %q", name)
			}
			summary.TensorNames = append(summary.TensorNames, name)
			summary.TensorShapes[name] = shape
		}
	}
	return nil
}

// InspectMetadata reads the complete GGUF header and every metadata KV entry
// strictly without traversing tensor headers or weights. Duplicate keys,
// unsupported GGUF versions, truncated headers, or corrupt KV encodings fail
// closed rather than returning partial facts.
func InspectMetadata(reader io.Reader) (Summary, error) {
	return inspectMetadataStrict(reader, false)
}

// InspectMetadataAndTensors reads the complete GGUF header, every metadata KV
// entry, and every tensor header strictly without reading tensor weight data.
func InspectMetadataAndTensors(reader io.Reader) (Summary, error) {
	return inspectMetadataStrict(reader, true)
}

type tokenizerScanState struct {
	watchedByID map[uint64]string
	// One bit per token, grown only after its type has actually been read.
	specialBits []uint64
}

func inspectMetadataStrict(reader io.Reader, readTensors bool) (Summary, error) {
	summary, err := readSummaryHeader(reader)
	if err != nil {
		return Summary{}, err
	}
	if summary.Version < 2 || summary.Version > 3 {
		return Summary{}, fmt.Errorf("unsupported gguf version %d", summary.Version)
	}
	seen := make(map[string]bool)
	tokScan := &tokenizerScanState{watchedByID: make(map[uint64]string)}
	for i := uint64(0); i < summary.KVCount; i++ {
		entry, err := readMetadataEntryWithTokenizerScan(reader, i, tokScan)
		if err != nil {
			return Summary{}, err
		}
		if seen[entry.Key] {
			return Summary{}, fmt.Errorf("duplicate gguf metadata key %q", entry.Key)
		}
		seen[entry.Key] = true
		summary.Entries = append(summary.Entries, entry)
	}
	if len(tokScan.watchedByID) > 0 {
		if bosID, ok := summary.Uint64Value("tokenizer.ggml.bos_token_id"); ok {
			summary.Tokenizer.BOSToken = tokScan.watchedByID[bosID]
		}
		if eosID, ok := summary.Uint64Value("tokenizer.ggml.eos_token_id"); ok {
			summary.Tokenizer.EOSToken = tokScan.watchedByID[eosID]
		}
		if len(tokScan.specialBits) > 0 {
			specialSet := make(map[string]struct{}, len(tokScan.watchedByID))
			for id, tok := range tokScan.watchedByID {
				if word := id / 64; word < uint64(len(tokScan.specialBits)) && tokScan.specialBits[word]&(1<<(id%64)) != 0 {
					specialSet[tok] = struct{}{}
				}
			}
			if len(specialSet) > 0 {
				specials := make([]string, 0, len(specialSet))
				for tok := range specialSet {
					specials = append(specials, tok)
				}
				sort.Strings(specials)
				summary.Tokenizer.SpecialTokens = specials
			}
		}
	}
	if readTensors {
		if err := readTensorHeaders(reader, &summary, nil); err != nil {
			return Summary{}, err
		}
	}
	return summary, nil
}

// InspectEmbeddingMetadata requires the entire bounded metadata section. Unlike
// optional LLM hints, a truncated prefix cannot prove an output contract: later
// metadata may change pooling or output width. Tensor contents are not read.
func InspectEmbeddingMetadata(reader io.Reader) (Summary, error) {
	return InspectMetadata(reader)
}

// InspectLLMMetadata reads only the GGUF metadata needed by non-chat Drivers
// (such as text encoders). It returns as soon as architecture and authored
// context length are known without traversing unrelated tokenizer arrays.
func InspectLLMMetadata(reader io.Reader) (Summary, error) {
	summary, err := readSummaryHeader(reader)
	if err != nil {
		return Summary{}, err
	}
	for i := uint64(0); i < summary.KVCount; i++ {
		entry, err := readMetadataEntry(reader, i)
		if err != nil {
			if (errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)) && LLMDetectedArchitecture(summary) != "" {
				return summary, nil
			}
			return Summary{}, err
		}
		summary.Entries = append(summary.Entries, entry)
		if _, ok := LLMContextLength(summary); ok {
			return summary, nil
		}
	}
	return summary, nil
}

// InspectMetadataUntilString reads GGUF metadata only until the requested
// string key is available. It is suitable for bounded ModelAsset probes where
// tokenizer arrays or tensor headers may extend beyond the captured prefix.
func InspectMetadataUntilString(reader io.Reader, key string) (Summary, error) {
	return InspectMetadataUntilStrings(reader, key)
}

// InspectMetadataUntilStrings reads GGUF metadata only until every requested
// string key is available. Metadata ordering is not significant.
func InspectMetadataUntilStrings(reader io.Reader, keys ...string) (Summary, error) {
	remaining := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		needle := strings.TrimSpace(key)
		if needle == "" {
			return Summary{}, fmt.Errorf("gguf metadata key is required")
		}
		remaining[needle] = struct{}{}
	}
	if len(remaining) == 0 {
		return Summary{}, fmt.Errorf("gguf metadata key is required")
	}
	summary, err := readSummaryHeader(reader)
	if err != nil {
		return Summary{}, err
	}
	for i := uint64(0); i < summary.KVCount; i++ {
		entry, err := readMetadataEntry(reader, i)
		if err != nil {
			return Summary{}, err
		}
		summary.Entries = append(summary.Entries, entry)
		if entry.HasStringValue {
			delete(remaining, entry.Key)
		}
		if len(remaining) == 0 {
			return summary, nil
		}
	}
	return summary, nil
}

func readSummaryHeader(reader io.Reader) (Summary, error) {
	if reader == nil {
		return Summary{}, fmt.Errorf("gguf reader is unavailable")
	}

	var summary Summary
	header := make([]byte, len(magicHeader))
	if _, err := io.ReadFull(reader, header); err != nil {
		return Summary{}, fmt.Errorf("read gguf magic: %w", err)
	}
	summary.Magic = string(header)
	if summary.Magic != magicHeader {
		return Summary{}, fmt.Errorf("invalid gguf magic %q", summary.Magic)
	}
	if err := binary.Read(reader, binary.LittleEndian, &summary.Version); err != nil {
		return Summary{}, fmt.Errorf("read gguf version: %w", err)
	}
	if err := binary.Read(reader, binary.LittleEndian, &summary.TensorCount); err != nil {
		return Summary{}, fmt.Errorf("read gguf tensor count: %w", err)
	}
	if err := binary.Read(reader, binary.LittleEndian, &summary.KVCount); err != nil {
		return Summary{}, fmt.Errorf("read gguf kv count: %w", err)
	}
	if summary.KVCount > maxMetadataEntries {
		return Summary{}, fmt.Errorf("gguf metadata entry count too large: %d", summary.KVCount)
	}
	if summary.TensorCount > maxTensorEntries {
		return Summary{}, fmt.Errorf("gguf tensor count too large: %d", summary.TensorCount)
	}
	return summary, nil
}

func readMetadataEntry(reader io.Reader, index uint64) (MetadataEntry, error) {
	return readMetadataEntryWithTokenizerScan(reader, index, nil)
}

func readMetadataEntryWithTokenizerScan(reader io.Reader, index uint64, tokScan *tokenizerScanState) (MetadataEntry, error) {
	key, err := readGGUFString(reader)
	if err != nil {
		return MetadataEntry{}, fmt.Errorf("read gguf metadata key %d: %w", index, err)
	}
	valueType, err := readValueType(reader)
	if err != nil {
		return MetadataEntry{}, fmt.Errorf("read gguf metadata type %q: %w", key, err)
	}
	entry := MetadataEntry{Key: key, Type: valueType}
	if valueType == ValueTypeString {
		value, err := readGGUFString(reader)
		if err != nil {
			return MetadataEntry{}, fmt.Errorf("read gguf metadata string %q: %w", key, err)
		}
		entry.StringValue = value
		entry.HasStringValue = true
	} else if valueType == ValueTypeBool {
		var raw uint8
		if err := binary.Read(reader, binary.LittleEndian, &raw); err != nil {
			return MetadataEntry{}, fmt.Errorf("read gguf metadata bool %q: %w", key, err)
		}
		entry.BoolValue = raw != 0
		entry.HasBoolValue = true
	} else if isIntegerValueType(valueType) {
		value, ok, err := readUint64MetadataValue(reader, valueType)
		if err != nil {
			return MetadataEntry{}, fmt.Errorf("read gguf metadata integer %q: %w", key, err)
		}
		entry.Uint64Value = value
		entry.HasUint64Value = ok
	} else if tokScan != nil && valueType == ValueTypeArray && (key == "tokenizer.ggml.tokens" || key == "tokenizer.ggml.token_type") {
		if err := scanTokenizerArray(reader, key, tokScan); err != nil {
			return MetadataEntry{}, fmt.Errorf("scan gguf metadata value %q: %w", key, err)
		}
	} else if err := skipValue(reader, valueType); err != nil {
		return MetadataEntry{}, fmt.Errorf("skip gguf metadata value %q: %w", key, err)
	}
	return entry, nil
}

func scanTokenizerArray(reader io.Reader, key string, tokScan *tokenizerScanState) error {
	elementType, err := readValueType(reader)
	if err != nil {
		return err
	}
	if elementType == ValueTypeArray {
		return fmt.Errorf("nested gguf metadata arrays are unsupported")
	}
	var length uint64
	if err := binary.Read(reader, binary.LittleEndian, &length); err != nil {
		return err
	}
	if key == "tokenizer.ggml.tokens" && elementType == ValueTypeString {
		var header [8]byte
		var buf [maxWatchedProtocolTokenLen]byte
		for i := uint64(0); i < length; i++ {
			if _, err := io.ReadFull(reader, header[:]); err != nil {
				return err
			}
			strLen := binary.LittleEndian.Uint64(header[:])
			if strLen > maxMetadataStringBytes {
				return fmt.Errorf("metadata string too large: %d bytes", strLen)
			}
			if strLen > 0 && strLen <= maxWatchedProtocolTokenLen {
				if _, err := io.ReadFull(reader, buf[:strLen]); err != nil {
					return err
				}
				candidate := string(buf[:strLen])
				if _, watched := watchedProtocolTokens[candidate]; watched {
					tokScan.watchedByID[i] = candidate
				}
				continue
			}
			n, err := discardMetadataBytes(reader, int64(strLen))
			if err == io.EOF && n > 0 {
				err = io.ErrUnexpectedEOF
			}
			if err != nil {
				return err
			}
		}
		return nil
	}
	if key == "tokenizer.ggml.token_type" && isIntegerValueType(elementType) {
		width := fixedMetadataValueBytes(elementType)
		if width == 0 || length > math.MaxInt64/width {
			return fmt.Errorf("gguf metadata array byte length overflows")
		}
		const chunkElems = 1024
		buf := make([]byte, chunkElems*width)
		var index uint64
		for index < length {
			batch := min(length-index, uint64(chunkElems))
			chunk := buf[:batch*width]
			if _, err := io.ReadFull(reader, chunk); err != nil {
				return err
			}
			tokScan.specialBits = append(tokScan.specialBits, make([]uint64, (batch+63)/64)...)
			for j := uint64(0); j < batch; j++ {
				val, ok := decodeIntegerLittleEndian(chunk[j*width:(j+1)*width], elementType)
				if ok && (val == llamaTokenTypeControl || val == llamaTokenTypeUserDefined) {
					id := index + j
					tokScan.specialBits[id/64] |= 1 << (id % 64)
				}
			}
			index += batch
		}
		return nil
	}
	if width := fixedMetadataValueBytes(elementType); width != 0 {
		if length > math.MaxInt64/width {
			return fmt.Errorf("gguf metadata array byte length overflows")
		}
		return skipBytes(reader, int64(length*width))
	}
	if elementType == ValueTypeString {
		return skipStringArray(reader, length)
	}
	for i := uint64(0); i < length; i++ {
		if err := skipValue(reader, elementType); err != nil {
			return err
		}
	}
	return nil
}

func decodeIntegerLittleEndian(raw []byte, valueType ValueType) (uint64, bool) {
	switch valueType {
	case ValueTypeUint8:
		return uint64(raw[0]), true
	case ValueTypeInt8:
		v := int8(raw[0])
		return uint64(max(v, 0)), v >= 0
	case ValueTypeUint16:
		return uint64(binary.LittleEndian.Uint16(raw)), true
	case ValueTypeInt16:
		v := int16(binary.LittleEndian.Uint16(raw))
		return uint64(max(v, 0)), v >= 0
	case ValueTypeUint32:
		return uint64(binary.LittleEndian.Uint32(raw)), true
	case ValueTypeInt32:
		v := int32(binary.LittleEndian.Uint32(raw))
		return uint64(max(v, 0)), v >= 0
	case ValueTypeUint64:
		return binary.LittleEndian.Uint64(raw), true
	case ValueTypeInt64:
		v := int64(binary.LittleEndian.Uint64(raw))
		return uint64(max(v, 0)), v >= 0
	default:
		return 0, false
	}
}

func (s Summary) Keys() []string {
	keys := make([]string, 0, len(s.Entries))
	for _, entry := range s.Entries {
		if strings.TrimSpace(entry.Key) != "" {
			keys = append(keys, entry.Key)
		}
	}
	return keys
}

func (s Summary) HasKey(key string) bool {
	needle := strings.TrimSpace(key)
	if needle == "" {
		return false
	}
	for _, entry := range s.Entries {
		if entry.Key == needle {
			return true
		}
	}
	return false
}

func (s Summary) StringValue(key string) (string, bool) {
	needle := strings.TrimSpace(key)
	if needle == "" {
		return "", false
	}
	for _, entry := range s.Entries {
		if entry.Key == needle && entry.HasStringValue {
			return entry.StringValue, true
		}
	}
	return "", false
}

func (s Summary) Uint64Value(key string) (uint64, bool) {
	needle := strings.TrimSpace(key)
	if needle == "" {
		return 0, false
	}
	for _, entry := range s.Entries {
		if entry.Key == needle && entry.HasUint64Value {
			return entry.Uint64Value, true
		}
	}
	return 0, false
}

func (s Summary) BoolValue(key string) (bool, bool) {
	needle := strings.TrimSpace(key)
	if needle == "" {
		return false, false
	}
	for _, entry := range s.Entries {
		if entry.Key == needle && entry.HasBoolValue {
			return entry.BoolValue, true
		}
	}
	return false, false
}

func (s Summary) HasTensorNameSuffix(suffix string) bool {
	needle := strings.TrimSpace(suffix)
	if needle == "" {
		return false
	}
	for _, name := range s.TensorNames {
		if strings.HasSuffix(strings.TrimSpace(name), needle) {
			return true
		}
	}
	return false
}

func StableDiffusionIdentityKeysPresent(summary Summary) []string {
	keys := make([]string, 0, len(stableDiffusionIdentityKeys))
	for _, key := range stableDiffusionIdentityKeys {
		if summary.HasKey(key) {
			keys = append(keys, key)
		}
	}
	return keys
}

func StableDiffusionVersionKeysPresent(summary Summary) []string {
	keys := make([]string, 0, len(stableDiffusionVersionKeys))
	for _, key := range stableDiffusionVersionKeys {
		if summary.HasKey(key) {
			keys = append(keys, key)
		}
	}
	return keys
}

func StableDiffusionTensorSignaturesPresent(summary Summary) []string {
	matches := make([]string, 0, len(stableDiffusionTensorSignatures))
	for _, signature := range stableDiffusionTensorSignatures {
		if summary.HasTensorNameSuffix(signature.Suffix) {
			matches = append(matches, signature.Family+":"+signature.Suffix)
		}
	}
	return matches
}

func StableDiffusionDetectedFamily(summary Summary) string {
	if len(StableDiffusionVersionKeysPresent(summary)) > 0 {
		return "metadata-versioned"
	}
	for _, signature := range stableDiffusionTensorSignatures {
		if summary.HasTensorNameSuffix(signature.Suffix) {
			return signature.Family
		}
	}
	return ""
}

func StableDiffusionMetadataIssue(summary Summary) string {
	if len(StableDiffusionVersionKeysPresent(summary)) > 0 {
		return ""
	}
	if len(StableDiffusionTensorSignaturesPresent(summary)) > 0 {
		return ""
	}
	if summary.KVCount == 0 && len(summary.TensorNames) == 0 {
		return "gguf metadata missing; no kv entries or tensor headers available to determine diffusion model family"
	}
	if summary.KVCount == 0 {
		return "gguf metadata missing and no runtime-supported diffusion tensor signature detected"
	}
	return "gguf metadata lacks runtime-supported diffusion version keys and tensor signatures"
}

// LLMDetectedArchitecture returns the value of "general.architecture"
// from the GGUF metadata, or empty string if not found.
func LLMDetectedArchitecture(summary Summary) string {
	value, ok := summary.StringValue("general.architecture")
	if !ok {
		return ""
	}
	return strings.TrimSpace(value)
}

// LLMContextLength returns the model-authored context length for the detected
// GGUF architecture. It never guesses an architecture or a default capacity.
func LLMContextLength(summary Summary) (uint64, bool) {
	architecture := LLMDetectedArchitecture(summary)
	if architecture == "" {
		return 0, false
	}
	value, ok := summary.Uint64Value(architecture + ".context_length")
	if !ok || value == 0 {
		return 0, false
	}
	return value, true
}

// LLMEmbeddingLength returns the model-authored embedding width
// (<architecture>.embedding_length) when present and positive.
func LLMEmbeddingLength(summary Summary) (uint64, bool) {
	architecture := LLMDetectedArchitecture(summary)
	if architecture == "" {
		return 0, false
	}
	value, ok := summary.Uint64Value(architecture + ".embedding_length")
	if !ok || value == 0 {
		return 0, false
	}
	return value, true
}

// LLMPoolingType returns <architecture>.pooling_type when explicitly present.
func LLMPoolingType(summary Summary) (uint64, bool) {
	architecture := LLMDetectedArchitecture(summary)
	if architecture == "" {
		return 0, false
	}
	return summary.Uint64Value(architecture + ".pooling_type")
}

// LLMChatTemplateIdentity returns the canonical digest of the exact
// model-authored tokenizer.chat_template bytes. It does not normalize,
// interpret, or guess a template. Missing and empty metadata intentionally
// yield no identity so base text remains independent from behavior matching.
func LLMChatTemplateIdentity(summary Summary) (string, bool) {
	template, ok := summary.StringValue("tokenizer.chat_template")
	if !ok || template == "" {
		return "", false
	}
	digest := sha256.Sum256([]byte(template))
	return "sha256:" + hex.EncodeToString(digest[:]), true
}

// LLMChatTemplateToolUseIdentity returns the canonical digest of
// tokenizer.chat_template.tool_use when present and non-empty.
func LLMChatTemplateToolUseIdentity(summary Summary) (string, bool) {
	template, ok := summary.StringValue("tokenizer.chat_template.tool_use")
	if !ok || template == "" {
		return "", false
	}
	digest := sha256.Sum256([]byte(template))
	return "sha256:" + hex.EncodeToString(digest[:]), true
}

// LLMDeepstackLayers returns the declared <arch>.n_deepstack_layers count used
// by pinned llama.cpp when computing n_embd_inp = n_embd * (1 + n_deepstack_layers).
func LLMDeepstackLayers(summary Summary) (uint64, bool) {
	arch := LLMDetectedArchitecture(summary)
	if arch == "" {
		return 0, false
	}
	return summary.Uint64Value(arch + ".n_deepstack_layers")
}

// Qwen3VLProjectorDimensions extracts the merger output width (mm.2.bias ne[0])
// and projector deepstack layer count (distinct v.deepstack.<il>.fc1.weight
// tensors) matching pinned llama.cpp b12648 tools/mtmd/mtmd-model.cpp:1702-1710,
// 2050, 5193-5195 (actual output width = mergerWidth * (1 + deepstackLayers)).
func Qwen3VLProjectorDimensions(summary Summary) (mergerWidth uint64, deepstackLayers uint64, ok bool) {
	shape, exists := summary.TensorShapes["mm.2.bias"]
	if !exists || len(shape) == 0 || shape[0] == 0 {
		return 0, 0, false
	}
	mergerWidth = shape[0]
	layers := make(map[uint64]struct{})
	const prefix = "v.deepstack."
	const suffix = ".fc1.weight"
	for _, name := range summary.TensorNames {
		if !strings.HasPrefix(name, prefix) || !strings.HasSuffix(name, suffix) {
			continue
		}
		mid := name[len(prefix) : len(name)-len(suffix)]
		if mid == "" {
			continue
		}
		il, err := strconv.ParseUint(mid, 10, 64)
		if err != nil || strconv.FormatUint(il, 10) != mid {
			continue
		}
		layers[il] = struct{}{}
	}
	return mergerWidth, uint64(len(layers)), true
}

// LLMEffectiveChatTemplateIdentity returns the effective chat-template identity
// consumed by pinned llama.cpp b12648 (common/chat.cpp:945-960 reads only
// tokenizer.chat_template and tokenizer.chat_template.tool_use). When no
// tokenizer.chat_template.tool_use key exists, it equals LLMChatTemplateIdentity.
// Unrelated named templates such as tokenizer.chat_template.tts are ignored.
func LLMEffectiveChatTemplateIdentity(summary Summary) (string, bool) {
	defaultTemplate, ok := summary.StringValue("tokenizer.chat_template")
	if !ok || defaultTemplate == "" {
		return "", false
	}
	var toolUseEntry *MetadataEntry
	for index := range summary.Entries {
		if summary.Entries[index].Key == "tokenizer.chat_template.tool_use" {
			entry := summary.Entries[index]
			toolUseEntry = &entry
			break
		}
	}
	if toolUseEntry == nil {
		return LLMChatTemplateIdentity(summary)
	}
	hash := sha256.New()
	_, _ = hash.Write([]byte("nimi.gguf.chat_template.v2\x00default\x00"))
	_, _ = hash.Write([]byte(defaultTemplate))
	_, _ = hash.Write([]byte{0})
	_, _ = hash.Write([]byte(toolUseEntry.Key))
	_, _ = hash.Write([]byte{0})
	_, _ = hash.Write([]byte(fmt.Sprintf("%d:%t:%s", toolUseEntry.Type, toolUseEntry.HasStringValue, toolUseEntry.StringValue)))
	return "sha256:" + hex.EncodeToString(hash.Sum(nil)), true
}

var stableDiffusionIdentityKeys = []string{
	"general.architecture",
	"general.name",
	"general.type",
	"sd.version",
	"stable_diffusion.version",
}

var stableDiffusionVersionKeys = []string{
	"sd.version",
	"stable_diffusion.version",
}

type stableDiffusionTensorSignature struct {
	Family string
	Suffix string
}

var stableDiffusionTensorSignatures = []stableDiffusionTensorSignature{
	{Family: "flux3", Suffix: "content_mode_blocks.image_cond.0.q_proj.weight"},
	{Family: "ideogram4", Suffix: "llm_cond_proj.weight"},
	{Family: "z-image", Suffix: "cap_embedder.0.weight"},
	{Family: "qwen-image", Suffix: "transformer_blocks.0.img_mod.1.weight"},
	{Family: "ovis-image", Suffix: "double_blocks.0.img_mlp.gate_proj.weight"},
	{Family: "anima", Suffix: "llm_adapter.blocks.0.cross_attn.q_proj.weight"},
	{Family: "chroma", Suffix: "distilled_guidance_layer.in_proj.weight"},
	{Family: "flux", Suffix: "double_blocks.0.img_mod.lin.weight"},
}

func readValueType(reader io.Reader) (ValueType, error) {
	var value uint32
	if err := binary.Read(reader, binary.LittleEndian, &value); err != nil {
		return 0, err
	}
	return ValueType(value), nil
}

func isIntegerValueType(valueType ValueType) bool {
	switch valueType {
	case ValueTypeUint8, ValueTypeInt8,
		ValueTypeUint16, ValueTypeInt16,
		ValueTypeUint32, ValueTypeInt32,
		ValueTypeUint64, ValueTypeInt64:
		return true
	default:
		return false
	}
}

func readUint64MetadataValue(reader io.Reader, valueType ValueType) (uint64, bool, error) {
	switch valueType {
	case ValueTypeUint8:
		var value uint8
		err := binary.Read(reader, binary.LittleEndian, &value)
		return uint64(value), true, err
	case ValueTypeInt8:
		var value int8
		err := binary.Read(reader, binary.LittleEndian, &value)
		return uint64(max(value, 0)), value >= 0, err
	case ValueTypeUint16:
		var value uint16
		err := binary.Read(reader, binary.LittleEndian, &value)
		return uint64(value), true, err
	case ValueTypeInt16:
		var value int16
		err := binary.Read(reader, binary.LittleEndian, &value)
		return uint64(max(value, 0)), value >= 0, err
	case ValueTypeUint32:
		var value uint32
		err := binary.Read(reader, binary.LittleEndian, &value)
		return uint64(value), true, err
	case ValueTypeInt32:
		var value int32
		err := binary.Read(reader, binary.LittleEndian, &value)
		return uint64(max(value, 0)), value >= 0, err
	case ValueTypeUint64:
		var value uint64
		err := binary.Read(reader, binary.LittleEndian, &value)
		return value, true, err
	case ValueTypeInt64:
		var value int64
		err := binary.Read(reader, binary.LittleEndian, &value)
		return uint64(max(value, 0)), value >= 0, err
	default:
		return 0, false, fmt.Errorf("value type %d is not an integer", valueType)
	}
}

func readGGUFString(reader io.Reader) (string, error) {
	var length uint64
	if err := binary.Read(reader, binary.LittleEndian, &length); err != nil {
		return "", err
	}
	if length > maxMetadataStringBytes {
		return "", fmt.Errorf("metadata string too large: %d bytes", length)
	}
	buf := make([]byte, length)
	if _, err := io.ReadFull(reader, buf); err != nil {
		return "", err
	}
	return string(buf), nil
}

func skipValue(reader io.Reader, valueType ValueType) error {
	switch valueType {
	case ValueTypeUint8, ValueTypeInt8, ValueTypeBool:
		return skipBytes(reader, 1)
	case ValueTypeUint16, ValueTypeInt16:
		return skipBytes(reader, 2)
	case ValueTypeUint32, ValueTypeInt32, ValueTypeFloat32:
		return skipBytes(reader, 4)
	case ValueTypeUint64, ValueTypeInt64, ValueTypeFloat64:
		return skipBytes(reader, 8)
	case ValueTypeString:
		var length uint64
		if err := binary.Read(reader, binary.LittleEndian, &length); err != nil {
			return err
		}
		if length > maxMetadataStringBytes {
			return fmt.Errorf("metadata string too large: %d bytes", length)
		}
		n, err := discardMetadataBytes(reader, int64(length))
		// Match readGGUFString's ReadFull failure for a partial string.
		if err == io.EOF && n > 0 {
			return io.ErrUnexpectedEOF
		}
		return err
	case ValueTypeArray:
		elementType, err := readValueType(reader)
		if err != nil {
			return err
		}
		if elementType == ValueTypeArray {
			return fmt.Errorf("nested gguf metadata arrays are unsupported")
		}
		var length uint64
		if err := binary.Read(reader, binary.LittleEndian, &length); err != nil {
			return err
		}
		if width := fixedMetadataValueBytes(elementType); width != 0 {
			if length > math.MaxInt64/width {
				return fmt.Errorf("gguf metadata array byte length overflows")
			}
			return skipBytes(reader, int64(length*width))
		}
		if elementType == ValueTypeString {
			return skipStringArray(reader, length)
		}
		for i := uint64(0); i < length; i++ {
			if err := skipValue(reader, elementType); err != nil {
				return err
			}
		}
		return nil
	default:
		return fmt.Errorf("unsupported gguf metadata value type %d", valueType)
	}
}

// Token/merge arrays may contain hundreds of thousands of strings. Reuse one
// length buffer instead of binary.Read allocating one for every element. Each
// length and readable body boundary is still checked, in the original order.
func skipStringArray(reader io.Reader, count uint64) error {
	var header [8]byte
	for i := uint64(0); i < count; i++ {
		if _, err := io.ReadFull(reader, header[:]); err != nil {
			return err
		}
		length := binary.LittleEndian.Uint64(header[:])
		if length > maxMetadataStringBytes {
			return fmt.Errorf("metadata string too large: %d bytes", length)
		}
		n, err := discardMetadataBytes(reader, int64(length))
		if err == io.EOF && n > 0 {
			err = io.ErrUnexpectedEOF
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func skipBytes(reader io.Reader, size int64) error {
	if size <= 0 {
		return nil
	}
	_, err := discardMetadataBytes(reader, size)
	return err
}

func fixedMetadataValueBytes(valueType ValueType) uint64 {
	switch valueType {
	case ValueTypeUint8, ValueTypeInt8, ValueTypeBool:
		return 1
	case ValueTypeUint16, ValueTypeInt16:
		return 2
	case ValueTypeUint32, ValueTypeInt32, ValueTypeFloat32:
		return 4
	case ValueTypeUint64, ValueTypeInt64, ValueTypeFloat64:
		return 8
	default:
		return 0
	}
}

func discardMetadataBytes(reader io.Reader, size int64) (int64, error) {
	if size <= 0 {
		return 0, nil
	}
	// The Driver parses a bounded in-memory prefix. Skip only when the reader
	// exposes its actual remaining length; a general Seeker can pass EOF.
	if bounded, ok := reader.(interface {
		Len() int
		Seek(int64, int) (int64, error)
	}); ok {
		remaining := int64(bounded.Len())
		if remaining < 0 {
			return 0, fmt.Errorf("invalid remaining gguf metadata length")
		}
		consumed := min(size, remaining)
		if consumed > 0 {
			if _, err := bounded.Seek(consumed, io.SeekCurrent); err != nil {
				return 0, err
			}
		}
		if consumed != size {
			return consumed, io.EOF
		}
		return consumed, nil
	}
	return io.CopyN(io.Discard, reader, size)
}
