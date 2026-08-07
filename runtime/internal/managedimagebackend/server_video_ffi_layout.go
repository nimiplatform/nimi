package managedimagebackend

import "unsafe"

// The following types mirror stable-diffusion.h at floor c6beeef35526.
// C enums/int are int32, C bool is one byte, and pointers/size_t use MSVC x64
// eight-byte alignment. See header lines 188-248 and 399-430.
type sdCtxParams struct {
	ModelPath                   uintptr
	ClipLPath                   uintptr
	ClipGPath                   uintptr
	ClipVisionPath              uintptr
	T5XXLPath                   uintptr
	LLMPath                     uintptr
	LLMVisionPath               uintptr
	DiffusionModelPath          uintptr
	HighNoiseDiffusionModelPath uintptr
	UncondDiffusionModelPath    uintptr
	EmbeddingsConnectorsPath    uintptr
	VAEPath                     uintptr
	AudioVAEPath                uintptr
	TAESDPath                   uintptr
	ControlNetPath              uintptr
	IPAdapterPath               uintptr
	MotionModulePath            uintptr
	Embeddings                  uintptr
	EmbeddingCount              uint32
	_                           [4]byte
	PhotoMakerPath              uintptr
	PulidWeightsPath            uintptr
	TensorTypeRules             uintptr
	NThreads                    int32
	WType                       int32
	RNGType                     int32
	SamplerRNGType              int32
	Prediction                  int32
	LoraApplyMode               int32
	EnableMMap                  uint8
	FlashAttention              uint8
	DiffusionFlashAttention     uint8
	TAEPreviewOnly              uint8
	DiffusionConvDirect         uint8
	VAEConvDirect               uint8
	ForceSDXLVAEConvScale       uint8
	_                           [1]byte
	VAEFormat                   int32
	_                           [4]byte
	MaxVRAM                     uintptr
	StreamLayers                uint8
	EagerLoad                   uint8
	_                           [6]byte
	Backend                     uintptr
	ParamsBackend               uintptr
	SplitMode                   uintptr
	AutoFit                     uint8
	_                           [7]byte
	RPCServers                  uintptr
	ModelArgs                   uintptr
}

type sdAudio struct {
	SampleRate  uint32
	Channels    uint32
	SampleCount uint64
	Data        unsafe.Pointer
}

type sdImage struct {
	Width   uint32
	Height  uint32
	Channel uint32
	_       [4]byte
	Data    unsafe.Pointer
}

type sdTilingParams struct {
	Enabled         uint8
	TemporalTiling  uint8
	_               [2]byte
	TileSizeX       int32
	TileSizeY       int32
	TargetOverlap   float32
	RelativeSizeX   float32
	RelativeSizeY   float32
	ExtraTilingArgs uintptr
}

type sdSLGParams struct {
	Layers     uintptr
	LayerCount uintptr
	LayerStart float32
	LayerEnd   float32
	Scale      float32
	_          [4]byte
}

type sdGuidanceParams struct {
	TextCFG           float32
	ImageCFG          float32
	DistilledGuidance float32
	_                 [4]byte
	SLG               sdSLGParams
}

type sdSampleParams struct {
	Guidance          sdGuidanceParams
	Scheduler         int32
	SampleMethod      int32
	SampleSteps       int32
	ETA               float32
	ShiftedTimestep   int32
	_                 [4]byte
	CustomSigmas      uintptr
	CustomSigmasCount int32
	FlowShift         float32
	ExtraSampleArgs   uintptr
}

type sdCacheParams struct {
	Mode                     int32
	ReuseThreshold           float32
	StartPercent             float32
	EndPercent               float32
	ErrorDecayRate           float32
	UseRelativeThreshold     uint8
	ResetErrorOnCompute      uint8
	_                        [2]byte
	FNComputeBlocks          int32
	BNComputeBlocks          int32
	ResidualDiffThreshold    float32
	MaxWarmupSteps           int32
	MaxCachedSteps           int32
	MaxContinuousCachedSteps int32
	TaylorseerNDerivatives   int32
	TaylorseerSkipInterval   int32
	SCMMask                  uintptr
	SCMPolicyDynamic         uint8
	_                        [3]byte
	SpectrumW                float32
	SpectrumM                int32
	SpectrumLambda           float32
	SpectrumWindowSize       int32
	SpectrumFlexWindow       float32
	SpectrumWarmupSteps      int32
	SpectrumStopPercent      float32
}

type sdHiresParams struct {
	Enabled           uint8
	_                 [3]byte
	Upscaler          int32
	ModelPath         uintptr
	Scale             float32
	TargetWidth       int32
	TargetHeight      int32
	Steps             int32
	DenoisingStrength float32
	UpscaleTileSize   int32
	CustomSigmas      uintptr
	CustomSigmasCount int32
	_                 [4]byte
}

type sdVideoGenParams struct {
	Loras                 uintptr
	LoraCount             uint32
	_                     [4]byte
	Prompt                uintptr
	NegativePrompt        uintptr
	ClipSkip              int32
	_                     [4]byte
	InitImage             sdImage
	EndImage              sdImage
	RefImages             uintptr
	RefImagesCount        int32
	_                     [4]byte
	RefVideos             uintptr
	RefVideosCount        int32
	_                     [4]byte
	RefAudios             uintptr
	RefAudiosCount        int32
	_                     [4]byte
	ControlFrames         uintptr
	ControlFramesSize     int32
	Width                 int32
	Height                int32
	_                     [4]byte
	SampleParams          sdSampleParams
	HighNoiseSampleParams sdSampleParams
	MOEBoundary           float32
	Strength              float32
	Seed                  int64
	VideoFrames           int32
	FPS                   int32
	VACEStrength          float32
	_                     [4]byte
	VAETilingParams       sdTilingParams
	Cache                 sdCacheParams
	Hires                 sdHiresParams
	CircularX             uint8
	CircularY             uint8
	_                     [6]byte
}

// Bidirectional compile-time size assertions for the MSVC x64 ABI.
var (
	_ [280 - unsafe.Sizeof(sdCtxParams{})]byte
	_ [unsafe.Sizeof(sdCtxParams{}) - 280]byte
	_ [24 - unsafe.Sizeof(sdAudio{})]byte
	_ [unsafe.Sizeof(sdAudio{}) - 24]byte
	_ [24 - unsafe.Sizeof(sdImage{})]byte
	_ [unsafe.Sizeof(sdImage{}) - 24]byte
	_ [576 - unsafe.Sizeof(sdVideoGenParams{})]byte
	_ [unsafe.Sizeof(sdVideoGenParams{}) - 576]byte
)
