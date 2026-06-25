package managedimagebackend

type stableDiffusionCPPSlotBinding struct {
	EngineSlot string
	Argument   string
}

var stableDiffusionCPPSlotBindings = map[string]stableDiffusionCPPSlotBinding{
	"vae_path": {
		EngineSlot: "vae_path",
		Argument:   "--vae",
	},
	"llm_path": {
		EngineSlot: "llm_path",
		Argument:   "--llm",
	},
	"clip_l_path": {
		EngineSlot: "clip_l_path",
		Argument:   "--clip_l",
	},
	"t5xxl_path": {
		EngineSlot: "t5xxl_path",
		Argument:   "--t5xxl",
	},
	"uncond_diffusion_model": {
		EngineSlot: "uncond_diffusion_model",
		Argument:   "--uncond-diffusion-model",
	},
}
