package capabilitydriver

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
)

const (
	llamaGGUFProbeSchema = "llama-gguf-probe/v1"
	// maxStructuredGGUFMetadataBytes bounds the GGUF header walk over io.ReaderAt
	// using a 64 KiB rolling buffer so 256k-512k vocab models (whose tokenizer
	// arrays can exceed 16 MiB) and their tensor tables are scanned without
	// loading weight payloads.
	maxStructuredGGUFMetadataBytes = 64 << 20
)

// ErrGGUFMetadataBudgetExceeded distinguishes a GGUF file whose KV section
// extends past the structured probe walk bound from physical truncation or
// header corruption.
var ErrGGUFMetadataBudgetExceeded = errors.New("GGUF metadata exceeds structured probe budget")

// These are per-probe interpreted facts, never stored verification authority.
// Recipe and slot prevent applying a more permissive parser's result to a
// different Model Contract. Exact content/binding identity stays owner-supplied.
type llamaGGUFProbe struct {
	Schema                   string                   `json:"schema"`
	RecipeID                 string                   `json:"recipeId"`
	RequirementID            string                   `json:"requirementId"`
	Kind                     runtimev1.LocalAssetKind `json:"kind"`
	Architecture             string                   `json:"architecture,omitempty"`
	ContextWindow            uint64                   `json:"contextWindow,omitempty"`
	EmbeddingLength          uint64                   `json:"embeddingLength,omitempty"`
	DeepstackLayers          uint64                   `json:"deepstackLayers,omitempty"`
	TemplateIdentity         string                   `json:"templateIdentity,omitempty"`
	TokenizerBOSToken        string                   `json:"tokenizerBosToken,omitempty"`
	TokenizerEOSToken        string                   `json:"tokenizerEosToken,omitempty"`
	TokenizerSpecialTokens   []string                 `json:"tokenizerSpecialTokens,omitempty"`
	ProjectorType            string                   `json:"projectorType,omitempty"`
	AudioProjectorType       string                   `json:"audioProjectorType,omitempty"`
	VisionProjectionDim      uint64                   `json:"visionProjectionDim,omitempty"`
	AudioProjectionDim       uint64                   `json:"audioProjectionDim,omitempty"`
	ProjectorMergerWidth     uint64                   `json:"projectorMergerWidth,omitempty"`
	ProjectorDeepstackLayers uint64                   `json:"projectorDeepstackLayers,omitempty"`
	HasVisionEncoder         bool                     `json:"hasVisionEncoder,omitempty"`
	EmbeddingDimension       int                      `json:"embeddingDimension,omitempty"`
	EmbeddingInputProtocol   string                   `json:"embeddingInputProtocol,omitempty"`
}

// ggufProbeReader exposes only a bounded prefix range over an opened io.ReaderAt
// via a 64 KiB rolling window. Skipped bytes require a real readable boundary;
// a supplied size or general Seek is not evidence of non-truncation.
type ggufProbeReader struct {
	window         *modelAssetProbeReaderAt
	source         *ggufProbeSource
	position       int64
	limit          int64
	budgetLimited  bool
	budgetExceeded bool
	failure        error
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
	if source == nil || size < 4 || limit < 4 || limit > maxStructuredGGUFMetadataBytes {
		return nil, fmt.Errorf("invalid GGUF probe source or bound")
	}
	budgetLimited := size > limit
	limit = min(size, limit)
	observed := &ggufProbeSource{reader: source}
	return &ggufProbeReader{
		window:        newModelAssetProbeReaderAt(observed, limit, 64<<10),
		source:        observed,
		limit:         limit,
		budgetLimited: budgetLimited,
	}, nil
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
		if r.budgetLimited {
			r.budgetExceeded = true
		}
		return 0, io.EOF
	}
	truncatedToLimit := int64(len(p)) > r.limit-r.position
	p = p[:min(int64(len(p)), r.limit-r.position)]
	n, err := r.window.ReadAt(p, r.position)
	r.position += int64(n)
	if truncatedToLimit && r.budgetLimited && r.position >= r.limit {
		r.budgetExceeded = true
	}
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
		if offset > r.limit-base && r.budgetLimited {
			r.budgetExceeded = true
		}
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

