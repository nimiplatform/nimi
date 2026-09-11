from __future__ import annotations

# @nimi-authority: rule.nimi.runtime.ai-provider.face-swap-host

import argparse
import base64
import hmac
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from face_swap import FaceSwapError, FaceSwapWorker, MAX_IMAGE_BYTES, PROTOCOL

MAX_REQUEST_BYTES = 2 * 4 * ((MAX_IMAGE_BYTES + 2) // 3) + 64 * 1024


def serve(port: int, token: str):
    if not token:
        raise ValueError("Runtime face-replacement admission token is required")
    worker = FaceSwapWorker()
    execution = threading.Lock()
    inference = ThreadPoolExecutor(max_workers=1, thread_name_prefix="nimi-face-inference")
    session = None

    class Handler(BaseHTTPRequestHandler):
        # A Session sends many frames over the same Runtime-owned connection.
        # Opening a new Windows loopback connection for every frame can fail
        # under sustained load even while inference remains healthy.
        protocol_version = "HTTP/1.1"

        def log_message(self, *_args):
            pass

        def send_json(self, status: int, value):
            body = json.dumps(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path != "/health":
                self.send_error(404)
                return
            self.send_json(200, {"protocol": PROTOCOL})

        def do_POST(self):
            if self.path not in ("/v1/image/face-swap", "/v1/video/face-swap", "/v1/video/session/open", "/v1/video/session/frame"):
                self.send_error(404)
                return
            if not hmac.compare_digest(token, self.headers.get("x-nimi-face-swap-token", "")):
                self.send_error(403)
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if size <= 0 or size > MAX_REQUEST_BYTES:
                    raise FaceSwapError("AI_INPUT_INVALID", "Face replacement request exceeds its bound")
                if self.path == "/v1/video/session/frame":
                    self.replace_session_frame(self.rfile.read(size))
                    return
                payload = json.loads(self.rfile.read(size))
                if self.path == "/v1/video/session/open":
                    self.open_session(payload)
                    return
                if self.path == "/v1/video/face-swap":
                    self.replace_video(payload)
                    return
                if not isinstance(payload, dict) or set(payload) != {"reference", "target", "bindings"}:
                    raise FaceSwapError("AI_INPUT_INVALID", "Face replacement request has an invalid shape")
                if not isinstance(payload["bindings"], dict) or any(not isinstance(v, str) for v in payload["bindings"].values()):
                    raise FaceSwapError("AI_INPUT_INVALID", "Face replacement model bindings are invalid")
                reference = base64.b64decode(payload["reference"], validate=True)
                target = base64.b64decode(payload["target"], validate=True)
                with execution:
                    body, width, height = inference.submit(worker.replace, reference, target, payload["bindings"]).result()
                self.send_json(200, {"image": base64.b64encode(body).decode("ascii"), "width": width, "height": height})
            except FaceSwapError as error:
                self.send_json(422, {"reason_code": error.reason, "detail": str(error)})
            except (ValueError, TypeError) as error:
                self.send_json(422, {"reason_code": "AI_INPUT_INVALID", "detail": "Malformed face replacement request"})
            except Exception:
                self.send_json(500, {"reason_code": "AI_LOCAL_EXECUTION_INFERENCE_FAILED", "detail": "Face replacement Worker failed"})

        def open_session(self, payload):
            nonlocal session
            if not isinstance(payload, dict) or set(payload) != {"session_id", "reference", "bindings", "width", "height"} or not isinstance(payload["session_id"], str) or not payload["session_id"] or (payload["width"], payload["height"]) != (1280, 720):
                raise FaceSwapError("AI_INPUT_INVALID", "Video Session opening fields are invalid")
            reference = base64.b64decode(payload["reference"], validate=True)
            with execution:
                session = None
                prepared = inference.submit(worker.prepare_reference, reference, payload["bindings"]).result()
                session = {"id": payload["session_id"], "prepared": prepared, "width": payload["width"], "height": payload["height"]}
            self.send_json(200, {"ready": True})

        def replace_session_frame(self, body):
            import cv2
            import numpy as np

            with execution:
                if session is None or self.headers.get("x-nimi-face-swap-session", "") != session["id"]:
                    raise FaceSwapError("AI_REALTIME_SESSION_CLOSED", "Video Session is closed")
                if len(body) != session["width"] * session["height"] * 3:
                    raise FaceSwapError("AI_INPUT_INVALID", "Video frame size does not match the Session")
                rgb = np.frombuffer(body, dtype=np.uint8).reshape(session["height"], session["width"], 3)
                result = inference.submit(worker.replace_frame, cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), session["prepared"]).result()
                output = cv2.cvtColor(result, cv2.COLOR_BGR2RGB).tobytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(output)))
            self.end_headers()
            self.wfile.write(output)

        def replace_video(self, payload):
            from face_swap_video import replace_video

            if not isinstance(payload, dict) or set(payload) != {"reference", "video_path", "output_path", "bindings", "no_face_policy"}:
                raise FaceSwapError("AI_INPUT_INVALID", "Video replacement request has an invalid shape")
            reference = base64.b64decode(payload["reference"], validate=True)
            if any(not isinstance(payload[key], str) for key in ("video_path", "output_path", "no_face_policy")):
                raise FaceSwapError("AI_INPUT_INVALID", "Video replacement request fields are invalid")
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Connection", "close")
            self.close_connection = True
            self.end_headers()

            def emit(value):
                self.wfile.write(json.dumps(value).encode() + b"\n")
                self.wfile.flush()

            try:
                with execution:
                    summary = inference.submit(replace_video, worker, reference, payload["video_path"], payload["output_path"], payload["bindings"], payload["no_face_policy"],
                                               lambda done, total: emit({"type": "progress", "done": done, "total": total})).result()
                emit({"type": "completed", "summary": summary})
            except FaceSwapError as error:
                emit({"type": "failed", "reason_code": error.reason, "detail": str(error)})
            except (BrokenPipeError, ConnectionResetError):
                return
            except Exception:
                emit({"type": "failed", "reason_code": "AI_LOCAL_EXECUTION_INFERENCE_FAILED", "detail": "Video replacement Worker failed"})

    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    serve(args.port, os.environ.get("NIMI_RUNTIME_FACE_SWAP_TOKEN", ""))
