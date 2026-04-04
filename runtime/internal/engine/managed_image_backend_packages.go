package engine

import "strings"

type managedImageBackendPackageFormat string

const (
	managedImageBackendPackageFormatNone          managedImageBackendPackageFormat = "none"
	managedImageBackendPackageFormatOCIPayload    managedImageBackendPackageFormat = "oci_payload"
	managedImageBackendPackageFormatDirectArchive managedImageBackendPackageFormat = "direct_archive"
)

type managedImageBackendLaunchMode string

const (
	managedImageBackendLaunchModePackageEntrypoint managedImageBackendLaunchMode = "package_entrypoint"
	managedImageBackendLaunchModeRuntimeWrapper    managedImageBackendLaunchMode = "runtime_wrapper"
)

type managedImageBackendArchiveSource struct {
	URL    string
	SHA256 string
}

type managedImageBackendPackageSpec struct {
	BackendName          string
	OS                   string
	Arch                 string
	GPUVendor            string
	CUDARequired         bool
	InstallDirName       string
	PackageFormat        managedImageBackendPackageFormat
	ImageRef             string
	ArchiveURL           string
	ArchiveSHA256        string
	SupplementalArchives []managedImageBackendArchiveSource
	ExecutableCandidates []string
	LaunchMode           managedImageBackendLaunchMode
	WrapperDriver        string
	Supported            bool
	Detail               string
}

var managedImageBackendPackageSpecs = []managedImageBackendPackageSpec{
	{
		BackendName:    "stablediffusion-ggml",
		OS:             "darwin",
		Arch:           "arm64",
		GPUVendor:      "apple",
		InstallDirName: "metal-stablediffusion-ggml",
		PackageFormat:  managedImageBackendPackageFormatOCIPayload,
		ImageRef:       "quay.io/go-skynet/local-ai-backends:latest-metal-darwin-arm64-stablediffusion-ggml",
		LaunchMode:     managedImageBackendLaunchModePackageEntrypoint,
		Supported:      true,
	},
	{
		BackendName:    "stablediffusion-ggml",
		OS:             "windows",
		Arch:           "amd64",
		GPUVendor:      "nvidia",
		CUDARequired:   true,
		InstallDirName: "sd-win-cuda12-x64-stablediffusion-ggml",
		PackageFormat:  managedImageBackendPackageFormatDirectArchive,
		ArchiveURL:     "https://github.com/leejet/stable-diffusion.cpp/releases/download/master-552-87ecb95/sd-master-87ecb95-bin-win-cuda12-x64.zip",
		ArchiveSHA256:  "011643ec700d6097b9537f0f75ffb26856cc56a5ce765ffe9a32f2b47844e080",
		SupplementalArchives: []managedImageBackendArchiveSource{
			{
				URL:    "https://github.com/leejet/stable-diffusion.cpp/releases/download/master-552-87ecb95/cudart-sd-bin-win-cu12-x64.zip",
				SHA256: "fe20366827d357c00797eebb58244dddab7fd9a348d70090c3871004c320f38d",
			},
		},
		ExecutableCandidates: []string{"sd.exe", "sd-cli.exe"},
		LaunchMode:           managedImageBackendLaunchModeRuntimeWrapper,
		WrapperDriver:        "stable-diffusion.cpp",
		Supported:            true,
	},
	{
		BackendName:   "stablediffusion-ggml",
		OS:            "linux",
		Arch:          "amd64",
		GPUVendor:     "nvidia",
		CUDARequired:  true,
		PackageFormat: managedImageBackendPackageFormatNone,
		Supported:     false,
		Detail:        "no published runtime-owned managed image backend package is available for linux/amd64+nvidia+cuda",
	},
}

func resolveManagedImageBackendPackageSpecForCurrentHost(backendName string) (managedImageBackendPackageSpec, bool) {
	return resolveManagedImageBackendPackageSpecForHost(
		backendName,
		currentGOOS(),
		currentGOARCH(),
		detectLocalGPUVendor(),
		detectMediaCUDAReady(),
	)
}

func resolveManagedImageBackendPackageSpecForHost(backendName string, goos string, goarch string, gpuVendor string, cudaReady bool) (managedImageBackendPackageSpec, bool) {
	normalizedBackend := strings.ToLower(strings.TrimSpace(backendName))
	hostGPUVendor := strings.ToLower(strings.TrimSpace(gpuVendor))
	hostCUDAReady := cudaReady
	for _, entry := range managedImageBackendPackageSpecs {
		if !strings.EqualFold(strings.TrimSpace(entry.BackendName), normalizedBackend) {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(entry.OS), strings.ToLower(strings.TrimSpace(goos))) {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(entry.Arch), strings.ToLower(strings.TrimSpace(goarch))) {
			continue
		}
		if strings.TrimSpace(entry.GPUVendor) != "" && !strings.EqualFold(strings.TrimSpace(entry.GPUVendor), hostGPUVendor) {
			continue
		}
		if entry.CUDARequired && !hostCUDAReady {
			continue
		}
		return entry, true
	}
	return managedImageBackendPackageSpec{}, false
}
