# Scenario Generator API

FastAPI + SQLite backend for the `frontend/` app.

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

- No external LLM is used. `GET /generation/config` reports `llm_configured: false`; the "AI agent" runs the
  deterministic pipeline above and the report is marked as a template summary.
- Generation runs execute in a thread inside the API process and are marked failed if the server restarts mid-run.
- Every resource is scoped to the signed-in user.
