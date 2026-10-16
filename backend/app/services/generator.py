"""Rule-based what-if scenario generation, validation and combination.

Scenarios are built from a library of disruption templates. Each template carries a
plausible parameter range; the system description decides which templates are most
relevant and a seeded random generator picks concrete values inside those ranges, so the
same system always produces the same first set of scenarios.
"""

from __future__ import annotations

import hashlib
import random
import re
from dataclasses import dataclass, field
from typing import Any

from .simulator import (
    DEFAULT_ASSUMPTIONS,
    PARAMETER_LIMITS,
    INTEGER_PARAMETERS,
    severity_for,
)

Range = tuple[float, float]


@dataclass(frozen=True)
class Template:
    key: str
    category: str
    title: str
    what_if: str
    effect: str
    triggers: tuple[str, ...]
    consequences: tuple[str, ...]
    resources: tuple[str, ...]
    keywords: tuple[str, ...]
    demand: Range = (0, 0)
    capacity: Range = (0, 0)
    cost: Range = (0, 0)
    duration: Range = (14, 30)
    recovery: Range = (7, 21)
    probability: Range = (0.1, 0.3)
    volatility: Range = (0.2, 0.4)
    potential_cost: int = 3
    operational_impact: int = 3
    assumptions: tuple[str, ...] = field(default_factory=tuple)


