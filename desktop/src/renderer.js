'use strict'

// ── Navigation ──────────────────────────────────────────
const navItems = document.querySelectorAll('.nav-item')
const panels   = document.querySelectorAll('.panel')

navItems.forEach(btn => btn.addEventListener('click', () => {
  navItems.forEach(b => b.classList.remove('active'))
  panels.forEach(p => p.classList.remove('active'))
  btn.classList.add('active')
  document.getElementById(`panel-${btn.dataset.panel}`).classList.add('active')
}))

// ── Physics models ───────────────────────────────────────

function rayleigh(wl, na, k1) { return k1 * wl / na }
function dof(wl, na, k2)      { return k2 * wl / (na * na) }

// Deal-Grove Arrhenius parameters (B in µm²/hr, B/A in µm/hr)
// Source: Grove 1965, Neamen "Semiconductor Physics and Devices"
const DG = {
  '100_dry': { B0: 772,    Ea_B: 1.23, BA0: 6.23e6,  Ea_BA: 2.00 },
  '111_dry': { B0: 772,    Ea_B: 1.23, BA0: 1.69e7,  Ea_BA: 2.00 },
  '100_wet': { B0: 386,    Ea_B: 0.78, BA0: 1.63e8,  Ea_BA: 2.05 },
  '111_wet': { B0: 386,    Ea_B: 0.78, BA0: 2.05e8,  Ea_BA: 2.05 },
}
const kB = 8.617e-5  // eV/K

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

// SRIM range data: [Rp_µm, dRp_µm] — Jaeger Table 3.1 / SRIM-2013
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

function murphyYield(D0, A) {
  const x = D0 * A
  if (x < 1e-9) return 1
  return ((1 - Math.exp(-x)) / x) ** 2
}
function poissonYield(D0, A) { return Math.exp(-D0 * A) }

function dpw(diam, w, h, edge = 3) {
  const R = diam / 2 - edge
  const A = w * h
  return Math.max(0, Math.floor(Math.PI * R * R / A - Math.PI * (diam - 2 * edge) / Math.sqrt(2 * A)))
}

// ── Chart theme ──────────────────────────────────────────

Chart.defaults.color         = '#7a84a0'
Chart.defaults.borderColor   = '#252538'
Chart.defaults.font.family   = '-apple-system, "Segoe UI", system-ui, sans-serif'
Chart.defaults.font.size     = 11

const CLR = {
  blue:   '#5b8df7',
  cyan:   '#26c6da',
  green:  '#3fb950',
  purple: '#a371f7',
  orange: '#e3a94e',
  dimBlue:   'rgba(91,141,247,0.12)',
  dimCyan:   'rgba(38,198,218,0.10)',
  dimGreen:  'rgba(63,185,80,0.10)',
  dimPurple: 'rgba(163,113,247,0.10)',
  grid: '#1a1a2e',
}

const AXIS_COMMON = {
  grid: { color: CLR.grid },
  ticks: { color: '#7a84a0' },
}

const TOOLTIP = {
  backgroundColor: '#1c1c2a',
  borderColor: '#2e2e48',
  borderWidth: 1,
  titleColor: '#dde3f0',
  bodyColor: '#9aa3b8',
  padding: 8,
}

// ── Lithography panel ─────────────────────────────────────

let lithoChart

function buildLithoChart() {
  const ctx = document.getElementById('litho-chart').getContext('2d')
  lithoChart = new Chart(ctx, {
    data: {
      labels: [],
      datasets: [
        {
          type: 'line', label: 'Resolution (nm)',
          data: [], yAxisID: 'y',
          borderColor: CLR.blue, backgroundColor: CLR.dimBlue,
          fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2,
        },
        {
          type: 'line', label: 'DOF (nm)',
          data: [], yAxisID: 'y2',
          borderColor: CLR.cyan, backgroundColor: 'transparent',
          borderDash: [5, 3], tension: 0.4, pointRadius: 0, borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 100 },
      plugins: {
        legend: { position: 'top', labels: { color: '#9aa3b8', boxWidth: 12, padding: 14 } },
        tooltip: TOOLTIP,
      },
      scales: {
        x:  { ...AXIS_COMMON, title: { display: true, text: 'NA', color: '#7a84a0' } },
        y:  { ...AXIS_COMMON, title: { display: true, text: 'Resolution (nm)', color: CLR.blue }, ticks: { color: CLR.blue } },
        y2: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: CLR.cyan },
              title: { display: true, text: 'DOF (nm)', color: CLR.cyan } },
      },
    },
  })
}

