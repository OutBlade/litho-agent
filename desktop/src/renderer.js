'use strict'

// ── Navigation ──────────────────────────────────────────────────────────────

const navItems = document.querySelectorAll('.nav-item')
const panels   = document.querySelectorAll('.panel')

navItems.forEach(btn => btn.addEventListener('click', () => {
  navItems.forEach(b => b.classList.remove('active'))
  panels.forEach(p => p.classList.remove('active'))
  btn.classList.add('active')
  document.getElementById(`panel-${btn.dataset.panel}`).classList.add('active')
}))

// ── Chart.js global defaults ────────────────────────────────────────────────

Chart.defaults.color       = '#8a8a96'
Chart.defaults.borderColor = '#2c2c32'
Chart.defaults.font.family = '-apple-system, "Segoe UI", system-ui, sans-serif'
Chart.defaults.font.size   = 11

const TOOLTIP = {
  backgroundColor: '#1c1c20',
  borderColor:     '#2c2c32',
  borderWidth:     1,
  titleColor:      '#f0f0f2',
  bodyColor:       '#8a8a96',
  padding:         9,
}

const GRID_COLOR = '#1c1c22'

const C1 = '#5b8df7'
const C2 = '#22d3ee'
const C3 = '#34d399'
const C4 = '#a78bfa'
const C5 = '#fb923c'
const C6 = '#f472b6'
const CA = '#d97757'

function axisCommon(extraY) {
  return {
    grid:  { color: GRID_COLOR },
    ticks: { color: '#8a8a96', ...(extraY || {}) },
  }
}

// ── Physics constants ───────────────────────────────────────────────────────

const kB = 8.617e-5  // eV/K

// ── Lithography (Rayleigh) ──────────────────────────────────────────────────

function rayleigh(wl, na, k1) { return k1 * wl / na }
function dof(wl, na, k2)      { return k2 * wl / (na * na) }

// Aerial image contrast: NILS-based approximation (higher k1 → lower contrast)
function aerialContrast(k1) {
  // Simplified model: contrast ≈ 1 - 2*(k1 - 0.25) / 0.75
  return Math.max(0.05, Math.min(1.0, 1.0 - 1.3 * (k1 - 0.25)))
}

// ── Deal-Grove oxidation ────────────────────────────────────────────────────

const DG = {
  '100_dry': { B0: 772,    Ea_B: 1.23, BA0: 6.23e6,  Ea_BA: 2.00 },
  '111_dry': { B0: 772,    Ea_B: 1.23, BA0: 1.69e7,  Ea_BA: 2.00 },
  '100_wet': { B0: 386,    Ea_B: 0.78, BA0: 1.63e8,  Ea_BA: 2.05 },
  '111_wet': { B0: 386,    Ea_B: 0.78, BA0: 2.05e8,  Ea_BA: 2.05 },
}

function dgConsts(tempC, orient, ambient) {
  const p  = DG[`${orient}_${ambient}`]
  const T  = tempC + 273.15
  const B  = p.B0  * Math.exp(-p.Ea_B  / (kB * T))
  const BA = p.BA0 * Math.exp(-p.Ea_BA / (kB * T))
  return { A: B / BA, B, BA }
}

function oxThickNm(timeMin, tempC, orient, ambient) {
  const { A, B } = dgConsts(tempC, orient, ambient)
  const t = timeMin / 60
  return 1000 * (-A + Math.sqrt(A * A + 4 * B * t)) / 2
}

// ── Implantation (Gaussian) ─────────────────────────────────────────────────

const RANGES = {
  boron:      { 20:[0.065,0.028], 40:[0.130,0.046], 80:[0.250,0.069], 100:[0.307,0.076], 200:[0.540,0.099] },
  phosphorus: { 20:[0.027,0.013], 40:[0.047,0.020], 80:[0.088,0.034], 100:[0.108,0.040], 200:[0.240,0.072] },
  arsenic:    { 20:[0.016,0.007], 40:[0.024,0.010], 80:[0.042,0.016], 100:[0.050,0.019], 200:[0.094,0.034] },
  bf2:        { 20:[0.017,0.008], 40:[0.027,0.012], 80:[0.047,0.019], 100:[0.057,0.023], 200:[0.109,0.040] },
}

function lerp(xs, ys, x) {
  if (x <= xs[0]) return ys[0]
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1]
  for (let i = 0; i < xs.length - 1; i++) {
    if (x >= xs[i] && x <= xs[i + 1]) {
      const t = (x - xs[i]) / (xs[i + 1] - xs[i])
      return ys[i] + t * (ys[i + 1] - ys[i])
    }
  }
}

function implRange(species, eKeV) {
  const data = RANGES[species]
  const Es   = Object.keys(data).map(Number).sort((a, b) => a - b)
  return {
    rp:  lerp(Es, Es.map(e => data[e][0]), eKeV),
    drp: lerp(Es, Es.map(e => data[e][1]), eKeV),
  }
}

function gaussProfile(doseLog, eKeV, species, nPts = 280) {
  const dose = Math.pow(10, doseLog)
  const { rp, drp } = implRange(species, eKeV)
  const rpNm  = rp  * 1000
  const drpNm = drp * 1000
  const peak  = dose / (Math.sqrt(2 * Math.PI) * drp * 1e-4)
  const xMax  = rpNm + 4.5 * drpNm
  const depths = Array.from({ length: nPts }, (_, i) => i * xMax / (nPts - 1))
  const concs  = depths.map(d => peak * Math.exp(-((d * 1e-3 - rp) ** 2) / (2 * drp ** 2)))
  return { depths, concs, rpNm, drpNm, peak }
}

