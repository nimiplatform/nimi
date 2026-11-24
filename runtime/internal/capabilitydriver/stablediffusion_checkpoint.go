package capabilitydriver

import (
	"cmp"
	"errors"
	"io"
	"slices"
)

// DiffusionCheckpointLayout identifies a verified standalone checkpoint layout
// detected from bounded safetensors header facts.
type DiffusionCheckpointLayout string

const (
	DiffusionCheckpointLayoutNone DiffusionCheckpointLayout = ""
	DiffusionCheckpointLayoutSDXL DiffusionCheckpointLayout = "sdxl"
	DiffusionCheckpointLayoutSD1  DiffusionCheckpointLayout = "sd1"
)

// ProbeStandaloneDiffusionCheckpoint recognizes self-contained SD 1.x and SDXL
// base files for acquisition and reports the detected layout so callers can
// disclose host recipe availability before download.
// @nimi-authority: rule.nimi.runtime.local-compute.r015
func ProbeStandaloneDiffusionCheckpoint(source io.Reader, size int64) (DiffusionCheckpointLayout, error) {
	header, tensors, err := readSafetensorsHeader(source, size)
	if errors.Is(err, errInvalidSafetensorsHeader) {
		return DiffusionCheckpointLayoutNone, nil
	}
	if err != nil {
		return DiffusionCheckpointLayoutNone, err
	}
	if !matchTensorShapes(tensors, map[string][]int64{
		"model.diffusion_model.input_blocks.0.0.weight":      {320, 4, 3, 3},
		"model.diffusion_model.out.2.weight":                 {4, 320, 3, 3},
		"first_stage_model.encoder.conv_in.weight":           {128, 3, 3, 3},
		"first_stage_model.encoder.mid.block_1.norm1.weight": {512},
		"first_stage_model.decoder.conv_in.weight":           {512, 4, 3, 3},
		"first_stage_model.decoder.mid.block_1.norm1.weight": {512},
		"first_stage_model.decoder.conv_out.weight":          {3, 128, 3, 3},
	}) {
		return DiffusionCheckpointLayoutNone, nil
	}
	sd1 := matchTensorShapes(tensors, map[string][]int64{
		"cond_stage_model.transformer.text_model.embeddings.token_embedding.weight":    {49408, 768},
		"cond_stage_model.transformer.text_model.encoder.layers.11.layer_norm2.weight": {768},
		"model.diffusion_model.middle_block.1.transformer_blocks.0.attn2.to_k.weight":  {1280, 768},
		"model.diffusion_model.output_blocks.11.0.in_layers.0.weight":                  {640},
	})
	sdxl := matchesSDXLTensors("sdxl-base-checkpoint", tensors) && matchTensorShapes(tensors, map[string][]int64{
		"conditioner.embedders.0.transformer.text_model.encoder.layers.11.layer_norm2.weight": {768},
		"conditioner.embedders.1.model.transformer.resblocks.31.ln_2.weight":                  {1280},
		"model.diffusion_model.middle_block.1.transformer_blocks.0.attn2.to_k.weight":         {1280, 2048},
		"model.diffusion_model.output_blocks.8.0.in_layers.0.weight":                          {640},
	})
	layout := DiffusionCheckpointLayoutNone
	switch {
	case sdxl:
		layout = DiffusionCheckpointLayoutSDXL
	case sd1:
		layout = DiffusionCheckpointLayoutSD1
	default:
		return DiffusionCheckpointLayoutNone, nil
	}
	offsets := make([][]int64, 0, len(tensors))
	for _, t := range tensors {
		if !validCheckpointTensorSize(t, size) {
			return DiffusionCheckpointLayoutNone, nil
		}
		offsets = append(offsets, t.DataOffsets)
	}
	slices.SortFunc(offsets, func(a, b []int64) int {
		return cmp.Or(cmp.Compare(a[0], b[0]), cmp.Compare(a[1], b[1]))
	})
	var end int64
	for _, span := range offsets {
		if span[0] != end {
			return DiffusionCheckpointLayoutNone, nil
		}
		end = span[1]
	}
	if end <= 0 || end != size-int64(len(header)) {
		return DiffusionCheckpointLayoutNone, nil
	}
	return layout, nil
}

func validCheckpointTensorSize(t safetensorsTensorFact, fileSize int64) bool {
	var n int64
	switch t.DType {
	case "BOOL", "U8", "I8", "F8_E4M3", "F8_E5M2":
		n = 1
	case "F16", "BF16", "I16", "U16":
		n = 2
	case "F32", "I32", "U32":
		n = 4
	case "F64", "I64", "U64":
		n = 8
	default:
		return false
	}
	for _, dim := range t.Shape {
		if dim < 0 || (n != 0 && dim > fileSize/n) {
			return false
		}
		n *= dim
	}
	return n == t.DataOffsets[1]-t.DataOffsets[0]
}
