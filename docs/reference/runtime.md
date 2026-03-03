# Runtime Reference

`nimi-runtime` is the local AI execution daemon used by apps and desktop.

## Command entry

```bash
go run ./cmd/nimi serve
```

## Operational commands

```bash
go run ./cmd/nimi health --source grpc
go run ./cmd/nimi providers --source grpc
go run ./cmd/nimi config get --json
```

## Health endpoints

- `GET /livez`
- `GET /readyz`
- `GET /v1/runtime/health`

## Source references

- Runtime implementation notes: [`runtime/README.md`](../../runtime/README.md)
- Runtime spec domain docs: [`spec/runtime`](../../spec/runtime)
- Runtime kernel contracts: [`spec/runtime/kernel`](../../spec/runtime/kernel)