function junctionDepth(doseLog, eKeV, species, bgLog) {
  const dose = Math.pow(10, doseLog)
  const bg   = Math.pow(10, bgLog)
  const { rp, drp } = implRange(species, eKeV)
  const peak = dose / (Math.sqrt(2 * Math.PI) * drp * 1e-4)
  if (peak <= bg) return null
  return (rp + drp * Math.sqrt(2 * Math.log(peak / bg))) * 1000
}

// ── Process Window (Bossung) ────────────────────────────────────────────────

function bossungCD(wl, na, k1, k2, focusNm, doseRel) {
  const CDnom = rayleigh(wl, na, k1)
  const DOF   = dof(wl, na, k2)
  return CDnom * (1 + 0.25 * (focusNm / DOF) ** 2) * Math.pow(doseRel, -0.50)
}

// Exposure latitude: dose range keeping CD within ±10% of CDnom at best focus
// Solve: CDnom*(1+0.25*(f/DOF)^2)*d^(-0.5) = 1.1*CDnom → d = (1/1.1)^2 = 0.826 (high dose limit)
//        CDnom*(1+0.25*(f/DOF)^2)*d^(-0.5) = 0.9*CDnom → d = (1/0.9)^2 = 1.235 (low dose limit)
// EL% = (dHigh - dLow) / dNom * 100, but at best focus factor = 1:
//   CDnom * dLow^(-0.5) = 0.9*CDnom → dLow = (1/0.9)^2
//   CDnom * dHigh^(-0.5) = 1.1*CDnom → dHigh = (1/1.1)^2
function exposureLatitude() {
  const dLow  = Math.pow(1 / 0.9,  2)  // 1.2346
  const dHigh = Math.pow(1 / 1.1, 2)   // 0.8264
  return (dLow - dHigh) / 1.0 * 100    // % relative to nominal
}

function meef(k1) {
  return 1 + 1.5 * (0.5 - k1)
}

// ── EUV throughput & stochastics ────────────────────────────────────────────

function euvWPH(sourcePowerW, doseMJcm2, etaMirrorsPercent, pelliclePercent, fieldWmm, fieldHmm) {
  const eta_optical = Math.pow(etaMirrorsPercent / 100, 6) * (pelliclePercent / 100)
  const P_wafer     = sourcePowerW * eta_optical
  if (P_wafer <= 0) return 0
  const fieldArea_cm2 = (fieldWmm / 10) * (fieldHmm / 10)
  const dose_J        = doseMJcm2 * 1e-3
  const t_expose      = (dose_J * fieldArea_cm2) / P_wafer
  const R = 150 - 3
  const A_die = fieldWmm * fieldHmm
  const nFields = Math.max(1, Math.floor(Math.PI * R * R / A_die - Math.PI * (300 - 6) / Math.sqrt(2 * A_die)))
  const tWafer  = nFields * t_expose * 1.15 + 30
  return 3600 / tWafer
}

function euvOpticalEta(etaMirrorsPercent, pelliclePercent) {
  return Math.pow(etaMirrorsPercent / 100, 6) * (pelliclePercent / 100)
}

function euvLWR(doseMJcm2, resistAbsorption) {
  const ra      = (resistAbsorption === undefined) ? 0.30 : resistAbsorption
  const E_phot  = 1.471e-17
  const N_per_cm2 = (doseMJcm2 * 1e-3) * ra / E_phot
  const N_per_nm2 = N_per_cm2 * 1e-14
  if (N_per_nm2 <= 0) return 999
  return 8 / Math.sqrt(N_per_nm2)
}

// Solve LWR = target for dose: N = (8/LWR)^2, dose = N * E_phot / (ra * 1e-14) * 1e3 mJ/cm2
function euvMinDose(lwrTarget, resistAbsorption) {
  const ra      = (resistAbsorption === undefined) ? 0.30 : resistAbsorption
  const E_phot  = 1.471e-17
  const N_nm2   = (8 / lwrTarget) ** 2
  const N_cm2   = N_nm2 / 1e-14
  const dose_J  = N_cm2 * E_phot / ra
  return dose_J * 1e3  // mJ/cm²
}

// ── Diffusion (Fick erfc) ───────────────────────────────────────────────────

const DIFF_PARAMS = {
  boron:      { D0: 10.5, Ea: 3.69 },
  phosphorus: { D0: 39.0, Ea: 3.66 },
  arsenic:    { D0: 32.0, Ea: 4.05 },
}

function diffusivity(species, tempC) {
  const p = DIFF_PARAMS[species]
  return p.D0 * Math.exp(-p.Ea / (kB * (tempC + 273.15)))
}

function erfcApprox(x) {
  if (x < 0) return 2 - erfcApprox(-x)
  const t    = 1 / (1 + 0.3275911 * x)
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
  return poly * Math.exp(-x * x)
}

function diffProfile(nsLog, tempC, timeMin, species, bgLog, nPts) {
  const pts   = nPts || 250
  const D     = diffusivity(species, tempC)
  const Dt    = D * timeMin * 60
  const sqDt  = Math.sqrt(Dt)
  const sqDtNm = sqDt * 1e7
  const Ns    = Math.pow(10, nsLog)
  const Nbg   = Math.pow(10, bgLog)
  const xMax  = sqDtNm * 6
  const depths = Array.from({ length: pts }, (_, i) => i * xMax / (pts - 1))
  const concs  = depths.map(x => {
    const arg = (x * 1e-7) / (2 * sqDt)
    return Math.max(Ns * erfcApprox(arg), Nbg * 1e-3)
  })
  let xj = null
  for (let i = 0; i < concs.length - 1; i++) {
    if (concs[i] >= Nbg && concs[i + 1] < Nbg) {
      xj = depths[i] + (depths[i + 1] - depths[i]) * (Nbg - concs[i]) / (concs[i + 1] - concs[i])
      break
    }
  }
  return { depths, concs, xj, sqrtDtNm: sqDtNm.toFixed(1), D_cm2s: D }
}

