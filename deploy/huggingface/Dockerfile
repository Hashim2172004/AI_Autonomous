# Hugging Face Space (Docker SDK) for the backend. The Space holds only this file and README.md;
# the code is cloned from GitHub at build time, so "Factory rebuild" in the Space picks up new pushes.
FROM python:3.13-slim

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Spaces run the container as uid 1000, which must be able to write data/ (SQLite db, models, key).
RUN useradd -m -u 1000 user
USER user
ENV PYTHONUNBUFFERED=1 PATH="/home/user/.local/bin:$PATH"
WORKDIR /home/user

RUN git clone --depth 1 https://github.com/Hashim2172004/AI_Autonomous.git repo \
    && pip install --no-cache-dir --user -r repo/backend/requirements.txt \
    && mkdir -p repo/backend/data

WORKDIR /home/user/repo/backend
EXPOSE 7860
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