TEMPLATES: tuple[Template, ...] = (
    Template(
        "demand_surge", "demand", "Sudden demand surge",
        "What if demand for {system}'s output jumps sharply within a few weeks?",
        "Orders arrive faster than the current capacity can absorb, so backlog and lead times grow.",
        ("Viral demand or a large promotional campaign", "A competitor exits the market or fails to deliver"),
        ("Backlog builds and delivery times lengthen", "Overtime and expediting costs rise", "Service level falls for lower-priority customers"),
        ("Temporary staff or shifts", "Spare machine or service capacity", "Raw-material buffer stock"),
        ("order", "customer", "retail", "e-commerce", "seasonal", "sales", "demand", "product", "consumer", "food"),
        demand=(25, 60), cost=(0, 5), duration=(14, 30), recovery=(7, 21), probability=(0.15, 0.35), volatility=(0.3, 0.5),
        potential_cost=3, operational_impact=4,
        assumptions=("The extra demand is real and arrives with little notice.", "No extra capacity is added during the event."),
    ),
    Template(
        "demand_slump", "demand", "Prolonged demand slump",
        "What if demand for {system}'s output falls well below plan for an extended period?",
        "Fixed costs are spread over fewer units, so margins shrink while capacity sits idle.",
        ("Economic downturn", "Loss of share to a substitute product or service"),
        ("Revenue and margin decline", "Utilisation falls and fixed costs are under-recovered", "Pressure to cut staff or investment"),
        ("Marketing budget", "Flexible-cost contracts", "Cash reserves"),
        ("demand", "market", "customer", "sales", "revenue", "retail", "consumer", "subscription"),
        demand=(-45, -20), duration=(30, 60), recovery=(20, 40), probability=(0.2, 0.4), volatility=(0.2, 0.4),
        potential_cost=4, operational_impact=2,
        assumptions=("Prices are held; the lost volume is not recovered by discounting.",),
    ),
    Template(
        "key_customer_loss", "demand", "Loss of a key customer",
        "What if the largest customer of {system} reduces or ends its orders?",
        "A concentrated share of demand disappears and the fixed cost base must be carried by the rest.",
        ("Contract not renewed", "Customer insources or switches supplier"),
        ("Step change in volume", "Idle capacity and under-absorbed overhead", "Urgent need to win replacement business"),
        ("Sales and account-management effort", "Pipeline of alternative customers"),
        ("customer", "contract", "b2b", "client", "account", "supplier", "services"),
        demand=(-35, -15), duration=(60, 90), recovery=(30, 60), probability=(0.1, 0.25), volatility=(0.15, 0.3),
        potential_cost=4, operational_impact=2,
    ),
    Template(
        "supplier_failure", "supply_chain", "Critical supplier failure",
        "What if a critical supplier of {system} cannot deliver for several weeks?",
        "Inputs run short, so production slows or stops until an alternative source is in place.",
        ("Supplier insolvency or plant shutdown", "Export restrictions or sanctions on a key input"),
        ("Output constrained by missing inputs", "Expedited alternative sourcing at a premium", "Late deliveries to customers"),
        ("Alternative supplier qualified in advance", "Safety stock of long-lead items"),
        ("supplier", "supply", "raw material", "component", "parts", "inventory", "procurement", "manufactur", "input"),
        capacity=(-45, -20), cost=(5, 15), duration=(10, 25), recovery=(7, 21), probability=(0.15, 0.3), volatility=(0.3, 0.5),
        potential_cost=4, operational_impact=5,
        assumptions=("There is no qualified second source for the affected input.",),
    ),
    Template(
        "material_price_spike", "supply_chain", "Input price spike",
        "What if the price of the main inputs of {system} rises sharply?",
        "Unit costs climb faster than prices can be adjusted, squeezing the margin on every unit.",
        ("Commodity market shock", "Tariffs or new levies on imported inputs"),
        ("Variable cost per unit rises", "Margin compression", "Customers resist price pass-through"),
        ("Hedging or forward contracts", "Price-adjustment clauses", "Substitute inputs"),
        ("material", "commodity", "price", "cost", "steel", "fuel", "energy", "manufactur", "agricultur", "food"),
        cost=(15, 40), duration=(30, 60), recovery=(15, 30), probability=(0.25, 0.45), volatility=(0.25, 0.45),
        potential_cost=4, operational_impact=2,
    ),
    Template(
        "logistics_disruption", "supply_chain", "Logistics and transport disruption",
        "What if inbound or outbound transport for {system} is disrupted for one to three weeks?",
        "Goods and materials do not move on schedule, delaying production and deliveries.",
        ("Port congestion or border closure", "Carrier capacity shortage or road closure"),
        ("Delayed receipt of inputs", "Late customer deliveries", "Higher freight and storage costs"),
        ("Alternative carriers or routes", "Local stock buffers"),
        ("logistic", "transport", "shipping", "freight", "delivery", "warehouse", "distribution", "fleet", "port"),
        demand=(-10, 0), capacity=(-30, -10), cost=(8, 20), duration=(7, 21), recovery=(7, 14), probability=(0.2, 0.4), volatility=(0.25, 0.4),
        potential_cost=3, operational_impact=4,
    ),
    Template(
        "equipment_failure", "operations", "Critical equipment breakdown",
        "What if the main production equipment at {system} breaks down unexpectedly?",
        "The bottleneck resource is unavailable, so throughput drops until it is repaired or replaced.",
        ("Component wear-out", "Missed preventive maintenance", "Power surge damaging key assets"),
        ("Throughput falls sharply", "Emergency repair costs", "Quality problems on restart"),
        ("Critical spare parts", "Maintenance team or vendor support", "Back-up equipment"),
        ("machine", "equipment", "plant", "factory", "production", "line", "assembly", "manufactur", "mill", "turbine"),
        capacity=(-60, -30), cost=(5, 15), duration=(5, 15), recovery=(3, 10), probability=(0.25, 0.45), volatility=(0.3, 0.5),
        potential_cost=4, operational_impact=5,
        assumptions=("Repair requires parts or vendor support that are not immediately on site.",),
    ),
    Template(
        "quality_incident", "operations", "Quality incident or recall",
        "What if a quality defect forces {system} to rework output or issue a recall?",
        "Output is quarantined and reworked while customers lose confidence and some orders are cancelled.",
        ("Defective batch reaches customers", "Process drift goes undetected"),
        ("Rework and scrap costs", "Customer cancellations", "Reputation damage"),
        ("Quality-assurance staff", "Traceability records", "Customer-communication plan"),
        ("quality", "defect", "food", "pharma", "medical", "safety", "manufactur", "product", "recall"),
        demand=(-20, -8), capacity=(-25, -10), cost=(10, 25), duration=(14, 30), recovery=(14, 40), probability=(0.05, 0.15), volatility=(0.3, 0.5),
        potential_cost=5, operational_impact=4,
    ),
    Template(
        "process_bottleneck", "operations", "Process bottleneck under load",
        "What if a hidden bottleneck in {system} limits throughput as volumes rise?",
        "The slowest step caps output so queues grow in front of it while downstream steps sit idle.",
        ("Volume growth beyond the design capacity of one step", "Change in product mix"),
        ("Queues and longer lead times", "Idle downstream resources", "Overtime at the constrained step"),
        ("Process-engineering time", "Additional capacity at the bottleneck"),
        ("process", "workflow", "queue", "throughput", "backlog", "service", "operations", "clinic", "hospital", "call"),
        capacity=(-25, -10), cost=(3, 8), duration=(20, 45), recovery=(10, 25), probability=(0.3, 0.5), volatility=(0.2, 0.35),
        potential_cost=2, operational_impact=4,
    ),
    Template(
        "staff_shortage", "workforce", "Key staff shortage",
        "What if a large share of skilled staff at {system} is unavailable for several weeks?",
        "Roles that cannot be covered quickly limit how much work can be done each day.",
        ("Illness wave or seasonal absence", "Resignations in a critical team"),
        ("Reduced productive capacity", "Overtime and agency costs", "Higher error rates and safety risk"),
        ("Cross-trained staff", "Agency or temporary workers", "Documented procedures"),
        ("staff", "worker", "employee", "labour", "labor", "nurse", "team", "shift", "hospital", "service"),
        capacity=(-35, -15), cost=(5, 12), duration=(14, 40), recovery=(14, 30), probability=(0.3, 0.5), volatility=(0.25, 0.4),
        potential_cost=3, operational_impact=4,
    ),
    Template(
        "labour_dispute", "workforce", "Strike or labour dispute",
        "What if a labour dispute halts most work at {system}?",
        "Output falls to a fraction of normal levels for the duration and recovers slowly afterwards.",
        ("Failed wage negotiations", "Disputes at a supplier or carrier spreading to the site"),
        ("Near-stoppage of output", "Missed delivery commitments", "Lasting damage to labour relations"),
        ("Contingency staffing plan", "Negotiation support", "Pre-built inventory"),
        ("union", "strike", "labour", "labor", "worker", "factory", "port", "transport", "plant", "manufactur"),
        capacity=(-70, -40), cost=(3, 10), duration=(7, 21), recovery=(10, 30), probability=(0.05, 0.15), volatility=(0.3, 0.5),
        potential_cost=4, operational_impact=5,
    ),
    Template(
        "skills_attrition", "workforce", "Skilled-labour attrition",
        "What if experienced people leave {system} faster than they can be replaced?",
        "Experience is lost, productivity per head drops and hiring and training costs climb.",
        ("Competitor poaching", "Ageing workforce retiring", "Poor retention in a tight labour market"),
        ("Gradual capacity decline", "Higher recruitment and training spend", "Loss of tacit know-how"),
        ("Retention incentives", "Training capacity", "Knowledge-transfer programme"),
        ("skill", "engineer", "technician", "expert", "staff", "labour", "talent", "software", "specialist"),
        capacity=(-20, -8), cost=(8, 18), duration=(45, 90), recovery=(30, 60), probability=(0.2, 0.4), volatility=(0.2, 0.35),
        potential_cost=3, operational_impact=3,
    ),
    Template(
        "energy_price_shock", "financial", "Energy price shock",
        "What if energy prices for {system} rise sharply for a sustained period?",
        "Operating cost per unit increases, particularly for energy-intensive steps.",
        ("Gas or electricity market spike", "Loss of a fixed-price energy contract"),
        ("Higher variable costs", "Margin squeeze", "Pressure to curtail output"),
        ("Energy-efficiency measures", "Fixed-price contract or on-site generation"),
        ("energy", "power", "electric", "gas", "steel", "chemical", "plant", "data center", "cold", "utilities"),
        cost=(12, 30), duration=(30, 60), recovery=(20, 40), probability=(0.2, 0.4), volatility=(0.25, 0.45),
        potential_cost=4, operational_impact=2,
    ),
    Template(
        "credit_tightening", "financial", "Credit tightening and weaker demand",
        "What if financing becomes more expensive and customers cut spending around {system}?",
        "Higher borrowing costs raise the cost base while softer demand reduces volume.",
        ("Interest-rate rise", "Banks tightening lending standards"),
        ("Higher financing cost", "Customers delay orders", "Reduced room to invest"),
        ("Committed credit line", "Cash buffer", "Working-capital management"),
        ("loan", "credit", "finance", "debt", "capital", "bank", "invest", "construction", "real estate"),
        demand=(-10, -3), cost=(4, 10), duration=(60, 90), recovery=(30, 60), probability=(0.15, 0.3), volatility=(0.2, 0.3),
        potential_cost=3, operational_impact=2,
    ),
    Template(
        "currency_swing", "financial", "Adverse currency movement",
        "What if the exchange rate moves against {system} for an extended period?",
        "Imported inputs become more expensive while export revenue buys less.",
        ("Central-bank decision", "Geopolitical shock"),
        ("Higher input costs", "Weaker export margin", "Pricing uncertainty"),
        ("Currency hedging", "Local-currency contracts"),
        ("export", "import", "currency", "global", "international", "foreign", "trade", "overseas"),
        demand=(-5, 0), cost=(6, 15), duration=(45, 90), recovery=(30, 60), probability=(0.25, 0.4), volatility=(0.25, 0.4),
        potential_cost=3, operational_impact=2,
    ),
    Template(
        "regulatory_change", "regulatory", "New regulation or compliance burden",
        "What if new regulation forces {system} to change how it operates?",
        "Compliance work diverts capacity and adds recurring cost until processes are adapted.",
        ("New environmental, safety or data-protection rules", "Stricter enforcement of existing requirements"),
        ("Capacity diverted to compliance", "Added compliance cost", "Risk of fines if the deadline is missed"),
        ("Compliance specialist", "Budget for process or system changes"),
        ("regulat", "compliance", "law", "safety", "environment", "privacy", "health", "bank", "pharma", "licen"),
        capacity=(-15, -5), cost=(8, 20), duration=(30, 60), recovery=(30, 60), probability=(0.3, 0.55), volatility=(0.2, 0.35),
        potential_cost=3, operational_impact=3,
    ),
    Template(
        "audit_findings", "regulatory", "Adverse audit or inspection findings",
        "What if an inspection of {system} finds serious non-conformities?",
        "Part of the operation is restricted until corrective actions are verified.",
        ("Unannounced inspection", "Customer or certification-body audit"),
        ("Operations restricted during remediation", "Corrective-action cost", "Risk of losing certification"),
        ("Quality and compliance team", "Corrective-action budget"),
        ("audit", "certif", "inspection", "iso", "quality", "safety", "pharma", "food", "regulat"),
        capacity=(-20, -8), cost=(5, 12), duration=(10, 25), recovery=(10, 20), probability=(0.15, 0.3), volatility=(0.2, 0.35),
        potential_cost=3, operational_impact=3,
    ),
    Template(
        "cyber_attack", "technology", "Cyber attack",
        "What if a cyber attack takes critical systems at {system} offline?",
        "Digital systems that coordinate work are unavailable, so operations fall back to slow manual workarounds.",
        ("Ransomware", "Compromised supplier or credential", "Targeted denial-of-service"),
        ("Operations stop or slow sharply", "Recovery and forensic costs", "Customer and regulator notification"),
        ("Offline backups", "Incident-response team", "Manual fallback procedures"),
        ("software", "digital", "data", "online", "platform", "cloud", "it ", "saas", "network", "bank", "e-commerce"),
        demand=(-10, 0), capacity=(-70, -35), cost=(10, 25), duration=(5, 14), recovery=(7, 30), probability=(0.1, 0.25), volatility=(0.3, 0.5),
        potential_cost=5, operational_impact=5,
    ),
    Template(
        "it_outage", "technology", "Major IT system outage",
        "What if the core IT system behind {system} is unavailable for a few days?",
        "Orders and scheduling cannot be processed normally, so work queues up.",
        ("Failed software release", "Data-centre or cloud-region outage"),
        ("Work cannot be scheduled or recorded", "Backlog after recovery", "Customer complaints"),
        ("Redundant systems", "On-call engineering", "Manual process for critical steps"),
        ("software", "system", "digital", "online", "platform", "cloud", "erp", "it ", "service"),
        capacity=(-50, -25), cost=(2, 6), duration=(2, 7), recovery=(2, 7), probability=(0.3, 0.5), volatility=(0.25, 0.4),
        potential_cost=3, operational_impact=4,
    ),
    Template(
        "natural_disaster", "external", "Natural disaster or severe weather",
        "What if a flood, storm or fire disrupts the site or region of {system}?",
        "Physical access, utilities or buildings are affected, stopping most work for a period.",
        ("Extreme weather", "Fire or flood at the site or a key partner"),
        ("Operations stop at the affected site", "Repair and relocation costs", "Long recovery of normal output"),
        ("Business-continuity plan", "Insurance cover", "Alternative site"),
        ("site", "plant", "warehouse", "farm", "agricultur", "construction", "outdoor", "coastal", "weather"),
        demand=(-25, -10), capacity=(-80, -40), cost=(10, 25), duration=(10, 30), recovery=(20, 60), probability=(0.03, 0.1), volatility=(0.35, 0.5),
        potential_cost=5, operational_impact=5,
    ),
    Template(
        "health_emergency", "external", "Public-health emergency",
        "What if a health emergency restricts people and movement around {system}?",
        "Staff availability and demand patterns change at the same time, with new safety requirements.",
        ("Pandemic or local outbreak", "Public-health restrictions"),
        ("Reduced staff availability", "Demand shifts", "Extra safety costs"),
        ("Remote-work capability", "Protective measures", "Flexible staffing"),
        ("health", "hospital", "clinic", "staff", "retail", "hospitality", "travel", "service", "care"),
        demand=(-20, 5), capacity=(-35, -15), cost=(4, 10), duration=(30, 70), recovery=(30, 60), probability=(0.05, 0.12), volatility=(0.3, 0.5),
        potential_cost=4, operational_impact=4,
    ),
    Template(
        "price_war", "external", "Competitor price war",
        "What if a competitor aggressively cuts prices and pulls demand away from {system}?",
        "Volume shifts to the cheaper alternative unless prices or service are adjusted.",
        ("Well-funded new entrant", "Competitor clearing excess stock"),
        ("Lost volume", "Pressure on price and margin", "Costly retention offers"),
        ("Pricing flexibility", "Differentiation in service or quality"),
        ("competit", "market", "price", "retail", "e-commerce", "consumer", "subscription", "telecom"),
        demand=(-25, -10), duration=(45, 90), recovery=(30, 60), probability=(0.25, 0.45), volatility=(0.25, 0.4),
        potential_cost=3, operational_impact=2,
    ),
    Template(
        "market_expansion", "opportunity", "Market expansion opportunity",
        "What if a new market or channel opens up for {system}?",
        "Additional demand arrives; the question is whether capacity and working capital can capture it.",
        ("New distribution partner", "Entry into an adjacent region or segment"),
        ("Higher volume and revenue", "Capacity and working-capital strain during ramp-up", "Chance to improve scale economics"),
        ("Growth capital", "Additional capacity", "Sales and onboarding effort"),
        ("growth", "expan", "market", "new", "channel", "export", "launch", "retail", "e-commerce", "startup"),
        demand=(15, 35), capacity=(0, 10), cost=(3, 8), duration=(30, 60), recovery=(14, 30), probability=(0.2, 0.4), volatility=(0.25, 0.4),
        potential_cost=2, operational_impact=3,
    ),
    Template(
        "automation_upgrade", "opportunity", "Automation or efficiency upgrade",
        "What if {system} invests in automation or process improvement?",
        "Capacity and unit cost improve once the change is bedded in, after a temporary adjustment period.",
        ("Technology becomes affordable", "Lean or continuous-improvement programme"),
        ("Higher throughput", "Lower unit cost", "Short-term disruption during rollout"),
        ("Capital budget", "Change-management effort", "Training"),
        ("automat", "efficien", "lean", "robot", "digital", "process", "manufactur", "warehouse", "improve"),
        capacity=(15, 35), cost=(-10, -3), duration=(30, 60), recovery=(0, 15), probability=(0.3, 0.5), volatility=(0.15, 0.3),
        potential_cost=2, operational_impact=2,
    ),
)

