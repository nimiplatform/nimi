//go:build windows && amd64

package managedimagebackend

import (
	"fmt"
	"path/filepath"

	"golang.org/x/sys/windows"
)

func newStableDiffusionVideoEngine(executablePath string, identity videoPackageIdentity) (videoEngine, error) {
	path := filepath.Join(filepath.Dir(executablePath), "stable-diffusion.dll")
	return &opaqueVideoEngine{open: func(api *sdVideoAPI) (func(), error) {
		if identity.ArchiveSHA256 != stableDiffusionVideoArchiveSHA256 {
			return nil, fmt.Errorf("video package does not match the Windows x64 ABI")
		}
		// The archive keeps GGML and media imports beside stable-diffusion.dll.
		// The wrapper process already has its verified CUDA directory on PATH.
		dll, err := windows.LoadLibraryEx(path, 0, windows.LOAD_WITH_ALTERED_SEARCH_PATH)
		if err != nil {
			return nil, fmt.Errorf("load stable-diffusion video DLL: %w", err)
		}
		closeLibrary := func() { _ = windows.FreeLibrary(dll) }
		if err := api.bind(func(symbol string) (uintptr, error) {
			return windows.GetProcAddress(dll, symbol)
		}); err != nil {
			closeLibrary()
			return nil, err
		}
		return closeLibrary, nil
	}}, nil
}
