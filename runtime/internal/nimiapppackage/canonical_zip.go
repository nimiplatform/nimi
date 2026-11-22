package nimiapppackage

import (
	"bufio"
	"bytes"
	"compress/flate"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"math"
	"os"
	"strings"
	"unicode/utf8"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-014a
const (
	NativeMaxArchiveBytes    int64  = 2000 * 1024 * 1024
	NativeMaxEntryBytes      uint64 = 2000 * 1024 * 1024
	NativeMaxReleaseBytes    uint64 = 4 * 1024 * 1024 * 1024
	NativeMaxDirectories            = 65_535
	MaxArchiveEntryNameBytes        = 1024
	MaxArchiveDirectoryDepth        = 64
	MaxSymlinkTargetBytes    uint64 = 4096
	MaxLicenseBytes          int64  = 128 * 1024
	ExpansionRatioFloorBytes uint64 = 8 * 1024 * 1024
	MaxExpansionRatio        uint64 = 20

	zipSigLocalHeader   uint32 = 0x04034b50
	zipSigCentralHeader uint32 = 0x02014b50
	zipSigEOCD          uint32 = 0x06054b50

	zipMethodStore   uint16 = 0
	zipMethodDeflate uint16 = 8

	extAttrRegular0644 uint32 = 0x81A40000
	extAttrRegular0755 uint32 = 0x81ED0000
	extAttrSymlink0777 uint32 = 0xA1FF0000
)

type canonicalZipEntry struct {
	Name              string
	Method            uint16
	ModTime           uint16
	ModDate           uint16
	CRC32             uint32
	CompressedSize    uint64
	UncompressedSize  uint64
	LocalHeaderOffset int64
	DataOffset        int64
	ExternalAttrs     uint32
	Mode              os.FileMode
}

type canonicalZipArchive struct {
	ra                io.ReaderAt
	archiveSize       int64
	entries           []canonicalZipEntry
	byName            map[string]int
	totalUncompressed uint64
}

func (archive *canonicalZipArchive) find(name string) (canonicalZipEntry, bool) {
	if archive == nil {
		return canonicalZipEntry{}, false
	}
	index, ok := archive.byName[name]
	if !ok {
		return canonicalZipEntry{}, false
	}
	return archive.entries[index], true
}

func readExactAt(ra io.ReaderAt, dst []byte, offset int64) error {
	if offset < 0 {
		return ErrInvalidPackage
	}
	readTotal := 0
	for readTotal < len(dst) {
		n, err := ra.ReadAt(dst[readTotal:], offset+int64(readTotal))
		readTotal += n
		if err != nil {
			if errors.Is(err, io.EOF) && readTotal == len(dst) {
				return nil
			}
			return errors.Join(ErrInvalidPackage, err)
		}
		if n == 0 {
			return ErrInvalidPackage
		}
	}
	return nil
}

// parseCanonicalZip parses and validates the closed ZIP32 container directly
// from ra without using archive/zip, ensuring identical Local/Central headers,
// zero-gap non-overlapping layout, strict UTF-8 ascending order, exact
// external attributes, and bounded uncompressed budgets before any inflation.
func parseCanonicalZip(ra io.ReaderAt, archiveSize int64) (*canonicalZipArchive, error) {
	if ra == nil || archiveSize < 22 || archiveSize > NativeMaxArchiveBytes || archiveSize > math.MaxUint32 {
		return nil, fmt.Errorf("inspect nimiapp ZIP size: %w", ErrInvalidPackage)
	}
	var eocd [22]byte
	if err := readExactAt(ra, eocd[:], archiveSize-22); err != nil {
		return nil, fmt.Errorf("read nimiapp ZIP end record: %w", err)
	}
	if binary.LittleEndian.Uint32(eocd[0:4]) != zipSigEOCD {
		return nil, fmt.Errorf("inspect nimiapp ZIP end signature: %w", ErrInvalidPackage)
	}
	diskNumber := binary.LittleEndian.Uint16(eocd[4:6])
	centralDisk := binary.LittleEndian.Uint16(eocd[6:8])
	entriesOnDisk := binary.LittleEndian.Uint16(eocd[8:10])
	totalEntries := binary.LittleEndian.Uint16(eocd[10:12])
	centralSize := uint64(binary.LittleEndian.Uint32(eocd[12:16]))
	centralOffset := uint64(binary.LittleEndian.Uint32(eocd[16:20]))
	commentLen := binary.LittleEndian.Uint16(eocd[20:22])
	if diskNumber != 0 || centralDisk != 0 || commentLen != 0 ||
		entriesOnDisk != totalEntries || totalEntries == 0 || int(totalEntries) > maxZip32Entries ||
		centralSize == 0 || centralSize == math.MaxUint32 || centralOffset == math.MaxUint32 ||
		centralOffset+centralSize != uint64(archiveSize-22) {
		return nil, fmt.Errorf("inspect nimiapp ZIP end record: %w", ErrInvalidPackage)
	}

	cdReader := bufio.NewReaderSize(io.NewSectionReader(ra, int64(centralOffset), int64(centralSize)), 64*1024)
	entries := make([]canonicalZipEntry, 0, int(totalEntries))
	byName := make(map[string]int, int(totalEntries))
	var (
		expectedOffset    int64
		cdConsumed        uint64
		totalUncompressed uint64
		prevRawName       []byte
		cdHeader          [46]byte
		localHeader       [30]byte
	)
	for index := 0; index < int(totalEntries); index++ {
		if _, err := io.ReadFull(cdReader, cdHeader[:]); err != nil {
			return nil, fmt.Errorf("read nimiapp ZIP central entry: %w", errors.Join(ErrInvalidPackage, err))
		}
		if binary.LittleEndian.Uint32(cdHeader[0:4]) != zipSigCentralHeader {
			return nil, fmt.Errorf("inspect nimiapp ZIP central signature: %w", ErrInvalidPackage)
		}
		creatorVersion := binary.LittleEndian.Uint16(cdHeader[4:6])
		readerVersion := binary.LittleEndian.Uint16(cdHeader[6:8])
		flags := binary.LittleEndian.Uint16(cdHeader[8:10])
		method := binary.LittleEndian.Uint16(cdHeader[10:12])
		modTime := binary.LittleEndian.Uint16(cdHeader[12:14])
		modDate := binary.LittleEndian.Uint16(cdHeader[14:16])
		expectedCRC := binary.LittleEndian.Uint32(cdHeader[16:20])
		compSize32 := binary.LittleEndian.Uint32(cdHeader[20:24])
		uncompSize32 := binary.LittleEndian.Uint32(cdHeader[24:28])
		nameLen := int(binary.LittleEndian.Uint16(cdHeader[28:30]))
		extraLen := binary.LittleEndian.Uint16(cdHeader[30:32])
		commentEntryLen := binary.LittleEndian.Uint16(cdHeader[32:34])
		diskStart := binary.LittleEndian.Uint16(cdHeader[34:36])
		internalAttrs := binary.LittleEndian.Uint16(cdHeader[36:38])
		externalAttrs := binary.LittleEndian.Uint32(cdHeader[38:42])
		localOffset32 := binary.LittleEndian.Uint32(cdHeader[42:46])

		if creatorVersion != canonicalZipCreatorVersion || readerVersion != canonicalZipReaderVersion ||
			flags != canonicalZipFlags || extraLen != 0 || commentEntryLen != 0 ||
			diskStart != 0 || internalAttrs != 0 ||
			compSize32 == math.MaxUint32 || uncompSize32 == math.MaxUint32 || localOffset32 == math.MaxUint32 ||
			nameLen <= 0 || nameLen > MaxArchiveEntryNameBytes {
			return nil, fmt.Errorf("inspect nimiapp ZIP central header: %w", ErrInvalidPackage)
		}

		var mode os.FileMode
		switch externalAttrs {
		case extAttrRegular0644:
			mode = 0o644
		case extAttrRegular0755:
			mode = 0o755
		case extAttrSymlink0777:
			mode = os.ModeSymlink | 0o777
		default:
			return nil, fmt.Errorf("inspect nimiapp ZIP entry attributes: %w", ErrInvalidPackage)
		}

		rawName := make([]byte, nameLen)
		if _, err := io.ReadFull(cdReader, rawName); err != nil {
			return nil, fmt.Errorf("read nimiapp ZIP entry name: %w", errors.Join(ErrInvalidPackage, err))
		}
		cdConsumed += 46 + uint64(nameLen)
		if !utf8.Valid(rawName) {
			return nil, fmt.Errorf("inspect nimiapp ZIP entry UTF-8: %w", ErrInvalidPackage)
		}
		if index > 0 && bytes.Compare(prevRawName, rawName) >= 0 {
			return nil, fmt.Errorf("inspect nimiapp ZIP entry ordering: %w", ErrInvalidPackage)
		}
		name := string(rawName)
		if strings.HasSuffix(name, "/") || strings.ContainsAny(name, "\\\x00") ||
			strings.Count(name, "/") > MaxArchiveDirectoryDepth {
			return nil, fmt.Errorf("inspect nimiapp ZIP entry path %q: %w", name, ErrInvalidPackage)
		}

		compSize := uint64(compSize32)
		uncompSize := uint64(uncompSize32)
		if mode&os.ModeSymlink != 0 {
			if method != zipMethodStore || compSize != uncompSize || uncompSize == 0 || uncompSize > MaxSymlinkTargetBytes {
				return nil, fmt.Errorf("inspect nimiapp ZIP symlink %q: %w", name, ErrInvalidPackage)
			}
		} else {
			switch method {
			case zipMethodStore:
				if compSize != uncompSize || uncompSize > NativeMaxEntryBytes || (uncompSize == 0 && expectedCRC != 0) {
					return nil, fmt.Errorf("inspect nimiapp ZIP store entry %q: %w", name, ErrInvalidPackage)
				}
			case zipMethodDeflate:
				if compSize == 0 || uncompSize == 0 || compSize >= uncompSize || uncompSize > NativeMaxEntryBytes {
					return nil, fmt.Errorf("inspect nimiapp ZIP deflate entry %q: %w", name, ErrInvalidPackage)
				}
			default:
				return nil, fmt.Errorf("inspect nimiapp ZIP method %d on %q: %w", method, name, ErrInvalidPackage)
			}
		}

		if int64(localOffset32) != expectedOffset {
			return nil, fmt.Errorf("inspect nimiapp ZIP local offset for %q: %w", name, ErrInvalidPackage)
		}
		if err := readExactAt(ra, localHeader[:], expectedOffset); err != nil {
			return nil, fmt.Errorf("read nimiapp ZIP local header for %q: %w", name, err)
		}
		if binary.LittleEndian.Uint32(localHeader[0:4]) != zipSigLocalHeader ||
			binary.LittleEndian.Uint16(localHeader[4:6]) != canonicalZipReaderVersion ||
			binary.LittleEndian.Uint16(localHeader[6:8]) != canonicalZipFlags ||
			binary.LittleEndian.Uint16(localHeader[8:10]) != method ||
			binary.LittleEndian.Uint16(localHeader[10:12]) != modTime ||
			binary.LittleEndian.Uint16(localHeader[12:14]) != modDate ||
			binary.LittleEndian.Uint32(localHeader[14:18]) != expectedCRC ||
			binary.LittleEndian.Uint32(localHeader[18:22]) != compSize32 ||
			binary.LittleEndian.Uint32(localHeader[22:26]) != uncompSize32 ||
			int(binary.LittleEndian.Uint16(localHeader[26:28])) != nameLen ||
			binary.LittleEndian.Uint16(localHeader[28:30]) != 0 {
			return nil, fmt.Errorf("inspect nimiapp ZIP local header mismatch for %q: %w", name, ErrInvalidPackage)
		}
		localName := make([]byte, nameLen)
		if err := readExactAt(ra, localName, expectedOffset+30); err != nil {
			return nil, fmt.Errorf("read nimiapp ZIP local name for %q: %w", name, err)
		}
		if !bytes.Equal(localName, rawName) {
			return nil, fmt.Errorf("inspect nimiapp ZIP local name mismatch for %q: %w", name, ErrInvalidPackage)
		}
		dataOffset := expectedOffset + 30 + int64(nameLen)
		nextOffset := dataOffset + int64(compSize)
		if nextOffset < dataOffset || uint64(nextOffset) > centralOffset {
			return nil, fmt.Errorf("inspect nimiapp ZIP data bounds for %q: %w", name, ErrInvalidPackage)
		}
		expectedOffset = nextOffset

		if math.MaxUint64-totalUncompressed < uncompSize || totalUncompressed+uncompSize > NativeMaxReleaseBytes {
			return nil, fmt.Errorf("inspect nimiapp ZIP expanded budget: %w", ErrInvalidPackage)
		}
		totalUncompressed += uncompSize

		byName[name] = len(entries)
		entries = append(entries, canonicalZipEntry{
			Name:              name,
			Method:            method,
			ModTime:           modTime,
			ModDate:           modDate,
			CRC32:             expectedCRC,
			CompressedSize:    compSize,
			UncompressedSize:  uncompSize,
			LocalHeaderOffset: int64(localOffset32),
			DataOffset:        dataOffset,
			ExternalAttrs:     externalAttrs,
			Mode:              mode,
		})
		prevRawName = rawName
	}
	if cdConsumed != centralSize || expectedOffset != int64(centralOffset) {
		return nil, fmt.Errorf("inspect nimiapp ZIP contiguous layout: %w", ErrInvalidPackage)
	}
	if totalUncompressed > ExpansionRatioFloorBytes && totalUncompressed > uint64(archiveSize)*MaxExpansionRatio {
		return nil, fmt.Errorf("inspect nimiapp ZIP expansion ratio: %w", ErrInvalidPackage)
	}
	return &canonicalZipArchive{
		ra:                ra,
		archiveSize:       archiveSize,
		entries:           entries,
		byName:            byName,
		totalUncompressed: totalUncompressed,
	}, nil
}

// copyCanonicalEntry decompresses or streams one canonical ZIP entry into dst
// (which may be nil to discard), verifying exact uncompressed length,
// independent IEEE CRC32 (never skipping CRC32 == 0), and exact compressed
// stream consumption with zero trailing bytes after Deflate BFINAL.
func copyCanonicalEntry(ctx context.Context, ra io.ReaderAt, entry canonicalZipEntry, dst io.Writer, buffer []byte) error {
	if ctx == nil || ra == nil {
		return ErrInvalidPackage
	}
	if len(buffer) == 0 {
		buffer = make([]byte, 128*1024)
	}
	crcHash := crc32.NewIEEE()
	var sink io.Writer = crcHash
	if dst != nil {
		sink = io.MultiWriter(dst, crcHash)
	}
	if entry.Method == zipMethodStore {
		sr := io.NewSectionReader(ra, entry.DataOffset, int64(entry.UncompressedSize))
		if err := copyWithContextBuffer(ctx, sink, sr, entry.UncompressedSize, buffer); err != nil {
			return err
		}
		if pos, err := sr.Seek(0, io.SeekCurrent); err != nil || uint64(pos) != entry.UncompressedSize {
			return ErrPackageIntegrity
		}
		if crcHash.Sum32() != entry.CRC32 {
			return ErrPackageIntegrity
		}
		return nil
	}
	if entry.Method != zipMethodDeflate {
		return ErrInvalidPackage
	}
	sr := io.NewSectionReader(ra, entry.DataOffset, int64(entry.CompressedSize))
	// bufio.NewReader implements io.ByteReader so flate.NewReader uses br
	// directly without adding a hidden internal read-ahead buffer.
	br := bufio.NewReader(sr)
	fl := flate.NewReader(br)
	copyErr := copyWithContextBuffer(ctx, sink, fl, entry.UncompressedSize, buffer)
	closeErr := fl.Close()
	if copyErr != nil || closeErr != nil {
		return errors.Join(ErrPackageIntegrity, copyErr, closeErr)
	}
	if crcHash.Sum32() != entry.CRC32 {
		return ErrPackageIntegrity
	}
	if br.Buffered() != 0 {
		return fmt.Errorf("trailing bytes in deflate buffer for %s: %w", entry.Name, ErrPackageIntegrity)
	}
	if _, tailErr := br.ReadByte(); !errors.Is(tailErr, io.EOF) {
		return fmt.Errorf("trailing bytes after deflate stream for %s: %w", entry.Name, ErrPackageIntegrity)
	}
	if pos, err := sr.Seek(0, io.SeekCurrent); err != nil || uint64(pos) != entry.CompressedSize {
		return fmt.Errorf("incomplete deflate input consumption for %s: %w", entry.Name, ErrPackageIntegrity)
	}
	return nil
}

func readCanonicalControlEntry(ctx context.Context, ra io.ReaderAt, entry canonicalZipEntry, maxBytes int64) ([]byte, error) {
	if entry.Mode&os.ModeSymlink != 0 || entry.UncompressedSize == 0 || entry.UncompressedSize > uint64(maxBytes) {
		return nil, ErrInvalidPackage
	}
	var raw bytes.Buffer
	raw.Grow(int(entry.UncompressedSize))
	if err := copyCanonicalEntry(ctx, ra, entry, &raw, nil); err != nil {
		return nil, errors.Join(ErrInvalidPackage, err)
	}
	if raw.Len() == 0 || uint64(raw.Len()) != entry.UncompressedSize || int64(raw.Len()) > maxBytes {
		return nil, ErrInvalidPackage
	}
	return raw.Bytes(), nil
}

func readCanonicalSymlinkTarget(ctx context.Context, ra io.ReaderAt, entry canonicalZipEntry) (string, error) {
	if entry.Mode&os.ModeSymlink == 0 || entry.Method != zipMethodStore ||
		entry.UncompressedSize == 0 || entry.UncompressedSize > MaxSymlinkTargetBytes {
		return "", ErrInvalidPackage
	}
	var raw bytes.Buffer
	raw.Grow(int(entry.UncompressedSize))
	if err := copyCanonicalEntry(ctx, ra, entry, &raw, nil); err != nil {
		return "", errors.Join(ErrInvalidPackage, err)
	}
	data := raw.Bytes()
	if len(data) == 0 || !utf8.Valid(data) {
		return "", ErrInvalidPackage
	}
	return string(data), nil
}