function updateLitho() {
  const wl = parseFloat(document.querySelector('input[name="wl"]:checked').value)
  const k1 = parseFloat(document.getElementById('k1-slider').value)
  const k2 = parseFloat(document.getElementById('k2-slider').value)

  // Clamp NA to physical limit for EUV
  const naMax   = wl < 100 ? 0.55 : 1.35
  const naSlider = document.getElementById('na-slider')
  naSlider.max   = naMax
  if (parseFloat(naSlider.value) > naMax) naSlider.value = naMax
  const na = parseFloat(naSlider.value)

  document.getElementById('na-val').textContent = na.toFixed(2)
  document.getElementById('k1-val').textContent = k1.toFixed(2)
  document.getElementById('k2-val').textContent = k2.toFixed(2)

  const N = 120
  const naArr = Array.from({ length: N }, (_, i) => 0.10 + i * (naMax - 0.10) / (N - 1))

  lithoChart.data.labels                = naArr.map(n => n.toFixed(2))
  lithoChart.data.datasets[0].data      = naArr.map(n => rayleigh(wl, n, k1))
  lithoChart.data.datasets[1].data      = naArr.map(n => dof(wl, n, k2))
  lithoChart.update()

  const res = rayleigh(wl, na, k1)
  const df  = dof(wl, na, k2)
  document.getElementById('res-val').textContent = res.toFixed(1)
  document.getElementById('dof-val').textContent = df.toFixed(1)
  document.getElementById('cdd-val').textContent = (0.4 * res / 100).toFixed(3)

  // EUV vs DUV comparison at the same target CD
  const targetCD  = res
  const euvNA     = Math.min(0.55, targetCD > 0 ? 0.25 * 13.5 / targetCD : 0.33)
  const euvDOF    = dof(13.5, euvNA, k2)
  const duvDOF    = dof(193, 1.35, k2)
  const duvSingle = rayleigh(193, 1.35, 0.28)
  const passes    = Math.max(1, Math.ceil(duvSingle / targetCD))

  document.getElementById('cmp-euv-na').textContent    = euvNA.toFixed(2)
  document.getElementById('cmp-euv-dof').textContent   = euvDOF.toFixed(0) + ' nm'
  document.getElementById('cmp-duv-dof').textContent   = duvDOF.toFixed(0) + ' nm'
  document.getElementById('cmp-duv-passes').textContent = passes + 'x'
}

// ── Oxidation panel ───────────────────────────────────────

let oxidChart
const OX_TEMPS  = [800, 900, 1000, 1100, 1200]
const OX_COLORS = ['#3a3a6a', '#4a5aaa', CLR.blue, CLR.cyan, '#20e8e0']

function buildOxidChart() {
  const ctx = document.getElementById('oxid-chart').getContext('2d')
  oxidChart = new Chart(ctx, {
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
      animation: { duration: 100 },
      plugins: {
        legend: { position: 'top', labels: { color: '#9aa3b8', boxWidth: 12, padding: 12 } },
        tooltip: TOOLTIP,
      },
      scales: {
        x: { ...AXIS_COMMON, title: { display: true, text: 'Time (min)', color: '#7a84a0' }, ticks: { maxTicksLimit: 8, color: '#7a84a0' } },
        y: { ...AXIS_COMMON, title: { display: true, text: 'Oxide thickness (nm)', color: '#7a84a0' }, min: 0 },
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
    oxidChart.data.datasets[i].borderColor = near ? OX_COLORS[i] : OX_COLORS[i] + '44'
    oxidChart.data.datasets[i].data        = tArr.map(t => oxThickNm(t, T, orient, ambient))
  })
  oxidChart.data.labels = tArr.map(t => Math.round(t))
  oxidChart.update()

  const { A, B, BA } = dgConsts(temp, orient, ambient)
  const thick   = oxThickNm(time, temp, orient, ambient)
  const xUm     = thick / 1000
  const regime  = xUm < 0.5 * A ? 'linear' : xUm > 2 * A ? 'parabolic' : 'mixed'

  document.getElementById('ox-thick').textContent  = thick.toFixed(1)
  document.getElementById('ox-regime').textContent = regime
  document.getElementById('ox-ba').textContent     = (BA * 1000).toFixed(1)
  document.getElementById('ox-b').textContent      = (B * 1e6).toFixed(0)
}

// ── Implantation panel ────────────────────────────────────

let implChart

function buildImplChart() {
  const ctx = document.getElementById('impl-chart').getContext('2d')
  implChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'N(x)',
          data: [],
          borderColor: CLR.purple, backgroundColor: CLR.dimPurple,
          fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2,
        },
        {
          label: 'Background Nb',
          data: [],
          borderColor: CLR.orange, backgroundColor: 'transparent',
          borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 100 },
      plugins: {
        legend: { position: 'top', labels: { color: '#9aa3b8', boxWidth: 12, padding: 14 } },
        tooltip: {
          ...TOOLTIP,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toExponential(2)} cm⁻³`,
          },
        },
      },
      scales: {
        x: { ...AXIS_COMMON, title: { display: true, text: 'Depth (nm)', color: '#7a84a0' } },
        y: {
          type: 'logarithmic',
          grid: { color: CLR.grid }, ticks: { color: '#7a84a0', callback: v => v.toExponential(0) },
          title: { display: true, text: 'Concentration (cm⁻³)', color: '#7a84a0' },
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

  implChart.data.labels                = depths.map(d => d.toFixed(0))
  implChart.data.datasets[0].data      = concs.map(c => Math.max(c, bg * 0.001))
  implChart.data.datasets[1].data      = depths.map(() => bg)
  implChart.update()

  const xj = junctionDepth(doseLog, energy, species, bgLog)
  document.getElementById('impl-rp').textContent   = rpNm.toFixed(1)
  document.getElementById('impl-drp').textContent  = drpNm.toFixed(1)
  document.getElementById('impl-peak').textContent = peak.toExponential(2)
  document.getElementById('impl-xj').textContent   = xj ? xj.toFixed(1) : 'none'
}

// ── Yield panel ───────────────────────────────────────────

let yieldChart

function buildYieldChart() {
  const ctx = document.getElementById('yield-chart').getContext('2d')
  yieldChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Murphy yield',
          data: [],
          borderColor: CLR.green, backgroundColor: CLR.dimGreen,
          fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2,
        },
        {
          label: 'Poisson yield',
          data: [],
          borderColor: CLR.blue, backgroundColor: 'transparent',
          borderDash: [5, 4], tension: 0.4, pointRadius: 0, borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 100 },
      plugins: {
        legend: { position: 'top', labels: { color: '#9aa3b8', boxWidth: 12, padding: 14 } },
        tooltip: { ...TOOLTIP, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%` } },
      },
      scales: {
        x: { ...AXIS_COMMON, title: { display: true, text: 'Defect density D0 (cm⁻²)', color: '#7a84a0' } },
        y: { ...AXIS_COMMON, title: { display: true, text: 'Yield (%)', color: '#7a84a0' },
             min: 0, max: 100, ticks: { color: '#7a84a0', callback: v => v + '%' } },
      },
    },
  })
}