TEMPLATE_BY_KEY = {template.key: template for template in TEMPLATES}


def _text_of(system: dict[str, Any]) -> str:
    return " ".join(
        str(system.get(key, ""))
        for key in ("name", "industry", "description", "objective", "current_conditions", "available_resources")
    ).lower()


def _seed(*parts: Any) -> int:
    digest = hashlib.sha256("|".join(str(part) for part in parts).encode()).hexdigest()
    return int(digest[:12], 16)


def _relevance(template: Template, text: str) -> int:
    return sum(1 for keyword in template.keywords if keyword in text)


def _first_sentence(text: str, limit: int = 220) -> str:
    text = " ".join((text or "").split())
    match = re.match(r"(.+?[.!?])(\s|$)", text)
    sentence = match.group(1) if match else text
    return sentence if len(sentence) <= limit else sentence[: limit - 1].rstrip() + "…"


def _split_items(text: str) -> list[str]:
    parts = re.split(r"[\n;,]+", text or "")
    return [part.strip(" -•*\t") for part in parts if part.strip(" -•*\t")]


def _pick(rng: random.Random, bounds: Range, integer: bool = False, digits: int = 0) -> float:
    low, high = bounds
    value = rng.uniform(low, high)
    if integer:
        return int(round(value))
    return round(value, digits)


