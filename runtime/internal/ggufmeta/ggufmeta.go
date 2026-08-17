package ggufmeta

import (
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"strings"
)

const (
	magicHeader            = "GGUF"
	maxMetadataStringBytes = 1 << 20
	maxMetadataEntries     = 1 << 20
	maxTensorEntries       = 1 << 20
	maxTensorDimensions    = 16
)

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
}

type Summary struct {
	Magic       string
	Version     uint32
	TensorCount uint64
	KVCount     uint64
	Entries     []MetadataEntry
	TensorNames []string
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
	summary.TensorNames = make([]string, 0, summary.TensorCount)
	for i := uint64(0); i < summary.TensorCount; i++ {
		name, err := readGGUFString(reader)
		if err != nil {
			return Summary{}, fmt.Errorf("read gguf tensor name %d: %w", i, err)
		}
		var dimensions uint32
		if err := binary.Read(reader, binary.LittleEndian, &dimensions); err != nil {
			return Summary{}, fmt.Errorf("read gguf tensor dimensions %q: %w", name, err)
		}
		if dimensions > maxTensorDimensions {
			return Summary{}, fmt.Errorf("gguf tensor %q has too many dimensions: %d", name, dimensions)
		}
		for dim := uint32(0); dim < dimensions; dim++ {
			var size uint64
			if err := binary.Read(reader, binary.LittleEndian, &size); err != nil {
				return Summary{}, fmt.Errorf("read gguf tensor shape %q: %w", name, err)
			}
		}
		var tensorType uint32
		if err := binary.Read(reader, binary.LittleEndian, &tensorType); err != nil {
			return Summary{}, fmt.Errorf("read gguf tensor type %q: %w", name, err)
		}
		var offset uint64
		if err := binary.Read(reader, binary.LittleEndian, &offset); err != nil {
			return Summary{}, fmt.Errorf("read gguf tensor offset %q: %w", name, err)
		}
		if strings.TrimSpace(name) != "" {
			summary.TensorNames = append(summary.TensorNames, name)
		}
	}
	return summary, nil
}

// InspectLLMMetadata reads only the GGUF metadata needed by LLM Drivers. It
// returns as soon as architecture and model-authored context length are known,
// without traversing unrelated tokenizer arrays or tensor headers. If a
// bounded prefix ends after a valid architecture but before optional context
// metadata, the already-read architecture remains usable.
func InspectLLMMetadata(reader io.Reader) (Summary, error) {
	summary, err := readSummaryHeader(reader)
	if err != nil {
		return Summary{}, err
	}
	for i := uint64(0); i < summary.KVCount; i++ {
		entry, err := readMetadataEntry(reader, i)
		if err != nil {
			if LLMDetectedArchitecture(summary) != "" {
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
	} else if isIntegerValueType(valueType) {
		value, ok, err := readUint64MetadataValue(reader, valueType)
		if err != nil {
			return MetadataEntry{}, fmt.Errorf("read gguf metadata integer %q: %w", key, err)
		}
		entry.Uint64Value = value
		entry.HasUint64Value = ok
	} else if err := skipValue(reader, valueType); err != nil {
		return MetadataEntry{}, fmt.Errorf("skip gguf metadata value %q: %w", key, err)
	}
	return entry, nil
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
		_, err := readGGUFString(reader)
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

func skipBytes(reader io.Reader, size int64) error {
	if size <= 0 {
		return nil
	}
	_, err := io.CopyN(io.Discard, reader, size)
	return err
}
