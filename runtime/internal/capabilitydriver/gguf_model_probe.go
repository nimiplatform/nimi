package capabilitydriver

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
)

const llamaGGUFProbeSchema = "llama-gguf-probe/v1"

// These are per-probe interpreted facts, never stored verification authority.
// Recipe and slot prevent applying a more permissive parser's result to a
// different Model Contract. Exact content/binding identity stays owner-supplied.
type llamaGGUFProbe struct {
	Schema                 string                   `json:"schema"`
	RecipeID               string                   `json:"recipeId"`
	RequirementID          string                   `json:"requirementId"`
	Kind                   runtimev1.LocalAssetKind `json:"kind"`
	Architecture           string                   `json:"architecture,omitempty"`
	ContextWindow          uint64                   `json:"contextWindow,omitempty"`
	TemplateIdentity       string                   `json:"templateIdentity,omitempty"`
	EmbeddingDimension     int                      `json:"embeddingDimension,omitempty"`
	EmbeddingInputProtocol string                   `json:"embeddingInputProtocol,omitempty"`
}

// ggufProbeReader exposes only the same prefix range the Driver admitted
// before structured probing. Skipped bytes require a real readable boundary;
// a supplied size or a general file Seek is not evidence of non-truncation.
type ggufProbeReader struct {
	window   *modelAssetProbeReaderAt
	source   *ggufProbeSource
	position int64
	limit    int64
	failure  error
}

type ggufProbeSource struct {
	reader  io.ReaderAt
	failure error
}

func (r *ggufProbeSource) ContextErr() error {
	if checker, ok := r.reader.(interface{ ContextErr() error }); ok {
		return checker.ContextErr()
	}
	return nil
}

func (r *ggufProbeSource) ReadAt(p []byte, offset int64) (int, error) {
	n, err := r.reader.ReadAt(p, offset)
	if n < len(p) && (err == nil || errors.Is(err, io.EOF)) {
		// The window never requests bytes outside the declared prefix range.
		// A shorter physical source must not become optional missing metadata.
		r.failure = io.ErrUnexpectedEOF
	} else if err != nil && !errors.Is(err, io.EOF) {
		r.failure = err
	}
	return n, err
}

func newGGUFProbeReader(source io.ReaderAt, size, limit int64) (*ggufProbeReader, error) {
	if source == nil || size < 4 || limit < 4 || limit > MaxDriverAssetFormatProbeBytes {
		return nil, fmt.Errorf("invalid GGUF probe source or bound")
	}
	limit = min(size, limit)
	observed := &ggufProbeSource{reader: source}
	return &ggufProbeReader{window: newModelAssetProbeReaderAt(observed, limit, 64<<10), source: observed, limit: limit}, nil
}

func (r *ggufProbeReader) ContextErr() error { return r.window.ContextErr() }
func (r *ggufProbeReader) Len() int          { return int(r.limit - r.position) }
func (r *ggufProbeReader) Read(p []byte) (int, error) {
	if err := r.ContextErr(); err != nil {
		r.failure = err
		return 0, err
	}
	if len(p) == 0 {
		return 0, nil
	}
	if r.position >= r.limit {
		return 0, io.EOF
	}
	p = p[:min(int64(len(p)), r.limit-r.position)]
	n, err := r.window.ReadAt(p, r.position)
	r.position += int64(n)
	if err != nil && !errors.Is(err, io.EOF) {
		r.failure = err
	}
	return n, err
}

func (r *ggufProbeReader) Seek(offset int64, whence int) (int64, error) {
	if err := r.ContextErr(); err != nil {
		r.failure = err
		return r.position, err
	}
	base := int64(0)
	switch whence {
	case io.SeekStart:
	case io.SeekCurrent:
		base = r.position
	case io.SeekEnd:
		base = r.limit
	default:
		return r.position, fmt.Errorf("invalid GGUF seek origin")
	}
	if offset > r.limit-base || offset < -base {
		return r.position, io.EOF
	}
	next := base + offset
	if next > r.position {
		var end [1]byte
		n, err := r.window.ReadAt(end[:], next-1)
		if err != nil {
			if !errors.Is(err, io.EOF) {
				r.failure = err
			}
			return r.position, err
		}
		if n != 1 {
			return r.position, io.ErrUnexpectedEOF
		}
	}
	r.position = next
	return next, nil
}

func (r *ggufProbeReader) actualFailure() error {
	if err := r.ContextErr(); err != nil {
		return err
	}
	if r.source.failure != nil {
		return r.source.failure
	}
	return r.failure
}

func encodeLlamaGGUFProbe(facts llamaGGUFProbe) ([]byte, error) {
	data, err := json.Marshal(facts)
	if err != nil {
		return nil, err
	}
	if len(data) > MaxAssetFormatProbeBytes {
		return nil, fmt.Errorf("GGUF structured probe exceeds its bound")
	}
	return data, nil
}

func decodeLlamaGGUFProbe(input ModelAssetBindingInput) (llamaGGUFProbe, error) {
	var facts llamaGGUFProbe
	if filepath.Ext(strings.ToLower(input.Entry.RelativePath)) != ".gguf" || len(input.Entry.FormatProbe) > MaxAssetFormatProbeBytes {
		return facts, fmt.Errorf("invalid GGUF structured probe")
	}
	decoder := json.NewDecoder(bytes.NewReader(input.Entry.FormatProbe))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&facts); err != nil {
		return facts, err
	}
	if decoder.Decode(new(any)) != io.EOF || facts.Schema != llamaGGUFProbeSchema || facts.RecipeID != input.RecipeID || facts.RequirementID != input.Requirement.GetRequirementId() {
		return facts, fmt.Errorf("GGUF structured probe contract mismatch")
	}
	return facts, nil
}

