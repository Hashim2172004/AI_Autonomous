# Scenario Generator API

FastAPI backend for the `frontend/` app. SQLite locally, Postgres (`DATABASE_URL`) when hosted.

## Run

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt   # Windows
.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000   # run from this folder
```

- API: http://localhost:8000/api/v1 (interactive docs at `/docs`)
- Health: http://localhost:8000/health
- Data: `data/app.db` (SQLite), `data/models/` (trained ML models), `data/.secret_key` (JWT signing key)

## What is inside

| Area | Module | Notes |
| --- | --- | --- |
| Auth | `routers/auth.py` | Register/login, JWT bearer tokens, PBKDF2 password hashing |
| Systems & scenarios | `routers/systems.py`, `routers/scenarios.py` | CRUD, filtering, sorting, paging, rule-based generation |
| Simulation | `services/simulator.py` | Monte Carlo queue/capacity model with common random numbers, risk scoring |
| What-if | `services/scenarios.py` | Re-simulates with changed parameters/assumptions and compares against the original |
| ML | `services/ml.py` | Random-forest surrogate trained on synthetic simulator output (clearly labelled as such) |
| Generation runs | `services/agent.py` | Background pipeline: analyse, retrieve, generate, validate, combine, simulate, predict, rank, report |
| Knowledge base | `services/knowledge.py` | Chunking + TF-IDF retrieval (offline, keyword based) |

## Notes

- Claude is optional: set `ANTHROPIC_API_KEY` to let the agent draft scenarios and write the report. Without it
  `GET /generation/config` reports `llm_configured: false` and the agent runs the deterministic pipeline above,
  marking the report as a template summary.
- Generation runs execute in a thread inside the API process and are marked failed if the server restarts mid-run.
  On Vercel (`VERCEL` is set) they run inside the request instead, since threads stop once the response is sent.

## Deploy on Vercel

Set the project root to `backend/`; `vercel.json` routes every request to `api/index.py`. Set `DATABASE_URL` to a
Postgres URL and `CORS_ORIGINS` to the frontend's address. Writable files (trained ML models) live in `/tmp`, which
is per instance and temporary, so a trained model may need retraining after a cold start.
- Every resource is scoped to the signed-in user.
