package engine

import _ "embed"

//go:embed assets/media_server.py
var mediaServerScript string

//go:embed assets/speech_server.py
var speechServerScript string

//go:embed assets/speech_server_runtime.py
var speechServerRuntimeScript string

//go:embed assets/qwen3_tts_driver.py
var speechQwen3TTSDriverScript string

//go:embed assets/qwen3_asr_driver.py
var speechQwen3ASRDriverScript string

//go:embed assets/qwen3_asr_transformers_driver.py
var speechQwen3ASRTransformersDriverScript string

//go:embed assets/voxcpm_driver.py
var speechVoxCPMDriverScript string

//go:embed assets/voxcpm_mlx_driver.py
var speechVoxCPMMLXDriverScript string
