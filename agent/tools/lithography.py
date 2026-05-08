"""
Optical lithography simulation tools.

Physical models for resolution, depth of focus, and process window analysis.
Covers both DUV (193nm ArF) and EUV (13.5nm) regimes.
"""

import numpy as np
from dataclasses import dataclass


@dataclass
class ProcessWindow:
    dose_center: float
    focus_center: float
    doe_latitude: float  # exposure latitude in %
    dof_nm: float  # depth of focus in nm
    cd_mean_nm: float
    cd_3sigma_nm: float


def rayleigh_resolution(wavelength_nm: float, na: float, k1: float = 0.25) -> float:
    """
    Minimum resolvable half-pitch via the Rayleigh criterion.

    R = k1 * lambda / NA

    k1 = 0.25 is the single-exposure diffraction limit.
    Practical DUV: k1 ~ 0.28-0.35 with OPC.
    EUV at 13.5nm / NA=0.33: R ~ 13nm at k1=0.32.
    """
    return k1 * wavelength_nm / na


def depth_of_focus(wavelength_nm: float, na: float, k2: float = 0.5) -> float:
    """
    Depth of focus via the Rayleigh DOF criterion.

    DOF = k2 * lambda / NA^2

    Note the NA^2 penalty: going from NA=0.33 to NA=0.55 (EUV High-NA)
    shrinks DOF by (0.33/0.55)^2 ~ 0.36x, driving pellicle and wafer
    flatness requirements.
    """
    return k2 * wavelength_nm / (na**2)


def cd_sensitivity(
    wavelength_nm: float, na: float, k1: float = 0.28, dose_variation_pct: float = 1.0
) -> dict:
    """
    CD sensitivity to dose and focus variations.

    Returns the expected CD change (nm) for a 1% dose shift and a 10nm
    focus shift, using first-order linear approximations typical for
    Gaussian aerial image models.
    """
    cd_nom = rayleigh_resolution(wavelength_nm, na, k1)
    dof = depth_of_focus(wavelength_nm, na)

    # Approximate: MEEF (mask error enhancement factor) ~ 1 at k1=0.28
    # CD/dose sensitivity ~ 0.4 * CD per 1% dose (empirical for dense lines)
    dcd_dose = 0.4 * cd_nom * dose_variation_pct / 100

    # CD/focus sensitivity: ~0.01 nm CD per nm focus offset near process window edge
    focus_offset_nm = 10.0
    dcd_focus = cd_nom * (focus_offset_nm / dof) ** 2 * 0.5

    return {
        "cd_nominal_nm": round(cd_nom, 2),
        "dof_nm": round(dof, 2),
        "dcd_per_1pct_dose_nm": round(dcd_dose, 3),
        "dcd_per_10nm_focus_nm": round(dcd_focus, 3),
    }


def euv_vs_duv(target_cd_nm: float) -> dict:
    """
    Compare DUV ArF (193nm) and EUV (13.5nm) for a given target CD.

    Returns required NA, k1, DOF, and number of multi-patterning steps
    needed for DUV to match EUV single-exposure resolution.
    """
    # EUV: NA=0.33 (current NXE), k1 solved from target
    euv_wl = 13.5
    euv_na = 0.33
    euv_k1 = target_cd_nm * euv_na / euv_wl
    euv_dof = depth_of_focus(euv_wl, euv_na)

    # DUV ArF immersion: lambda=193nm, NA up to 1.35
    duv_wl = 193.0
    duv_na = 1.35
    # Practical k1 limit with OPC ~ 0.28
    duv_k1_min = 0.28
    duv_single_cd = rayleigh_resolution(duv_wl, duv_na, duv_k1_min)
    n_patterning = max(1, int(np.ceil(duv_single_cd / target_cd_nm)))
    duv_dof = depth_of_focus(duv_wl, duv_na)

    return {
        "target_cd_nm": target_cd_nm,
        "euv": {
            "wavelength_nm": euv_wl,
            "NA": euv_na,
            "k1_required": round(euv_k1, 3),
            "feasible": euv_k1 >= 0.25,
            "dof_nm": round(euv_dof, 1),
            "exposures": 1,
        },
        "duv_arf_immersion": {
            "wavelength_nm": duv_wl,
            "NA": duv_na,
            "k1_at_single": round(duv_k1_min, 3),
            "single_cd_nm": round(duv_single_cd, 1),
            "multi_patterning_steps": n_patterning,
            "dof_nm": round(duv_dof, 1),
        },
        "euv_advantage": {
            "dof_ratio_euv_over_duv": round(euv_dof / duv_dof, 2),
            "complexity_reduction": f"1 EUV pass vs {n_patterning}x DUV SADP/SAQP",
        },
    }


def overlay_budget(cd_nm: float, layers: int = 3) -> dict:
    """
    Overlay budget breakdown for a simple multi-layer stack.

    Industry rule: total overlay <= CD/4 at each critical layer.
    Returns per-contributor budget assuming 4 equal error sources.
    """
    total_budget_nm = cd_nm / 4
    contributors = ["scanner", "reticle", "wafer_chuck", "process_induced"]
    per_contributor = total_budget_nm / np.sqrt(len(contributors))  # RSS split

    return {
        "cd_nm": cd_nm,
        "total_overlay_budget_nm": round(total_budget_nm, 2),
        "per_contributor_3sigma_nm": round(per_contributor, 2),
        "contributors": contributors,
        "note": (
            "Budget assumes RSS combination of uncorrelated error sources. "
            "Scanner overlay spec for NXE:3600 is typically <2nm 3-sigma."
        ),
    }
