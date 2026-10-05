package musicscore

import (
	"encoding/binary"
	"reflect"
	"sort"
	"testing"
)

func TestNoteMIDIPreservesPolyphonyAndEqualPitchOverlaps(t *testing.T) {
	notes := []MIDINote{{17, 1500, 60}, {90, 500, 60}, {17, 700, 64}, {1500, 1600, 60}}
	data, err := MarshalNoteMIDI(notes)
	if err != nil {
		t.Fatal(err)
	}
	got, err := ParseNoteMIDI(data)
	if err != nil {
		t.Fatal(err)
	}
	less := func(values []MIDINote) {
		sort.Slice(values, func(i, j int) bool {
			if values[i].StartTick != values[j].StartTick {
				return values[i].StartTick < values[j].StartTick
			}
			return values[i].Pitch < values[j].Pitch
		})
	}
	less(notes)
	less(got)
	if !reflect.DeepEqual(got, notes) {
		t.Fatalf("note spans changed: %v", got)
	}
}

func TestNoteMIDIRequiresCompletePairedTerminalTrack(t *testing.T) {
	valid, err := MarshalNoteMIDI([]MIDINote{{0, 200, 72}})
	if err != nil {
		t.Fatal(err)
	}
	for name, corrupt := range map[string]func([]byte) []byte{
		"missing end": func(b []byte) []byte {
			b = b[:len(b)-4]
			binary.BigEndian.PutUint32(b[18:22], uint32(len(b)-22))
			return b
		},
		"trailing":        func(b []byte) []byte { return append(b, 0) },
		"orphan off":      func(b []byte) []byte { b[23] = 0x80; b[25] = 0; return b },
		"different clock": func(b []byte) []byte { b[12] = 0; b[13] = 96; return b },
		"unclosed note":   func(b []byte) []byte { b[28] = 73; return b },
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := ParseNoteMIDI(corrupt(append([]byte(nil), valid...))); err == nil {
				t.Fatal("malformed MIDI accepted")
			}
		})
	}
	data, err := MarshalNoteMIDI(nil)
	if err != nil {
		t.Fatal(err)
	}
	notes, err := ParseNoteMIDI(data)
	if err != nil || len(notes) != 0 {
		t.Fatal("actual empty result was not representable")
	}
}
