from __future__ import annotations

# @nimi-authority: rule.nimi.runtime.ai-provider.laya-local-decision

import argparse
import hmac
import os
import threading

from fastapi import FastAPI, Header, Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from laya_text_decision import (
    MAX_REQUEST_BYTES,
    PROTOCOL,
    DecisionError,
    DecisionWorker,
    decode_request,
    encode_response,
)

_INPUT_REASONS = {"AI_INPUT_INVALID", "AI_INPUT_LIMIT_EXCEEDED"}
_JSON_UTF8 = "application/json; charset=utf-8"


def _failure(error: DecisionError) -> Response:
    status = 422 if error.reason in _INPUT_REASONS else 500
    return Response(status_code=status, content=encode_response(error.payload()), media_type=_JSON_UTF8)


def _admitted(token: str, presented: str) -> bool:
    return hmac.compare_digest(token.encode("utf-8"), presented.encode("utf-8", "surrogateescape"))


def create_app(token: str, worker: DecisionWorker | None = None) -> FastAPI:
    if not token:
        raise ValueError("Runtime decision admission token is required")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    decision_worker = worker or DecisionWorker()
    lease = threading.Lock()

    def execute(body: bytes) -> Response:
        with lease:
            try:
                return Response(status_code=200, content=encode_response(decision_worker.run(decode_request(body))), media_type=_JSON_UTF8)
            except DecisionError as error:
                return _failure(error)
            except Exception:
                return _failure(DecisionError("AI_LOCAL_EXECUTION_INFERENCE_FAILED", "Decision execution failed"))

    @app.get("/health")
    def health():
        return {"status": "ready", "protocol": PROTOCOL}

    @app.post("/v1/text/decide")
    async def decide(request: Request, x_nimi_decision_token: str = Header(default="")):
        if not _admitted(token, x_nimi_decision_token):
            return Response(status_code=403, content=b'{"detail":"Runtime decision admission is required"}', media_type=_JSON_UTF8)
        chunks: list[bytes] = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_REQUEST_BYTES:
                return _failure(DecisionError("AI_INPUT_INVALID", "Decision request exceeds the private transport bound"))
            chunks.append(chunk)
        return await run_in_threadpool(execute, b"".join(chunks))

    return app


def main() -> None:
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True, type=int)
    args = parser.parse_args()
    app = create_app(os.environ.get("NIMI_RUNTIME_DECISION_ADMISSION_TOKEN", ""))
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
