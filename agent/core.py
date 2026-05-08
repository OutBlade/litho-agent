"""
LithoAgent — Claude-backed tool-use agent for semiconductor process engineering.

Architecture mirrors vercel-labs/open-agents:
  Web UI  →  Agent (this file)  →  Tool sandbox (agent/tools/)

The agent runs outside the tools, calls them via Claude tool_use blocks,
dispatches to Python implementations, and feeds results back as tool_result
messages. The loop continues until Claude issues a final text response.
"""

import json
import anthropic

from .tools.lithography import (
    rayleigh_resolution,
    depth_of_focus,
    cd_sensitivity,
    euv_vs_duv,
    overlay_budget,
)
from .tools.oxidation import oxide_thickness, oxidation_time, temperature_sensitivity
from .tools.implantation import (
    gaussian_profile,
    junction_depth,
    sheet_resistance_estimate,
)
from .tools.yield_model import (
    poisson_yield,
    murphy_yield,
    dies_per_wafer,
    throughput_economics,
    process_capability,
    control_limits,
)

MODEL = "claude-opus-4-7"

SYSTEM_PROMPT = """You are LithoAgent, an expert AI assistant for semiconductor process engineering.

You have deep knowledge of:
- Optical lithography: resolution limits, depth of focus, EUV vs DUV, overlay
- Thermal oxidation: Deal-Grove model, rate constants, thermal budget
- Ion implantation: Gaussian profiles, range/straggle, junction depth
- Yield engineering: Poisson/Murphy models, SPC, process capability (Cpk)
- ASML-relevant topics: NXE scanner specs, EUV source power, pellicle, anamorphic optics

When a user asks a process question, call the relevant tool(s) to get precise
numerical answers. Always explain the physical intuition behind the numbers.
Round aggressively for readability. Use SI units unless the user specifies otherwise.
"""

