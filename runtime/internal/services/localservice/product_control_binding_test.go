package localservice

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

type productControlSharedRawVectorFixture struct {
	Version int               `json:"version"`
	BaseRaw map[string]string `json:"baseRaw"`
	Vectors []struct {
		Name                string     `json:"name"`
		Base                string     `json:"base"`
		Replace             [][]string `json:"replace"`
		Disposition         string     `json:"disposition"`
		PrefixHex           string     `json:"prefixHex"`
		RawHex              string     `json:"rawHex"`
		SuffixUTF8          string     `json:"suffixUtf8"`
		RepeatHex           string     `json:"repeatHex"`
		RepeatCount         int        `json:"repeatCount"`
		DataRootPlaceholder string     `json:"dataRootPlaceholder"`
		DataRootLiteral     string     `json:"dataRootLiteral"`
		Platform            string     `json:"platform"`
	} `json:"vectors"`
}

func loadProductControlSharedRawVectorFixture(t *testing.T) productControlSharedRawVectorFixture {
	t.Helper()
	path := filepath.Join(
		"..",
		"..",
		"..",
		"..",
		"scripts",
		"lib",
		"product-control-raw-record-vectors.json",
	)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read shared Product Control raw vectors: %v", err)
	}
	var fixture productControlSharedRawVectorFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode shared Product Control raw vectors: %v", err)
	}
	if fixture.Version != 1 {
		t.Fatalf("shared Product Control raw vector version = %d", fixture.Version)
	}
	return fixture
}

func renderProductControlSharedRawVector(
	t *testing.T,
	fixture productControlSharedRawVectorFixture,
	index int,
	dataRoot string,
	volumeRoot string,
) []byte {
	t.Helper()
	vector := fixture.Vectors[index]
	if vector.RawHex != "" {
		raw, err := hex.DecodeString(vector.RawHex)
		if err != nil {
			t.Fatalf("%s rawHex: %v", vector.Name, err)
		}
		return raw
	}
	if vector.RepeatHex != "" {
		value, err := hex.DecodeString(vector.RepeatHex)
		if err != nil || len(value) != 1 {
			t.Fatalf("%s repeatHex is invalid: %v", vector.Name, err)
		}
		return bytes.Repeat(value, vector.RepeatCount)
	}
	raw, ok := fixture.BaseRaw[vector.Base]
	if !ok {
		t.Fatalf("%s base %q is unavailable", vector.Name, vector.Base)
	}
	for _, replacement := range vector.Replace {
		if len(replacement) != 2 || strings.Count(raw, replacement[0]) != 1 {
			t.Fatalf("%s replacement source must occur exactly once", vector.Name)
		}
		raw = strings.Replace(raw, replacement[0], replacement[1], 1)
	}
	placeholderValue := dataRoot
	if vector.DataRootLiteral != "" {
		placeholderValue = vector.DataRootLiteral
	} else if vector.DataRootPlaceholder == "volumeRoot" {
		placeholderValue = volumeRoot
	}
	raw = strings.ReplaceAll(raw, `"__DATA_ROOT__"`, strconv.Quote(placeholderValue))
	out := make([]byte, 0, len(raw)+len(vector.SuffixUTF8)+3)
	if vector.PrefixHex != "" {
		prefix, err := hex.DecodeString(vector.PrefixHex)
		if err != nil {
			t.Fatalf("%s prefixHex: %v", vector.Name, err)
		}
		out = append(out, prefix...)
	}
	out = append(out, raw...)
	out = append(out, vector.SuffixUTF8...)
	return out
}

func productControlBindingRecordForTest(dataRoot string) map[string]any {
	return map[string]any{
		"schemaVersion":  1,
		"installId":      "binding-test",
		"productVersion": "test",
		"state":          "data_root_selected",
		"dataRoot": map[string]any{
			"path":             dataRoot,
			"status":           "selected",
			"selectedAt":       "2026-07-26T00:00:00.000Z",
			"verifiedAt":       "2026-07-26T00:00:01.000Z",
			"selectedAtUnixMs": 1,
			"verifiedAtUnixMs": 2,
		},
		"firstRun": map[string]any{
			"completed":   false,
			"completedAt": nil,
		},
		"pointers": map[string]any{"factoryProfileIndex": nil},
		"repair":   map[string]any{"required": false, "reason": nil},
	}
}

