#!/usr/bin/env python3
from __future__ import annotations

import argparse

from fastapi import FastAPI
from fastapi.responses import JSONResponse
import uvicorn


def create_app() -> FastAPI:
    app = FastAPI()

    @app.get("/healthz")
    def healthz():
        return {"status": "ok", "ready": True}

    @app.get("/v1/catalog")
    def catalog():
        return {
            "models": [
                {
                    "id": "speech-default",
                    "ready": True,
                    "capabilities": [
                        "audio.transcribe",
                        "audio.synthesize",
                    ],
                }
            ]
        }

    @app.post("/v1/audio/transcriptions")
    def transcribe():
        return JSONResponse(status_code=501, content={"detail": "speech runtime stub does not implement transcription"})

    @app.post("/v1/audio/speech")
    def synthesize():
        return JSONResponse(status_code=501, content={"detail": "speech runtime stub does not implement synthesis"})

    @app.post("/v1/voice/clone")
    def clone_voice():
        return JSONResponse(status_code=501, content={"detail": "speech runtime stub does not implement voice clone"})

    @app.post("/v1/voice/design")
    def design_voice():
        return JSONResponse(status_code=501, content={"detail": "speech runtime stub does not implement voice design"})

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
