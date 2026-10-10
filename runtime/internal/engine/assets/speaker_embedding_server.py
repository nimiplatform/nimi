from __future__ import annotations
# @nimi-authority: rule.nimi.runtime.speaker-representation.sherpa-speaker-encoder

import argparse
import os
import secrets

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
import uvicorn

from speaker_embedding_driver import PROTOCOL, SpeakerInputError, execute_request, load_managed_ort

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health():
    return {"protocol": PROTOCOL}


@app.post("/v1/audio/speaker-embed")
def encode(payload: dict, x_nimi_speaker_token: str = Header(default="")):
    token = os.environ.get("NIMI_RUNTIME_SPEAKER_ADMISSION_TOKEN", "")
    if not token or not secrets.compare_digest(token, x_nimi_speaker_token):
        raise HTTPException(status_code=403)
    try:
        return execute_request(payload)
    except SpeakerInputError:
        return JSONResponse(status_code=400, content={"reason_code": "AI_INPUT_INVALID"})
    except Exception:
        return JSONResponse(status_code=500, content={"reason_code": "AI_LOCAL_EXECUTION_INFERENCE_FAILED"})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535 or not os.environ.get("NIMI_RUNTIME_SPEAKER_ADMISSION_TOKEN"):
        raise RuntimeError("speaker Host admission is missing")
    load_managed_ort()
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