func createProductControlBindingLayoutForTest(t *testing.T) (string, string) {
	t.Helper()
	productControlRoot := filepath.Join(t.TempDir(), ".nimi")
	if err := os.MkdirAll(productControlRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	dataRoot := filepath.Join(t.TempDir(), "NimiData")
	for _, directory := range nimiDataRootRequiredDirectories {
		if err := os.MkdirAll(filepath.Join(dataRoot, directory), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return productControlRoot, dataRoot
}

func writeProductControlBindingRecordForTest(t *testing.T, productControlRoot string, record map[string]any) {
	t.Helper()
	raw, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(productControlRoot, "nimi.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestProductControlDataRootBoundaryRejectsHomeAndProductControlOverlap(t *testing.T) {
	home := t.TempDir()
	productControlRoot := filepath.Join(home, ".nimi")
	for _, candidate := range []string{
		home,
		productControlRoot,
		filepath.Join(productControlRoot, "data"),
	} {
		if err := validateProductControlDataRootBoundary(candidate, productControlRoot); err == nil {
			t.Fatalf("overlapping data root was admitted: %s", candidate)
		}
	}
	if err := validateProductControlDataRootBoundary(
		filepath.Join(home, "Nimi"),
		productControlRoot,
	); err != nil {
		t.Fatalf("ordinary sibling data root was rejected: %v", err)
	}
}

func TestProductControlRawRecordSharedVectorDispositions(t *testing.T) {
	fixture := loadProductControlSharedRawVectorFixture(t)
	dataRoot := `/var/lib/nimi-shared-vector-data`
	volumeRoot := `/`
	if runtime.GOOS == "windows" {
		dataRoot = `D:\NimiSharedVectorData`
		volumeRoot = `D:\`
	}
	for index := range fixture.Vectors {
		vector := fixture.Vectors[index]
		if vector.Platform != "" &&
			!((vector.Platform == "win32" && runtime.GOOS == "windows") ||
				vector.Platform == runtime.GOOS) {
			continue
		}
		t.Run(vector.Name, func(t *testing.T) {
			productControlRoot := filepath.Join(t.TempDir(), ".nimi")
			if err := os.Mkdir(productControlRoot, 0o755); err != nil {
				t.Fatal(err)
			}
			raw := renderProductControlSharedRawVector(
				t,
				fixture,
				index,
				dataRoot,
				volumeRoot,
			)
			recordPath := filepath.Join(productControlRoot, "nimi.json")
			if err := os.WriteFile(recordPath, raw, 0o600); err != nil {
				t.Fatal(err)
			}
			record, err := readProductControlRecord(recordPath)
			switch vector.Disposition {
			case "accept":
				if err != nil {
					t.Fatalf("shared vector rejected: %v", err)
				}
				expectedDataRoot := dataRoot
				if vector.DataRootLiteral != "" {
					expectedDataRoot = vector.DataRootLiteral
				}
				if got := selectedProductDataRootPath(record); got != filepath.Clean(expectedDataRoot) {
					t.Fatalf("selected data root = %q, want %q", got, filepath.Clean(expectedDataRoot))
				}
			case "reject":
				if err == nil {
					t.Fatalf("shared vector was accepted: %+v", record)
				}
			default:
				t.Fatalf("unknown shared-vector disposition %q", vector.Disposition)
			}
		})
	}
}

func TestLoadProductControlDataRootBindingAcceptsSelectedAndReady(t *testing.T) {
	for _, status := range []string{"selected", "ready"} {
		t.Run(status, func(t *testing.T) {
			productControlRoot, dataRoot := createProductControlBindingLayoutForTest(t)
			record := productControlBindingRecordForTest(dataRoot)
			record["dataRoot"].(map[string]any)["status"] = status
			writeProductControlBindingRecordForTest(t, productControlRoot, record)

			binding, err := LoadProductControlDataRootBinding(
				productControlRoot,
				ProductControlDataRootSecurityBinding{},
			)
			if err != nil {
				t.Fatalf("load %s binding: %v", status, err)
			}
			if !binding.RecordExists || binding.DataRoot != dataRoot {
				t.Fatalf("%s binding = %+v", status, binding)
			}
		})
	}
}

func TestLoadProductControlDataRootBindingFailsClosedForUnusableRecordState(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(map[string]any)
		want   string
	}{
		{
			name: "unknown product state",
			mutate: func(record map[string]any) {
				record["state"] = "invented_state"
			},
			want: "unsupported product-control state",
		},
		{
			name: "unknown data-root status",
			mutate: func(record map[string]any) {
				record["dataRoot"].(map[string]any)["status"] = "invented_status"
			},
			want: "unsupported product-control dataRoot.status",
		},
		{
			name: "repair required flag",
			mutate: func(record map[string]any) {
				record["repair"].(map[string]any)["required"] = true
			},
			want: "inconsistent state/status/repair",
		},
		{
			name: "repair-required product state",
			mutate: func(record map[string]any) {
				record["state"] = "repair_required"
				record["dataRoot"].(map[string]any)["status"] = "repair_required"
				record["repair"] = map[string]any{
					"required": true,
					"reason":   "repair",
				}
			},
			want: "forbids data-root binding",
		},
		{
			name: "blocked product state",
			mutate: func(record map[string]any) {
				record["state"] = "blocked"
				record["dataRoot"].(map[string]any)["status"] = "repair_required"
				record["repair"] = map[string]any{
					"required": true,
					"reason":   "blocked",
				}
			},
			want: "forbids data-root binding",
		},
		{
			name: "repair-required data-root status",
			mutate: func(record map[string]any) {
				record["dataRoot"].(map[string]any)["status"] = "repair_required"
			},
			want: "inconsistent state/status/repair",
		},
		{
			name: "missing state cannot smuggle a root",
			mutate: func(record map[string]any) {
				record["state"] = "data_root_missing"
			},
			want: "cannot carry dataRoot",
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			productControlRoot, dataRoot := createProductControlBindingLayoutForTest(t)
			record := productControlBindingRecordForTest(dataRoot)
			testCase.mutate(record)
			writeProductControlBindingRecordForTest(t, productControlRoot, record)

			binding, err := LoadProductControlDataRootBinding(
				productControlRoot,
				ProductControlDataRootSecurityBinding{},
			)
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("binding=%+v error=%v, want %q", binding, err, testCase.want)
			}
			if binding.DataRoot != "" {
				t.Fatalf("unusable Product Control leaked data root: %+v", binding)
			}
		})
	}
}

func TestLoadProductControlDataRootBindingRejectsRetiredRootDirectories(t *testing.T) {
	for _, retired := range retiredNimiDataRootDirectories {
		t.Run(retired, func(t *testing.T) {
			productControlRoot, dataRoot := createProductControlBindingLayoutForTest(t)
			if err := os.Mkdir(filepath.Join(dataRoot, retired), 0o755); err != nil {
				t.Fatal(err)
			}
			writeProductControlBindingRecordForTest(
				t,
				productControlRoot,
				productControlBindingRecordForTest(dataRoot),
			)

			binding, err := LoadProductControlDataRootBinding(
				productControlRoot,
				ProductControlDataRootSecurityBinding{},
			)
			if err == nil || !strings.Contains(err.Error(), "retired root-level directory "+retired+" still exists") {
				t.Fatalf("binding=%+v error=%v", binding, err)
			}
			if binding.DataRoot != "" {
				t.Fatalf("retired directory leaked data root: %+v", binding)
			}
		})
	}
}

func TestReadProductControlRecordRejectsNonDirectOrUnboundedInput(t *testing.T) {
	t.Run("symlink", func(t *testing.T) {
		productControlRoot, dataRoot := createProductControlBindingLayoutForTest(t)
		target := filepath.Join(t.TempDir(), "target.json")
		raw, err := json.Marshal(productControlBindingRecordForTest(dataRoot))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, raw, 0o600); err != nil {
			t.Fatal(err)
		}
		link := filepath.Join(productControlRoot, "nimi.json")
		if err := os.Symlink(target, link); err != nil {
			if runtime.GOOS == "windows" || errors.Is(err, os.ErrPermission) {
				t.Skipf("symlink creation is unavailable: %v", err)
			}
			t.Fatal(err)
		}
		if _, err := readProductControlRecord(link); err == nil ||
			!strings.Contains(err.Error(), "direct regular file") {
			t.Fatalf("symlink read error = %v", err)
		}
	})

	t.Run("over 64 KiB", func(t *testing.T) {
		productControlRoot, _ := createProductControlBindingLayoutForTest(t)
		path := filepath.Join(productControlRoot, "nimi.json")
		if err := os.WriteFile(path, bytes.Repeat([]byte{' '}, productControlRecordMaxBytes+1), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := readProductControlRecord(path); err == nil ||
			!strings.Contains(err.Error(), "exceeds 65536 bytes") {
			t.Fatalf("oversize read error = %v", err)
		}
	})

	t.Run("invalid UTF-8", func(t *testing.T) {
		productControlRoot, _ := createProductControlBindingLayoutForTest(t)
		path := filepath.Join(productControlRoot, "nimi.json")
		if err := os.WriteFile(path, []byte{0xff}, 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := readProductControlRecord(path); err == nil ||
			!strings.Contains(err.Error(), "not valid UTF-8") {
			t.Fatalf("UTF-8 read error = %v", err)
		}
	})

	t.Run("trailing JSON value", func(t *testing.T) {
		productControlRoot, dataRoot := createProductControlBindingLayoutForTest(t)
		raw, err := json.Marshal(productControlBindingRecordForTest(dataRoot))
		if err != nil {
			t.Fatal(err)
		}
		raw = append(raw, []byte(` {}`)...)
		path := filepath.Join(productControlRoot, "nimi.json")
		if err := os.WriteFile(path, raw, 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := readProductControlRecord(path); err == nil ||
			!strings.Contains(err.Error(), "trailing JSON") {
			t.Fatalf("trailing JSON read error = %v", err)
		}
	})
}
