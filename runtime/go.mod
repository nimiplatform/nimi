module github.com/nimiplatform/nimi/runtime

go 1.26.10

require (
	github.com/Microsoft/go-winio v0.6.4
	github.com/aliyun/alibabacloud-oss-go-sdk-v2 v1.6.1
	github.com/aws/aws-sdk-go-v2/aws/protocol/eventstream v1.7.26
	github.com/dlclark/regexp2 v1.12.0
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/google/uuid v1.6.0
	github.com/gorilla/websocket v1.5.3
	github.com/hajimehoshi/go-mp3 v0.3.4
	github.com/larksuite/oapi-sdk-go/v3 v3.12.2
	github.com/modelcontextprotocol/go-sdk v1.8.0
	github.com/nimiplatform/nimi/nimi-cognition v0.0.0
	github.com/oklog/ulid/v2 v2.1.2
	github.com/santhosh-tekuri/jsonschema/v6 v6.0.3
	github.com/yuin/goldmark v1.8.7
	golang.org/x/image v0.47.0
	golang.org/x/mod v0.42.0
	golang.org/x/net v0.62.0
	golang.org/x/sys v0.49.0
	golang.org/x/text v0.43.0
	google.golang.org/genproto/googleapis/rpc v0.0.0-20261019180522-ce908d29299b
	google.golang.org/grpc v1.85.0
	google.golang.org/protobuf v1.36.12
	gopkg.in/yaml.v3 v3.0.1
	modernc.org/sqlite v1.61.1
)

require (
	github.com/aws/smithy-go v1.28.8 // indirect
	github.com/dustin/go-humanize v1.1.0 // indirect
	github.com/gogo/protobuf v1.3.2 // indirect
	github.com/google/jsonschema-go v0.4.3 // indirect
	github.com/mattn/go-isatty v0.0.24 // indirect
	github.com/ncruces/go-strftime v1.1.0 // indirect
	github.com/pion/datachannel v1.6.3 // indirect
	github.com/pion/dtls/v3 v3.1.15 // indirect
	github.com/pion/ice/v4 v4.4.8 // indirect
	github.com/pion/interceptor v0.1.51 // indirect
	github.com/pion/logging v0.2.4 // indirect
	github.com/pion/mdns/v2 v2.2.2 // indirect
	github.com/pion/randutil v0.1.0 // indirect
	github.com/pion/rtcp v1.2.20 // indirect
	github.com/pion/rtp v1.10.6 // indirect
	github.com/pion/sctp v1.12.0 // indirect
	github.com/pion/sdp/v3 v3.0.20 // indirect
	github.com/pion/srtp/v3 v3.1.3 // indirect
	github.com/pion/stun/v4 v4.0.1 // indirect
	github.com/pion/transport/v5 v5.1.4 // indirect
	github.com/pion/turn/v5 v5.1.3 // indirect
	github.com/pion/webrtc/v4 v4.2.26 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	github.com/segmentio/asm v1.2.1 // indirect
	github.com/segmentio/encoding v0.5.4 // indirect
	github.com/wlynxg/anet v0.0.5 // indirect
	github.com/yosida95/uritemplate/v3 v3.0.2 // indirect
	golang.org/x/crypto v0.58.0 // indirect
	golang.org/x/oauth2 v0.37.0 // indirect
	golang.org/x/sync v0.24.0 // indirect
	golang.org/x/time v0.16.0 // indirect
	modernc.org/libc v1.79.0 // indirect
	modernc.org/mathutil v1.7.1 // indirect
	modernc.org/memory v1.12.1 // indirect
)

replace github.com/nimiplatform/nimi/nimi-cognition => ../nimi-cognition