function updateYield() {
  const D0   = parseFloat(document.getElementById('d0-slider').value)
  const dw   = parseFloat(document.getElementById('dw-slider').value)
  const dh   = parseFloat(document.getElementById('dh-slider').value)
  const wDiam = parseInt(document.querySelector('input[name="wafer"]:checked').value)

  document.getElementById('d0-val').textContent = D0.toFixed(2)
  document.getElementById('dw-val').textContent = dw.toFixed(1)
  document.getElementById('dh-val').textContent = dh.toFixed(1)

  const A_cm2 = dw * dh / 100
  const D0arr = Array.from({ length: 100 }, (_, i) => 0.01 + i * (5 - 0.01) / 99)

  yieldChart.data.labels                = D0arr.map(d => d.toFixed(2))
  yieldChart.data.datasets[0].data      = D0arr.map(d => murphyYield(d, A_cm2) * 100)
  yieldChart.data.datasets[1].data      = D0arr.map(d => poissonYield(d, A_cm2) * 100)
  yieldChart.update()

  const dies = dpw(wDiam, dw, dh)
  const yM   = murphyYield(D0, A_cm2)
  const yP   = poissonYield(D0, A_cm2)

  document.getElementById('y-murphy').textContent  = (yM * 100).toFixed(1)
  document.getElementById('y-poisson').textContent = (yP * 100).toFixed(1)
  document.getElementById('y-dpw').textContent     = dies
  document.getElementById('y-gdw').textContent     = Math.round(dies * yM)
}

// ── Wire controls ─────────────────────────────────────────

function on(ids, fn) {
  ids.forEach(id => document.getElementById(id)?.addEventListener('input', fn))
}
function onRadio(name, fn) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(r => r.addEventListener('change', fn))
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('ver').textContent = window.app?.version ?? '1.0.0'

  buildLithoChart()
  buildOxidChart()
  buildImplChart()
  buildYieldChart()

  onRadio('wl', updateLitho)
  on(['na-slider', 'k1-slider', 'k2-slider'], updateLitho)

  on(['ox-temp', 'ox-time'], updateOxid)
  onRadio('ambient', updateOxid)
  onRadio('orient', updateOxid)

  document.getElementById('impl-species').addEventListener('change', updateImpl)
  on(['impl-energy', 'impl-dose', 'impl-bg'], updateImpl)

  on(['d0-slider', 'dw-slider', 'dh-slider'], updateYield)
  onRadio('wafer', updateYield)

  updateLitho()
  updateOxid()
  updateImpl()
  updateYield()
})