def _changed_variables(params: dict[str, float], assumptions: dict[str, Any]) -> list[dict[str, Any]]:
    demand = float(assumptions["baseline_daily_demand"])
    capacity = demand * (1 + float(assumptions["capacity_headroom"]))
    unit_cost = float(assumptions["unit_cost"])
    rows = []
    if params["demand_change_pct"]:
        rows.append({
            "name": "Customer demand",
            "baseline": f"{demand:g} units/day",
            "scenario_value": f"{demand * (1 + params['demand_change_pct'] / 100):.0f} units/day",
            "change_pct": params["demand_change_pct"],
        })
    if params["capacity_change_pct"]:
        rows.append({
            "name": "Available capacity",
            "baseline": f"{capacity:.0f} units/day",
            "scenario_value": f"{capacity * (1 + params['capacity_change_pct'] / 100):.0f} units/day",
            "change_pct": params["capacity_change_pct"],
        })
    if params["cost_change_pct"]:
        rows.append({
            "name": "Unit cost",
            "baseline": f"{unit_cost:g} per unit",
            "scenario_value": f"{unit_cost * (1 + params['cost_change_pct'] / 100):.2f} per unit",
            "change_pct": params["cost_change_pct"],
        })
    rows.append({
        "name": "Event duration",
        "baseline": "none",
        "scenario_value": f"{params['duration_days']:.0f} days (+{params['recovery_days']:.0f} days recovery)",
        "change_pct": None,
    })
    return rows


