"""Surrogate machine-learning model trained on synthetic simulator output.

The model learns to approximate the simulator: it maps scenario parameters to the headline
outcomes. It is *not* trained on real historical data and is labelled as such in the API.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import KFold, train_test_split
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import DATA_DIR
from ..models import MlModel
from .simulator import DEFAULT_ASSUMPTIONS, PARAMETER_LIMITS, fast_outcomes, normalise_parameters

FEATURES = list(PARAMETER_LIMITS)
TARGETS = ["profit_change_pct", "total_cost_change_pct", "avg_delay_days", "unmet_demand_pct"]
TARGET_LABELS = {
    "profit_change_pct": "Profit change (%)",
    "total_cost_change_pct": "Total cost change (%)",
    "avg_delay_days": "Average delay (days)",
    "unmet_demand_pct": "Unserved demand (%)",
}
DISCLAIMER = (
    "Trained on synthetic scenarios produced by this application's own simulator, not on real historical outcomes. "
    "It shows how closely a model can imitate the simulation; it is not a validated forecast of the real world."
)
ALGORITHM = "Random forest regressor (scikit-learn)"
N_SAMPLES = 500
MODEL_DIR = DATA_DIR / "models"

_train_lock = threading.Lock()


def is_available() -> tuple[bool, str | None]:
    return True, None


def _sample_parameters(rng: np.random.Generator) -> dict[str, float]:
    """Draw plausible scenarios: mostly one or two shocks, a minority of mixed ones."""
    params = {name: 0.0 for name in ("demand_change_pct", "capacity_change_pct", "cost_change_pct")}
    active = rng.choice(3, size=int(rng.integers(1, 4)), replace=False)
    names = list(params)
    for index in active:
        name = names[index]
        if name == "demand_change_pct":
            params[name] = float(rng.uniform(-60, 80))
        elif name == "capacity_change_pct":
            params[name] = float(rng.uniform(-80, 40))
        else:
            params[name] = float(rng.uniform(-10, 50))
    params["duration_days"] = float(rng.integers(2, 75))
    params["recovery_days"] = float(rng.integers(0, 60))
    params["probability"] = float(rng.uniform(0.02, 0.8))
    params["volatility"] = float(rng.uniform(0.05, 0.8))
    return params


def train(db: Session, assumptions: dict[str, Any] | None = None, seed: int = 7) -> MlModel:
    with _train_lock:
        assumptions = {**DEFAULT_ASSUMPTIONS, **(assumptions or {})}
        rng = np.random.default_rng(seed)
        rows, targets = [], []
        for index in range(N_SAMPLES):
            params = normalise_parameters(_sample_parameters(rng))
            outcome = fast_outcomes(params, {**assumptions, "seed": seed + index})
            rows.append([params[name] for name in FEATURES])
            targets.append([outcome[name] for name in TARGETS])
        x, y = np.array(rows), np.array(targets)

        x_train, x_test, y_train, y_test = train_test_split(x, y, test_size=0.2, random_state=seed)
        forest = RandomForestRegressor(n_estimators=120, min_samples_leaf=2, random_state=seed, n_jobs=1)
        forest.fit(x_train, y_train)
        predicted = forest.predict(x_test)

        # Cross-validation per outcome on the training split.
        folds = list(KFold(n_splits=5, shuffle=True, random_state=seed).split(x_train))
        cv_scores = np.zeros((len(folds), len(TARGETS)))
        for fold_index, (fit_idx, val_idx) in enumerate(folds):
            fold_model = RandomForestRegressor(n_estimators=60, min_samples_leaf=2, random_state=seed, n_jobs=1)
            fold_model.fit(x_train[fit_idx], y_train[fit_idx])
            fold_pred = fold_model.predict(x_train[val_idx])
            for t in range(len(TARGETS)):
                cv_scores[fold_index, t] = r2_score(y_train[val_idx, t], fold_pred[:, t])

        test_metrics: dict[str, dict[str, float]] = {}
        for t, target in enumerate(TARGETS):
            actual = y_test[:, t]
            baseline = np.full_like(actual, y_train[:, t].mean())
            test_metrics[target] = {
                "mae": float(mean_absolute_error(actual, predicted[:, t])),
                "rmse": float(np.sqrt(mean_squared_error(actual, predicted[:, t]))),
                "r2": float(r2_score(actual, predicted[:, t])),
                "baseline_mae": float(mean_absolute_error(actual, baseline)),
                "cv_r2_mean": float(cv_scores[:, t].mean()),
                "cv_r2_std": float(cv_scores[:, t].std()),
            }

        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        record = MlModel(
            algorithm=ALGORITHM,
            n_samples=int(len(x)),
            n_test=int(len(x_test)),
            metrics={"test": test_metrics},
            meta={
                "features": FEATURES,
                "targets": TARGETS,
                "target_labels": TARGET_LABELS,
                "disclaimer": DISCLAIMER,
                "assumptions": assumptions,
                "feature_ranges": {
                    name: [float(x[:, i].min()), float(x[:, i].max())] for i, name in enumerate(FEATURES)
                },
            },
            file_path="",
        )
        db.add(record)
        db.flush()
        path = MODEL_DIR / f"model_{record.id}.joblib"
        joblib.dump(forest, path)
        record.file_path = str(path)
        db.commit()
        db.refresh(record)
        return record


def latest_model(db: Session) -> MlModel | None:
    return db.scalars(select(MlModel).order_by(MlModel.id.desc()).limit(1)).first()


def ensure_model(db: Session) -> MlModel:
    record = latest_model(db)
    if record and Path(record.file_path).exists():
        return record
    return train(db)


def model_to_dict(record: MlModel | None) -> dict | None:
    if record is None:
        return None
    from ..models import iso

    return {
        "id": record.id,
        "algorithm": record.algorithm,
        "n_samples": record.n_samples,
        "n_test": record.n_test,
        "metrics": record.metrics,
        "target_labels": record.meta.get("target_labels", TARGET_LABELS),
        "disclaimer": record.meta.get("disclaimer", DISCLAIMER),
        "features": record.meta.get("features", FEATURES),
        "created_at": iso(record.created_at),
    }


def predict(record: MlModel, params: dict[str, float]) -> dict[str, Any]:
    forest: RandomForestRegressor = joblib.load(record.file_path)
    vector = np.array([[float(params[name]) for name in FEATURES]])
    per_tree = np.array([tree.predict(vector)[0] for tree in forest.estimators_])  # (trees, targets)
    mean = per_tree.mean(axis=0)
    low = np.percentile(per_tree, 10, axis=0)
    high = np.percentile(per_tree, 90, axis=0)

    ranges = record.meta.get("feature_ranges", {})
    out_of_range = [
        name
        for name in FEATURES
        if name in ranges and not (ranges[name][0] - 1e-9 <= float(params[name]) <= ranges[name][1] + 1e-9)
    ]
    return {
        "predicted": {t: round(float(mean[i]), 3) for i, t in enumerate(TARGETS)},
        "low": {t: round(float(low[i]), 3) for i, t in enumerate(TARGETS)},
        "high": {t: round(float(high[i]), 3) for i, t in enumerate(TARGETS)},
        "out_of_range": out_of_range,
    }
