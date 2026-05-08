"""
Thermal oxidation simulation via the Deal-Grove model.

Reference: B.E. Deal & A.S. Grove, J. Appl. Phys. 36, 3770 (1965).
Valid for oxide thicknesses > ~20nm (linear-parabolic regime).
"""

import numpy as np

# Deal-Grove coefficients from Grove's original paper and Jaeger "Introduction to Microelectronic Fabrication"
# A (um), B (um^2/min), tau (min) for Si(100) and Si(111)
_DG_PARAMS = {
    # (orientation, ambient): (A_um, B_um2_per_min, Ea_A_eV, Ea_B_eV)
    # A controls linear rate constant B/A, B is parabolic rate constant
    ("100", "dry"): dict(
        A0=0.0117,  # um,  pre-exponential
        B0=772,  # um^2/min
        Ea_A=2.00,  # eV, activation energy for B/A
        Ea_B=1.23,  # eV, activation energy for B
    ),
    ("111", "dry"): dict(
        A0=0.00756,
        B0=772,
        Ea_A=2.00,
        Ea_B=1.23,
    ),
    ("100", "wet"): dict(
        A0=0.226,
        B0=1.08e4,
        Ea_A=2.05,
        Ea_B=0.78,
    ),
    ("111", "wet"): dict(
        A0=0.150,
        B0=1.08e4,
        Ea_A=2.05,
        Ea_B=0.78,
    ),
}

_k_eV = 8.617e-5  # eV/K


def _dg_constants(temp_C: float, orientation: str, ambient: str) -> tuple[float, float]:
    """Return (A_um, B_um2_min) at the given temperature."""
    key = (orientation, ambient)
    if key not in _DG_PARAMS:
        raise ValueError(f"Unknown orientation/ambient combination: {key}")
    p = _DG_PARAMS[key]
    T = temp_C + 273.15
    A = p["A0"] * np.exp(-p["Ea_A"] / (_k_eV * T))
    B = p["B0"] * np.exp(-p["Ea_B"] / (_k_eV * T))
    return A, B


def oxide_thickness(
    time_min: float,
    temp_C: float,
    orientation: str = "100",
    ambient: str = "dry",
    initial_oxide_nm: float = 0.0,
) -> dict:
    """
    Oxide thickness grown in `time_min` minutes at `temp_C` degrees C.

    Uses the Deal-Grove quadratic solution:
        x^2 + A*x = B*(t + tau)
    where tau accounts for any pre-existing oxide.

    Returns thickness in nm and the dominant growth regime.
    """
    A_um, B_um2_min = _dg_constants(temp_C, orientation, ambient)

    # Convert initial oxide to um
    xi_um = initial_oxide_nm / 1000.0
    # tau: effective time offset for pre-existing oxide
    tau = (xi_um**2 + A_um * xi_um) / B_um2_min
    t_eff = time_min + tau

    # Solve quadratic: x^2 + A*x - B*t_eff = 0
    discriminant = A_um**2 + 4 * B_um2_min * t_eff
    x_um = (-A_um + np.sqrt(discriminant)) / 2.0

    x_nm = x_um * 1000.0
    linear_rate = B_um2_min / A_um  # um/min, dominates for thin oxides
    parabolic_rate = B_um2_min  # um^2/min, dominates for thick oxides

    # Regime: linear if x << A, parabolic if x >> A
    regime = (
        "linear" if x_um < 0.5 * A_um else "parabolic" if x_um > 2 * A_um else "mixed"
    )

    return {
        "thickness_nm": round(x_nm, 2),
        "time_min": time_min,
        "temp_C": temp_C,
        "orientation": orientation,
        "ambient": ambient,
        "regime": regime,
        "linear_rate_nm_per_min": round(linear_rate * 1000, 4),
        "parabolic_rate_nm2_per_min": round(parabolic_rate * 1e6, 2),
        "A_um": round(A_um, 6),
        "B_um2_min": round(B_um2_min, 6),
    }


def oxidation_time(
    target_nm: float,
    temp_C: float,
    orientation: str = "100",
    ambient: str = "dry",
    initial_oxide_nm: float = 0.0,
) -> dict:
    """
    Time required to grow `target_nm` of oxide at `temp_C`.

    Inverts the Deal-Grove quadratic analytically.
    """
    A_um, B_um2_min = _dg_constants(temp_C, orientation, ambient)
    x_um = target_nm / 1000.0
    xi_um = initial_oxide_nm / 1000.0

    tau = (xi_um**2 + A_um * xi_um) / B_um2_min
    t_eff = (x_um**2 + A_um * x_um) / B_um2_min
    t_min = t_eff - tau

    if t_min < 0:
        return {"error": "Target thickness is less than the initial oxide thickness."}

    return {
        "time_min": round(t_min, 2),
        "time_hr": round(t_min / 60, 3),
        "target_nm": target_nm,
        "temp_C": temp_C,
        "orientation": orientation,
        "ambient": ambient,
    }


def temperature_sensitivity(target_nm: float, ambient: str = "dry") -> list[dict]:
    """
    Show how growth time changes with temperature for a fixed target.

    Useful for understanding thermal budget trade-offs.
    """
    temps = [850, 900, 950, 1000, 1050, 1100]
    results = []
    for T in temps:
        r = oxidation_time(target_nm, T, orientation="100", ambient=ambient)
        if "error" not in r:
            results.append({"temp_C": T, "time_min": r["time_min"]})
    return results