// ── Etch (ARDE) ─────────────────────────────────────────────────────────────

const ETCH_RATES = {
  'SiO2':    { base: 80,  select_to_pr: 5,  select_to_si: 0.1, arde_alpha: 0.35 },
  'Si3N4':   { base: 60,  select_to_pr: 8,  select_to_si: 0.2, arde_alpha: 0.40 },
  'poly-Si': { base: 200, select_to_pr: 12, select_to_si: 50,  arde_alpha: 0.30 },
  'metal':   { base: 150, select_to_pr: 6,  select_to_si: 3,   arde_alpha: 0.25 },
}

function etchRateARDE(material, aspectRatio, powerScale) {
  const ps = (powerScale === undefined) ? 1.0 : powerScale
  const p  = ETCH_RATES[material]
  return p.base * ps * Math.exp(-p.arde_alpha * aspectRatio)
}

// ── Overlay RSS ─────────────────────────────────────────────────────────────

function overlayRSS(contributors) {
  const sumSq = contributors.reduce((s, c) => s + c.value * c.value, 0)
  return Math.sqrt(sumSq)
}

// ── Yield models ────────────────────────────────────────────────────────────

function murphyYield(D0, A) {
  const x = D0 * A
  if (x < 1e-9) return 1
  return ((1 - Math.exp(-x)) / x) ** 2
}

function poissonYield(D0, A) { return Math.exp(-D0 * A) }

function dpw(diam, w, h, edge) {
  const eg = (edge === undefined) ? 3 : edge
  const R  = diam / 2 - eg
  const A  = w * h
  return Math.max(0, Math.floor(Math.PI * R * R / A - Math.PI * (diam - 2 * eg) / Math.sqrt(2 * A)))
}

// ── Helper: make or update a chart ─────────────────────────────────────────

function makeChart(id, config) {
  const ctx = document.getElementById(id).getContext('2d')
  return new Chart(ctx, config)
}

// ── Panel: Optics ───────────────────────────────────────────────────────────

let opticsChart

function buildOpticsChart() {
  opticsChart = makeChart('optics-chart', {
    data: {
      labels: [],
      datasets: [
        {
          type: 'line', label: 'Resolution (nm)',
          data: [], yAxisID: 'y',
          borderColor: C1, backgroundColor: 'rgba(91,141,247,0.10)',
          fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2,
        },
        {
          type: 'line', label: 'DOF (nm)',
          data: [], yAxisID: 'y2',
          borderColor: C2, backgroundColor: 'transparent',
          borderDash: [5, 3], tension: 0.4, pointRadius: 0, borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 80 },
      plugins: {
        legend: { position: 'top', labels: { color: '#8a8a96', boxWidth: 12, padding: 14 } },
        tooltip: TOOLTIP,
      },
      scales: {
        x:  { ...axisCommon(), title: { display: true, text: 'NA', color: '#8a8a96' } },
        y:  { ...axisCommon({ color: C1 }), title: { display: true, text: 'Resolution (nm)', color: C1 } },
        y2: {
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: C2 },
          title: { display: true, text: 'DOF (nm)', color: C2 },
        },
      },
    },
  })
}

function updateOptics() {
  const wl     = parseFloat(document.querySelector('input[name="wl"]:checked').value)
  const k1     = parseFloat(document.getElementById('k1-slider').value)
  const k2     = parseFloat(document.getElementById('k2-slider').value)
  const naMax  = wl < 100 ? 0.55 : 1.35
  const naSlider = document.getElementById('na-slider')
  naSlider.max = naMax
  if (parseFloat(naSlider.value) > naMax) naSlider.value = naMax
  const na = parseFloat(naSlider.value)

  document.getElementById('na-val').textContent = na.toFixed(2)
  document.getElementById('k1-val').textContent = k1.toFixed(2)
  document.getElementById('k2-val').textContent = k2.toFixed(2)

  const N    = 120
  const naArr = Array.from({ length: N }, (_, i) => 0.10 + i * (naMax - 0.10) / (N - 1))

  opticsChart.data.labels            = naArr.map(n => n.toFixed(2))
  opticsChart.data.datasets[0].data  = naArr.map(n => rayleigh(wl, n, k1))
  opticsChart.data.datasets[1].data  = naArr.map(n => dof(wl, n, k2))
  opticsChart.update()

  const res  = rayleigh(wl, na, k1)
  const df   = dof(wl, na, k2)
  const aic  = aerialContrast(k1)

  document.getElementById('res-val').textContent = res.toFixed(1)
  document.getElementById('dof-val').textContent = df.toFixed(1)
  document.getElementById('aic-val').textContent = aic.toFixed(3)
  document.getElementById('cdd-val').textContent = (0.4 * res / 100).toFixed(3)

  const targetCD  = res
  const euvNA     = Math.min(0.55, targetCD > 0 ? 0.25 * 13.5 / targetCD : 0.33)
  const euvDOF    = dof(13.5, euvNA, k2)
  const duvDOF    = dof(193, 1.35, k2)
  const duvSingle = rayleigh(193, 1.35, 0.28)
  const passes    = Math.max(1, Math.ceil(duvSingle / targetCD))

  document.getElementById('cmp-euv-na').textContent     = euvNA.toFixed(2)
  document.getElementById('cmp-euv-dof').textContent    = euvDOF.toFixed(0) + ' nm'
  document.getElementById('cmp-duv-dof').textContent    = duvDOF.toFixed(0) + ' nm'
  document.getElementById('cmp-duv-passes').textContent = passes + 'x'
}

// ── Panel: Process Window ───────────────────────────────────────────────────

let bossungChart, elChart

