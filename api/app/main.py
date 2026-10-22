from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import db
from app.config import get_settings
from app.routes import experiments, ingest, rca, runs

settings = get_settings()

app = FastAPI(title="AgentTrace API", version="0.0.1")

# Bearer tokens travel in the Authorization header, not cookies, so no credentialed CORS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.web_origins,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(ingest.router)
app.include_router(runs.router)
app.include_router(experiments.router)
app.include_router(rca.router)


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True, "db": await db.ping()}
