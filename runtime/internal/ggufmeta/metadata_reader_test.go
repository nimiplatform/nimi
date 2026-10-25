package ggufmeta

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"math"
	"testing"
)

func TestStringArrayScanPreservesPerStringFailure(t *testing.T) {
	valid := discardArrayFixture(3, true)[12:]
	for _, cut := range []int{0, 1, 7, 8, 9, 71, 72, 73, len(valid) - 1, len(valid)} {
		for _, seekable := range []bool{true, false} {
			makeReader := func() (io.Reader, *bytes.Reader) {
				b := bytes.NewReader(valid[:cut])
				if seekable {
					return b, b
				}
				return io.LimitReader(b, int64(cut)), b
			}
			fast, fastBase := makeReader()
			slow, slowBase := makeReader()
			got := skipStringArray(fast, 3)
			var want error
			for range 3 {
				if want = skipValue(slow, ValueTypeString); want != nil {
					break
				}
			}
			if (got == nil) != (want == nil) || errors.Is(got, io.EOF) != errors.Is(want, io.EOF) || errors.Is(got, io.ErrUnexpectedEOF) != errors.Is(want, io.ErrUnexpectedEOF) || fastBase.Len() != slowBase.Len() {
				t.Fatalf("cut=%d seekable=%v got=%v want=%v remaining=%d/%d", cut, seekable, got, want, fastBase.Len(), slowBase.Len())
			}
		}
	}
	oversize := binary.LittleEndian.AppendUint64(nil, maxMetadataStringBytes+1)
	if err := skipStringArray(bytes.NewReader(oversize), 1); err == nil {
		t.Fatal("oversize token accepted")
	}
}

type countedMetadataReader struct {
	*bytes.Reader
	reads     int64
	readBytes int64
}

type unboundedMetadataSeeker struct {
	reader io.Reader
	seeks  int
}

func (r *unboundedMetadataSeeker) Read(p []byte) (int, error) { return r.reader.Read(p) }
func (r *unboundedMetadataSeeker) Seek(offset int64, _ int) (int64, error) {
	r.seeks++
	return offset, nil
}

func (r *countedMetadataReader) Read(p []byte) (int, error) {
	r.reads++
	n, err := r.Reader.Read(p)
	r.readBytes += int64(n)
	return n, err
}

func discardArrayFixture(count int, strings bool) []byte {
	typeID := ValueTypeUint32
	if strings {
		typeID = ValueTypeString
	}
	data := binary.LittleEndian.AppendUint32(nil, uint32(typeID))
	data = binary.LittleEndian.AppendUint64(data, uint64(count))
	for i := 0; i < count; i++ {
		if strings {
			data = binary.LittleEndian.AppendUint64(data, 64)
			data = append(data, bytes.Repeat([]byte{'x'}, 64)...)
		} else {
			data = binary.LittleEndian.AppendUint32(data, uint32(i))
		}
	}
	return data
}

func TestMetadataDiscardReadsOnlyStringLengthsAndFixedArrayHeader(t *testing.T) {
	for _, strings := range []bool{false, true} {
		data := discardArrayFixture(128, strings)
		r := &countedMetadataReader{Reader: bytes.NewReader(data)}
		if err := skipValue(r, ValueTypeArray); err != nil {
			t.Fatal(err)
		}
		want := int64(12)
		if strings {
			want += 128 * 8
		}
		if r.readBytes != want {
			t.Fatalf("strings=%v discarded payload read: bytes=%d want=%d reads=%d", strings, r.readBytes, want, r.reads)
		}
		if r.Len() != 0 {
			t.Fatalf("strings=%v remaining=%d", strings, r.Len())
		}
	}
}

