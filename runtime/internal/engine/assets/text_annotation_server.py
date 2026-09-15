from __future__ import annotations

import argparse
import hmac
import os
import threading

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from spacy_text_annotation import AnnotationError, AnnotationWorker, PROTOCOL

# @nimi-authority: rule.nimi.runtime.ai-provider.spacy-local-annotation


class AnnotationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    language: str = Field(min_length=2, max_length=16)
    texts: list[str] = Field(min_length=1, max_length=64)
    model_dir: str = Field(min_length=1)
    model_content_id: str = Field(min_length=1)


def create_app(token: str) -> FastAPI:
    if not token:
        raise ValueError("Runtime NLP admission token is required")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    worker = AnnotationWorker()
    lease = threading.Lock()

    @app.get("/health")
    def health():
        return {"status": "ready", "protocol": PROTOCOL}

    @app.post("/v1/text/annotate")
    def annotate(request: AnnotationRequest, x_nimi_nlp_token: str = Header(default="")):
        if not hmac.compare_digest(token, x_nimi_nlp_token):
            raise HTTPException(status_code=403, detail="Runtime NLP admission is required")
        with lease:
            try:
                return worker.run(request.model_dir, request.model_content_id, request.language, request.texts)
            except AnnotationError as error:
                return JSONResponse(status_code=422, content={"reason_code": error.reason, "detail": str(error)})
            except Exception:
                return JSONResponse(status_code=500, content={"reason_code": "AI_LOCAL_EXECUTION_INFERENCE_FAILED", "detail": "Language analysis failed"})

    return app


def main() -> None:
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True, type=int)
    args = parser.parse_args()
    app = create_app(os.environ.get("NIMI_RUNTIME_NLP_ADMISSION_TOKEN", ""))
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
