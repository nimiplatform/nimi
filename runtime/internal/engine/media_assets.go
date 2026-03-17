package engine

import _ "embed"

//go:embed assets/media_server.py
var mediaServerScript string

//go:embed assets/speech_server.py
var speechServerScript string