function buildProcWinCharts() {
  bossungChart = makeChart('bossung-chart', {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: '80% dose',  data: [], borderColor: C3, backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.8, tension: 0.4 },
        { label: '100% dose', data: [], borderColor: C1, backgroundColor: 'rgba(91,141,247,0.12)', fill: true, pointRadius: 0, borderWidth: 2.2, tension: 0.4 },
        { label: '120% dose', data: [], borderColor: C5, backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.8, tension: 0.4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 80 },
      plugins: {
        legend: { position: 'top', labels: { color: '#8a8a96', boxWidth: 12, padding: 12 } },
        tooltip: TOOLTIP,
      },
      scales: {
        x: { ...axisCommon(), title: { display: true, text: 'Focus offset (nm)', color: '#8a8a96' } },
        y: { ...axisCommon(), title: { display: true, text: 'CD (nm)', color: '#8a8a96' } },
      },
    },
  })

  elChart = makeChart('el-chart', {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'EL (%)',  data: [], yAxisID: 'yel',  borderColor: C4, backgroundColor: 'rgba(167,139,250,0.10)', fill: true, pointRadius: 0, borderWidth: 2, tension: 0.4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 80 },
      plugins: {
        legend: { position: 'top', labels: { color: '#8a8a96', boxWidth: 12, padding: 12 } },
        tooltip: TOOLTIP,
      },
      scales: {
        x:   { ...axisCommon(), title: { display: true, text: 'DOF (nm)', color: '#8a8a96' } },
        yel: { ...axisCommon(), title: { display: true, text: 'Exposure latitude (%)', color: C4 }, ticks: { color: C4 } },
      },
    },
  })
}

function updateProcWin() {
  const wl    = parseFloat(document.querySelector('input[name="pw-wl"]:checked').value)
  const na    = parseFloat(document.getElementById('pw-na').value)
  const k1    = parseFloat(document.getElementById('pw-k1').value)
  const k2    = parseFloat(document.getElementById('pw-k2').value)

  document.getElementById('pw-na-val').textContent   = na.toFixed(2)
  document.getElementById('pw-k1-val').textContent   = k1.toFixed(2)
  document.getElementById('pw-k2-val').textContent   = k2.toFixed(2)
  document.getElementById('pw-dose-val').textContent = document.getElementById('pw-dose').value

  const CDnom  = rayleigh(wl, na, k1)
  const DOF    = dof(wl, na, k2)
  const fMax   = DOF * 1.5
  const N      = 100
  const fArr   = Array.from({ length: N }, (_, i) => -fMax + 2 * fMax * i / (N - 1))

  bossungChart.data.labels            = fArr.map(f => f.toFixed(0))
  bossungChart.data.datasets[0].data  = fArr.map(f => bossungCD(wl, na, k1, k2, f, 0.80))
  bossungChart.data.datasets[1].data  = fArr.map(f => bossungCD(wl, na, k1, k2, f, 1.00))
  bossungChart.data.datasets[2].data  = fArr.map(f => bossungCD(wl, na, k1, k2, f, 1.20))
  bossungChart.update()

  // EL vs DOF across a range of NAs
  const naRange = Array.from({ length: 50 }, (_, i) => 0.1 + i * (Math.min(na * 2, wl < 100 ? 0.55 : 1.35) - 0.1) / 49)
  const el = exposureLatitude()
  elChart.data.labels            = naRange.map(n => dof(wl, n, k2).toFixed(0))
  elChart.data.datasets[0].data  = naRange.map(() => el)
  elChart.update()

  const mf = meef(k1)
  document.getElementById('pw-cd-val').textContent   = CDnom.toFixed(1)
  document.getElementById('pw-dof-val').textContent  = DOF.toFixed(0)
  document.getElementById('pw-el-val').textContent   = el.toFixed(1)
  document.getElementById('pw-meef-val').textContent = mf.toFixed(2)
}

// ── Panel: EUV ──────────────────────────────────────────────────────────────

let euvWphChart, euvLwrChart

function buildEuvCharts() {
  euvWphChart = makeChart('euv-wph-chart', {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'WPH', data: [], borderColor: CA, backgroundColor: 'rgba(217,119,87,0.12)', fill: true, pointRadius: 0, borderWidth: 2, tension: 0.4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 80 },
      plugins: {
        legend: { position: 'top', labels: { color: '#8a8a96', boxWidth: 12, padding: 12 } },
        tooltip: TOOLTIP,
      },
      scales: {
        x: { ...axisCommon(), title: { display: true, text: 'Source power (W)', color: '#8a8a96' } },
        y: { ...axisCommon(), title: { display: true, text: 'Wafers per hour', color: '#8a8a96' }, min: 0 },
      },
    },
  })

  euvLwrChart = makeChart('euv-lwr-chart', {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'LWR 3σ (nm)', data: [], borderColor: C6, backgroundColor: 'rgba(244,114,182,0.10)', fill: true, pointRadius: 0, borderWidth: 2, tension: 0.3 },
        { label: 'Min viable dose (LWR=2 nm)', data: [], borderColor: CA, backgroundColor: 'transparent', borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 80 },
      plugins: {
        legend: { position: 'top', labels: { color: '#8a8a96', boxWidth: 12, padding: 12 } },
        tooltip: TOOLTIP,
      },
      scales: {
        x: { ...axisCommon(), title: { display: true, text: 'Dose (mJ/cm²)', color: '#8a8a96' } },
        y: { ...axisCommon(), title: { display: true, text: 'LWR 3σ (nm)', color: '#8a8a96' }, min: 0 },
      },
    },
  })
}

