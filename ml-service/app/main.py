"""FastAPI entry point. Interactive OpenAPI docs: /docs (Swagger) and /redoc."""
from __future__ import annotations

import hmac
import os

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import ALGORITHM_VERSION
from .api import handlers as h

app = FastAPI(
    title="MarineTrace AI - ML service",
    version=ALGORITHM_VERSION,
    description="Research prototype. Data quality assessment, anomaly detection, missing-data "
                "reconstruction with empirical uncertainty, and benchmarking. Not an operational service.",
)

origins = [o.strip() for o in os.getenv("ML_ALLOWED_ORIGINS", "http://localhost:4000").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["*"])


def require_token(x_service_token: str | None = Header(default=None)) -> None:
    """Shared-secret check between the Express backend and this service."""
    expected = os.getenv("ML_SERVICE_TOKEN", "")
    if expected and not hmac.compare_digest(x_service_token or "", expected):
        raise HTTPException(status_code=401, detail="Invalid or missing service token")


class Base(BaseModel):
    csv: str = Field(..., description="Original CSV text (never modified).")
    mapping: dict[str, str] | None = Field(default=None, description="canonical_field -> source column")


class ProfileReq(BaseModel):
    csv: str


class QualityReq(Base):
    config: dict | None = None


class AnomalyReq(Base):
    columns: list[str] | None = None
    mad: dict | None = None
    iforest: dict | None = None


class ReconstructReq(Base):
    variable: str = "sea_surface_temperature"
    method: str = "mare"
    max_gap: int = Field(24, ge=1, le=500)
    min_obs_fraction: float = Field(0.5, ge=0, le=1)
    max_relative_halfwidth: float | None = Field(default=None, gt=0)
    alpha: float = Field(0.10, gt=0.0, lt=0.5)
    seed: int = 0


class EvaluateReq(Base):
    variable: str = "sea_surface_temperature"
    n_repeats: int = Field(3, ge=1, le=10)
    seed: int = 7
    max_gap: int = Field(24, ge=1, le=500)
    alpha: float = Field(0.10, gt=0.0, lt=0.5)
    truth_csv: str | None = None


def guarded(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except h.BadRequest as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/health")
def health():
    return {"status": "ok", "algorithm_version": ALGORITHM_VERSION}


@app.post("/v1/profile", dependencies=[Depends(require_token)])
def profile(req: ProfileReq):
    return guarded(h.profile, req.csv)


@app.post("/v1/quality", dependencies=[Depends(require_token)])
def quality(req: QualityReq):
    return guarded(h.quality, req.csv, req.mapping, req.config)


@app.post("/v1/anomalies", dependencies=[Depends(require_token)])
def anomalies(req: AnomalyReq):
    return guarded(h.anomalies, req.csv, req.mapping, req.columns, req.mad, req.iforest)


@app.post("/v1/reconstruct", dependencies=[Depends(require_token)])
def reconstruct(req: ReconstructReq):
    return guarded(h.reconstruct_handler, req.csv, req.mapping, req.variable, req.method, req.max_gap,
                   req.min_obs_fraction, req.max_relative_halfwidth, req.alpha, req.seed)


@app.post("/v1/evaluate", dependencies=[Depends(require_token)])
def evaluate_endpoint(req: EvaluateReq):
    return guarded(h.evaluate_handler, req.csv, req.mapping, req.variable, req.n_repeats, req.seed,
                   req.max_gap, req.alpha, req.truth_csv)