def build_from_template(
    template: Template,
    system: dict[str, Any],
    rng: random.Random,
    relevance: int,
    variant: int = 0,
) -> dict[str, Any]:
    params = {
        "demand_change_pct": _pick(rng, template.demand, digits=0),
        "capacity_change_pct": _pick(rng, template.capacity, digits=0),
        "cost_change_pct": _pick(rng, template.cost, digits=0),
        "duration_days": _pick(rng, template.duration, integer=True),
        "recovery_days": _pick(rng, template.recovery, integer=True),
        "probability": _pick(rng, template.probability, digits=2),
        "volatility": _pick(rng, template.volatility, digits=2),
    }
    name = system.get("name") or "the system"
    objective = _first_sentence(system.get("objective", ""), 160).rstrip(".")
    category_hook = "supports" if template.category == "opportunity" else "puts at risk"
    description = (
        f"{template.what_if.format(system=name)} {template.effect} "
        f"The event is modelled as lasting about {params['duration_days']} days with roughly "
        f"{params['recovery_days']} days to recover, and it {category_hook} the objective: {objective}."
    )
    conditions = _first_sentence(system.get("current_conditions", ""))
    initial = [conditions] if conditions else ["The system is operating at its normal baseline."]
    initial.append(f"Operating context: {_first_sentence(system.get('description', ''), 160)}")
    resources = _split_items(system.get("available_resources", ""))[:3]
    required = list(template.resources) + [f"Existing resource: {item}" for item in resources[:2]]
    severity, _score = severity_for(params)
    title = template.title if variant == 0 else f"{template.title} (variant {variant + 1})"
    details = {
        "kind": "base",
        "template": template.key,
        "trigger_events": list(template.triggers),
        "initial_conditions": initial,
        "expected_consequences": list(template.consequences),
        "required_resources": required,
        "changed_variables": _changed_variables(params, DEFAULT_ASSUMPTIONS),
        "potential_cost": template.potential_cost,
        "operational_impact": template.operational_impact,
    }
    assumptions = list(template.assumptions) + [
        "The simulation uses the system's baseline demand and capacity; the scenario is applied as a temporary shock.",
        f"Likelihood ({params['probability'] * 100:.0f}%) is an informed estimate for the next 12 months, not a measured frequency.",
    ]
    confidence = round(min(0.9, 0.5 + 0.08 * min(relevance, 4) + rng.uniform(0, 0.08)), 2)
    return {
        "title": title,
        "description": description,
        "category": template.category,
        "severity": severity,
        "parameters": params,
        "details": details,
        "assumptions": assumptions,
        "confidence": confidence,
    }


