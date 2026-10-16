"""Monte Carlo simulation of a disruption on a single-stage production / service system.

The model is intentionally small and transparent. Each simulated day:

* demand arrives (baseline x noise x scenario demand shock),
* capacity is available (baseline x scenario capacity shock),
* work is produced up to capacity, the remainder joins a backlog,
* backlog beyond ``max_backlog_days`` of demand is abandoned (unmet demand),
* profit = produced x (price - unit cost) - fixed cost - overtime - backlog holding cost.

The scenario run and the baseline run share the same random draws (common random
numbers), so the difference between them is caused by the scenario, not by luck.
Everything is expressed in index units unless the user provides a unit value.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

SHOCK_START_DAY = 10

PARAMETER_LIMITS: dict[str, tuple[float, float]] = {
    "demand_change_pct": (-100, 300),
    "capacity_change_pct": (-100, 300),
    "cost_change_pct": (-100, 300),
    "duration_days": (1, 90),
    "recovery_days": (0, 60),
    "probability": (0, 1),
    "volatility": (0, 1),
}
INTEGER_PARAMETERS = {"duration_days", "recovery_days"}

DEFAULT_PARAMETERS: dict[str, float] = {
    "demand_change_pct": 0,
    "capacity_change_pct": 0,
    "cost_change_pct": 0,
    "duration_days": 14,
    "recovery_days": 7,
    "probability": 0.3,
    "volatility": 0.2,
}

# name -> (default, minimum, maximum, description)
ASSUMPTION_FIELDS: dict[str, tuple[Any, float | None, float | None, str]] = {
    "horizon_days": (90, 30, 365, "Length of the simulated period in days."),
    "iterations": (200, 20, 1000, "Number of Monte Carlo runs. More runs give smoother percentiles."),
    "baseline_daily_demand": (100, 1, 1_000_000, "Units of work arriving per day with no disruption."),
    "capacity_headroom": (0.25, 0, 3, "Spare capacity as a share of demand (0.25 = capacity is 125% of demand)."),
    "unit_price": (10, 0.01, 1_000_000, "Revenue per unit produced."),
    "unit_cost": (6, 0, 1_000_000, "Variable cost per unit produced."),
    "fixed_cost_per_day": (150, 0, 100_000_000, "Daily cost that does not depend on output."),
    "demand_noise": (0.08, 0, 1, "Day-to-day demand variation (standard deviation as a share of demand)."),
    "overtime_threshold": (0.95, 0.5, 1, "Utilisation above which work is done at overtime cost."),
    "overtime_cost_multiplier": (1.5, 1, 5, "Cost multiplier applied to overtime work."),
    "backlog_cost_per_unit_day": (0.4, 0, 1000, "Penalty per unit of work waiting in the backlog per day."),
    "max_backlog_days": (5, 0, 60, "Days of demand the backlog can hold before work is abandoned."),
    "seed": (42, 0, 2_147_483_647, "Random seed; the same inputs always give the same results."),
    "currency": ("index units", None, None, "Label for monetary values."),
}

DEFAULT_ASSUMPTIONS: dict[str, Any] = {name: spec[0] for name, spec in ASSUMPTION_FIELDS.items()}
INTEGER_ASSUMPTIONS = {"horizon_days", "iterations", "seed", "max_backlog_days"}


class ValidationError(ValueError):
    """Raised for out-of-range parameters or assumptions; ``fields`` maps field name to message."""

    def __init__(self, fields: dict[str, str]):
        super().__init__("; ".join(f"{name}: {message}" for name, message in fields.items()))
        self.fields = fields


def normalise_parameters(values: dict[str, Any] | None, base: dict[str, Any] | None = None) -> dict[str, float]:
    merged = {**DEFAULT_PARAMETERS, **(base or {}), **(values or {})}
    errors: dict[str, str] = {}
    result: dict[str, float] = {}
    for name, (low, high) in PARAMETER_LIMITS.items():
        try:
            number = float(merged[name])
        except (TypeError, ValueError):
            errors[name] = "must be a number"
            continue
        if not np.isfinite(number) or number < low or number > high:
            errors[name] = f"must be between {low:g} and {high:g}"
        elif name in INTEGER_PARAMETERS and not float(number).is_integer():
            errors[name] = "must be a whole number"
        else:
            result[name] = int(number) if name in INTEGER_PARAMETERS else round(number, 4)
    if errors:
        raise ValidationError(errors)
    return result


def normalise_assumptions(values: dict[str, Any] | None, base: dict[str, Any] | None = None) -> dict[str, Any]:
    merged = {**DEFAULT_ASSUMPTIONS, **(base or {}), **(values or {})}
    errors: dict[str, str] = {}
    result: dict[str, Any] = {}
    for name, (default, low, high, _description) in ASSUMPTION_FIELDS.items():
        value = merged.get(name, default)
        if name == "currency":
            text = str(value).strip()
            result[name] = text[:30] or default
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            errors[name] = "must be a number"
            continue
        if not np.isfinite(number) or number < low or number > high:
            errors[name] = f"must be between {low:g} and {high:g}"
        else:
            result[name] = int(round(number)) if name in INTEGER_ASSUMPTIONS else number
    unknown = set(values or {}) - set(ASSUMPTION_FIELDS)
    for name in unknown:
        errors[name] = "is not a known assumption"
    if errors:
        raise ValidationError(errors)
    return result


def assumption_field_info() -> list[dict[str, Any]]:
    return [
        {"name": name, "default": default, "minimum": low, "maximum": high, "description": description}
        for name, (default, low, high, description) in ASSUMPTION_FIELDS.items()
    ]


@dataclass
class SimulationOutput:
    metrics: dict[str, Any]
    timeseries: dict[str, list[float]]
    distribution: list[float]
    summary_stats: dict[str, float]


def _shock_profile(horizon: int, duration: int, recovery: int) -> np.ndarray:
    """Share of the shock that is active on each day: 1 during the event, fading linearly after it."""
    days = np.arange(horizon)
    start = SHOCK_START_DAY
    profile = np.zeros(horizon)
    during = (days >= start) & (days < start + duration)
    profile[during] = 1.0
    if recovery > 0:
        fading = (days >= start + duration) & (days < start + duration + recovery)
        profile[fading] = 1.0 - (days[fading] - (start + duration) + 1) / (recovery + 1)
    return profile


def _run(
    noise: np.ndarray,
    magnitude: np.ndarray,
    profile: np.ndarray,
    params: dict[str, float],
    a: dict[str, Any],
    shocked: bool,
) -> dict[str, np.ndarray]:
    """Simulate ``noise.shape[0]`` independent runs; returns per-day arrays shaped (runs, days)."""
    runs, horizon = noise.shape
    base_demand = float(a["baseline_daily_demand"])
    base_capacity = base_demand * (1 + float(a["capacity_headroom"]))
    max_backlog = float(a["max_backlog_days"]) * base_demand
    price, unit_cost, fixed = float(a["unit_price"]), float(a["unit_cost"]), float(a["fixed_cost_per_day"])
    threshold, overtime_mult = float(a["overtime_threshold"]), float(a["overtime_cost_multiplier"])
    backlog_cost = float(a["backlog_cost_per_unit_day"])

    backlog = np.zeros(runs)
    out = {key: np.zeros((runs, horizon)) for key in ("demand", "capacity", "produced", "backlog", "lost", "profit", "cost", "util")}
    for day in range(horizon):
        intensity = magnitude * profile[day] if shocked else np.zeros(runs)
        demand = base_demand * noise[:, day] * np.clip(1 + params["demand_change_pct"] / 100 * intensity, 0, None)
        capacity = base_capacity * np.clip(1 + params["capacity_change_pct"] / 100 * intensity, 0, None)
        cost_factor = np.clip(1 + params["cost_change_pct"] / 100 * intensity, 0, None)

        available = backlog + demand
        produced = np.minimum(capacity, available)
        backlog = available - produced
        lost = np.clip(backlog - max_backlog, 0, None)
        backlog = backlog - lost

        util = np.divide(produced, capacity, out=np.zeros(runs), where=capacity > 0)
        overtime_units = np.clip(util - threshold, 0, None) * capacity
        variable = produced * unit_cost * cost_factor + overtime_units * unit_cost * cost_factor * (overtime_mult - 1)
        holding = backlog * backlog_cost
        total_cost = variable + holding + fixed
        profit = produced * price - total_cost

        out["demand"][:, day] = demand
        out["capacity"][:, day] = capacity
        out["produced"][:, day] = produced
        out["backlog"][:, day] = backlog
        out["lost"][:, day] = lost
        out["profit"][:, day] = profit
        out["cost"][:, day] = total_cost
        out["util"][:, day] = np.clip(util, 0, 1)
    return out


def _pct_change(new: np.ndarray, old: np.ndarray) -> np.ndarray:
    denominator = np.where(np.abs(old) < 1e-9, 1e-9, np.abs(old))
    return (new - old) / denominator * 100


def _round(values: np.ndarray, digits: int = 2) -> list[float]:
    return [round(float(v), digits) for v in values]


def simulate(params: dict[str, float], assumptions: dict[str, Any], seed_offset: int = 0) -> SimulationOutput:
    """Run the scenario and its baseline with shared random draws and summarise the outcome."""
    a = assumptions
    runs, horizon = int(a["iterations"]), int(a["horizon_days"])
    rng = np.random.default_rng(int(a["seed"]) + seed_offset)

    noise = np.clip(1 + rng.normal(0.0, float(a["demand_noise"]), size=(runs, horizon)), 0.2, None)
    # Per-run severity of the shock: the scenario's uncertainty widens or narrows the realised impact.
    magnitude = np.clip(1 + rng.normal(0.0, params["volatility"] * 0.5, size=runs), 0.0, 3.0)
    profile = _shock_profile(horizon, int(params["duration_days"]), int(params["recovery_days"]))

    base = _run(noise, magnitude, profile, params, a, shocked=False)
    scen = _run(noise, magnitude, profile, params, a, shocked=True)

    base_demand = float(a["baseline_daily_demand"])
    base_capacity = base_demand * (1 + float(a["capacity_headroom"]))

    base_profit = base["profit"].sum(axis=1)
    scen_profit = scen["profit"].sum(axis=1)
    profit_change = _pct_change(scen_profit, base_profit)
    base_cost = base["cost"].sum(axis=1)
    scen_cost = scen["cost"].sum(axis=1)
    cost_change = _pct_change(scen_cost, base_cost)

    total_demand = scen["demand"].sum(axis=1)
    unmet = np.divide(scen["lost"].sum(axis=1), total_demand, out=np.zeros(runs), where=total_demand > 0) * 100
    delay_days = scen["backlog"] / base_capacity
    avg_delay = delay_days.mean(axis=1)
    peak_delay = delay_days.max(axis=1)
    peak_util = scen["util"].max(axis=1) * 100
    avg_util = scen["util"].mean(axis=1) * 100
    base_avg_util = base["util"].mean(axis=1) * 100
    overload = (scen["util"] > float(a["overtime_threshold"])).sum(axis=1).astype(float)
    # Extra daily capacity (as % of baseline) that would have prevented the unserved demand.
    capacity_gap = np.clip((scen["demand"].max(axis=1) - scen["capacity"].min(axis=1)) / base_capacity * 100, 0, None)
    capacity_gap = np.where(unmet > 0.01, capacity_gap, 0.0)

    def pct(values: np.ndarray, q: float) -> float:
        return float(np.percentile(values, q))

    def case(values: np.ndarray, high_is_bad: bool) -> tuple[float, float, float]:
        worst, best = (95, 5) if high_is_bad else (5, 95)
        return pct(values, worst), float(values.mean()), pct(values, best)

    rows = {
        "profit_change_pct": (profit_change, False),
        "cost_change_pct": (cost_change, True),
        "total_cost": (scen_cost, True),
        "avg_delay_days": (avg_delay, True),
        "peak_delay_days": (peak_delay, True),
        "unmet_demand_pct": (unmet, True),
        "peak_utilization_pct": (peak_util, True),
        "overload_days": (overload, True),
        "capacity_gap_pct": (capacity_gap, True),
    }
    worst_case, average, best_case = {}, {}, {}
    for key, (values, high_is_bad) in rows.items():
        worst, mean, best = case(values, high_is_bad)
        worst_case[key], average[key], best_case[key] = round(worst, 3), round(mean, 3), round(best, 3)

    probability = params["probability"]
    mean_profit_loss = max(0.0, float(base_profit.mean() - scen_profit.mean()))
    metrics = {
        "currency": a["currency"],
        "horizon_days": horizon,
        "profit_change_pct": round(float(profit_change.mean()), 3),
        "profit_change_p5": round(pct(profit_change, 5), 3),
        "profit_change_p50": round(pct(profit_change, 50), 3),
        "profit_change_p95": round(pct(profit_change, 95), 3),
        "cost": {
            "baseline_total": round(float(base_cost.mean()), 2),
            "scenario_total": round(float(scen_cost.mean()), 2),
            "change_pct": round(float(cost_change.mean()), 3),
            "expected_financial_loss": round(probability * mean_profit_loss, 2),
            "financial_loss_if_it_occurs": round(mean_profit_loss, 2),
        },
        "delay": {
            "avg_days": round(float(avg_delay.mean()), 3),
            "peak_days": round(float(peak_delay.mean()), 3),
            "worst_case_peak_days": round(pct(peak_delay, 95), 3),
        },
        "service_level_pct": round(100 - float(unmet.mean()), 3),
        "unmet_demand_pct": round(float(unmet.mean()), 3),
        "resources": {
            "avg_utilization_pct": round(float(avg_util.mean()), 2),
            "baseline_avg_utilization_pct": round(float(base_avg_util.mean()), 2),
            "peak_utilization_pct": round(float(peak_util.mean()), 2),
            "overload_days": round(float(overload.mean()), 1),
            "capacity_gap_pct": round(float(capacity_gap.mean()), 2),
        },
        "worst_case": worst_case,
        "average": average,
        "best_case": best_case,
    }

    order = np.argsort(scen_profit)
    worst_index, best_index = order[max(0, int(0.05 * runs) - 1)], order[min(runs - 1, int(0.95 * runs))]
    cum_scen_profit = np.cumsum(scen["profit"], axis=1)
    timeseries = {
        "days": list(range(1, horizon + 1)),
        "baseline_output": _round(base["produced"].mean(axis=0)),
        "scenario_output": _round(scen["produced"].mean(axis=0)),
        "scenario_output_p10": _round(np.percentile(scen["produced"], 10, axis=0)),
        "scenario_output_p90": _round(np.percentile(scen["produced"], 90, axis=0)),
        "baseline_profit": _round(base["profit"].mean(axis=0)),
        "scenario_profit": _round(scen["profit"].mean(axis=0)),
        "average_cumulative_profit": _round(cum_scen_profit.mean(axis=0)),
        "best_case_cumulative_profit": _round(cum_scen_profit[best_index]),
        "worst_case_cumulative_profit": _round(cum_scen_profit[worst_index]),
        "scenario_backlog": _round(scen["backlog"].mean(axis=0)),
        "scenario_backlog_p90": _round(np.percentile(scen["backlog"], 90, axis=0)),
        "baseline_utilization_pct": _round(base["util"].mean(axis=0) * 100, 1),
        "scenario_utilization_pct": _round(scen["util"].mean(axis=0) * 100, 1),
    }

    return SimulationOutput(
        metrics=metrics,
        timeseries=timeseries,
        distribution=_round(profit_change, 2),
        summary_stats={
            "profit_change_pct": float(profit_change.mean()),
            "total_cost_change_pct": float(cost_change.mean()),
            "avg_delay_days": float(avg_delay.mean()),
            "unmet_demand_pct": float(unmet.mean()),
            "peak_utilization_pct": float(peak_util.mean()),
            "total_profit": float(scen_profit.mean()),
            "expected_financial_loss": metrics["cost"]["expected_financial_loss"],
        },
    )


def fast_outcomes(params: dict[str, float], assumptions: dict[str, Any]) -> dict[str, float]:
    """The four headline outcomes the ML surrogate learns, with fewer runs for speed."""
    reduced = {**assumptions, "iterations": min(int(assumptions["iterations"]), 40)}
    return simulate(params, reduced).summary_stats


# --- risk assessment ---------------------------------------------------------------------------

IMPACT_SCALE = 1.5
RISK_LEVELS = ((15, "low"), (30, "medium"), (50, "high"))

MITIGATIONS = {
    "demand": [
        "Agree flexible capacity (temporary staff, shifts, subcontractors) that can be activated within days.",
        "Keep a buffer stock of the fastest-moving items and review reorder points monthly.",
        "Segment customers and prioritise the contracts with the highest margin during peaks.",
    ],
    "supply_chain": [
        "Qualify at least one alternative supplier for each critical input.",
        "Hold safety stock for long-lead items and review it against supplier lead-time variance.",
        "Add contractual delivery penalties and early-warning reporting from key suppliers.",
    ],
    "operations": [
        "Move from time-based to condition-based maintenance on the bottleneck equipment.",
        "Document and rehearse a manual or degraded-mode procedure for the critical process.",
        "Stock critical spares on site and agree service-level terms with the equipment vendor.",
    ],
    "workforce": [
        "Cross-train staff on the bottleneck steps so absence does not stop the flow.",
        "Maintain a call-off list of temporary or agency workers with pre-approved onboarding.",
        "Review shift patterns and overtime limits to avoid burnout during extended events.",
    ],
    "financial": [
        "Hedge or index the largest cost exposures where contracts allow it.",
        "Secure a committed credit line sized to cover the downside case.",
        "Review pricing clauses so cost increases can be passed through with a short delay.",
    ],
    "regulatory": [
        "Assign an owner to track upcoming regulation and brief leadership quarterly.",
        "Run a gap assessment now and budget remediation before the deadline.",
        "Keep audit evidence current so inspections do not interrupt operations.",
    ],
    "technology": [
        "Maintain tested offline backups and an incident-response runbook with named roles.",
        "Segment networks and enforce multi-factor authentication on operational systems.",
        "Define a recovery-time objective for each critical application and test it twice a year.",
    ],
    "external": [
        "Maintain a business-continuity plan with alternative sites and communication trees.",
        "Review insurance coverage against the downside case, including business interruption.",
        "Diversify sourcing and routing so a single region or route cannot stop operations.",
    ],
    "opportunity": [
        "Pre-approve a capacity and working-capital plan so the upside can be captured quickly.",
        "Define the trigger metrics that start the investment, and review them monthly.",
        "Pilot on a small scale first to confirm the unit economics before committing fully.",
    ],
}
MITIGATIONS["logistics"] = MITIGATIONS["supply_chain"]


def risk_level_for(score: float) -> str:
    for threshold, level in RISK_LEVELS:
        if score < threshold:
            return level
    return "critical"


def severity_for(params: dict[str, float]) -> tuple[str, float]:
    """Category and 0-100 score describing how large the modelled shock is."""
    magnitude = max(abs(params["demand_change_pct"]), abs(params["capacity_change_pct"]), abs(params["cost_change_pct"]))
    reach = min(1.0, (params["duration_days"] + params["recovery_days"] / 2) / 45)
    score = min(100.0, magnitude * (0.5 + 0.5 * reach) * 1.25)
    if score < 20:
        return "low", score
    if score < 45:
        return "moderate", score
    if score < 70:
        return "high", score
    return "critical", score


def assess(output: SimulationOutput, params: dict[str, float], category: str) -> tuple[float, dict[str, Any]]:
    """Return (impact_score, risk_analysis) for a simulation."""
    m = output.metrics
    profit = m["profit_change_pct"]
    strain = max(0.0, m["resources"]["avg_utilization_pct"] - m["resources"].get("baseline_avg_utilization_pct", 0.0))
    other = {
        "service": min(100.0, m["unmet_demand_pct"] * 8.0),
        "delay": min(100.0, m["delay"]["avg_days"] * 25.0),
        "capacity": min(100.0, strain * 5.0),
        "cost": min(100.0, abs(m["cost"]["change_pct"]) * 5.0),
    }
    # `impact` measures the size of the swing (gains included); the risk score only counts downside.
    factor_values = {"financial": min(100.0, abs(profit) * 1.4), **other}
    downside_values = {"financial": min(100.0, max(0.0, -profit) * 1.4), **other}
    weights = {"financial": 0.35, "service": 0.25, "delay": 0.15, "capacity": 0.10, "cost": 0.15}
    descriptions = {
        "financial": f"Average profit change of {m['profit_change_pct']:+.1f}% over the horizon",
        "service": f"{m['unmet_demand_pct']:.1f}% of demand not served",
        "delay": f"Orders wait {m['delay']['avg_days']:.2f} days on average",
        "capacity": (
            f"Average utilisation {m['resources']['avg_utilization_pct']:.0f}% "
            f"(baseline {m['resources'].get('baseline_avg_utilization_pct', 0):.0f}%)"
        ),
        "cost": f"Total cost changes by {m['cost']['change_pct']:+.1f}%",
    }
    names = {
        "financial": "Profit loss",
        "service": "Unserved demand",
        "delay": "Order delay",
        "capacity": "Capacity strain",
        "cost": "Cost increase",
    }
    weighted = {key: weights[key] * factor_values[key] for key in weights}
    impact = round(min(100.0, sum(weighted.values()) * IMPACT_SCALE), 2)
    total = sum(weighted.values()) or 1.0
    downside = min(100.0, sum(weights[key] * downside_values[key] for key in weights) * IMPACT_SCALE)

    probability = params["probability"]
    risk_score = round(downside * (0.4 + 0.6 * probability), 2)
    level = risk_level_for(risk_score)
    _severity_label, severity_score = severity_for(params)
    financial = round(factor_values["financial"] * 0.7 + factor_values["cost"] * 0.3, 2)
    operational = round((factor_values["service"] + factor_values["delay"] + factor_values["capacity"]) / 3, 2)

    factors = [
        {
            "name": names[key],
            "description": descriptions[key],
            "value": round(factor_values[key], 1),
            "weight": weights[key],
            "contribution": round(weighted[key] / total * 100, 1),
        }
        for key in sorted(weights, key=lambda k: weighted[k], reverse=True)
    ]
    main = factors[0]
    summary = (
        f"{level.capitalize()} risk (score {risk_score:.0f}/100): impact {impact:.0f}/100 with a "
        f"{probability * 100:.0f}% likelihood. The largest driver is {main['name'].lower()} ({main['contribution']:.0f}% of the impact)."
    )
    analysis = {
        "risk_level": level,
        "risk_score": risk_score,
        "probability": probability,
        "impact": impact,
        "severity": round(severity_score, 1),
        "financial_impact": financial,
        "operational_impact": operational,
        "summary": summary,
        "factors": factors,
        "mitigations": list(MITIGATIONS.get(category, MITIGATIONS["external"])),
    }
    return impact, analysis


def summarise(title: str, output: SimulationOutput, analysis: dict[str, Any]) -> str:
    m = output.metrics
    return (
        f"Across {len(output.distribution)} simulated runs of {m['horizon_days']} days, \"{title}\" changes profit by "
        f"{m['profit_change_pct']:+.1f}% on average (worst case {m['profit_change_p5']:+.1f}%, best case "
        f"{m['profit_change_p95']:+.1f}%). Service level falls to {m['service_level_pct']:.1f}%, orders wait "
        f"{m['delay']['avg_days']:.2f} days on average, and peak utilisation reaches "
        f"{m['resources']['peak_utilization_pct']:.0f}%."
    )
