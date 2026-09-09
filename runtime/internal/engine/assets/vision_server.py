from __future__ import annotations

# @nimi-authority: rule.nimi.runtime.local-compute.r117

import argparse
import hmac
import os
import threading
from typing import Literal

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from vision_locate import LocateError, LocateWorker, MAX_IMAGE_BYTES, MAX_QUERY_BYTES, PROTOCOL


class LocateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    image_artifact_id: str = Field(min_length=1, max_length=128)
    image_base64: str = Field(min_length=1, max_length=4 * ((MAX_IMAGE_BYTES + 2) // 3))
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    query: str = Field(min_length=1, max_length=MAX_QUERY_BYTES)
    geometry: Literal["BOX", "POINT"]
    model_dir: str = Field(min_length=1)
    model_content_id: str = Field(min_length=1)
    profile_digest: str = Field(min_length=1)
    backend: Literal["transformers", "mlx"]


def create_app(token: str) -> FastAPI:
    if not token:
        raise ValueError("Runtime Vision admission token is required")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    worker = LocateWorker()
    lease = threading.Lock()

    @app.get("/health")
    def health():
        return {"status": "ready", "protocol": PROTOCOL}

    @app.post("/v1/vision/locate")
    def locate(request: LocateRequest, x_nimi_vision_token: str = Header(default="")):
        if not hmac.compare_digest(token, x_nimi_vision_token):
            raise HTTPException(status_code=403, detail="Runtime Vision admission is required")
        with lease:
            try:
                return worker.run(request.model_dump())
            except LocateError as error:
                return JSONResponse(status_code=422, content={"reason_code": error.reason, "detail": str(error)})
            except Exception as error:
                return JSONResponse(status_code=500, content={"reason_code": "AI_PROVIDER_INTERNAL", "detail": str(error)})

    return app


def main() -> None:
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True, type=int)
    args = parser.parse_args()
    token = os.environ.get("NIMI_RUNTIME_VISION_ADMISSION_TOKEN", "")
    app = create_app(token)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
