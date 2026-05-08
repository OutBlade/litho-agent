"""
Thermal oxidation simulation via the Deal-Grove model.

Reference: B.E. Deal & A.S. Grove, J. Appl. Phys. 36, 3770 (1965).
Valid for oxide thicknesses > ~20 nm (linear-parabolic regime).
"""

import numpy as np

# Arrhenius parameters from Grove 1965 / Neamen "Semiconductor Physics and Devices".
# B  — parabolic rate constant — units µm²/hr
# BA — linear rate constant B/A — units µm/hr
# A is derived: A = B / BA  (units µm)
_DG_PARAMS = {
    ("100", "dry"): dict(B0=772, Ea_B=1.23, BA0=6.23e6, Ea_BA=2.00),
    ("111", "dry"): dict(B0=772, Ea_B=1.23, BA0=1.69e7, Ea_BA=2.00),
    ("100", "wet"): dict(B0=386, Ea_B=0.78, BA0=1.63e8, Ea_BA=2.05),
    ("111", "wet"): dict(B0=386, Ea_B=0.78, BA0=2.05e8, Ea_BA=2.05),
}

_k_eV = 8.617e-5  # eV/K


def _dg_constants(
    temp_C: float, orientation: str, ambient: str
) -> tuple[float, float, float]:
    """Return (A_um, B_um2_hr, BA_um_hr) at the given temperature."""
    key = (orientation, ambient)
    if key not in _DG_PARAMS:
        raise ValueError(f"Unknown orientation/ambient combination: {key}")
    p = _DG_PARAMS[key]
    T = temp_C + 273.15
    B = p["B0"] * np.exp(-p["Ea_B"] / (_k_eV * T))  # µm²/hr
    BA = p["BA0"] * np.exp(-p["Ea_BA"] / (_k_eV * T))  # µm/hr
    A = B / BA  # µm
    return A, B, BA


def oxide_thickness(
    time_min: float,
    temp_C: float,
    orientation: str = "100",
    ambient: str = "dry",
    initial_oxide_nm: float = 0.0,
) -> dict:
    """
    Oxide thickness grown in `time_min` minutes at `temp_C` °C.

    Deal-Grove quadratic:  x² + A·x = B·(t + τ)
    τ accounts for any pre-existing oxide; time is converted to hours internally.

    Verification: 30 min dry at 1000 °C Si(100) → ~31 nm  (Neamen Table 7.4).
    """
    A_um, B_hr, BA_hr = _dg_constants(temp_C, orientation, ambient)
    t_hr = time_min / 60.0
    xi_um = initial_oxide_nm / 1000.0

    tau = (xi_um**2 + A_um * xi_um) / B_hr
    t_eff = t_hr + tau

    x_um = (-A_um + np.sqrt(A_um**2 + 4 * B_hr * t_eff)) / 2.0
    x_nm = x_um * 1000.0

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
        "linear_rate_nm_per_min": round(BA_hr / 60 * 1000, 4),  # nm/min
        "parabolic_rate_nm2_per_min": round(B_hr / 60 * 1e6, 2),  # nm²/min
        "A_um": round(A_um, 6),
        "B_um2_hr": round(B_hr, 6),
    }


def oxidation_time(
    target_nm: float,
    temp_C: float,
    orientation: str = "100",
    ambient: str = "dry",
    initial_oxide_nm: float = 0.0,
) -> dict:
    """
    Time required to grow `target_nm` of oxide at `temp_C` °C.

    Inverts the Deal-Grove quadratic analytically; returns minutes.
    """
    A_um, B_hr, _ = _dg_constants(temp_C, orientation, ambient)
    x_um = target_nm / 1000.0
    xi_um = initial_oxide_nm / 1000.0

    tau = (xi_um**2 + A_um * xi_um) / B_hr
    t_eff = (x_um**2 + A_um * x_um) / B_hr
    t_hr = t_eff - tau

    if t_hr < 0:
        return {"error": "Target thickness is less than the initial oxide thickness."}

    return {
        "time_min": round(t_hr * 60, 2),
        "time_hr": round(t_hr, 4),
        "target_nm": target_nm,
        "temp_C": temp_C,
        "orientation": orientation,
        "ambient": ambient,
    }


def temperature_sensitivity(target_nm: float, ambient: str = "dry") -> list[dict]:
    """Growth time vs temperature for a fixed oxide target — shows thermal budget trade-offs."""
    results = []
    for T in [850, 900, 950, 1000, 1050, 1100]:
        r = oxidation_time(target_nm, T, orientation="100", ambient=ambient)
        if "error" not in r:
            results.append({"temp_C": T, "time_min": r["time_min"]})
    return results
