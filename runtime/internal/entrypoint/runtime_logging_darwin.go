//go:build darwin && cgo && !nimi_macos_source_local_development

package entrypoint

import (
	"log/slog"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func newMacOSRuntimeLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(protectedlocal.MacOSRuntimeLogWriter{}, nil))
}