function updateEuv() {
  const srcPwr  = parseFloat(document.getElementById('euv-pw').value)
  const mirPct  = parseFloat(document.getElementById('euv-mir').value)
  const pelPct  = parseFloat(document.getElementById('euv-pel').value)
  const dose    = parseFloat(document.getElementById('euv-dose').value)
  const fw      = parseFloat(document.getElementById('euv-fw').value)
  const fh      = parseFloat(document.getElementById('euv-fh').value)

  document.getElementById('euv-pw-val').textContent   = srcPwr
  document.getElementById('euv-mir-val').textContent  = mirPct.toFixed(1)
  document.getElementById('euv-pel-val').textContent  = pelPct
  document.getElementById('euv-dose-val').textContent = dose
  document.getElementById('euv-fw-val').textContent   = fw
  document.getElementById('euv-fh-val').textContent   = fh

  // WPH vs source power chart
  const pwArr = Array.from({ length: 80 }, (_, i) => 50 + i * 450 / 79)
  euvWphChart.data.labels            = pwArr.map(p => p.toFixed(0))
  euvWphChart.data.datasets[0].data  = pwArr.map(p => euvWPH(p, dose, mirPct, pelPct, fw, fh))
  euvWphChart.update()

  // LWR vs dose chart
  const doseArr = Array.from({ length: 100 }, (_, i) => 2 + i * 0.98)
  const mvd     = euvMinDose(2.0, 0.30)
  euvLwrChart.data.labels            = doseArr.map(d => d.toFixed(1))
  euvLwrChart.data.datasets[0].data  = doseArr.map(d => euvLWR(d, 0.30))
  euvLwrChart.data.datasets[1].data  = doseArr.map(() => 2.0)
  euvLwrChart.update()

  const eta      = euvOpticalEta(mirPct, pelPct)
  const pWafer   = srcPwr * eta
  const wph      = euvWPH(srcPwr, dose, mirPct, pelPct, fw, fh)
  const lwr      = euvLWR(dose, 0.30)

  document.getElementById('euv-wph-val').textContent  = wph.toFixed(1)
  document.getElementById('euv-eta-val').textContent  = (eta * 100).toFixed(3)
  document.getElementById('euv-pwaf-val').textContent = pWafer.toFixed(2)
  document.getElementById('euv-lwr-val').textContent  = lwr.toFixed(2)
  document.getElementById('euv-mvd-val').textContent  = mvd.toFixed(1)
}

// ── Panel: Oxidation ────────────────────────────────────────────────────────

let oxidChart

const OX_TEMPS  = [800, 900, 1000, 1100, 1200]
const OX_COLORS = [
  'rgba(91,141,247,0.35)',
  'rgba(91,141,247,0.55)',
  C1,
  C2,
  '#20e0e0',
]

