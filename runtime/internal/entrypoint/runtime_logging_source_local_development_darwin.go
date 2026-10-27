//go:build darwin && cgo && nimi_macos_source_local_development

package entrypoint

import (
	"io"
	"log/slog"
	"os"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

// The source supervisor inherits stdout from the dev:runtime terminal. Keep
// native diagnostics available while making daemon progress visible there too.
func newMacOSRuntimeLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(io.MultiWriter(os.Stdout, protectedlocal.MacOSRuntimeLogWriter{}), nil))
}
