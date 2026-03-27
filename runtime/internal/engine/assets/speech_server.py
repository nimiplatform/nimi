#!/usr/bin/env python3
from __future__ import annotations

import argparse

from fastapi import FastAPI
from fastapi.responses import JSONResponse
import uvicorn


def create_app() -> FastAPI:
    app = FastAPI()

    def unavailable_response(operation: str) -> JSONResponse:
        return JSONResponse(
            status_code=503,
            content={
                "detail": {
                    "message": f"speech runtime unavailable: {operation} requires supervised speech drivers and artifacts",
                    "reason": "speech_engine_unavailable",
                }
            },
        )

    @app.get("/healthz")
    def healthz():
        return {"status": "stub", "ready": False}

    @app.get("/v1/catalog")
    def catalog():
        return {
            "models": [
                {
                    "id": "speech-default",
                    "ready": False,
                    "capabilities": [
                        "audio.transcribe",
                        "audio.synthesize",
                    ],
                }
            ]
        }

    @app.post("/v1/audio/transcriptions")
    def transcribe():
        return unavailable_response("audio transcription")

    @app.post("/v1/audio/speech")
    def synthesize():
        return unavailable_response("audio synthesis")

    @app.post("/v1/voice/clone")
    def clone_voice():
        return unavailable_response("voice clone")

    @app.post("/v1/voice/design")
    def design_voice():
        return unavailable_response("voice design")

    return app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8330)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    uvicorn.run(create_app(), host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
