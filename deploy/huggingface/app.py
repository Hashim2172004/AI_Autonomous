"""Hugging Face Space entry point (Gradio SDK, free CPU).

Docker Spaces need a paid plan, so this Space runs `python app.py` instead: it clones the
app from GitHub (public repo) and serves the FastAPI backend on the Space's port, 7860.
"Restart Space" or "Factory rebuild" picks up new pushes to main.
"""
import os
import subprocess
import sys

REPO = "https://github.com/Hashim2172004/AI_Autonomous.git"
HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, "source")

if not os.path.isdir(SOURCE):
    subprocess.run(["git", "clone", "--depth", "1", REPO, SOURCE], check=True)

BACKEND = os.path.join(SOURCE, "backend")
os.chdir(BACKEND)
sys.path.insert(0, BACKEND)

import uvicorn  # noqa: E402  (installed with gradio)

uvicorn.run("app.main:app", host="0.0.0.0", port=7860)
