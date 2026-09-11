package capabilitydriver

import (
	"encoding/json"
	"fmt"
	"io"

	"google.golang.org/protobuf/encoding/protowire"
)

// ONNX graph metadata follows potentially large tensor payloads. Walk wire
// boundaries without loading weights, and decode only bounded type records.
type onnxTensor struct {
	Name  string  `json:"name"`
	Type  uint64  `json:"type"`
	Shape []int64 `json:"shape"`
}

type onnxModel struct {
	IRVersion uint64       `json:"ir_version"`
	Inputs    []onnxTensor `json:"inputs"`
	Outputs   []onnxTensor `json:"outputs"`
}

func probeONNXModel(source io.ReaderAt, size int64) ([]byte, error) {
	if size <= 0 {
		return nil, fmt.Errorf("empty ONNX model")
	}
	model := onnxModel{}
	graphs := 0
	err := walkONNXFields(source, 0, size, func(field protowire.Number, kind protowire.Type, start, length int64, value uint64) error {
		if field == 1 && kind == protowire.VarintType {
			model.IRVersion = value
		}
		if field != 7 || kind != protowire.BytesType {
			return nil
		}
		graphs++
		if graphs != 1 {
			return fmt.Errorf("ambiguous ONNX graph")
		}
		return walkONNXFields(source, start, length, func(number protowire.Number, wire protowire.Type, offset, count int64, _ uint64) error {
			if number == 5 && wire == protowire.BytesType {
				return walkONNXFields(source, offset, count, func(field protowire.Number, kind protowire.Type, _, _ int64, value uint64) error {
					if field == 13 || (field == 14 && kind == protowire.VarintType && value != 0) {
						return fmt.Errorf("external ONNX tensor files are not admitted")
					}
					return nil
				})
			}
			if number != 11 && number != 12 {
				return nil
			}
			if wire != protowire.BytesType || count > 65536 || len(model.Inputs)+len(model.Outputs) >= 32 {
				return fmt.Errorf("ONNX interface exceeds its bound")
			}
			body := make([]byte, count)
			if _, err := source.ReadAt(body, offset); err != nil {
				return err
			}
			tensor, err := decodeONNXValue(body)
			if err != nil {
				return err
			}
			if number == 11 {
				model.Inputs = append(model.Inputs, tensor)
			} else {
				model.Outputs = append(model.Outputs, tensor)
			}
			return nil
		})
	})
	if err != nil {
		return nil, err
	}
	if graphs != 1 || model.IRVersion == 0 || len(model.Inputs) == 0 || len(model.Outputs) == 0 {
		return nil, fmt.Errorf("ONNX model has no complete tensor interface")
	}
	return json.Marshal(model)
}

func walkONNXFields(source io.ReaderAt, start, length int64, visit func(protowire.Number, protowire.Type, int64, int64, uint64) error) error {
	end := start + length
	if start < 0 || length < 0 || end < start {
		return fmt.Errorf("invalid ONNX wire range")
	}
	position := start
	readVarint := func() (uint64, error) {
		var data [10]byte
		for index := range data {
			if position >= end {
				return 0, io.ErrUnexpectedEOF
			}
			if _, err := source.ReadAt(data[index:index+1], position); err != nil {
				return 0, err
			}
			position++
			if data[index] < 128 {
				value, n := protowire.ConsumeVarint(data[:index+1])
				if n < 0 {
					return 0, fmt.Errorf("invalid ONNX varint")
				}
				return value, nil
			}
		}
		return 0, fmt.Errorf("invalid ONNX varint")
	}
	for fields := 0; position < end; fields++ {
		if fields >= 100000 {
			return fmt.Errorf("ONNX structure exceeds its field bound")
		}
		tag, err := readVarint()
		if err != nil {
			return err
		}
		number, wire := protowire.DecodeTag(tag)
		if number <= 0 {
			return fmt.Errorf("invalid ONNX field")
		}
		var count int64
		var value uint64
		switch wire {
		case protowire.VarintType:
			value, err = readVarint()
		case protowire.Fixed32Type:
			count = 4
		case protowire.Fixed64Type:
			count = 8
		case protowire.BytesType:
			var encoded uint64
			encoded, err = readVarint()
			if encoded > uint64(end-position) {
				return io.ErrUnexpectedEOF
			}
			count = int64(encoded)
		default:
			return fmt.Errorf("unsupported ONNX wire type")
		}
		if err != nil {
			return err
		}
		if count > end-position {
			return io.ErrUnexpectedEOF
		}
		if err := visit(number, wire, position, count, value); err != nil {
			return err
		}
		position += count
	}
	return nil
}

func onnxBytes(body []byte, field protowire.Number) ([][]byte, error) {
	var values [][]byte
	for len(body) > 0 {
		number, kind, n := protowire.ConsumeTag(body)
		if n < 0 {
			return nil, fmt.Errorf("invalid ONNX metadata tag")
		}
		body = body[n:]
		consumed := protowire.ConsumeFieldValue(number, kind, body)
		if consumed < 0 {
			return nil, fmt.Errorf("invalid ONNX metadata value")
		}
		if number == field && kind == protowire.BytesType {
			value, n := protowire.ConsumeBytes(body)
			if n < 0 {
				return nil, fmt.Errorf("invalid ONNX bytes")
			}
			values = append(values, value)
		}
		body = body[consumed:]
	}
	return values, nil
}

func onnxOne(body []byte, field protowire.Number) ([]byte, error) {
	values, err := onnxBytes(body, field)
	if err != nil {
		return nil, err
	}
	if len(values) != 1 {
		return nil, fmt.Errorf("missing or repeated ONNX metadata field %d", field)
	}
	return values[0], nil
}

func onnxVarint(body []byte, field protowire.Number) (uint64, bool) {
	for len(body) > 0 {
		number, kind, n := protowire.ConsumeTag(body)
		if n < 0 {
			return 0, false
		}
		body = body[n:]
		n = protowire.ConsumeFieldValue(number, kind, body)
		if n < 0 {
			return 0, false
		}
		if number == field && kind == protowire.VarintType {
			value, count := protowire.ConsumeVarint(body)
			return value, count >= 0
		}
		body = body[n:]
	}
	return 0, false
}

func decodeONNXValue(body []byte) (onnxTensor, error) {
	var result onnxTensor
	name, err := onnxOne(body, 1)
	if err != nil {
		return result, err
	}
	result.Name = string(name)
	typeProto, err := onnxOne(body, 2)
	if err != nil {
		return result, err
	}
	tensor, err := onnxOne(typeProto, 1)
	if err != nil {
		return result, err
	}
	var ok bool
	result.Type, ok = onnxVarint(tensor, 1)
	if !ok {
		return result, fmt.Errorf("ONNX tensor has no element type")
	}
	shape, err := onnxOne(tensor, 2)
	if err != nil {
		return result, err
	}
	dimensions, err := onnxBytes(shape, 1)
	if err != nil || len(dimensions) > 8 {
		return result, fmt.Errorf("invalid ONNX dimensions")
	}
	for _, dimension := range dimensions {
		value, fixed := onnxVarint(dimension, 1)
		if fixed {
			result.Shape = append(result.Shape, int64(value))
		} else {
			result.Shape = append(result.Shape, -1)
		}
	}
	return result, nil
}
