# LithoAgent

**Semiconductor process engineering assistant — AI-powered web agent and Windows desktop calculator.**

[![Download for Windows](https://img.shields.io/badge/Download%20for%20Windows-Installer-5b8df7?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/OutBlade/litho-agent/releases/latest)
[![CI](https://github.com/OutBlade/litho-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/OutBlade/litho-agent/actions/workflows/ci.yml)
[![Release](https://github.com/OutBlade/litho-agent/actions/workflows/release.yml/badge.svg)](https://github.com/OutBlade/litho-agent/actions/workflows/release.yml)
[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/)

---

LithoAgent ships as two complementary tools built on the same physical models. The **desktop app** is a standalone Windows calculator — four interactive panels with real-time charts, no internet connection or API key required. The **web agent** wraps the same calculations behind a Claude-powered chat interface: ask a question in plain language, get a precise answer backed by the physics.

Both tools target the domain that matters to semiconductor manufacturing: optical lithography resolution limits, thermal oxidation kinetics, ion implantation profiles, and fab yield economics.

---

## Desktop App — Windows

Four modules, all updating in real time as you drag sliders.

| Module | What it shows |
|---|---|
| Lithography | Rayleigh resolution and DOF curves vs NA, live EUV vs DUV comparison table |
| Oxidation | Deal-Grove thickness vs time, full 800–1200 °C family of curves, regime indicator |
| Implantation | Gaussian concentration profile on a log-scale chart, junction depth, sheet resistance |
| Yield | Murphy and Poisson yield vs D0, dies per wafer, good dies per wafer |

```
cd desktop
npm install
npm start
```

Build a signed NSIS installer:

```
npm run build
```

---

## Web Agent — Python

Claude-backed tool-use agent. Ask process questions in plain language; the agent selects the right model, runs the calculation, and explains the physics.

```
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
streamlit run app.py
```

The sidebar runs standalone (resolution vs NA curve, implant profile) without an API key.

Example questions:

- *What resolution can EUV reach at NA = 0.33?*
- *How long does it take to grow 8 nm of dry SiO2 at 900 °C on Si(100)?*
- *Compare EUV and DUV ArF immersion for a 7 nm half-pitch target.*
- *Junction depth for boron at 1×10¹⁴ cm⁻², 80 keV, into a 10¹⁷ cm⁻³ p-well?*
- *Murphy yield for D0 = 0.5 cm⁻² and a 100 mm² die on a 300 mm wafer?*

---

## Tests

```
pytest tests/ -v
```

Sixteen unit tests covering all four tool modules. No API key required.

---

## Project Structure

```
litho-agent/
├── agent/
│   ├── core.py              Claude tool-use loop
│   └── tools/
│       ├── lithography.py   Rayleigh, DOF, EUV vs DUV, overlay budget
│       ├── oxidation.py     Deal-Grove model — dry + wet, Si(100) + Si(111)
│       ├── implantation.py  Gaussian profiles, junction depth, sheet resistance
│       └── yield_model.py   Poisson, Murphy, SPC, Cpk, fab economics
├── desktop/
│   ├── package.json         Electron + electron-builder config
│   ├── build/icon.ico       BLADE logo installer icon
│   └── src/
│       ├── main.js          Electron main process + auto-updater
│       ├── preload.js       Context bridge
│       ├── index.html       App shell — four panel layout
│       ├── renderer.js      All physics calculations + Chart.js charts
│       └── styles.css       Dark theme
├── tests/
│   └── test_tools.py        16 unit tests
├── app.py                   Streamlit chat interface
└── requirements.txt
```

---

## Physics References

| Model | Reference |
|---|---|
| Rayleigh resolution / DOF | Born & Wolf, *Principles of Optics*; ASML NXE product specs |
| Thermal oxidation | B.E. Deal & A.S. Grove, *J. Appl. Phys.* 36, 3770 (1965) |
| Ion implantation ranges | Ziegler, SRIM-2013; Jaeger, *Introduction to Microelectronic Fabrication*, Table 3.1 |
| Yield — Murphy | W.J. Murphy, *Proc. IEEE* 52, 1537 (1964) |
| Yield — Poisson | Standard Poisson defect distribution model |
| SPC / Cpk | Montgomery, *Introduction to Statistical Quality Control* |

Models reproduce textbook results and are suitable for first-order process planning and education. They are intentionally simplified relative to production TCAD tools (Sentaurus, Athena).

---

## License

MIT
