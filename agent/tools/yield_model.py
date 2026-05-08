"""
Semiconductor yield and process capability models.

Implements Poisson, Murphy, and Seeds yield models plus
standard SPC metrics (Cp, Cpk) used in fab process control.
"""

import numpy as np
from dataclasses import dataclass


@dataclass
class SPCResult:
    mean: float
    std: float
    usl: float
    lsl: float
    cp: float
    cpk: float
    out_of_spec_ppm: float
    verdict: str


def poisson_yield(defect_density_cm2: float, die_area_cm2: float) -> dict:
    """
    Simple Poisson yield: Y = exp(-D0 * A).

    Assumes defects are randomly distributed (Poisson) and each
    defect kills the die. Valid when D0*A << 1.
    """
    D0A = defect_density_cm2 * die_area_cm2
    Y = np.exp(-D0A)
    return {
        "yield_pct": round(Y * 100, 2),
        "D0_cm2": defect_density_cm2,
        "die_area_cm2": die_area_cm2,
        "D0_times_A": round(D0A, 4),
        "model": "Poisson",
    }


def murphy_yield(defect_density_cm2: float, die_area_cm2: float) -> dict:
    """
    Murphy's yield model — better for clustered defects.

    Y = ((1 - exp(-D0*A)) / (D0*A))^2

    Murphy assumed a triangular defect density distribution.
    More realistic than Poisson for real fab data.
    """
    D0A = defect_density_cm2 * die_area_cm2
    if D0A < 1e-9:
        Y = 1.0
    else:
        Y = ((1 - np.exp(-D0A)) / D0A) ** 2
    return {
        "yield_pct": round(Y * 100, 2),
        "D0_cm2": defect_density_cm2,
        "die_area_cm2": die_area_cm2,
        "model": "Murphy",
    }


def dies_per_wafer(
    wafer_diameter_mm: float,
    die_width_mm: float,
    die_height_mm: float,
    edge_exclusion_mm: float = 3.0,
) -> dict:
    """
    Estimated dies per wafer using the standard area-ratio formula.

    DPW = (pi * (D/2 - E)^2) / (W * H) - pi * (D - 2*E) / sqrt(2 * W * H)

    The second term subtracts partial dies at the wafer perimeter.
    """
    R = wafer_diameter_mm / 2 - edge_exclusion_mm
    die_area = die_width_mm * die_height_mm
    dpw = (np.pi * R**2) / die_area - (
        np.pi * (wafer_diameter_mm - 2 * edge_exclusion_mm)
    ) / np.sqrt(2 * die_area)
    dpw = max(0, int(dpw))
    return {
        "dies_per_wafer": dpw,
        "wafer_diameter_mm": wafer_diameter_mm,
        "die_width_mm": die_width_mm,
        "die_height_mm": die_height_mm,
        "edge_exclusion_mm": edge_exclusion_mm,
        "die_area_cm2": round(die_area / 100, 4),
    }


def throughput_economics(
    wafer_diameter_mm: float,
    die_width_mm: float,
    die_height_mm: float,
    defect_density_cm2: float,
    wafer_cost_usd: float = 5000,
    tool_cost_per_hr_usd: float = 800,
    cycle_time_hr: float = 1.5,
) -> dict:
    """
    Cost-per-good-die estimate incorporating yield and tool cost.

    Useful for understanding why defect density and die size matter
    so much to fab economics — ASML's scanners directly impact D0.
    """
    dpw_data = dies_per_wafer(wafer_diameter_mm, die_width_mm, die_height_mm)
    dpw = dpw_data["dies_per_wafer"]
    die_area_cm2 = dpw_data["die_area_cm2"]

    y_data = murphy_yield(defect_density_cm2, die_area_cm2)
    y = y_data["yield_pct"] / 100

    total_cost = wafer_cost_usd + tool_cost_per_hr_usd * cycle_time_hr
    good_dies = dpw * y
    cpgd = total_cost / good_dies if good_dies > 0 else float("inf")

    return {
        "cost_per_good_die_usd": round(cpgd, 2),
        "good_dies_per_wafer": round(good_dies, 1),
        "yield_pct": y_data["yield_pct"],
        "dies_per_wafer": dpw,
        "total_wafer_cost_usd": total_cost,
    }


def process_capability(
    measurements: list[float],
    usl: float,
    lsl: float,
) -> SPCResult:
    """
    Compute Cp and Cpk for a set of CD or overlay measurements.

    Cp = (USL - LSL) / (6 * sigma)   — process spread vs spec width
    Cpk = min((USL - mean), (mean - LSL)) / (3 * sigma)  — centering + spread

    Cpk >= 1.33 is the standard fab acceptance criterion (4-sigma margin).
    """
    data = np.array(measurements)
    mean = float(np.mean(data))
    std = float(np.std(data, ddof=1))

    cp = (usl - lsl) / (6 * std) if std > 0 else float("inf")
    cpk = min((usl - mean), (mean - lsl)) / (3 * std) if std > 0 else float("inf")

    # Approximate PPM out-of-spec assuming normality
    from scipy import stats

    oos_high = stats.norm.sf(usl, loc=mean, scale=std)
    oos_low = stats.norm.cdf(lsl, loc=mean, scale=std)
    ppm = (oos_high + oos_low) * 1e6

    verdict = (
        "PASS (Cpk >= 1.33)"
        if cpk >= 1.33
        else "MARGINAL (1.0 <= Cpk < 1.33)"
        if cpk >= 1.0
        else "FAIL (Cpk < 1.0)"
    )

    return SPCResult(
        mean=round(mean, 4),
        std=round(std, 4),
        usl=usl,
        lsl=lsl,
        cp=round(cp, 3),
        cpk=round(cpk, 3),
        out_of_spec_ppm=round(ppm, 1),
        verdict=verdict,
    )


def control_limits(measurements: list[float]) -> dict:
    """
    Shewhart X-bar control limits (3-sigma) for a process monitor.

    UCL = mean + 3*sigma, LCL = mean - 3*sigma.
    Points outside these limits indicate assignable-cause variation.
    """
    data = np.array(measurements)
    mean = float(np.mean(data))
    std = float(np.std(data, ddof=1))
    ucl = mean + 3 * std
    lcl = mean - 3 * std
    out_of_control = [i for i, v in enumerate(data) if v > ucl or v < lcl]

    return {
        "mean": round(mean, 4),
        "std": round(std, 4),
        "UCL": round(ucl, 4),
        "LCL": round(lcl, 4),
        "out_of_control_indices": out_of_control,
        "n_points": len(data),
        "in_control": len(out_of_control) == 0,
    }
