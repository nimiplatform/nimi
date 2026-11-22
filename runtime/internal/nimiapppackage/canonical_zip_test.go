package nimiapppackage

import (
	"bytes"
	"compress/flate"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"hash/crc32"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

type rawZipTestEntry struct {
	name             []byte
	localName        []byte
	method           uint16
	localMethod      *uint16
	flags            uint16
	localFlags       *uint16
	modTime          uint16
	modDate          uint16
	crc32            uint32
	uncompressedSize uint32
	compressed       []byte
	externalAttrs    uint32
	localOffset      *uint32
	localExtra       []byte
	centralExtra     []byte
}

func deflateRawBytes(t *testing.T, plain []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	w, err := flate.NewWriter(&buf, flate.DefaultCompression)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write(plain); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func rawEntryFromFixture(t *testing.T, e archiveFixtureEntry, useDeflate bool) rawZipTestEntry {
	t.Helper()
	checksum := crc32.ChecksumIEEE(e.bytes)
	if e.crc32 != nil {
		checksum = *e.crc32
	}
	method := e.method
	payload := e.bytes
	if useDeflate {
		compressed := deflateRawBytes(t, e.bytes)
		if len(compressed) > 0 && len(compressed) < len(e.bytes) {
			method = zipMethodDeflate
			payload = compressed
		}
	}
	return rawZipTestEntry{
		name:             []byte(e.name),
		method:           method,
		flags:            e.flags,
		modTime:          0,
		modDate:          0x0021,
		crc32:            checksum,
		uncompressedSize: uint32(len(e.bytes)),
		compressed:       payload,
		externalAttrs:    e.mode << 16,
	}
}

func buildRawZipBytes(entries []rawZipTestEntry, sortByUTF8 bool) []byte {
	list := append([]rawZipTestEntry(nil), entries...)
	if sortByUTF8 {
		sort.Slice(list, func(i, j int) bool {
			return bytes.Compare(list[i].name, list[j].name) < 0
		})
	}
	var out bytes.Buffer
	offsets := make([]uint32, len(list))
	for i, e := range list {
		offsets[i] = uint32(out.Len())
		if e.localOffset != nil {
			offsets[i] = *e.localOffset
		}
		lName := e.name
		if e.localName != nil {
			lName = e.localName
		}
		lMethod := e.method
		if e.localMethod != nil {
			lMethod = *e.localMethod
		}
		lFlags := e.flags
		if e.localFlags != nil {
			lFlags = *e.localFlags
		}
		var lh [30]byte
		binary.LittleEndian.PutUint32(lh[0:4], zipSigLocalHeader)
		binary.LittleEndian.PutUint16(lh[4:6], canonicalZipReaderVersion)
		binary.LittleEndian.PutUint16(lh[6:8], lFlags)
		binary.LittleEndian.PutUint16(lh[8:10], lMethod)
		binary.LittleEndian.PutUint16(lh[10:12], e.modTime)
		binary.LittleEndian.PutUint16(lh[12:14], e.modDate)
		binary.LittleEndian.PutUint32(lh[14:18], e.crc32)
		binary.LittleEndian.PutUint32(lh[18:22], uint32(len(e.compressed)))
		binary.LittleEndian.PutUint32(lh[22:26], e.uncompressedSize)
		binary.LittleEndian.PutUint16(lh[26:28], uint16(len(lName)))
		binary.LittleEndian.PutUint16(lh[28:30], uint16(len(e.localExtra)))
		out.Write(lh[:])
		out.Write(lName)
		out.Write(e.localExtra)
		out.Write(e.compressed)
	}
	cdStart := uint32(out.Len())
	for i, e := range list {
		var ch [46]byte
		binary.LittleEndian.PutUint32(ch[0:4], zipSigCentralHeader)
		binary.LittleEndian.PutUint16(ch[4:6], canonicalZipCreatorVersion)
		binary.LittleEndian.PutUint16(ch[6:8], canonicalZipReaderVersion)
		binary.LittleEndian.PutUint16(ch[8:10], e.flags)
		binary.LittleEndian.PutUint16(ch[10:12], e.method)
		binary.LittleEndian.PutUint16(ch[12:14], e.modTime)
		binary.LittleEndian.PutUint16(ch[14:16], e.modDate)
		binary.LittleEndian.PutUint32(ch[16:20], e.crc32)
		binary.LittleEndian.PutUint32(ch[20:24], uint32(len(e.compressed)))
		binary.LittleEndian.PutUint32(ch[24:28], e.uncompressedSize)
		binary.LittleEndian.PutUint16(ch[28:30], uint16(len(e.name)))
		binary.LittleEndian.PutUint16(ch[30:32], uint16(len(e.centralExtra)))
		binary.LittleEndian.PutUint16(ch[32:34], 0)
		binary.LittleEndian.PutUint16(ch[34:36], 0)
		binary.LittleEndian.PutUint16(ch[36:38], 0)
		binary.LittleEndian.PutUint32(ch[38:42], e.externalAttrs)
		binary.LittleEndian.PutUint32(ch[42:46], offsets[i])
		out.Write(ch[:])
		out.Write(e.name)
		out.Write(e.centralExtra)
	}
	cdSize := uint32(out.Len()) - cdStart
	var eocd [22]byte
	binary.LittleEndian.PutUint32(eocd[0:4], zipSigEOCD)
	binary.LittleEndian.PutUint16(eocd[4:6], 0)
	binary.LittleEndian.PutUint16(eocd[6:8], 0)
	binary.LittleEndian.PutUint16(eocd[8:10], uint16(len(list)))
	binary.LittleEndian.PutUint16(eocd[10:12], uint16(len(list)))
	binary.LittleEndian.PutUint32(eocd[12:16], cdSize)
	binary.LittleEndian.PutUint32(eocd[16:20], cdStart)
	binary.LittleEndian.PutUint16(eocd[20:22], 0)
	out.Write(eocd[:])
	return out.Bytes()
}

func writeRawZipFixture(t *testing.T, data []byte) (string, Expected) {
	t.Helper()
	archivePath := filepath.Join(t.TempDir(), "raw.nimiapp")
	if err := os.WriteFile(archivePath, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return archivePath, expectedPackage(data)
}

func TestDeflateBoundariesEmptyFileAndSinglePassMaterializeParity(t *testing.T) {
	base := validArchiveEntries(t)
	// Exact 32 KiB and 64 KiB Deflate window boundaries + 0 B Store empty file
	exact32K := bytes.Repeat([]byte("nimi-32k-window-boundary-0123456"), 32*1024/32)
	exact64K := bytes.Repeat([]byte("nimi-64k-window-boundary-abcdef0"), 64*1024/32)
	base = append(base,
		canonicalFixtureEntry("payload/resources/exact-32k.txt", exact32K, 0o644),
		canonicalFixtureEntry("payload/resources/exact-64k.txt", exact64K, 0o644),
		canonicalFixtureEntry("payload/resources/__init__.py", []byte{}, 0o644),
	)
	storeEntries := make([]rawZipTestEntry, 0, len(base))
	deflateEntries := make([]rawZipTestEntry, 0, len(base))
	for _, item := range base {
		storeEntries = append(storeEntries, rawEntryFromFixture(t, item, false))
		deflateEntries = append(deflateEntries, rawEntryFromFixture(t, item, true))
	}
	storeBytes := buildRawZipBytes(storeEntries, true)
	deflateBytes := buildRawZipBytes(deflateEntries, true)
	if len(deflateBytes) >= len(storeBytes) {
		t.Fatalf("expected deflate archive (%d B) smaller than store archive (%d B)", len(deflateBytes), len(storeBytes))
	}
	storePath, storeExpected := writeRawZipFixture(t, storeBytes)
	deflatePath, deflateExpected := writeRawZipFixture(t, deflateBytes)

	if _, err := Inspect(context.Background(), deflatePath, deflateExpected); err != nil {
		t.Fatalf("Inspect deflate archive failed: %v", err)
	}
	ownerRoot, _ := openOwnerRoot(t)
	storeMat, err := Materialize(context.Background(), storePath, ownerRoot, "store-stage", storeExpected)
	if err != nil {
		t.Fatalf("Materialize store failed: %v", err)
	}
	deflateMat, err := Materialize(context.Background(), deflatePath, ownerRoot, "deflate-stage", deflateExpected)
	if err != nil {
		t.Fatalf("Materialize deflate failed: %v", err)
	}
	if storeMat.PayloadRootSHA256 != deflateMat.PayloadRootSHA256 || storeMat.HostExecutableSHA256 != deflateMat.HostExecutableSHA256 {
		t.Fatalf("store vs deflate materialized digests diverged")
	}
	if _, err := VerifyMaterialized(context.Background(), deflateMat.Root, deflateExpected, PayloadRootDigestRef(deflateMat.PayloadRootSHA256), deflateMat.HostExecutableSHA256); err != nil {
		t.Fatalf("VerifyMaterialized deflate failed: %v", err)
	}
}

func TestCanonicalZipRejectsZeroCRCTamperingAndBFINALSmuggling(t *testing.T) {
	makeBase := func() []rawZipTestEntry {
		base := validArchiveEntries(t)
		base = append(base, canonicalFixtureEntry("payload/resources/compressible.txt", bytes.Repeat([]byte("A"), 8192), 0o644))
		raw := make([]rawZipTestEntry, 0, len(base))
		for _, item := range base {
			raw = append(raw, rawEntryFromFixture(t, item, item.name == "payload/resources/compressible.txt"))
		}
		sort.Slice(raw, func(i, j int) bool { return bytes.Compare(raw[i].name, raw[j].name) < 0 })
		return raw
	}
	findIdx := func(entries []rawZipTestEntry, name string) int {
		for i, e := range entries {
			if string(e.name) == name {
				return i
			}
		}
		t.Fatalf("missing %s", name)
		return -1
	}

	// T-L2-04: CRC32 == 0 tampering must NEVER be skipped on Store or Deflate.
	t.Run("store_crc32_zero_tampered", func(t *testing.T) {
		entries := makeBase()
		idx := findIdx(entries, "payload/resources/app.js")
		entries[idx].crc32 = 0
		archivePath, expected := writeRawZipFixture(t, buildRawZipBytes(entries, false))
		if _, err := Inspect(context.Background(), archivePath, expected); err == nil {
			t.Fatal("accepted Store entry with tampered CRC32 == 0")
		}
	})
	t.Run("deflate_crc32_zero_tampered", func(t *testing.T) {
		entries := makeBase()
		idx := findIdx(entries, "payload/resources/compressible.txt")
		entries[idx].crc32 = 0
		archivePath, expected := writeRawZipFixture(t, buildRawZipBytes(entries, false))
		if _, err := Inspect(context.Background(), archivePath, expected); err == nil {
			t.Fatal("accepted Deflate entry with tampered CRC32 == 0")
		}
	})

	// T-L2-03: BFINAL trailing byte smuggling (1 B, 4095 B, 100 KiB).
	for _, tailSize := range []int{1, 4095, 100 * 1024} {
		t.Run(fmt.Sprintf("bfinal_tail_%dB", tailSize), func(t *testing.T) {
			entries := makeBase()
			// Make entry larger than 200 KiB so even +100 KiB compressed remains < uncompressedSize.
			plain := bytes.Repeat([]byte("deflate-tail-smuggling-payload!!"), 8192) // 256 KiB
			idx := findIdx(entries, "payload/resources/compressible.txt")
			entries[idx].uncompressedSize = uint32(len(plain))
			entries[idx].crc32 = crc32.ChecksumIEEE(plain)
			entries[idx].compressed = append(deflateRawBytes(t, plain), bytes.Repeat([]byte{0x42}, tailSize)...)
			if len(entries[idx].compressed) >= int(entries[idx].uncompressedSize) {
				t.Fatalf("test setup error: compressed %d >= uncompressed %d", len(entries[idx].compressed), entries[idx].uncompressedSize)
			}
			archivePath, expected := writeRawZipFixture(t, buildRawZipBytes(entries, false))
			if _, err := Inspect(context.Background(), archivePath, expected); err == nil {
				t.Fatalf("accepted Deflate entry with %d B trailing bytes after BFINAL", tailSize)
			}
			ownerRoot, _ := openOwnerRoot(t)
			if _, err := Materialize(context.Background(), archivePath, ownerRoot, "stage", expected); err == nil {
				t.Fatalf("Materialize accepted Deflate entry with %d B trailing bytes", tailSize)
			}
		})
	}
}

func TestCanonicalZipRejectsStructuralAndBudgetAbuse(t *testing.T) {
	makeBase := func() []rawZipTestEntry {
		base := validArchiveEntries(t)
		raw := make([]rawZipTestEntry, 0, len(base))
		for _, item := range base {
			raw = append(raw, rawEntryFromFixture(t, item, false))
		}
		sort.Slice(raw, func(i, j int) bool { return bytes.Compare(raw[i].name, raw[j].name) < 0 })
		return raw
	}

	t.Run("unsorted_entries", func(t *testing.T) {
		entries := makeBase()
		entries[0], entries[1] = entries[1], entries[0]
		archivePath, expected := writeRawZipFixture(t, buildRawZipBytes(entries, false))
		if _, err := Inspect(context.Background(), archivePath, expected); !errors.Is(err, ErrInvalidPackage) {
			t.Fatalf("unsorted entries error = %v", err)
		}
	})

	t.Run("overlapping_local_offset", func(t *testing.T) {
		entries := makeBase()
		zero := uint32(0)
		entries[1].localOffset = &zero
		archivePath, expected := writeRawZipFixture(t, buildRawZipBytes(entries, false))
		if _, err := Inspect(context.Background(), archivePath, expected); !errors.Is(err, ErrInvalidPackage) {
			t.Fatalf("overlapping local offset error = %v", err)
		}
	})

	t.Run("local_central_header_mismatch", func(t *testing.T) {
		entries := makeBase()
		otherFlags := uint16(0)
		entries[0].localFlags = &otherFlags
		archivePath, expected := writeRawZipFixture(t, buildRawZipBytes(entries, false))
		if _, err := Inspect(context.Background(), archivePath, expected); !errors.Is(err, ErrInvalidPackage) {
			t.Fatalf("local/central mismatch error = %v", err)
		}
	})

	t.Run("invalid_utf8_filename", func(t *testing.T) {
		entries := makeBase()
		entries = append(entries, rawZipTestEntry{
			name:             []byte("payload/\xffinvalid.txt"),
			method:           zipMethodStore,
			flags:            canonicalZipFlags,
			modDate:          0x0021,
			crc32:            crc32.ChecksumIEEE([]byte("x")),
			uncompressedSize: 1,
			compressed:       []byte("x"),
			externalAttrs:    extAttrRegular0644,
		})
		archivePath, expected := writeRawZipFixture(t, buildRawZipBytes(entries, true))
		if _, err := Inspect(context.Background(), archivePath, expected); !errors.Is(err, ErrInvalidPackage) {
			t.Fatalf("invalid UTF-8 error = %v", err)
		}
	})

	t.Run("non_whitelist_external_attrs", func(t *testing.T) {
		entries := makeBase()
		entries[len(entries)-1].externalAttrs = extAttrRegular0644 | 0x0001
		archivePath, expected := writeRawZipFixture(t, buildRawZipBytes(entries, false))
		if _, err := Inspect(context.Background(), archivePath, expected); !errors.Is(err, ErrInvalidPackage) {
			t.Fatalf("dirty externalAttrs low bits error = %v", err)
		}
	})

	t.Run("entry_name_over_1024_bytes", func(t *testing.T) {
		entries := makeBase()
		longName := "payload/" + strings.Repeat("a", 1020)
		entries = append(entries, rawEntryFromFixture(t, canonicalFixtureEntry(longName, []byte("x"), 0o644), false))
		archivePath, expected := writeRawZipFixture(t, buildRawZipBytes(entries, true))
		if _, err := Inspect(context.Background(), archivePath, expected); !errors.Is(err, ErrInvalidPackage) {
			t.Fatalf("entry name > 1024 B error = %v", err)
		}
	})

	t.Run("native_directory_depth_over_64", func(t *testing.T) {
		entries := makeBase()
		// 65 directory segments + file = 66 segments => depth 65 > 64.
		deepName := "payload/" + strings.Repeat("d/", 64) + "leaf.txt"
		entries = append(entries, rawEntryFromFixture(t, canonicalFixtureEntry(deepName, []byte("x"), 0o644), false))
		archivePath, expected := writeRawZipFixture(t, buildRawZipBytes(entries, true))
		if _, err := Inspect(context.Background(), archivePath, expected); !errors.Is(err, ErrInvalidPackage) {
			t.Fatalf("depth > 64 error = %v", err)
		}
	})

	t.Run("expansion_ratio_over_20x_above_8MiB", func(t *testing.T) {
		entries := makeBase()
		// 10 MiB of zeros compresses to ~10 KiB => ratio >> 20x.
		zeros := make([]byte, 10*1024*1024)
		entries = append(entries, rawEntryFromFixture(t, canonicalFixtureEntry("payload/resources/zeros.bin", zeros, 0o644), true))
		archivePath, expected := writeRawZipFixture(t, buildRawZipBytes(entries, true))
		if _, err := Inspect(context.Background(), archivePath, expected); !errors.Is(err, ErrInvalidPackage) {
			t.Fatalf("zip bomb >20x error = %v", err)
		}
	})

	t.Run("license_over_128KiB_rejected_pre_inflation", func(t *testing.T) {
		entries := makeBase()
		bigLicense := bytes.Repeat([]byte("L"), int(MaxLicenseBytes)+1)
		for i := range entries {
			if string(entries[i].name) == "LICENSE" {
				entries[i] = rawEntryFromFixture(t, canonicalFixtureEntry("LICENSE", bigLicense, 0o644), true)
			}
		}
		archivePath, expected := writeRawZipFixture(t, buildRawZipBytes(entries, true))
		if _, err := Inspect(context.Background(), archivePath, expected); !errors.Is(err, ErrInvalidPackage) {
			t.Fatalf("oversized LICENSE error = %v", err)
		}
	})
}

func TestMacOSComponentByComponentSymlinkValidation(t *testing.T) {
	t.Run("escape_via_intermediate_symlink_then_dotdot", func(t *testing.T) {
		// payload/a/b/link -> c/../../.. where c -> ../.. would look safe if path.Join
		// collapsed before resolving `c`, but component-by-component escapes payload/.
		entries := map[string]payloadLinkEntry{
			"payload/a/b/c":      {symbolic: true, target: ".."}, // resolves to payload/a
			"payload/a/b/escape": {symbolic: true, target: "c/../../manifest.json"},
			"payload/a/file.txt": {symbolic: false},
			"manifest.json":      {symbolic: false},
		}
		if err := validatePayloadLinkTree(entries, "macos"); !errors.Is(err, ErrInvalidPackage) {
			t.Fatalf("symlink component escape accepted: %v", err)
		}
	})

	t.Run("reject_over_32_hops", func(t *testing.T) {
		entries := map[string]payloadLinkEntry{
			"payload/dir/target": {symbolic: false},
		}
		// 33 chained symlinks: l0 -> l1 -> ... -> l32 -> target
		for i := 0; i < 33; i++ {
			next := "target"
			if i < 32 {
				next = fmt.Sprintf("l%d", i+1)
			}
			entries[fmt.Sprintf("payload/dir/l%d", i)] = payloadLinkEntry{symbolic: true, target: next}
		}
		if err := validatePayloadLinkTree(entries, "macos"); !errors.Is(err, ErrInvalidPackage) {
			t.Fatalf("33-hop symlink chain accepted: %v", err)
		}
	})

	t.Run("allow_legit_electron_framework_links_and_payload_sibling_parent", func(t *testing.T) {
		entries := map[string]payloadLinkEntry{
			"payload/App.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework": {symbolic: false},
			"payload/App.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/en.lproj": {symbolic: false},
			"payload/App.app/Contents/Frameworks/Electron Framework.framework/Versions/Current":              {symbolic: true, target: "A"},
			"payload/App.app/Contents/Frameworks/Electron Framework.framework/Electron Framework":            {symbolic: true, target: "Versions/Current/Electron Framework"},
			"payload/App.app/Contents/Frameworks/Electron Framework.framework/Resources":                     {symbolic: true, target: "Versions/Current/Resources"},
			"payload/sibling/file": {symbolic: false},
			"payload/a/to-sibling": {symbolic: true, target: "../sibling/file"},
		}
		if err := validatePayloadLinkTree(entries, "macos"); err != nil {
			t.Fatalf("legitimate Electron framework symlinks rejected: %v", err)
		}
	})
}

func TestInspectLocalRejectsOversizedManagedWebExplicitly(t *testing.T) {
	// Ensure InspectLocal uses canonicalZip and enforces 72 MiB cap for managed-web.
	base := validArchiveEntries(t)
	archivePath, expected := writeArchiveFixture(t, base)
	meta, err := InspectLocal(context.Background(), archivePath, "windows", "x86_64")
	if err != nil {
		t.Fatalf("InspectLocal valid fixture: %v", err)
	}
	if meta.Expected.ArchiveSHA256 != expected.ArchiveSHA256 {
		t.Fatalf("InspectLocal SHA256 mismatch")
	}
	// Verify SHA-256 matches actual disk bytes.
	diskBytes, err := os.ReadFile(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(diskBytes)
	if hex.EncodeToString(sum[:]) != meta.Expected.ArchiveSHA256 {
		t.Fatalf("InspectLocal digest mismatch")
	}
}