function buildOxidChart() {
  oxidChart = makeChart('oxid-chart', {
    type: 'line',
    data: {
      labels: [],
      datasets: OX_TEMPS.map((T, i) => ({
        label: `${T} °C`,
        data: [],
        borderColor: OX_COLORS[i],
        backgroundColor: 'transparent',
        tension: 0.3, pointRadius: 0, borderWidth: 1.5,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 80 },
      plugins: {
        legend: { position: 'top', labels: { color: '#8a8a96', boxWidth: 12, padding: 12 } },
        tooltip: TOOLTIP,
      },
      scales: {
        x: { ...axisCommon(), title: { display: true, text: 'Time (min)', color: '#8a8a96' }, ticks: { maxTicksLimit: 8 } },
        y: { ...axisCommon(), title: { display: true, text: 'Oxide thickness (nm)', color: '#8a8a96' }, min: 0 },
      },
    },
  })
}

function updateOxid() {
  const temp    = parseInt(document.getElementById('ox-temp').value)
  const time    = parseInt(document.getElementById('ox-time').value)
  const ambient = document.querySelector('input[name="ambient"]:checked').value
  const orient  = document.querySelector('input[name="orient"]:checked').value

  document.getElementById('ox-temp-val').textContent = temp
  document.getElementById('ox-time-val').textContent = time

  const tMax = Math.max(time * 2, 30)
  const tArr = Array.from({ length: 100 }, (_, i) => (i + 1) * tMax / 100)

  OX_TEMPS.forEach((T, i) => {
    const near = Math.abs(T - temp) <= 60
    oxidChart.data.datasets[i].borderWidth = near ? 2.2 : 1.0
    oxidChart.data.datasets[i].borderColor = near ? OX_COLORS[i] : OX_COLORS[i].replace(')', ',0.3)').replace('rgba', 'rgba').replace('#', 'rgba(') || OX_COLORS[i] + '44'
    oxidChart.data.datasets[i].data        = tArr.map(t => oxThickNm(t, T, orient, ambient))
  })
  oxidChart.data.labels = tArr.map(t => Math.round(t))
  oxidChart.update()

  const { A, B, BA } = dgConsts(temp, orient, ambient)
  const thick  = oxThickNm(time, temp, orient, ambient)
  const xUm    = thick / 1000
  const regime = xUm < 0.5 * A ? 'linear' : xUm > 2 * A ? 'parabolic' : 'mixed'

  document.getElementById('ox-thick').textContent  = thick.toFixed(1)
  document.getElementById('ox-regime').textContent = regime
  document.getElementById('ox-ba').textContent     = (BA * 1000).toFixed(1)
  document.getElementById('ox-b').textContent      = (B * 1e6).toFixed(0)
}

// ── Panel: Implantation ─────────────────────────────────────────────────────

let implChart

function buildImplChart() {
  implChart = makeChart('impl-chart', {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'N(x)',
          data: [],
          borderColor: C4, backgroundColor: 'rgba(167,139,250,0.10)',
          fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2,
        },
        {
          label: 'Background Nb',
          data: [],
          borderColor: C5, backgroundColor: 'transparent',
          borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 80 },
      plugins: {
        legend: { position: 'top', labels: { color: '#8a8a96', boxWidth: 12, padding: 14 } },
        tooltip: {
          ...TOOLTIP,
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toExponential(2)} cm⁻³` },
        },
      },
      scales: {
        x: { ...axisCommon(), title: { display: true, text: 'Depth (nm)', color: '#8a8a96' } },
        y: {
          type: 'logarithmic',
          grid: { color: GRID_COLOR },
          ticks: { color: '#8a8a96', callback: v => v.toExponential(0) },
          title: { display: true, text: 'Concentration (cm⁻³)', color: '#8a8a96' },
        },
      },
    },
  })
}

function updateImpl() {
  const species = document.getElementById('impl-species').value
  const energy  = parseFloat(document.getElementById('impl-energy').value)
  const doseLog = parseFloat(document.getElementById('impl-dose').value)
  const bgLog   = parseFloat(document.getElementById('impl-bg').value)

  document.getElementById('impl-e-val').textContent  = energy
  document.getElementById('impl-d-val').textContent  = doseLog.toFixed(1)
  document.getElementById('impl-bg-val').textContent = bgLog.toFixed(1)

  const { depths, concs, rpNm, drpNm, peak } = gaussProfile(doseLog, energy, species)
  const bg = Math.pow(10, bgLog)

  implChart.data.labels               = depths.map(d => d.toFixed(0))
  implChart.data.datasets[0].data     = concs.map(c => Math.max(c, bg * 0.001))
  implChart.data.datasets[1].data     = depths.map(() => bg)
  implChart.update()

  const xj = junctionDepth(doseLog, energy, species, bgLog)
  document.getElementById('impl-rp').textContent   = rpNm.toFixed(1)
  document.getElementById('impl-drp').textContent  = drpNm.toFixed(1)
  document.getElementById('impl-peak').textContent = peak.toExponential(2)
  document.getElementById('impl-xj').textContent   = xj ? xj.toFixed(1) : 'none'
}

// ── Panel: Diffusion ────────────────────────────────────────────────────────

let diffProfileChart, diffXjChart

function buildDiffCharts() {
  diffProfileChart = makeChart('diff-profile-chart', {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'N(x)', data: [], borderColor: C3, backgroundColor: 'rgba(52,211,153,0.10)', fill: true, pointRadius: 0, borderWidth: 2, tension: 0.3 },
        { label: 'Background', data: [], borderColor: C5, backgroundColor: 'transparent', borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 80 },
      plugins: {
        legend: { position: 'top', labels: { color: '#8a8a96', boxWidth: 12, padding: 12 } },
        tooltip: {
          ...TOOLTIP,
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toExponential(2)} cm⁻³` },
        },
      },
      scales: {
        x: { ...axisCommon(), title: { display: true, text: 'Depth (nm)', color: '#8a8a96' } },
        y: {
          type: 'logarithmic',
          grid: { color: GRID_COLOR },
          ticks: { color: '#8a8a96', callback: v => v.toExponential(0) },
          title: { display: true, text: 'Concentration (cm⁻³)', color: '#8a8a96' },
        },
      },
    },
  })

  diffXjChart = makeChart('diff-xj-chart', {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'xj (nm)', data: [], borderColor: C2, backgroundColor: 'rgba(34,211,238,0.10)', fill: true, pointRadius: 0, borderWidth: 2, tension: 0.4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 80 },
      plugins: {
        legend: { position: 'top', labels: { color: '#8a8a96', boxWidth: 12, padding: 12 } },
        tooltip: TOOLTIP,
      },
      scales: {
        x: { ...axisCommon(), title: { display: true, text: 'Anneal time (min)', color: '#8a8a96' } },
        y: { ...axisCommon(), title: { display: true, text: 'Junction depth (nm)', color: '#8a8a96' }, min: 0 },
      },
    },
  })
}

function updateDiff() {
  const species = document.getElementById('diff-species').value
  const tempC   = parseFloat(document.getElementById('diff-temp').value)
  const timeMin = parseFloat(document.getElementById('diff-time').value)
  const nsLog   = parseFloat(document.getElementById('diff-ns').value)
  const bgLog   = parseFloat(document.getElementById('diff-bg').value)

  document.getElementById('diff-temp-val').textContent = tempC
  document.getElementById('diff-time-val').textContent = timeMin
  document.getElementById('diff-ns-val').textContent   = nsLog.toFixed(1)
  document.getElementById('diff-bg-val').textContent   = bgLog.toFixed(1)

  const { depths, concs, xj, sqrtDtNm, D_cm2s } = diffProfile(nsLog, tempC, timeMin, species, bgLog)
  const Nbg = Math.pow(10, bgLog)

  diffProfileChart.data.labels               = depths.map(d => d.toFixed(0))
  diffProfileChart.data.datasets[0].data     = concs
  diffProfileChart.data.datasets[1].data     = depths.map(() => Nbg)
  diffProfileChart.update()

  // Junction depth vs time (at current temp and species)
  const tMax  = Math.max(timeMin * 2, 60)
  const tArr  = Array.from({ length: 80 }, (_, i) => (i + 1) * tMax / 80)
  const xjArr = tArr.map(t => {
    const { xj: xjt } = diffProfile(nsLog, tempC, t, species, bgLog)
    return xjt || 0
  })
  diffXjChart.data.labels               = tArr.map(t => Math.round(t))
  diffXjChart.data.datasets[0].data     = xjArr
  diffXjChart.update()

  document.getElementById('diff-D-val').textContent      = D_cm2s.toExponential(3)
  document.getElementById('diff-sqrtDt-val').textContent = sqrtDtNm
  document.getElementById('diff-xj-val').textContent     = xj ? xj.toFixed(1) : 'none'
}

// ── Panel: Etch ─────────────────────────────────────────────────────────────

let etchChart