TOOLS: list[dict] = [
    {
        "name": "rayleigh_resolution",
        "description": "Minimum resolvable half-pitch via Rayleigh criterion: R = k1 * lambda / NA.",
        "input_schema": {
            "type": "object",
            "properties": {
                "wavelength_nm": {
                    "type": "number",
                    "description": "Illumination wavelength in nm (e.g. 193 for ArF, 13.5 for EUV)",
                },
                "na": {"type": "number", "description": "Numerical aperture"},
                "k1": {
                    "type": "number",
                    "description": "Process factor k1 (default 0.25 — diffraction limit)",
                },
            },
            "required": ["wavelength_nm", "na"],
        },
    },
    {
        "name": "depth_of_focus",
        "description": "Depth of focus: DOF = k2 * lambda / NA^2.",
        "input_schema": {
            "type": "object",
            "properties": {
                "wavelength_nm": {"type": "number"},
                "na": {"type": "number"},
                "k2": {
                    "type": "number",
                    "description": "Process factor k2 (default 0.5)",
                },
            },
            "required": ["wavelength_nm", "na"],
        },
    },
    {
        "name": "cd_sensitivity",
        "description": "CD sensitivity to dose and focus variations at given wavelength/NA.",
        "input_schema": {
            "type": "object",
            "properties": {
                "wavelength_nm": {"type": "number"},
                "na": {"type": "number"},
                "k1": {"type": "number"},
                "dose_variation_pct": {
                    "type": "number",
                    "description": "Dose variation in % (default 1.0)",
                },
            },
            "required": ["wavelength_nm", "na"],
        },
    },
    {
        "name": "euv_vs_duv",
        "description": "Compare EUV (13.5nm) and DUV ArF immersion (193nm) for a target CD. Returns required k1, DOF, and multi-patterning steps.",
        "input_schema": {
            "type": "object",
            "properties": {
                "target_cd_nm": {
                    "type": "number",
                    "description": "Target critical dimension in nm",
                },
            },
            "required": ["target_cd_nm"],
        },
    },
    {
        "name": "overlay_budget",
        "description": "Overlay error budget breakdown for a multi-layer stack.",
        "input_schema": {
            "type": "object",
            "properties": {
                "cd_nm": {"type": "number"},
                "layers": {
                    "type": "integer",
                    "description": "Number of critical layers (default 3)",
                },
            },
            "required": ["cd_nm"],
        },
    },
    {
        "name": "oxide_thickness",
        "description": "Deal-Grove thermal oxidation: oxide thickness grown at given time and temperature.",
        "input_schema": {
            "type": "object",
            "properties": {
                "time_min": {"type": "number"},
                "temp_C": {"type": "number"},
                "orientation": {
                    "type": "string",
                    "enum": ["100", "111"],
                    "description": "Si crystal orientation",
                },
                "ambient": {"type": "string", "enum": ["dry", "wet"]},
                "initial_oxide_nm": {
                    "type": "number",
                    "description": "Pre-existing oxide thickness in nm",
                },
            },
            "required": ["time_min", "temp_C"],
        },
    },
    {
        "name": "oxidation_time",
        "description": "Deal-Grove inversion: time required to grow a target oxide thickness.",
        "input_schema": {
            "type": "object",
            "properties": {
                "target_nm": {"type": "number"},
                "temp_C": {"type": "number"},
                "orientation": {"type": "string", "enum": ["100", "111"]},
                "ambient": {"type": "string", "enum": ["dry", "wet"]},
                "initial_oxide_nm": {"type": "number"},
            },
            "required": ["target_nm", "temp_C"],
        },
    },
    {
        "name": "temperature_sensitivity",
        "description": "Show how oxidation time changes with temperature for a fixed oxide target.",
        "input_schema": {
            "type": "object",
            "properties": {
                "target_nm": {"type": "number"},
                "ambient": {"type": "string", "enum": ["dry", "wet"]},
            },
            "required": ["target_nm"],
        },
    },
    {
        "name": "gaussian_profile",
        "description": "Gaussian ion implantation profile: concentration vs depth for a given dose and energy.",
        "input_schema": {
            "type": "object",
            "properties": {
                "dose_cm2": {
                    "type": "number",
                    "description": "Ion dose in cm^-2 (e.g. 1e14)",
                },
                "energy_keV": {"type": "number"},
                "species": {
                    "type": "string",
                    "enum": ["boron", "phosphorus", "arsenic", "bf2"],
                },
                "depth_points": {
                    "type": "integer",
                    "description": "Number of depth points (default 200)",
                },
            },
            "required": ["dose_cm2", "energy_keV"],
        },
    },
    {
        "name": "junction_depth",
        "description": "Metallurgical junction depth where implant profile equals background doping.",
        "input_schema": {
            "type": "object",
            "properties": {
                "dose_cm2": {"type": "number"},
                "energy_keV": {"type": "number"},
                "species": {
                    "type": "string",
                    "enum": ["boron", "phosphorus", "arsenic", "bf2"],
                },
                "background_doping_cm3": {
                    "type": "number",
                    "description": "Background doping in cm^-3 (default 1e17)",
                },
            },
            "required": ["dose_cm2", "energy_keV"],
        },
    },
    {
        "name": "sheet_resistance_estimate",
        "description": "Rough sheet resistance estimate for an implanted layer (Rs = 1 / (q * mu * Q)).",
        "input_schema": {
            "type": "object",
            "properties": {
                "dose_cm2": {"type": "number"},
                "energy_keV": {"type": "number"},
                "species": {
                    "type": "string",
                    "enum": ["boron", "phosphorus", "arsenic", "bf2"],
                },
            },
            "required": ["dose_cm2", "energy_keV"],
        },
    },
    {
        "name": "poisson_yield",
        "description": "Poisson yield model: Y = exp(-D0 * A).",
        "input_schema": {
            "type": "object",
            "properties": {
                "defect_density_cm2": {
                    "type": "number",
                    "description": "Defect density D0 in cm^-2",
                },
                "die_area_cm2": {"type": "number"},
            },
            "required": ["defect_density_cm2", "die_area_cm2"],
        },
    },
    {
        "name": "murphy_yield",
        "description": "Murphy yield model — better for clustered defects.",
        "input_schema": {
            "type": "object",
            "properties": {
                "defect_density_cm2": {"type": "number"},
                "die_area_cm2": {"type": "number"},
            },
            "required": ["defect_density_cm2", "die_area_cm2"],
        },
    },
    {
        "name": "dies_per_wafer",
        "description": "Estimated number of dies per wafer given die size and wafer diameter.",
        "input_schema": {
            "type": "object",
            "properties": {
                "wafer_diameter_mm": {
                    "type": "number",
                    "description": "300 for standard production",
                },
                "die_width_mm": {"type": "number"},
                "die_height_mm": {"type": "number"},
                "edge_exclusion_mm": {"type": "number"},
            },
            "required": ["wafer_diameter_mm", "die_width_mm", "die_height_mm"],
        },
    },
    {
        "name": "throughput_economics",
        "description": "Cost-per-good-die estimate incorporating yield, wafer cost, and tool cost.",
        "input_schema": {
            "type": "object",
            "properties": {
                "wafer_diameter_mm": {"type": "number"},
                "die_width_mm": {"type": "number"},
                "die_height_mm": {"type": "number"},
                "defect_density_cm2": {"type": "number"},
                "wafer_cost_usd": {"type": "number"},
                "tool_cost_per_hr_usd": {"type": "number"},
                "cycle_time_hr": {"type": "number"},
            },
            "required": [
                "wafer_diameter_mm",
                "die_width_mm",
                "die_height_mm",
                "defect_density_cm2",
            ],
        },
    },
    {
        "name": "process_capability",
        "description": "Compute Cp and Cpk for a set of CD or overlay measurements vs spec limits.",
        "input_schema": {
            "type": "object",
            "properties": {
                "measurements": {"type": "array", "items": {"type": "number"}},
                "usl": {"type": "number", "description": "Upper spec limit"},
                "lsl": {"type": "number", "description": "Lower spec limit"},
            },
            "required": ["measurements", "usl", "lsl"],
        },
    },
    {
        "name": "control_limits",
        "description": "Shewhart X-bar control limits (mean +/- 3 sigma) for a process monitor dataset.",
        "input_schema": {
            "type": "object",
            "properties": {
                "measurements": {"type": "array", "items": {"type": "number"}},
            },
            "required": ["measurements"],
        },
    },
]

