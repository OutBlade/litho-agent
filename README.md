# LithoAgent

AI-powered semiconductor process engineering assistant. Ask questions in plain language; get precise answers backed by physical models.

Built on the same architectural pattern as [vercel-labs/open-agents](https://github.com/vercel-labs/open-agents): a chat web UI drives a Claude agent that dispatches to a tool sandbox. Here the sandbox is a set of validated Python process models instead of a VM with a shell.

```
Streamlit UI  →  Agent (Claude tool-use loop)  →  Process tool sandbox
```

---

## What it can calculate

**Lithography**
- Rayleigh resolution and depth of focus for any wavelength / NA combination
- EUV (13.5 nm) vs DUV ArF immersion (193 nm) comparison — required k1, DOF, multi-patterning steps
- CD sensitivity to dose and focus variation
- Overlay budget breakdown for multi-layer stacks

**Thermal oxidation (Deal-Grove)**
- Oxide thickness for given time, temperature, orientation, and ambient (dry/wet)
- Time required to reach a target thickness
- Temperature sensitivity — how thermal budget scales with process temperature

**Ion implantation**
- Gaussian concentration profiles for B, P, As, BF2 at arbitrary dose and energy
- Metallurgical junction depth vs background doping
- Sheet resistance estimate from dose and species mobility

**Yield engineering**
- Poisson and Murphy yield models
- Dies per wafer (standard area formula)
- Cost per good die incorporating yield, wafer cost, and tool cost
- Process capability (Cp, Cpk) and Shewhart SPC control limits

---

## Quick start

```bash
git clone https://github.com/OutBlade/litho-agent
cd litho-agent
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
streamlit run app.py
```

The sidebar provides standalone interactive plots (resolution vs NA, implant profiles) that work without an API key.

---

## Running tests

```bash
pytest tests/ -v
```

All tests are purely computational — no API key required.

---

## Example questions

- *What resolution can EUV achieve at NA = 0.33?*
- *How long does it take to grow 8 nm of gate oxide at 900°C in dry O2 on Si(100)?*
- *Compare EUV and DUV for a 7 nm half-pitch target.*
- *What is the junction depth for a boron implant at 1e14 cm-2, 80 keV into p-well doping of 1e17 cm-3?*
- *If defect density is 0.5 cm-2 and die area is 200 mm2, what is the Murphy yield?*
- *Given these 20 overlay measurements, is the process in spec at ±3 nm?*

---

## Project structure

```
litho-agent/
├── agent/
│   ├── core.py              # Claude tool-use loop — the agent layer
│   └── tools/
│       ├── lithography.py   # Rayleigh, DOF, EUV vs DUV, overlay
│       ├── oxidation.py     # Deal-Grove model (dry + wet, 100/111)
│       ├── implantation.py  # Gaussian profiles, junction depth, Rs
│       └── yield_model.py   # Poisson, Murphy, SPC, Cpk, economics
├── tests/
│   └── test_tools.py        # 16 unit tests, no API key required
├── app.py                   # Streamlit chat UI + sidebar calculators
└── requirements.txt
```

---

## Model sources

| Model | Reference |
|---|---|
| Oxidation | B.E. Deal & A.S. Grove, *J. Appl. Phys.* 36, 3770 (1965) |
| Implantation ranges | Ziegler SRIM-2013 / Jaeger Table 3.1 |
| Rayleigh / DOF | Born & Wolf *Principles of Optics*; ASML NXE specs |
| Murphy yield | W.J. Murphy, *Proc. IEEE* 52, 1537 (1964) |
| SPC / Cpk | Montgomery *Introduction to Statistical Quality Control* |

Models are intentionally simplified relative to production TCAD tools (Sentaurus, Athena). They reproduce textbook results and are suitable for first-order process planning and education.
