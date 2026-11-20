"""
BalSwasthya AI - AI service INTEGRATION PLACEHOLDER.

This service is owned by the AI team. This file only exists so the backend can
be developed and tested against a running endpoint. It contains NO models and
returns NO predictions.

Contract with the backend (services/api/src/integrations/ai-service):
  GET /health -> {"status": "ok", "service": "ai-service", "version": str, "modelsLoaded": bool}
The matching Zod schema is `aiServiceHealthSchema` in packages/shared-contracts/src/ai.ts.

Screening-support endpoints will be added by the AI team once the request/response
contract is agreed. Any result must be framed as screening support, never diagnosis.
"""

import os

from fastapi import FastAPI

SERVICE_VERSION = "0.1.0"

app = FastAPI(
    title="BalSwasthya AI Service (placeholder)",
    version=SERVICE_VERSION,
    description="Integration placeholder. No AI models are implemented here.",
)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "ai-service",
        "version": SERVICE_VERSION,
        # Always False in the placeholder: no models exist yet.
        "modelsLoaded": False,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("AI_SERVICE_PORT", "8000")))