function buildEtchChart() {
  const mats = Object.keys(ETCH_RATES)
  const matColors = [C1, C2, C3, C5]

  etchChart = makeChart('etch-chart', {
    type: 'line',
    data: {
      labels: [],
      datasets: mats.map((m, i) => ({
        label: m,
        data: [],
        borderColor: matColors[i],
        backgroundColor: 'transparent',
        pointRadius: 0, borderWidth: 1.8, tension: 0.3,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 80 },
      plugins: {
        legend: { position: 'top', labels: { color: '#8a8a96', boxWidth: 12, padding: 12 } },
        tooltip: TOOLTIP,
      },
      scales: {
        x: { ...axisCommon(), title: { display: true, text: 'Aspect ratio', color: '#8a8a96' } },
        y: { ...axisCommon(), title: { display: true, text: 'Etch rate (nm/min)', color: '#8a8a96' }, min: 0 },
      },
    },
  })
}

function updateEtch() {
  const mat    = document.getElementById('etch-mat').value
  const depth  = parseFloat(document.getElementById('etch-depth').value)
  const width  = parseFloat(document.getElementById('etch-width').value)
  const pwr    = parseFloat(document.getElementById('etch-pwr').value)

  document.getElementById('etch-depth-val').textContent = depth
  document.getElementById('etch-width-val').textContent = width
  document.getElementById('etch-pwr-val').textContent   = pwr.toFixed(2)

  const ar     = depth / width
  const arMax  = Math.max(ar * 1.8, 10)
  const arArr  = Array.from({ length: 80 }, (_, i) => i * arMax / 79)
  const mats   = Object.keys(ETCH_RATES)

  mats.forEach((m, i) => {
    etchChart.data.datasets[i].data = arArr.map(a => etchRateARDE(m, a, pwr))
  })
  etchChart.data.labels = arArr.map(a => a.toFixed(1))
  etchChart.update()

  const rate = etchRateARDE(mat, ar, pwr)
  const time = depth / rate

  document.getElementById('etch-ar-val').textContent   = ar.toFixed(2)
  document.getElementById('etch-rate-val').textContent = rate.toFixed(1)
  document.getElementById('etch-time-val').textContent = time.toFixed(2)

  const tbody = document.getElementById('etch-select-tbody')
  tbody.innerHTML = ''
  mats.forEach(m => {
    const p      = ETCH_RATES[m]
    const prCls  = p.select_to_pr >= 8 ? 'hi' : p.select_to_pr <= 3 ? 'lo' : ''
    const siCls  = p.select_to_si >= 10 ? 'hi' : p.select_to_si <= 0.5 ? 'lo' : ''
    const bold   = m === mat ? ' style="color:var(--cl-text)"' : ''
    tbody.innerHTML += `<tr>
      <td${bold}>${m}</td>
      <td class="${prCls}">${p.select_to_pr}</td>
      <td class="${siCls}">${p.select_to_si}</td>
    </tr>`
  })
}

// ── Panel: Overlay ──────────────────────────────────────────────────────────

let overlayChart

function buildOverlayChart() {
  overlayChart = makeChart('overlay-chart', {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Contribution (nm)',
          data: [],
          backgroundColor: [C1, C2, C3, C4, C5, CA],
          borderColor:     [C1, C2, C3, C4, C5, CA],
          borderWidth: 1,
          borderRadius: 3,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 80 },
      plugins: {
        legend: { display: false },
        tooltip: TOOLTIP,
      },
      scales: {
        x: { ...axisCommon(), title: { display: true, text: 'Overlay (nm)', color: '#8a8a96' }, min: 0 },
        y: { ...axisCommon(), ticks: { color: '#8a8a96' } },
      },
    },
  })
}

function updateOverlay() {
  const scanner = parseFloat(document.getElementById('ov-scanner').value)
  const wafer   = parseFloat(document.getElementById('ov-wafer').value)
  const reticle = parseFloat(document.getElementById('ov-reticle').value)
  const process = parseFloat(document.getElementById('ov-process').value)
  const metro   = parseFloat(document.getElementById('ov-metro').value)
  const cd      = parseFloat(document.getElementById('ov-cd').value)

  document.getElementById('ov-scanner-val').textContent = scanner.toFixed(1)
  document.getElementById('ov-wafer-val').textContent   = wafer.toFixed(1)
  document.getElementById('ov-reticle-val').textContent = reticle.toFixed(1)
  document.getElementById('ov-process-val').textContent = process.toFixed(1)
  document.getElementById('ov-metro-val').textContent   = metro.toFixed(1)
  document.getElementById('ov-cd-val').textContent      = cd

  const contribs = [
    { label: 'Scanner align', value: scanner },
    { label: 'Wafer distortion', value: wafer },
    { label: 'Reticle placement', value: reticle },
    { label: 'Process-induced', value: process },
    { label: 'Metrology noise', value: metro },
  ]
  const total = overlayRSS(contribs)
  const limit = cd / 4
  const correctable = scanner
  const residual    = overlayRSS(contribs.slice(1))

  // Add total bar
  const labels = contribs.map(c => c.label).concat(['Total (RSS)'])
  const values = contribs.map(c => c.value).concat([total])

  overlayChart.data.labels                   = labels
  overlayChart.data.datasets[0].data         = values
  overlayChart.data.datasets[0].backgroundColor = [C1, C2, C3, C4, C5, total > limit ? '#f87171' : '#34d399']
  overlayChart.data.datasets[0].borderColor     = [C1, C2, C3, C4, C5, total > limit ? '#f87171' : '#34d399']
  overlayChart.update()

  document.getElementById('ov-total-val').textContent = total.toFixed(2)
  document.getElementById('ov-limit-val').textContent = limit.toFixed(2)
  document.getElementById('ov-corr-val').textContent  = correctable.toFixed(2)
  document.getElementById('ov-resid-val').textContent = residual.toFixed(2)

  const chip = document.getElementById('ov-status-chip')
  if (total <= limit) {
    chip.textContent = 'PASS'
    chip.className   = 'status-chip pass'
  } else {
    chip.textContent = 'FAIL'
    chip.className   = 'status-chip fail'
  }
}