def generate_scenarios(
    system: dict[str, Any],
    count: int,
    existing_titles: set[str] | None = None,
    salt: str = "",
) -> list[dict[str, Any]]:
    """Return ``count`` base scenarios, most relevant to the system first, spread over categories."""
    text = _text_of(system)
    existing = {title.lower() for title in (existing_titles or set())}
    seed = _seed(system.get("name", ""), system.get("industry", ""), salt, len(existing))
    rng = random.Random(seed)

    scored = [(template, _relevance(template, text)) for template in TEMPLATES]
    # Relevance first; the seeded jitter decides ties so different systems get different mixes.
    scored.sort(key=lambda pair: (-pair[1], rng.random()))

    chosen: list[tuple[Template, int, int]] = []
    used_categories: dict[str, int] = {}
    pool = [(template, relevance) for template, relevance in scored if template.title.lower() not in existing]
    variant_round = 0
    while len(chosen) < count:
        if not pool:
            variant_round += 1
            pool = [
                (template, relevance)
                for template, relevance in scored
                if f"{template.title} (variant {variant_round + 1})".lower() not in existing
            ]
            if not pool:
                break
        # Prefer a category that has not been used yet so the set covers different kinds of risk.
        pool.sort(key=lambda pair: used_categories.get(pair[0].category, 0))
        best_count = used_categories.get(pool[0][0].category, 0)
        candidates = [pair for pair in pool if used_categories.get(pair[0].category, 0) == best_count]
        template, relevance = max(candidates, key=lambda pair: pair[1])
        pool.remove((template, relevance))
        used_categories[template.category] = used_categories.get(template.category, 0) + 1
        chosen.append((template, relevance, variant_round))

    return [
        build_from_template(template, system, random.Random(_seed(seed, template.key, variant)), relevance, variant)
        for template, relevance, variant in chosen
    ]