func (r *ggufProbeReader) inspectModel(size int64) (ggufmeta.Summary, error) {
	summary, end, err := ggufmeta.InspectModel(r, size)
	if failure := r.actualFailure(); failure != nil {
		return ggufmeta.Summary{}, failure
	}
	if err != nil {
		if (r.budgetExceeded || (r.budgetLimited && r.position >= r.limit)) &&
			(errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)) {
			return ggufmeta.Summary{}, fmt.Errorf("%w (%d bytes)", ErrGGUFMetadataBudgetExceeded, r.limit)
		}
		return ggufmeta.Summary{}, err
	}
	var lastByte [1]byte
	_, err = r.source.ReadAt(lastByte[:], end-1)
	if failure := r.actualFailure(); failure != nil {
		return ggufmeta.Summary{}, failure
	}
	if err != nil {
		return ggufmeta.Summary{}, fmt.Errorf("read GGUF tensor data boundary: %w", err)
	}
	return summary, nil
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
	if !ggufmeta.IsGGUFExtension(input.Entry.RelativePath) || len(input.Entry.FormatProbe) > MaxAssetFormatProbeBytes {
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

func decodeLlamaGGUFProbeBytes(probe []byte) (llamaGGUFProbe, error) {
	var facts llamaGGUFProbe
	if len(probe) == 0 || len(probe) > MaxAssetFormatProbeBytes {
		return facts, fmt.Errorf("invalid GGUF structured probe")
	}
	decoder := json.NewDecoder(bytes.NewReader(probe))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&facts); err != nil {
		return facts, err
	}
	if decoder.Decode(new(any)) != io.EOF || facts.Schema != llamaGGUFProbeSchema {
		return facts, fmt.Errorf("GGUF structured probe schema mismatch")
	}
	return facts, nil
}

