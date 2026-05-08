"""
Ion implantation profiles using the Gaussian approximation.

Range (Rp) and straggle (dRp) data from Jaeger Table 3.1 and
Ziegler's SRIM database, interpolated for common CMOS species.
"""

import numpy as np

# (Rp_um, dRp_um) at selected energies for Si substrate
# Source: SRIM-2013 / Jaeger "Introduction to Microelectronic Fabrication" Table 3.1
_RANGE_DATA = {
    "boron": {
        20: (0.065, 0.028),
        40: (0.130, 0.046),
        80: (0.250, 0.069),
        100: (0.307, 0.076),
        200: (0.540, 0.099),
    },
    "phosphorus": {
        20: (0.027, 0.013),
        40: (0.047, 0.020),
        80: (0.088, 0.034),
        100: (0.108, 0.040),
        200: (0.240, 0.072),
    },
    "arsenic": {
        20: (0.016, 0.007),
        40: (0.024, 0.010),
        80: (0.042, 0.016),
        100: (0.050, 0.019),
        200: (0.094, 0.034),
    },
    "bf2": {  # BF2+ implant: boron energy = 11/49 * beam energy
        20: (0.017, 0.008),
        40: (0.027, 0.012),
        80: (0.047, 0.019),
        100: (0.057, 0.023),
        200: (0.109, 0.040),
    },
}


def _interpolate_range(species: str, energy_keV: float) -> tuple[float, float]:
    data = _RANGE_DATA.get(species.lower())
    if data is None:
        raise ValueError(
            f"Unknown species '{species}'. Choose from: {list(_RANGE_DATA)}"
        )
    energies = sorted(data.keys())
    rps = [data[e][0] for e in energies]
    drps = [data[e][1] for e in energies]
    rp = float(np.interp(energy_keV, energies, rps))
    drp = float(np.interp(energy_keV, energies, drps))
    return rp, drp


def gaussian_profile(
    dose_cm2: float,
    energy_keV: float,
    species: str = "boron",
    depth_points: int = 200,
) -> dict:
    """
    Gaussian implant concentration profile N(x).

    N(x) = (Q / (sqrt(2*pi) * dRp)) * exp(-(x - Rp)^2 / (2 * dRp^2))

    Returns depth array (nm) and concentration array (cm^-3).
    """
    rp_um, drp_um = _interpolate_range(species, energy_keV)
    rp_nm = rp_um * 1000
    drp_nm = drp_um * 1000

    peak_conc = dose_cm2 / (np.sqrt(2 * np.pi) * drp_um * 1e-4)  # cm^-3

    x_max_nm = rp_nm + 4 * drp_nm
    depth_nm = np.linspace(0, x_max_nm, depth_points)
    conc = (dose_cm2 / (np.sqrt(2 * np.pi) * drp_um * 1e-4)) * np.exp(
        -((depth_nm * 1e-7 - rp_um) ** 2) / (2 * drp_um**2)
    )

    return {
        "species": species,
        "energy_keV": energy_keV,
        "dose_cm2": dose_cm2,
        "Rp_nm": round(rp_nm, 1),
        "dRp_nm": round(drp_nm, 1),
        "peak_concentration_cm3": float(f"{peak_conc:.3e}"),
        "depth_nm": depth_nm.tolist(),
        "concentration_cm3": conc.tolist(),
    }


def junction_depth(
    dose_cm2: float,
    energy_keV: float,
    species: str = "boron",
    background_doping_cm3: float = 1e17,
) -> dict:
    """
    Metallurgical junction depth where implant profile equals background doping.

    Solves N(xj) = Nbg analytically for the Gaussian approximation.
    Returns xj on the trailing edge (deeper junction).
    """
    rp_um, drp_um = _interpolate_range(species, energy_keV)
    peak_conc = dose_cm2 / (np.sqrt(2 * np.pi) * drp_um * 1e-4)

    if peak_conc <= background_doping_cm3:
        return {
            "error": (
                f"Peak concentration {peak_conc:.2e} cm^-3 does not exceed "
                f"background {background_doping_cm3:.2e} cm^-3. No junction formed."
            )
        }

    # x_j = Rp + dRp * sqrt(2 * ln(peak / Nbg))
    xj_um = rp_um + drp_um * np.sqrt(2 * np.log(peak_conc / background_doping_cm3))

    return {
        "junction_depth_nm": round(xj_um * 1000, 1),
        "Rp_nm": round(rp_um * 1000, 1),
        "dRp_nm": round(drp_um * 1000, 1),
        "peak_concentration_cm3": float(f"{peak_conc:.3e}"),
        "background_doping_cm3": float(f"{background_doping_cm3:.3e}"),
        "species": species,
        "energy_keV": energy_keV,
    }


def sheet_resistance_estimate(
    dose_cm2: float,
    energy_keV: float,
    species: str = "boron",
) -> dict:
    """
    Rough sheet resistance estimate using Rs = 1 / (q * mu * Q).

    Uses bulk mobility values — real Rs depends on activation and
    profile shape, so treat this as a first-order estimate only.
    """
    mobility = {"boron": 450, "phosphorus": 1350, "arsenic": 480, "bf2": 450}
    mu = mobility.get(species.lower(), 500)
    q = 1.602e-19
    Rs = 1.0 / (q * mu * dose_cm2)

    return {
        "sheet_resistance_ohm_sq": round(Rs, 1),
        "species": species,
        "dose_cm2": dose_cm2,
        "note": "Assumes 100% electrical activation and bulk mobility. Anneal conditions will shift this significantly.",
    }