func TestMetadataDiscardDoesNotSeekBeyondTruncatedData(t *testing.T) {
	for _, strings := range []bool{false, true} {
		data := discardArrayFixture(3, strings)
		data = data[:len(data)-1]
		for _, seekable := range []bool{false, true} {
			base := bytes.NewReader(data)
			var reader io.Reader = base
			if !seekable {
				reader = io.LimitReader(base, int64(len(data)))
			}
			if err := skipValue(reader, ValueTypeArray); err == nil {
				t.Fatalf("strings=%v seekable=%v accepted truncated array", strings, seekable)
			}
			position, err := base.Seek(0, io.SeekCurrent)
			if err != nil || position > int64(len(data)) {
				t.Fatalf("seek crossed input: %d/%d err=%v", position, len(data), err)
			}
		}
	}
	for _, data := range [][]byte{
		binary.LittleEndian.AppendUint64(binary.LittleEndian.AppendUint32(nil, uint32(ValueTypeUint64)), math.MaxUint64),
		binary.LittleEndian.AppendUint64(binary.LittleEndian.AppendUint32(nil, uint32(ValueTypeArray)), 1),
		binary.LittleEndian.AppendUint64(binary.LittleEndian.AppendUint32(nil, 999), 1),
		append(binary.LittleEndian.AppendUint64(binary.LittleEndian.AppendUint32(nil, uint32(ValueTypeString)), 1), binary.LittleEndian.AppendUint64(nil, maxMetadataStringBytes+1)...),
	} {
		if err := skipValue(bytes.NewReader(data), ValueTypeArray); err == nil {
			t.Fatal("invalid array admitted")
		}
	}
	data := discardArrayFixture(3, false)
	unbounded := &unboundedMetadataSeeker{reader: bytes.NewReader(data[:len(data)-1])}
	if err := skipValue(unbounded, ValueTypeArray); err == nil || unbounded.seeks != 0 {
		t.Fatalf("general Seeker bypassed truncation: seeks=%d err=%v", unbounded.seeks, err)
	}
}

func TestMetadataDiscardFixedWidthsPreserveNextValue(t *testing.T) {
	for valueType, width := range map[ValueType]int{
		ValueTypeUint8: 1, ValueTypeInt8: 1, ValueTypeBool: 1,
		ValueTypeUint16: 2, ValueTypeInt16: 2,
		ValueTypeUint32: 4, ValueTypeInt32: 4, ValueTypeFloat32: 4,
		ValueTypeUint64: 8, ValueTypeInt64: 8, ValueTypeFloat64: 8,
	} {
		data := binary.LittleEndian.AppendUint32(nil, uint32(valueType))
		data = binary.LittleEndian.AppendUint64(data, 5)
		data = append(data, bytes.Repeat([]byte{0x7f}, width*5)...)
		data = append(data, 0x42)
		for _, seekable := range []bool{false, true} {
			base := bytes.NewReader(data)
			var reader io.Reader = base
			if !seekable {
				reader = io.LimitReader(base, int64(len(data)))
			}
			if err := skipValue(reader, ValueTypeArray); err != nil {
				t.Fatalf("type=%d seekable=%v: %v", valueType, seekable, err)
			}
			next, err := base.ReadByte()
			if err != nil || next != 0x42 || base.Len() != 0 {
				t.Fatalf("type=%d consumed next value: %x, %v", valueType, next, err)
			}
		}
	}
}

func BenchmarkMetadataDiscard(b *testing.B) {
	for _, strings := range []bool{false, true} {
		name := "fixed-width"
		count := 65536
		if strings {
			name, count = "token-strings", 32768
		}
		b.Run(name, func(b *testing.B) {
			data := discardArrayFixture(count, strings)
			r := &countedMetadataReader{Reader: bytes.NewReader(data)}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				r.Reset(data)
				if err := skipValue(r, ValueTypeArray); err != nil {
					b.Fatal(err)
				}
			}
			b.ReportMetric(float64(r.reads)/float64(b.N), "reader-ops/op")
			b.ReportMetric(float64(r.readBytes)/float64(b.N), "reader-bytes/op")
		})
	}
}
