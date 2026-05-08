# LITHOAGENT

**Semiconductor process engineering — Windows desktop calculator and Claude-powered web agent.**

[![Download for Windows](https://img.shields.io/badge/Download%20for%20Windows-Installer-5b8df7?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/OutBlade/litho-agent/releases/latest)
[![CI](https://github.com/OutBlade/litho-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/OutBlade/litho-agent/actions/workflows/ci.yml)
[![Release](https://github.com/OutBlade/litho-agent/actions/workflows/release.yml/badge.svg)](https://github.com/OutBlade/litho-agent/actions/workflows/release.yml)
[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/)

---

<p align="center">
  <img src="docs/screenshots/lithography.png" alt="LithoAgent — Lithography panel showing resolution and DOF curves vs NA with EUV vs DUV comparison table" width="100%">
</p>

<p align="center">
  <img src="docs/screenshots/implantation.png" alt="LithoAgent — Implantation panel showing Gaussian concentration profile on a log-scale chart with junction depth" width="100%">
</p>

---

## Features

**Desktop app — four real-time panels**

- Lithography: Rayleigh resolution and depth of focus curves vs NA on a dual-axis live chart; EUV vs DUV comparison table showing required k1, DOF ratio, and multi-patterning passes for any target CD
- Oxidation: Deal-Grove oxide thickness vs time with a full 800–1200 °C family of curves; current temperature highlighted; regime indicator (linear / mixed / parabolic); live rate constants B/A and B
- Implantation: Gaussian concentration profile on a log-scale chart with background doping line; real-time Rp, dRp, peak concentration, and junction depth from SRIM range data for B, P, As, BF2
- Yield: Murphy and Poisson yield curves vs defect density D0 for the current die geometry; dies per wafer and good dies per wafer updated instantly; 200 mm and 300 mm wafer support
- All charts powered by Chart.js with a dark semiconductor-tool aesthetic; sub-100 ms animation on every slider move

**Web agent — Claude tool use**

- Ask process questions in plain language; the agent picks the right model, runs the calculation, and explains the physics
- Streamlit sidebar provides standalone interactive plots (resolution vs NA, implant profiles) without an API key
- 16 unit tests covering all four calculation modules — no API key required

---

## Desktop App

```
cd desktop
npm install
npm start
```

Sliders and radio buttons update every chart in real time — no submit button.

| Control | Effect |
|---|---|
| Wavelength toggle (EUV / DUV) | Switches between 13.5 nm and 193 nm; NA slider clamps to physical maximum |
| NA slider | Moves the highlighted operating point on the resolution / DOF chart |
| k1 / k2 sliders | Adjusts process factors; resolution and DOF update instantly |
| Temperature slider | Highlights the nearest curve in the oxidation family; recalculates rate constants |
| Time slider | Moves the thickness result; chart time axis scales to context |
| Species / Energy / Dose | Regenerates the full Gaussian profile and recalculates junction depth |
| D0 / Die size / Wafer | Redraws the yield curve; good-die count updates in the results card |

Build a signed NSIS installer:

```
npm run build
```

Output lands in `desktop/dist/`. Auto-update polls `releases/latest` on each launch and installs silently on quit.

---

## Web Agent

```
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
streamlit run app.py
```

Example questions:

- *What resolution can EUV reach at NA = 0.33?*
- *How long to grow 8 nm dry SiO2 at 900 °C on Si(100)?*
- *Compare EUV and DUV ArF immersion for a 7 nm half-pitch.*
- *Junction depth for boron at 1×10¹⁴ cm⁻², 80 keV, into a 10¹⁷ cm⁻³ p-well?*
- *Murphy yield for D0 = 0.5 cm⁻² on a 100 mm² die, 300 mm wafer?*
- *Given these overlay measurements, is the process within ±3 nm spec?*

Run tests (no API key needed):

```
pytest tests/ -v
```

---

## Project Structure

```
litho-agent/
├── agent/
│   ├── core.py              Claude tool-use loop — agent layer
│   └── tools/
│       ├── lithography.py   Rayleigh, DOF, EUV vs DUV, overlay budget
│       ├── oxidation.py     Deal-Grove model — dry + wet, Si(100) + Si(111)
│       ├── implantation.py  Gaussian profiles, junction depth, sheet resistance
│       └── yield_model.py   Poisson, Murphy, SPC, Cpk, fab economics
├── desktop/
│   ├── package.json         Electron + electron-builder config; auto-update wired to this repo
│   ├── build/icon.ico       Installer icon
│   └── src/
│       ├── main.js          Electron main process — window, updater
│       ├── preload.js       Context bridge
│       ├── index.html       App shell — four-panel layout
│       ├── renderer.js      All physics models + Chart.js charts
│       └── styles.css       Dark semiconductor-tool theme
├── tests/
│   └── test_tools.py        16 unit tests — Lithography, Oxidation, Implantation, Yield
├── app.py                   Streamlit chat interface
└── requirements.txt
```

---

## Physics References

| Model | Reference |
|---|---|
| Rayleigh resolution / DOF | Born & Wolf, *Principles of Optics*; ASML NXE product specs |
| Thermal oxidation | B.E. Deal & A.S. Grove, *J. Appl. Phys.* 36, 3770 (1965) |
| Implant ranges | Ziegler, SRIM-2013; Jaeger, *Introduction to Microelectronic Fabrication*, Table 3.1 |
| Yield — Murphy | W.J. Murphy, *Proc. IEEE* 52, 1537 (1964) |
| Yield — Poisson | Standard Poisson defect distribution |
| SPC / Cpk | Montgomery, *Introduction to Statistical Quality Control* |

Models reproduce textbook results and are suitable for first-order process planning and education. They are intentionally simplified relative to production TCAD tools such as Sentaurus or Athena.

---

## License

MIT
