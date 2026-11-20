# ai-service (integration placeholder)

**Owned by the AI team.** This folder only contains a minimal FastAPI app with a
`/health` endpoint, so the backend can be developed against a real URL.
It contains **no AI models and returns no predictions.**

## Run locally (PowerShell)

```powershell
cd services\ai-service
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Check: open http://localhost:8000/health

## Contract the AI team must keep

| Endpoint      | Response                                                                 |
|---------------|--------------------------------------------------------------------------|
| `GET /health` | `{"status":"ok","service":"ai-service","version":"x.y.z","modelsLoaded":bool}` |

- The backend calls this service; the mobile app **never** calls it directly.
- The backend sends `X-API-Key` when `AI_SERVICE_API_KEY` is set.
- New endpoints (screening support) must be agreed first and added to
  `packages/shared-contracts/src/ai.ts` so both sides validate the same shape.
- Outputs are screening **support** only, never a diagnosis. Include model version
  and a disclaimer field in any result.
- The backend applies a timeout (`AI_SERVICE_TIMEOUT_MS`) and keeps working if this
  service is down.