// @nimi-authority: rule.nimi.runtime.local-compute.r031
func (driver LlamaTextDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if !input.Entry {
		return nil, nil
	}
	if filepath.Ext(strings.ToLower(input.RelativePath)) != ".gguf" {
		return nil, fmt.Errorf("GGUF entry required")
	}
	reader, err := newGGUFProbeReader(source, size, driver.ModelAssetFormatProbeBytes(input))
	if err != nil {
		return nil, err
	}
	facts := llamaGGUFProbe{Schema: llamaGGUFProbeSchema, RecipeID: input.RecipeID, RequirementID: input.RequirementID}
	switch input.RequirementID {
	case MainGGUFRequirementID:
		var summary ggufmeta.Summary
		if qwen35Recipe(input.RecipeID) {
			summary, err = ggufmeta.Inspect(reader)
		} else {
			summary, err = ggufmeta.InspectLLMMetadataWithChatTemplate(reader)
		}
		if failure := reader.actualFailure(); failure != nil {
			return nil, failure
		}
		if err != nil {
			return nil, err
		}
		if qwen35Recipe(input.RecipeID) && !qwen35BaseTextModelContract(summary) {
			return nil, fmt.Errorf("qwen35 Model Contract mismatch")
		}
		facts.Architecture = ggufmeta.LLMDetectedArchitecture(summary)
		if !contains(driver.recipeModelArchitectures(input.RecipeID, input.RequirementID), facts.Architecture) {
			return nil, fmt.Errorf("GGUF architecture mismatch")
		}
		facts.ContextWindow, _ = ggufmeta.LLMContextLength(summary)
		facts.TemplateIdentity, _ = ggufmeta.LLMChatTemplateIdentity(summary)
		facts.Kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT
	case CompanionMMProjRequirementID:
		if strings.TrimSpace(input.RecipeID) == LlamaQwen35VisionRecipeID {
			summary, inspectErr := ggufmeta.Inspect(reader)
			if failure := reader.actualFailure(); failure != nil {
				return nil, failure
			}
			if inspectErr != nil {
				return nil, inspectErr
			}
			if !qwen35ProjectorModelContract(summary) {
				return nil, fmt.Errorf("qwen35 projector Model Contract mismatch")
			}
			facts.Architecture = ggufmeta.LLMDetectedArchitecture(summary)
		} else {
			var magic [4]byte
			if _, err := io.ReadFull(reader, magic[:]); err != nil {
				return nil, err
			}
			if string(magic[:]) != "GGUF" {
				return nil, fmt.Errorf("invalid GGUF projector magic")
			}
		}
		facts.Kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY
	default:
		return nil, fmt.Errorf("unsupported GGUF slot")
	}
	if failure := reader.actualFailure(); failure != nil {
		return nil, failure
	}
	return encodeLlamaGGUFProbe(facts)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.embedding-output-contract
func (driver LlamaEmbedDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if !input.Entry {
		return nil, nil
	}
	if input.RequirementID != EmbeddingGGUFRequirementID || filepath.Ext(strings.ToLower(input.RelativePath)) != ".gguf" {
		return nil, fmt.Errorf("embedding GGUF entry required")
	}
	reader, err := newGGUFProbeReader(source, size, driver.ModelAssetFormatProbeBytes(input))
	if err != nil {
		return nil, err
	}
	summary, err := ggufmeta.InspectEmbeddingMetadata(reader)
	if failure := reader.actualFailure(); failure != nil {
		return nil, failure
	}
	if err != nil {
		return nil, err
	}
	architecture := ggufmeta.LLMDetectedArchitecture(summary)
	if !contains(driver.recipeModelArchitectures(input.RecipeID, input.RequirementID), architecture) {
		return nil, fmt.Errorf("embedding GGUF architecture mismatch")
	}
	if input.RecipeID == LlamaQwen3EmbedRecipeID {
		if pooling, ok := summary.Uint64Value("qwen3.pooling_type"); !ok || pooling != 3 {
			return nil, fmt.Errorf("qwen3 embedding pooling mismatch")
		}
	}
	dimension, ok := summary.Uint64Value(architecture + ".embedding_length")
	if !ok || dimension == 0 || dimension > uint64(^uint32(0)>>1) {
		return nil, fmt.Errorf("invalid embedding width")
	}
	if summary.HasKey(architecture + ".embedding_length_out") {
		if output, ok := summary.Uint64Value(architecture + ".embedding_length_out"); !ok || output != dimension {
			return nil, fmt.Errorf("embedding output width mismatch")
		}
	}
	if summary.HasKey(architecture + ".pooling_type") {
		if pooling, ok := summary.Uint64Value(architecture + ".pooling_type"); !ok || pooling < 1 || pooling > 3 {
			return nil, fmt.Errorf("unsupported embedding pooling")
		}
	}
	contextWindow, _ := ggufmeta.LLMContextLength(summary)
	facts := llamaGGUFProbe{Schema: llamaGGUFProbeSchema, RecipeID: input.RecipeID, RequirementID: input.RequirementID,
		Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING, Architecture: architecture, ContextWindow: contextWindow,
		EmbeddingDimension: int(dimension), EmbeddingInputProtocol: EmbeddingInputNativeV1}
	if architecture == "nomic-bert" {
		facts.EmbeddingInputProtocol = EmbeddingInputNomicV1
	}
	return encodeLlamaGGUFProbe(facts)
}