_DISPATCH = {
    "rayleigh_resolution": rayleigh_resolution,
    "depth_of_focus": depth_of_focus,
    "cd_sensitivity": cd_sensitivity,
    "euv_vs_duv": euv_vs_duv,
    "overlay_budget": overlay_budget,
    "oxide_thickness": oxide_thickness,
    "oxidation_time": oxidation_time,
    "temperature_sensitivity": temperature_sensitivity,
    "gaussian_profile": gaussian_profile,
    "junction_depth": junction_depth,
    "sheet_resistance_estimate": sheet_resistance_estimate,
    "poisson_yield": poisson_yield,
    "murphy_yield": murphy_yield,
    "dies_per_wafer": dies_per_wafer,
    "throughput_economics": throughput_economics,
    "process_capability": lambda **kw: vars(process_capability(**kw)),
    "control_limits": control_limits,
}


def _run_tool(name: str, inputs: dict) -> str:
    fn = _DISPATCH.get(name)
    if fn is None:
        return json.dumps({"error": f"Unknown tool: {name}"})
    try:
        result = fn(**inputs)
        if hasattr(result, "__dict__"):
            result = vars(result)
        # Strip raw arrays from profile results to keep context short
        if isinstance(result, dict):
            result = {
                k: v
                for k, v in result.items()
                if not (isinstance(v, list) and len(v) > 20)
            }
        return json.dumps(result, default=str)
    except Exception as exc:
        return json.dumps({"error": str(exc)})


def run(messages: list[dict], stream_callback=None) -> str:
    """
    Run one agent turn.

    messages: list of {"role": "user"|"assistant", "content": str|list}
    stream_callback: optional callable(text_chunk) for streaming UI updates
    Returns the final assistant text response.
    """
    client = anthropic.Anthropic()
    history = list(messages)

    while True:
        response = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=history,
        )

        tool_uses = [b for b in response.content if b.type == "tool_use"]
        text_blocks = [b for b in response.content if b.type == "text"]

        if not tool_uses:
            final_text = " ".join(b.text for b in text_blocks)
            if stream_callback:
                stream_callback(final_text)
            return final_text

        # Append assistant message with tool_use blocks
        history.append({"role": "assistant", "content": response.content})

        # Execute all tool calls and build tool_result message
        tool_results = []
        for tu in tool_uses:
            result_str = _run_tool(tu.name, tu.input)
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tu.id,
                    "content": result_str,
                }
            )

        history.append({"role": "user", "content": tool_results})