// ── Panel: Yield ────────────────────────────────────────────────────────────

let yieldChart

function buildYieldChart() {
  yieldChart = makeChart('yield-chart', {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Murphy yield',
          data: [],
          borderColor: C3, backgroundColor: 'rgba(52,211,153,0.10)',
          fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2,
        },
        {
          label: 'Poisson yield',
          data: [],
          borderColor: C1, backgroundColor: 'transparent',
          borderDash: [5, 4], tension: 0.4, pointRadius: 0, borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 80 },
      plugins: {
        legend: { position: 'top', labels: { color: '#8a8a96', boxWidth: 12, padding: 14 } },
        tooltip: { ...TOOLTIP, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%` } },
      },
      scales: {
        x: { ...axisCommon(), title: { display: true, text: 'Defect density D0 (cm⁻²)', color: '#8a8a96' } },
        y: { ...axisCommon(), title: { display: true, text: 'Yield (%)', color: '#8a8a96' }, min: 0, max: 100, ticks: { color: '#8a8a96', callback: v => v + '%' } },
      },
    },
  })
}

function updateYield() {
  const D0    = parseFloat(document.getElementById('d0-slider').value)
  const dw    = parseFloat(document.getElementById('dw-slider').value)
  const dh    = parseFloat(document.getElementById('dh-slider').value)
  const wc    = parseFloat(document.getElementById('wc-slider').value)
  const wDiam = parseInt(document.querySelector('input[name="wafer"]:checked').value)

  document.getElementById('d0-val').textContent = D0.toFixed(2)
  document.getElementById('dw-val').textContent = dw.toFixed(1)
  document.getElementById('dh-val').textContent = dh.toFixed(1)
  document.getElementById('wc-val').textContent = wc.toFixed(0)

  const A_cm2 = dw * dh / 100
  const D0arr = Array.from({ length: 100 }, (_, i) => 0.01 + i * (5 - 0.01) / 99)

  yieldChart.data.labels               = D0arr.map(d => d.toFixed(2))
  yieldChart.data.datasets[0].data     = D0arr.map(d => murphyYield(d, A_cm2) * 100)
  yieldChart.data.datasets[1].data     = D0arr.map(d => poissonYield(d, A_cm2) * 100)
  yieldChart.update()

  const dies  = dpw(wDiam, dw, dh)
  const yM    = murphyYield(D0, A_cm2)
  const yP    = poissonYield(D0, A_cm2)
  const gdw   = Math.round(dies * yM)
  const cpgd  = gdw > 0 ? (wc / gdw).toFixed(2) : '—'

  document.getElementById('y-murphy').textContent  = (yM * 100).toFixed(1)
  document.getElementById('y-poisson').textContent = (yP * 100).toFixed(1)
  document.getElementById('y-dpw').textContent     = dies
  document.getElementById('y-gdw').textContent     = gdw
  document.getElementById('y-cpgd').textContent    = cpgd
}

// ── Wire controls ────────────────────────────────────────────────────────────

function on(ids, fn) {
  ids.forEach(id => {
    const el = document.getElementById(id)
    if (el) el.addEventListener('input', fn)
  })
}

function onRadio(name, fn) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(r => r.addEventListener('change', fn))
}

function onSelect(id, fn) {
  const el = document.getElementById(id)
  if (el) el.addEventListener('change', fn)
}

// ── Init ─────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('ver').textContent = window.app?.version ?? '2.0.0'

  // Build all charts
  buildOpticsChart()
  buildProcWinCharts()
  buildEuvCharts()
  buildOxidChart()
  buildImplChart()
  buildDiffCharts()
  buildEtchChart()
  buildOverlayChart()
  buildYieldChart()

  // Wire Optics
  onRadio('wl', updateOptics)
  on(['na-slider', 'k1-slider', 'k2-slider'], updateOptics)

  // Wire Process Window
  onRadio('pw-wl', updateProcWin)
  on(['pw-na', 'pw-k1', 'pw-k2', 'pw-dose'], updateProcWin)

  // Wire EUV
  on(['euv-pw', 'euv-mir', 'euv-pel', 'euv-dose', 'euv-fw', 'euv-fh'], updateEuv)

  // Wire Oxidation
  on(['ox-temp', 'ox-time'], updateOxid)
  onRadio('ambient', updateOxid)
  onRadio('orient',  updateOxid)

  // Wire Implantation
  onSelect('impl-species', updateImpl)
  on(['impl-energy', 'impl-dose', 'impl-bg'], updateImpl)

  // Wire Diffusion
  onSelect('diff-species', updateDiff)
  on(['diff-temp', 'diff-time', 'diff-ns', 'diff-bg'], updateDiff)

  // Wire Etch
  onSelect('etch-mat', updateEtch)
  on(['etch-depth', 'etch-width', 'etch-pwr'], updateEtch)

  // Wire Overlay
  on(['ov-scanner', 'ov-wafer', 'ov-reticle', 'ov-process', 'ov-metro', 'ov-cd'], updateOverlay)

  // Wire Yield
  on(['d0-slider', 'dw-slider', 'dh-slider', 'wc-slider'], updateYield)
  onRadio('wafer', updateYield)

  // Initial renders
  updateOptics()
  updateProcWin()
  updateEuv()
  updateOxid()
  updateImpl()
  updateDiff()
  updateEtch()
  updateOverlay()
  updateYield()
})