# --- validation --------------------------------------------------------------------------------


def validate_scenarios(
    scenarios: list[dict[str, Any]], system: dict[str, Any]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Check scenarios for duplicates, ranges, consistency, constraints and completeness.

    Returns the kept (and repaired) scenarios plus a report listing every issue and its outcome.
    Each scenario needs a ``scenario_key``.
    """
    issues: list[dict[str, Any]] = []
    dropped: list[dict[str, Any]] = []
    kept: list[dict[str, Any]] = []
    seen_titles: set[str] = set()
    constraint_text = (system.get("constraints") or "").lower()

    def note(scenario: dict[str, Any], issue_type: str, message: str, outcome: str) -> None:
        issues.append(
            {"scenario_id": scenario["scenario_key"], "issue_type": issue_type, "message": message, "outcome": outcome}
        )

    for scenario in scenarios:
        key = scenario["title"].strip().lower()
        if key in seen_titles:
            note(scenario, "duplicate", f"“{scenario['title']}” repeats an earlier scenario.", "dropped")
            dropped.append({"scenario_id": scenario["scenario_key"], "title": scenario["title"]})
            continue
        seen_titles.add(key)

        params = scenario["parameters"]
        for name, (low, high) in PARAMETER_LIMITS.items():
            value = params.get(name)
            if value is None or not isinstance(value, (int, float)) or value < low or value > high:
                fixed = min(high, max(low, float(value if isinstance(value, (int, float)) else (low + high) / 2)))
                params[name] = int(round(fixed)) if name in INTEGER_PARAMETERS else round(fixed, 4)
                note(scenario, "range", f"{name.replace('_', ' ')} was outside {low:g}–{high:g}; set to {params[name]:g}.", "repaired")

        if scenario["category"] != "opportunity" and not any(
            params[name] for name in ("demand_change_pct", "capacity_change_pct", "cost_change_pct")
        ):
            params["demand_change_pct"] = -10
            note(scenario, "consistency", "The scenario changed nothing in the model; a 10% demand drop was applied.", "repaired")

        if len(scenario["description"].strip()) < 40:
            scenario["description"] = (
                scenario["description"].strip() + " The event affects demand, capacity or cost for a limited period."
            ).strip()
            note(scenario, "completeness", "The description was too short to be useful and was extended.", "repaired")

        resources = scenario.get("details", {}).get("required_resources", [])
        kept_resources = []
        for item in resources:
            plain = item.replace("Existing resource:", "").strip().lower()
            if constraint_text and len(plain) >= 5 and plain in constraint_text:
                note(scenario, "constraint", f"“{item}” conflicts with a stated constraint and was removed.", "repaired")
            else:
                kept_resources.append(item)
        if scenario.get("details"):
            scenario["details"]["required_resources"] = kept_resources
        kept.append(scenario)

    return kept, {"issues": issues, "dropped": dropped}


# --- combinations ------------------------------------------------------------------------------

COMPATIBLE = {
    ("operations", "workforce"), ("workforce", "operations"),
    ("supply_chain", "demand"), ("demand", "supply_chain"),
    ("supply_chain", "financial"), ("financial", "supply_chain"),
    ("technology", "operations"), ("operations", "technology"),
    ("external", "supply_chain"), ("supply_chain", "external"),
    ("demand", "operations"), ("operations", "demand"),
    ("regulatory", "workforce"), ("workforce", "regulatory"),
    ("financial", "demand"), ("demand", "financial"),
    ("technology", "workforce"), ("workforce", "technology"),
}


def expand_combinations(scenarios: list[dict[str, Any]], max_new: int) -> list[dict[str, Any]]:
    """Create compound scenarios from pairs of compatible base scenarios.

    Each compound carries ``components`` (indexes into ``scenarios``) so the caller can store
    the relationships. Opportunities are never combined with threats.
    """
    candidates = []
    for i, first in enumerate(scenarios):
        for j in range(i + 1, len(scenarios)):
            second = scenarios[j]
            if first["category"] == "opportunity" or second["category"] == "opportunity":
                continue
            if (first["category"], second["category"]) not in COMPATIBLE:
                continue
            weight = first["parameters"]["probability"] * second["parameters"]["probability"]
            candidates.append((weight, i, j))
    candidates.sort(reverse=True)

    compounds: list[dict[str, Any]] = []
    used: set[int] = set()
    for _weight, i, j in candidates:
        if len(compounds) >= max_new:
            break
        # Keep the set varied: each base scenario joins at most one combination.
        if i in used or j in used:
            continue
        used.update((i, j))
        a, b = scenarios[i], scenarios[j]
        pa, pb = a["parameters"], b["parameters"]
        params = {
            "demand_change_pct": max(-100, min(300, pa["demand_change_pct"] + pb["demand_change_pct"])),
            "capacity_change_pct": max(-100, min(300, pa["capacity_change_pct"] + pb["capacity_change_pct"])),
            "cost_change_pct": max(-100, min(300, pa["cost_change_pct"] + pb["cost_change_pct"])),
            "duration_days": int(max(pa["duration_days"], pb["duration_days"])),
            "recovery_days": int(max(pa["recovery_days"], pb["recovery_days"])),
            # Events that hit together are more likely than independent chance suggests.
            "probability": round(min(0.6, pa["probability"] * pb["probability"] * 2.5), 2),
            "volatility": round(min(1.0, max(pa["volatility"], pb["volatility"]) + 0.1), 2),
        }
        severity, _score = severity_for(params)
        title = f"{a['title']} + {b['title']}"
        compounds.append({
            "title": title[:300],
            "description": (
                f"What if both happen close together: {a['title'].lower()} and {b['title'].lower()}? "
                f"The effects overlap, so capacity, demand and cost move at the same time and recovery takes longer "
                f"than for either event alone."
            ),
            "category": a["category"] if a["parameters"]["probability"] >= b["parameters"]["probability"] else b["category"],
            "severity": severity,
            "parameters": params,
            "details": {
                "kind": "compound",
                "trigger_events": [*a["details"]["trigger_events"][:1], *b["details"]["trigger_events"][:1]],
                "initial_conditions": a["details"]["initial_conditions"][:1],
                "expected_consequences": [
                    *a["details"]["expected_consequences"][:2],
                    *b["details"]["expected_consequences"][:2],
                ],
                "required_resources": sorted({*a["details"]["required_resources"][:2], *b["details"]["required_resources"][:2]}),
                "changed_variables": _changed_variables(params, DEFAULT_ASSUMPTIONS),
                "potential_cost": min(5, max(a["details"]["potential_cost"], b["details"]["potential_cost"]) + 1),
                "operational_impact": min(5, max(a["details"]["operational_impact"], b["details"]["operational_impact"]) + 1),
                "combination_rationale": (
                    f"{a['category'].replace('_', ' ').capitalize()} and {b['category'].replace('_', ' ').capitalize()} "
                    f"risks often reinforce each other: the same stress that triggers one makes the other more likely "
                    f"and harder to absorb."
                ),
            },
            "assumptions": [
                "Shock sizes of the two events are added together; this is a simplification.",
                "Probability is the product of the two likelihoods, raised because the events are correlated.",
            ],
            "confidence": round(max(0.35, min(a["confidence"], b["confidence"]) - 0.1), 2),
            "components": [i, j],
        })
    return compounds


def analyse_system(system: dict[str, Any]) -> dict[str, Any]:
    """Short structured reading of the system description, used on the run page."""
    text = _text_of(system)
    category_hits: dict[str, int] = {}
    for template in TEMPLATES:
        category_hits[template.category] = category_hits.get(template.category, 0) + _relevance(template, text)
    exposures = [
        category.replace("_", " ")
        for category, hits in sorted(category_hits.items(), key=lambda item: -item[1])
        if hits > 0 and category != "opportunity"
    ][:4]
    missing = []
    if not (system.get("current_conditions") or "").strip():
        missing.append("Current operating conditions were not provided; a normal baseline is assumed.")
    if not (system.get("available_resources") or "").strip():
        missing.append("Available resources were not provided; generic mitigation resources are listed.")
    if not (system.get("constraints") or "").strip():
        missing.append("No hard constraints were provided, so none were enforced during validation.")
    return {
        "summary": (
            f"{system.get('name')} is a {system.get('industry', '').lower()} system whose objective is: "
            f"{_first_sentence(system.get('objective', ''), 200)}"
        ),
        "vulnerabilities": [f"Exposure to {name} disruptions" for name in exposures] or ["No specific exposure stood out"],
        "hard_constraints": _split_items(system.get("constraints", ""))[:6],
        "missing_information": missing,
    }
