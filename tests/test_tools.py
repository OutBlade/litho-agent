"""
Unit tests for process simulation tools.
No API key required — tests are purely computational.
"""

import pytest
from agent.tools.lithography import (
    rayleigh_resolution,
    depth_of_focus,
    euv_vs_duv,
    overlay_budget,
)
from agent.tools.oxidation import oxide_thickness, oxidation_time
from agent.tools.implantation import gaussian_profile, junction_depth
from agent.tools.yield_model import (
    poisson_yield,
    murphy_yield,
    dies_per_wafer,
    process_capability,
)


# --- Lithography ---


def test_rayleigh_euv():
    # EUV 13.5nm / NA=0.33 / k1=0.25 → ~10.2nm
    r = rayleigh_resolution(13.5, 0.33, k1=0.25)
    assert 9 < r < 12


def test_rayleigh_duv():
    # ArF immersion 193nm / NA=1.35 / k1=0.28 → ~40nm
    r = rayleigh_resolution(193, 1.35, k1=0.28)
    assert 35 < r < 45


def test_dof_na_squared_scaling():
    # DOF scales as 1/NA^2 — doubling NA cuts DOF by 4x
    dof1 = depth_of_focus(193, 0.5)
    dof2 = depth_of_focus(193, 1.0)
    assert abs(dof1 / dof2 - 4.0) < 0.1


def test_euv_vs_duv_7nm():
    result = euv_vs_duv(7.0)
    assert result["euv"]["exposures"] == 1
    assert result["duv_arf_immersion"]["multi_patterning_steps"] >= 4


def test_overlay_budget():
    ob = overlay_budget(14.0)
    assert ob["total_overlay_budget_nm"] == pytest.approx(3.5, rel=0.01)


# --- Oxidation ---


def test_deal_grove_known_value():
    # ~30min at 1000°C dry on Si(100) → ~30nm (textbook ballpark)
    result = oxide_thickness(30, 1000, orientation="100", ambient="dry")
    assert 20 < result["thickness_nm"] < 50


def test_oxidation_roundtrip():
    # Growing then inverting should recover the original time
    t_target = 60.0
    r = oxide_thickness(t_target, 1000, orientation="100", ambient="wet")
    xox = r["thickness_nm"]
    r2 = oxidation_time(xox, 1000, orientation="100", ambient="wet")
    assert abs(r2["time_min"] - t_target) < 0.5


def test_wet_faster_than_dry():
    wet = oxide_thickness(30, 900, ambient="wet")
    dry = oxide_thickness(30, 900, ambient="dry")
    assert wet["thickness_nm"] > dry["thickness_nm"]


# --- Implantation ---


def test_gaussian_profile_shape():
    p = gaussian_profile(1e14, 80, species="boron")
    assert p["Rp_nm"] > 0
    assert p["dRp_nm"] > 0
    assert p["peak_concentration_cm3"] > 0


def test_junction_depth_below_rp():
    # Junction is always deeper than Rp for trailing-edge solution
    jd = junction_depth(1e14, 80, species="boron", background_doping_cm3=1e16)
    assert "error" not in jd
    assert jd["junction_depth_nm"] > jd["Rp_nm"]


def test_junction_depth_no_junction_if_dose_too_low():
    result = junction_depth(1e10, 80, species="boron", background_doping_cm3=1e17)
    assert "error" in result


# --- Yield ---


def test_poisson_yield_high_d0():
    r = poisson_yield(defect_density_cm2=10, die_area_cm2=1.0)
    assert r["yield_pct"] < 1.0


def test_poisson_yield_zero_d0():
    r = poisson_yield(defect_density_cm2=0, die_area_cm2=1.0)
    assert r["yield_pct"] == 100.0


def test_murphy_higher_than_poisson():
    # Murphy model gives higher yield than Poisson for same D0 (clustered defects)
    p = poisson_yield(1.0, 1.0)["yield_pct"]
    m = murphy_yield(1.0, 1.0)["yield_pct"]
    assert m > p


def test_dies_per_wafer_300mm():
    r = dies_per_wafer(300, 10, 10)
    assert r["dies_per_wafer"] > 500


def test_process_capability_pass():
    data = [100.0 + i * 0.01 for i in range(20)]
    r = process_capability(data, usl=105.0, lsl=95.0)
    assert r.cpk > 1.33
    assert "PASS" in r.verdict


def test_process_capability_fail():
    import numpy as np

    rng = [95.0 + i * 0.5 for i in range(20)]  # mean ~99.75, std ~3 — too wide
    r = process_capability(rng, usl=101.0, lsl=99.0)
    assert r.cpk < 1.0
    assert "FAIL" in r.verdict