// @nimi-authority: rule.nimi.runtime.local-compute.r031
// @nimi-authority: rule.nimi.runtime.local-compute.r112
func (driver LlamaTextDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if !input.Entry {
		return nil, nil
	}
	if !ggufmeta.IsGGUFExtension(input.RelativePath) {
		return nil, fmt.Errorf("GGUF entry required")
	}
	reader, err := newGGUFProbeReader(source, size, maxStructuredGGUFMetadataBytes)
	if err != nil {
		return nil, err
	}
	facts := llamaGGUFProbe{Schema: llamaGGUFProbeSchema, RecipeID: input.RecipeID, RequirementID: input.RequirementID}
	if input.RequirementID != MainGGUFRequirementID && input.RequirementID != CompanionMMProjRequirementID {
		return nil, fmt.Errorf("unsupported GGUF slot")
	}
	summary, err := reader.inspectModel(size)
	if err != nil {
		return nil, err
	}
	switch input.RequirementID {
	case MainGGUFRequirementID:
		if summary.HasKey("general.type") {
			modelType, ok := summary.StringValue("general.type")
			if !ok {
				return nil, fmt.Errorf("GGUF general.type is not a string")
			}
			if modelType != "model" {
				return nil, fmt.Errorf("GGUF general.type %q is not a generative model", modelType)
			}
		}
		facts.Architecture = ggufmeta.LLMDetectedArchitecture(summary)
		if !contains(driver.recipeModelArchitectures(input.RecipeID, input.RequirementID), facts.Architecture) {
			return nil, fmt.Errorf("GGUF architecture %q is unsupported for recipe %q", facts.Architecture, input.RecipeID)
		}
		if summary.HasKey(facts.Architecture + ".pooling_type") {
			pooling, ok := ggufmeta.LLMPoolingType(summary)
			if !ok {
				return nil, fmt.Errorf("GGUF model %s.pooling_type is not a valid non-negative integer", facts.Architecture)
			}
			if pooling > 0 {
				return nil, fmt.Errorf("GGUF model declares non-zero pooling_type %d", pooling)
			}
		}
		if summary.HasKey(facts.Architecture + ".n_deepstack_layers") {
			deepstack, ok := ggufmeta.LLMDeepstackLayers(summary)
			if !ok {
				return nil, fmt.Errorf("GGUF model %s.n_deepstack_layers is not a valid non-negative integer", facts.Architecture)
			}
			facts.DeepstackLayers = deepstack
		}
		contextWindow, ok := ggufmeta.LLMContextLength(summary)
		if !ok || contextWindow == 0 {
			return nil, fmt.Errorf("GGUF model context_length is missing or zero")
		}
		facts.ContextWindow = contextWindow
		facts.EmbeddingLength, _ = ggufmeta.LLMEmbeddingLength(summary)
		facts.TemplateIdentity, _ = ggufmeta.LLMEffectiveChatTemplateIdentity(summary)
		facts.TokenizerBOSToken = summary.Tokenizer.BOSToken
		facts.TokenizerEOSToken = summary.Tokenizer.EOSToken
		facts.TokenizerSpecialTokens = append([]string(nil), summary.Tokenizer.SpecialTokens...)
		facts.Kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT
	case CompanionMMProjRequirementID:
		if summary.HasKey("general.type") {
			modelType, ok := summary.StringValue("general.type")
			if !ok {
				return nil, fmt.Errorf("GGUF projector general.type is not a string")
			}
			if modelType != "mmproj" && modelType != "model" {
				return nil, fmt.Errorf("GGUF projector general.type %q is not mmproj or model", modelType)
			}
		}
		facts.Architecture = ggufmeta.LLMDetectedArchitecture(summary)
		if facts.Architecture != "clip" {
			return nil, fmt.Errorf("GGUF projector architecture %q is not clip", facts.Architecture)
		}
		if summary.HasKey("clip.vision.projector_type") {
			projector, ok := summary.StringValue("clip.vision.projector_type")
			if !ok {
				return nil, fmt.Errorf("GGUF clip.vision.projector_type is not a string")
			}
			facts.ProjectorType = projector
		} else if summary.HasKey("clip.projector_type") {
			projector, ok := summary.StringValue("clip.projector_type")
			if !ok {
				return nil, fmt.Errorf("GGUF clip.projector_type is not a string")
			}
			facts.ProjectorType = projector
		}
		if summary.HasKey("clip.audio.projector_type") {
			audioProjector, ok := summary.StringValue("clip.audio.projector_type")
			if !ok {
				return nil, fmt.Errorf("GGUF clip.audio.projector_type is not a string")
			}
			facts.AudioProjectorType = audioProjector
		}
		if summary.HasKey("clip.vision.projection_dim") {
			visionDim, ok := summary.Uint64Value("clip.vision.projection_dim")
			if !ok {
				return nil, fmt.Errorf("GGUF clip.vision.projection_dim is not a valid non-negative integer")
			}
			facts.VisionProjectionDim = visionDim
		}
		if summary.HasKey("clip.audio.projection_dim") {
			audioDim, ok := summary.Uint64Value("clip.audio.projection_dim")
			if !ok {
				return nil, fmt.Errorf("GGUF clip.audio.projection_dim is not a valid non-negative integer")
			}
			facts.AudioProjectionDim = audioDim
		}
		facts.HasVisionEncoder, _ = summary.BoolValue("clip.has_vision_encoder")
		if input.RecipeID == LlamaGemma412BRecipeID {
			if facts.ProjectorType != "gemma4uv" || facts.AudioProjectorType != "gemma4ua" ||
				facts.VisionProjectionDim == 0 || facts.AudioProjectionDim == 0 {
				return nil, fmt.Errorf("Gemma 4 unified projector metadata mismatch")
			}
		} else {
			if !llamaAdmittedVisionProjectorType(facts.ProjectorType) || facts.VisionProjectionDim == 0 {
				return nil, fmt.Errorf("GGUF projector type %q or projection_dim %d is unsupported", facts.ProjectorType, facts.VisionProjectionDim)
			}
			if facts.ProjectorType == "qwen3vl_merger" {
				mergerWidth, deepstackLayers, ok := ggufmeta.Qwen3VLProjectorDimensions(summary)
				if !ok {
					return nil, fmt.Errorf("GGUF qwen3vl_merger projector lacks valid mm.2.bias tensor header")
				}
				facts.ProjectorMergerWidth = mergerWidth
				facts.ProjectorDeepstackLayers = deepstackLayers
			}
		}
		facts.Kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY
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
	if input.RequirementID != EmbeddingGGUFRequirementID || !ggufmeta.IsGGUFExtension(input.RelativePath) {
		return nil, fmt.Errorf("embedding GGUF entry required")
	}
	limit := driver.ModelAssetFormatProbeBytes(input)
	if input.RecipeID == LlamaEmbeddingGemma2RecipeID {
		limit = maxStructuredGGUFMetadataBytes
	}
	reader, err := newGGUFProbeReader(source, size, limit)
	if err != nil {
		return nil, err
	}
	var summary ggufmeta.Summary
	if input.RecipeID == LlamaEmbeddingGemma2RecipeID {
		summary, err = reader.inspectModel(size)
	} else {
		summary, err = ggufmeta.InspectEmbeddingMetadata(reader)
	}
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
	if input.RecipeID == LlamaEmbeddingGemma2RecipeID {
		if !embeddingGemma2ModelContract(summary) {
			return nil, fmt.Errorf("EmbeddingGemma 2 model contract mismatch")
		}
		return encodeLlamaGGUFProbe(llamaGGUFProbe{Schema: llamaGGUFProbeSchema, RecipeID: input.RecipeID, RequirementID: input.RequirementID, Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING, Architecture: architecture, ContextWindow: 8192, EmbeddingDimension: 768, EmbeddingInputProtocol: EmbeddingInputGemma2V1})
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
