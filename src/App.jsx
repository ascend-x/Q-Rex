import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Simulation } from './engine/simulation.js'
import { DEFAULTS, SCENARIOS, MOTIONS, ATMOSPHERES, clampConfig } from './engine/config.js'
import Logo from './Logo.jsx'
import { computeMetrics, recordsToCSV, metricsToHTML } from './engine/metrics.js'
import { loadVideo, runVideo, videoRowsToCSV } from './engine/videoRunner.js'
import { parseGroundTruth } from './engine/videoTracker.js'
import { SECTIONS, LIVE_KEYS } from './fields.js'
import './index.css'

// readable names + units for the Benchmark-2 metrics table (raw key kept as the row tooltip)
const METRIC_LABELS = {
  frames: ['Frames processed', ''], frameSize: ['Frame size', 'px'], simulationDurationSec: ['Video duration', 's'],
  averageFPS: ['Tracker speed', 'FPS'], processingTimeMeanMs: ['Processing time per frame', 'ms'],
  acquisitionTimeSec: ['Acquisition time', 's'], lockRetentionRatePct: ['Lock retention', '%'],
  reacquisitionEvents: ['Re-acquisition events', ''], reacquisitionTimeMaxSec: ['Re-acquisition time (max)', 's'],
  centroidingErrorRmsePx: ['Centroid error · RMSE', 'px'], centroidingErrorMeanPx: ['Centroid error · mean', 'px'],
  centroidingErrorP95Px: ['Centroid error · 95th percentile', 'px'], centroidingErrorMaxPx: ['Centroid error · max', 'px'],
  groundTruthFrames: ['Frames with ground truth', ''], offsetFromCentreMeanPx: ['Mean offset from frame centre', 'px'],
}

const STATE_COLOR = { TRACK: '#059669', COAST: '#d97706', SLEW: '#2563eb', SEARCH: '#6b7280', REACQUIRE: '#dc2626' }

function download(name, text, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Size a canvas' backing store to its CSS box x devicePixelRatio and return a ctx drawing in CSS pixels. */
function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1
  const W = canvas.clientWidth, H = canvas.clientHeight
  if (!W || !H) return null
  const bw = Math.round(W * dpr), bh = Math.round(H * dpr)
  if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, W, H }
}

function FilePick({ inputRef, accept, label, name, onPick }) {
  return (
    <label className="filepick">
      <input type="file" accept={accept} ref={inputRef} onChange={(e) => onPick(e.target.files?.[0]?.name || '')} />
      <span className="filebtn">{label}</span>
      <em title={name}>{name || 'no file chosen'}</em>
    </label>
  )
}

function Field({ f, cfg, onChange }) {
  if (f.show && !f.show(cfg)) return null
  const v = cfg[f.k]
  if (f.type === 'check') {
    return (
      <label className="check"><input type="checkbox" checked={!!v} onChange={(e) => onChange(f.k, e.target.checked)} /> {f.label}</label>
    )
  }
  return (
    <div className="field">
      <label>{f.label}{(f.type === 'num' || f.type === 'int') && <b> {Number(v)}</b>}</label>
      {f.type === 'select' && (
        <select value={v} onChange={(e) => onChange(f.k, e.target.value)}>
          {f.opts.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      )}
      {(f.type === 'num' || f.type === 'int') && (
        <input type="range" min={f.min} max={f.max} step={f.step ?? 1} value={v} onChange={(e) => onChange(f.k, Number(e.target.value))} />
      )}
      {f.type === 'number' && (
        <input type="number" min={f.min} max={f.max} value={v} onChange={(e) => onChange(f.k, Math.max(f.min, Math.min(f.max, Number(e.target.value) || 0)))} />
      )}
      {f.type === 'text' && <textarea rows={4} value={v} onChange={(e) => onChange(f.k, e.target.value)} />}
    </div>
  )
}

function Tile({ label, value, unit, ok, sub }) {
  return (
    <div className={`tile ${ok === true ? 'ok' : ok === false ? 'bad' : ''}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}<span>{unit}</span></div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  )
}

const fmt = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : Number(v).toFixed(d))

export default function App() {
  const camRef = useRef(null)
  const mapRef = useRef(null)
  const plotRef = useRef(null)
  const simRef = useRef(null)
  const imgRef = useRef(null)
  const runRef = useRef({ running: true, speed: 1, done: false, showTruth: true, autoSave: true })

  const [cfg, setCfg] = useState(() => clampConfig({}))
  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [showTruth, setShowTruth] = useState(true)
  const [autoSave, setAutoSave] = useState(true)
  const [stats, setStats] = useState(null)
  const [live, setLive] = useState({ state: 'SEARCH', t: 0 })
  const [done, setDone] = useState(false)
  const [scenario, setScenario] = useState('nominal')
  const [batch, setBatch] = useState({ running: false, rows: [], progress: 0 })
  const [batchSecs, setBatchSecs] = useState(20)
  const [batchSeeds, setBatchSeeds] = useState(2)
  const [video, setVideo] = useState({ busy: false, progress: 0, result: null, name: '', error: '' })
  const videoFile = useRef(null)
  const gtFile = useRef(null)
  const videoCanvas = useRef(null)
  const [videoFps, setVideoFps] = useState(30)
  const [videoName, setVideoName] = useState('')
  const [gtName, setGtName] = useState('')
  const [videoAI, setVideoAI] = useState(false)
  const [gtConv, setGtConv] = useState('index')
  const cancelRef = useRef({ stop: false })

  runRef.current.running = running
  runRef.current.speed = speed
  runRef.current.showTruth = showTruth
  runRef.current.autoSave = autoSave

  // ---- simulation lifecycle
  const restart = useCallback((next) => {
    const c = clampConfig(next)
    if (!simRef.current) simRef.current = new Simulation(c)
    else simRef.current.reset(c)
    runRef.current.done = false
    setDone(false)
  }, [])

  const exportAll = useCallback((kind = 'all') => {
    const sim = simRef.current
    if (!sim || !sim.records.length) return
    const m = computeMetrics(sim.records, sim.cfg, sim.wallTotal / 1000)
    runRef.current.savedK = sim.k
    if (kind === 'all' || kind === 'json') download('performance_report.json', JSON.stringify(m, null, 2), 'application/json')
    if (kind === 'all' || kind === 'html') setTimeout(() => download('performance_report.html', metricsToHTML(m), 'text/html'), 250)
    if (kind === 'all' || kind === 'csv') setTimeout(() => download('tracking_log.csv', recordsToCSV(sim.records), 'text/csv'), 500)
  }, [])

  const onChange = useCallback((k, v) => {
    setCfg((prev) => {
      const next = { ...prev, [k]: v }
      if (LIVE_KEYS.has(k) && simRef.current) simRef.current.updateLive({ [k]: v })
      else restart(next)
      return next
    })
  }, [restart])

  useEffect(() => { restart(cfg) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // endless runs: warn before the page/window closes with an unsaved log
  useEffect(() => {
    const warn = (e) => {
      const sim = simRef.current
      if (sim && sim.cfg.duration === 0 && sim.k - (runRef.current.savedK || 0) > 30) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  // ---- drawing
  const draw = useCallback(() => {
    const sim = simRef.current
    const cv = camRef.current
    if (!sim || !cv || !sim.last) return
    const ctx = cv.getContext('2d')
    const { w, h, frame } = sim.sensor
    if (!imgRef.current || imgRef.current.width !== w || imgRef.current.height !== h) imgRef.current = ctx.createImageData(w, h)
    const d = imgRef.current.data
    if (sim.cfg.cameraType === 'colour' && sim.sensor.rgb) d.set(sim.sensor.rgb)
    else for (let i = 0, j = 0; i < frame.length; i++, j += 4) { const v = frame[i]; d[j] = d[j + 1] = d[j + 2] = v; d[j + 3] = 255 }
    ctx.putImageData(imgRef.current, 0, 0)
    const { out, truth } = sim.last
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(255,60,60,.8)'
    ctx.beginPath(); ctx.moveTo(w / 2 - 14, h / 2); ctx.lineTo(w / 2 + 14, h / 2); ctx.moveTo(w / 2, h / 2 - 14); ctx.lineTo(w / 2, h / 2 + 14); ctx.stroke()
    if (out.roi) {
      ctx.strokeStyle = 'rgba(0,220,255,.7)'; ctx.setLineDash([4, 4])
      ctx.strokeRect(out.roi.x - out.roi.r, out.roi.y - out.roi.r, out.roi.r * 2, out.roi.r * 2); ctx.setLineDash([])
    }
    if (out.est) { ctx.strokeStyle = '#fde047'; ctx.beginPath(); ctx.arc(out.est.x, out.est.y, 9, 0, 6.3); ctx.stroke() }
    if (out.det) { const s = out.det.size + 6; ctx.strokeStyle = '#22ff88'; ctx.lineWidth = 2; ctx.strokeRect(out.det.x - s / 2, out.det.y - s / 2, s, s); ctx.lineWidth = 1 }
    if (runRef.current.showTruth && truth) { ctx.strokeStyle = '#ff4de0'; ctx.beginPath(); ctx.arc(truth.x, truth.y, 16, 0, 6.3); ctx.stroke() }
    ctx.fillStyle = STATE_COLOR[out.state] || '#999'
    ctx.fillRect(0, 0, 150, 22)
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px monospace'
    ctx.fillText(`${out.state}  t=${sim.last.rec.t.toFixed(2)}s`, 8, 15)
    ctx.fillStyle = 'rgba(255,255,255,.7)'
    ctx.fillText(`FOV ${sim.fov.toFixed(1)}°×${(sim.fov * h / w).toFixed(1)}°  ${w}×${h}`, 8, h - 8)

    // minimap
    const mc = mapRef.current
    const mf = mc && fitCanvas(mc)
    if (mf) {
      const m = mf.ctx
      const side = Math.min(mf.W, mf.H) - 2, S = side / sim.cfg.screenSize
      m.fillStyle = '#05080f'; m.fillRect(0, 0, mf.W, mf.H)
      m.save(); m.translate(Math.round((mf.W - side) / 2), Math.round((mf.H - side) / 2))
      m.fillStyle = '#0b1020'; m.fillRect(0, 0, side, side)
      m.strokeStyle = 'rgba(255,255,255,.09)'; m.lineWidth = 1
      for (let g = 500; g < sim.cfg.screenSize; g += 500) { m.beginPath(); m.moveTo(g * S, 0); m.lineTo(g * S, side); m.moveTo(0, g * S); m.lineTo(side, g * S); m.stroke() }
      m.strokeStyle = 'rgba(255,255,255,.35)'; m.strokeRect(0.5, 0.5, side - 1, side - 1)
      m.fillStyle = 'rgba(255,255,255,.45)'; m.font = '10px ui-monospace, monospace'
      m.fillText('0', 4, 12); m.fillText(String(sim.cfg.screenSize) + ' px', side - 48, side - 5)
      const recs = sim.records, n0 = Math.max(0, recs.length - 150)
      m.strokeStyle = 'rgba(255,77,224,.55)'; m.beginPath()
      for (let i = n0; i < recs.length; i++) { const x = recs[i].worldX * S, y = recs[i].worldY * S; if (i === n0) m.moveTo(x, y); else m.lineTo(x, y) }
      m.stroke()
      const sc = sim.last.scale
      const { view } = sim.last
      m.strokeStyle = '#38bdf8'; m.lineWidth = 1.5
      m.strokeRect((view.cx - (w / 2) * sc) * S, (view.cy - (h / 2) * sc) * S, w * sc * S, h * sc * S)
      m.lineWidth = 1
      sim.last.tgts.forEach((t, i) => { m.fillStyle = i === 0 ? '#ff4de0' : '#9ca3af'; m.beginPath(); m.arc(t.x * S, t.y * S, i === 0 ? 4 : 3, 0, 6.3); m.fill() })
      if (out.estWorld) { m.strokeStyle = '#22ff88'; m.beginPath(); m.arc((out.estWorld.x + sim.last.view.cx - sim.last.cam.x) * S, (out.estWorld.y + sim.last.view.cy - sim.last.cam.y) * S, 8, 0, 6.3); m.stroke() }
      m.restore()
    }
    // live error plot
    const pc = plotRef.current
    const pf = pc && fitCanvas(pc)
    if (pf) {
      const p = pf.ctx, W = pf.W, H = pf.H
      const L = 38, R = 12, T = 30, B = 32, N = 300
      const pw = W - L - R, ph = H - T - B
      const recs = sim.records, n0 = Math.max(0, recs.length - N), n = recs.length - n0
      // the line starts once the beacon has first been centred (<= 10 px); the slew-in transient is shown by the state strip
      if (sim._settled === undefined || sim._settled > recs.length) sim._settled = -1
      for (let i = Math.max(0, sim._settledScan || 0); sim._settled < 0 && i < recs.length; i++) { sim._settledScan = i + 1; if (recs[i].state === 'TRACK' && recs[i].errTrack <= 10) sim._settled = i }
      const locked = (r) => (r.state === 'TRACK' || r.state === 'COAST') && sim._settled >= 0 && r.k >= sim._settled
      let peak = 0
      for (let i = n0; i < recs.length; i++) if (locked(recs[i]) && recs[i].errTrack > peak) peak = recs[i].errTrack
      const YM = peak * 1.15 <= 15 ? 15 : peak * 1.15 <= 20 ? 20 : 40
      const STEP = YM <= 15 ? 5 : YM <= 20 ? 5 : 10
      const xx = (i) => L + (i / (N - 1)) * pw
      const yy = (e) => T + ph - (Math.min(e, YM) / YM) * ph
      p.fillStyle = '#fff'; p.fillRect(0, 0, W, H)
      // grid + y labels
      p.font = '10px ui-monospace, monospace'; p.textBaseline = 'middle'; p.textAlign = 'right'
      for (let v = 0; v <= YM; v += STEP) {
        p.strokeStyle = v === 0 ? '#9ca3af' : '#e5e7eb'; p.lineWidth = 1
        p.beginPath(); p.moveTo(L, Math.round(yy(v)) + 0.5); p.lineTo(L + pw, Math.round(yy(v)) + 0.5); p.stroke()
        p.fillStyle = '#6b7280'; p.fillText(String(v), L - 6, yy(v))
      }
      // spec band (0..10 px) and line
      p.fillStyle = 'rgba(5,150,105,.08)'; p.fillRect(L, yy(10), pw, yy(0) - yy(10))
      p.strokeStyle = '#dc2626'; p.setLineDash([6, 4]); p.lineWidth = 1.2
      p.beginPath(); p.moveTo(L, yy(10)); p.lineTo(L + pw, yy(10)); p.stroke(); p.setLineDash([])
      p.fillStyle = '#dc2626'; p.textAlign = 'right'; p.textBaseline = 'bottom'; p.fillText('10 px spec', L + pw - 4, yy(10) - 3)
      if (n > 1) {
        // error line only while the beacon is tracked (acquisition slew is shown by the state strip, not as "error")
        let nT = 0, sum = 0, lastV = null
        let open = false
        p.lineWidth = 1.8; p.lineJoin = 'round'
        for (let i = 0; i < n; i++) {
          const r = recs[n0 + i]
          if (!locked(r)) { if (open) { p.strokeStyle = '#ea4c00'; p.stroke(); open = false } continue }
          const x = xx(i), y = yy(r.errTrack)
          if (!open) { p.beginPath(); p.moveTo(x, y); open = true } else p.lineTo(x, y)
          nT++; sum += r.errTrack; lastV = { x, y, e: r.errTrack }
        }
        if (open) { p.strokeStyle = '#ea4c00'; p.stroke() }
        if (lastV) { p.fillStyle = '#ea4c00'; p.beginPath(); p.arc(lastV.x, lastV.y, 3.5, 0, 6.3); p.fill() }
        p.textAlign = 'right'; p.textBaseline = 'middle'; p.font = '600 12px ui-monospace, monospace'
        if (lastV) {
          p.fillStyle = lastV.e <= 10 ? '#047857' : '#b91c1c'
          p.fillText(`now ${lastV.e.toFixed(1)} px`, W - R, 12)
          p.fillStyle = '#374151'; p.fillText(`mean ${(sum / nT).toFixed(1)} px (locked)`, W - R - 106, 12)
        } else { p.fillStyle = '#6b7280'; p.fillText('acquiring…', W - R, 12) }
        // state strip
        for (let i = 0; i < n; i++) { p.fillStyle = STATE_COLOR[recs[n0 + i].state] || '#999'; p.fillRect(xx(i), H - B + 8, pw / (N - 1) + 0.6, 7) }
      }
      p.textAlign = 'left'; p.textBaseline = 'middle'; p.font = '700 11px ui-monospace, monospace'; p.fillStyle = '#111'
      p.fillText('BORESIGHT ERROR (px)', L, 12)
      p.font = '10px ui-monospace, monospace'; p.fillStyle = '#6b7280'
      p.textAlign = 'left'; p.fillText(`−${(N / sim.cfg.fps).toFixed(0)} s`, L, H - 4)
      p.textAlign = 'right'; p.fillText('now', L + pw, H - 4)
    }
  }, [])

  // ---- main loop (fixed-step sim, real-time paced by accumulator)
  useEffect(() => {
    let raf, last = performance.now(), acc = 0
    const tick = (now) => {
      raf = requestAnimationFrame(tick)
      const sim = simRef.current
      const r = runRef.current
      if (!sim) return
      const elapsed = Math.min(0.1, (now - last) / 1000)
      last = now
      if (r.running && !r.done) {
        const dt = sim.dt
        acc += elapsed * r.speed
        const t0 = performance.now()
        let steps = 0
        const budget = r.speed >= 50 ? 28 : 22
        while ((acc >= dt || r.speed >= 50) && performance.now() - t0 < budget && steps < 400) {
          sim.step(); acc -= dt; steps++
          if (sim.cfg.duration > 0 && sim.k >= sim.cfg.duration * sim.cfg.fps) { r.done = true; break }
          // endless runs: write the performance log every 60 s of simulated time so nothing is lost
          if (sim.cfg.duration === 0 && r.autoSave && sim.k % (60 * sim.cfg.fps) === 0) { exportAll('all'); break }
        }
        if (acc > 0.25) acc = 0
        if (r.done) { setDone(true); if (r.autoSave) exportAll('all') }
      }
      draw()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [draw, exportAll])

  useEffect(() => {
    const id = setInterval(() => {
      const sim = simRef.current
      if (!sim || !sim.records.length) return
      setStats(computeMetrics(sim.records, sim.cfg, sim.wallTotal / 1000))
      const o = sim.last.out, kf = sim.tracker.kf
      setLive({
        state: o.state, t: sim.last.rec.t, err: sim.last.rec.errTrack, ms: sim.last.rec.procMs, frame: sim.k, fov: sim.fov,
        sat: sim.last.rec.saturated, overview: o.overview, mu: o.mu, v: o.estWorld ? Math.hypot(o.estWorld.vx, o.estWorld.vy) : null,
        sp: o.estWorld ? o.estWorld.sp : null, roi: o.roi ? o.roi.r : null, cam: sim.last.cam, qScale: kf.initialised ? kf.qScale : null, rHat: kf.initialised ? Math.sqrt(kf.rHat) : null,
      })
    }, 250)
    return () => clearInterval(id)
  }, [])

  // ---- scenarios (Benchmark-1 style)
  const loadScenario = (id) => {
    const sc = SCENARIOS.find((s) => s.id === id)
    if (!sc) return
    const next = clampConfig({ ...DEFAULTS, seed: cfg.seed, duration: cfg.duration, ...sc.cfg })
    setCfg(next); restart(next); setRunning(true)
  }

  const runBatch = async () => {
    setBatch({ running: true, rows: [], progress: 0 })
    const rows = []
    for (let si = 0; si < SCENARIOS.length; si++) {
      const sc = SCENARIOS[si]
      const ms = []
      for (let s = 1; s <= batchSeeds; s++) {
        const sim = new Simulation({ ...DEFAULTS, ...sc.cfg, seed: s, duration: batchSecs })
        const n = batchSecs * sim.cfg.fps, w0 = performance.now()
        for (let i = 0; i < n; i++) { sim.step(); if (i % 15 === 0) await new Promise((r) => setTimeout(r, 0)) }
        ms.push(computeMetrics(sim.records, sim.cfg, (performance.now() - w0) / 1000))
        setBatch((b) => ({ ...b, progress: (si + s / batchSeeds) / SCENARIOS.length }))
      }
      const avg = (k) => ms.reduce((a, m) => a + (m[k] ?? 0), 0) / ms.length
      rows.push({ id: sc.id, label: sc.label, acq: avg('acquisitionTimeSec'), err: avg('trackingErrorMeanPx'), cent: avg('centroidingErrorRmsePx'), loss: avg('targetLossPct'), lock: avg('lockRetentionRatePct'), reacq: Math.max(...ms.map((m) => m.reacquisitionTimeMaxSec)), fps: avg('averageFPS'), pass: ms.filter((m) => m.passAll).length, runs: ms.length, checks: Object.fromEntries(Object.keys(ms[0].checks).map((k) => [k, ms.filter((m) => m.checks[k]).length])), metrics: ms })
      setBatch((b) => ({ ...b, rows: [...rows] }))
    }
    setBatch((b) => ({ ...b, running: false, progress: 1 }))
  }

  // ---- video benchmark
  const runVideoBench = async () => {
    const file = videoFile.current?.files?.[0]
    if (!file) return
    cancelRef.current = { stop: false }
    setVideo({ busy: true, progress: 0, result: null, name: file.name, error: '' })
    try {
      const gtText = gtFile.current?.files?.[0] ? await gtFile.current.files[0].text() : null
      const vid = await loadVideo(file)
      const res = await runVideo(vid, {
        fps: videoFps, ai: videoAI, gtConvention: gtConv, gt: gtText ? parseGroundTruth(gtText, videoFps) : null, cancel: cancelRef.current,
        onFrame: (row, cv, p) => {
          const c = videoCanvas.current
          if (c) {
            const ctx = c.getContext('2d')
            c.width = 480; c.height = Math.round(480 * cv.height / cv.width)
            ctx.drawImage(cv, 0, 0, c.width, c.height)
            if (row.found) { const sx = c.width / cv.width; ctx.strokeStyle = '#22ff88'; ctx.lineWidth = 2; ctx.strokeRect(row.x * sx - 10, row.y * sx - 10, 20, 20) }
          }
          setVideo((v) => ({ ...v, progress: p }))
        },
      })
      setVideo({ busy: false, progress: 1, result: res, name: file.name, error: '' })
      URL.revokeObjectURL(vid.src)
    } catch (e) {
      setVideo({ busy: false, progress: 0, result: null, name: file.name, error: String(e.message || e) })
    }
  }

  const chips = useMemo(() => {
    const c = []
    c.push(MOTIONS.find((m) => m.id === cfg.motion)?.label ?? cfg.motion)
    c.push(`${cfg.targetSize}px ${cfg.targetShape}`)
    if (cfg.numTargets > 1) c.push(`${cfg.numTargets - 1} decoy${cfg.numTargets > 2 ? 's' : ''}`)
    if (cfg.saltPepper) c.push(`salt&pepper ${Math.round(cfg.saltPepperDensity * 100)}%`)
    if (cfg.gaussian) c.push(`gaussian σ${cfg.gaussianSigma}`)
    if (cfg.poisson) c.push('poisson')
    if (cfg.jitter) c.push(`jitter ±${cfg.jitterMax}px`)
    if (cfg.platform) c.push(`platform ${cfg.platformSpeed}px/f ${cfg.platformModel}`)
    if (cfg.atmosphere !== 'clear') c.push(ATMOSPHERES[cfg.atmosphere]?.label ?? cfg.atmosphere)
    if (cfg.turbulence > 0) c.push(`turbulence ${cfg.turbulence}`)
    if (cfg.dropout) c.push('dropouts')
    if (cfg.acquisition !== 'overview') c.push(cfg.acquisition === 'zoom' ? 'zoom acquisition' : 'raster scan')
    if (cfg.aiVerifier) c.push('AI verifier')
    c.push(`seed ${cfg.seed}`)
    return c
  }, [cfg])

  const scenarioTable = useMemo(() => batch.rows, [batch.rows])
  const c = stats?.checks
  const slewPx = Math.min(cfg.maxPanSpeed, cfg.maxTiltSpeed) * 160
  const worstRel = cfg.targetSpeed + (cfg.platform ? cfg.platformSpeed * cfg.fps : 0)
  const feasible = worstRel <= slewPx

  return (
    <div className="layout">
      <aside className="sidebar panel">
        <div className="brand">
          <div className="brandrow"><Logo size={46} /><div><h1>Q-Rex</h1><p>Workstation · FSOC coarse alignment</p></div></div>
          <a className="homelink" href="#/">← Home / overview</a>
        </div>
        <label className="check"><input type="checkbox" checked={showTruth} onChange={(e) => setShowTruth(e.target.checked)} /> Show ground truth overlay</label>
        <label className="check"><input type="checkbox" checked={autoSave} onChange={(e) => setAutoSave(e.target.checked)} /> Auto-save report at end of run</label>
        <div className="field">
          <label>Load scenario</label>
          <div className="btnrow">
            <select value={scenario} onChange={(e) => setScenario(e.target.value)}>{SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
            <button className="btn" onClick={() => loadScenario(scenario)}>Load</button>
          </div>
        </div>
        {SECTIONS.map((s) => (
          <details key={s.title} open={s.open} className="section">
            <summary>{s.title}</summary>
            {s.fields.map((f) => <Field key={f.k} f={f} cfg={cfg} onChange={onChange} />)}
          </details>
        ))}
        {!feasible && <div className="warn">Target + platform speed ({Math.round(worstRel)} px/s) exceeds the gimbal limit ({slewPx} px/s) — saturation expected.</div>}
      </aside>

      <main className="main">
        <section className="panel toolbar">
          <div className="tb-left">
            <span className={`livepill ${running && !done ? 'on' : ''}`}><i />{done ? 'RUN COMPLETE' : running ? 'LIVE' : 'PAUSED'}</span>
            <div className="chips2">{chips.map((c) => <span key={c}>{c}</span>)}</div>
          </div>
          <div className="tb-right">
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="Simulation speed">
              <option value={0.25}>0.25×</option><option value={0.5}>0.5×</option><option value={1}>1× real time</option><option value={2}>2×</option><option value={4}>4×</option><option value={100}>max speed</option>
            </select>
            <button className="btn primary" onClick={() => setRunning((r) => !r)}>{running ? '❚❚ Pause' : '▶ Run'}</button>
            <button className="btn" onClick={() => { restart(cfg); setRunning(true) }}>↻ Restart</button>
            <span className="tbsep" />
            <button className="btn" onClick={() => exportAll('json')} title="Performance report (JSON)">JSON</button>
            <button className="btn" onClick={() => exportAll('csv')} title="Per-frame tracking log">CSV</button>
            <button className="btn" onClick={() => exportAll('html')} title="Printable report">HTML</button>
          </div>
        </section>

        <section className="panel statbar">
          <div className="status" style={{ background: STATE_COLOR[live.state] }}>{live.state}{done ? ' · DONE' : ''}</div>
          <Tile label="Acquisition" value={fmt(stats?.acquisitionTimeSec)} unit=" s" ok={c?.K01_acquisition_le_2s} sub="spec ≤ 2 s" />
          <Tile label="Tracking error (mean)" value={fmt(stats?.trackingErrorMeanPx)} unit=" px" ok={c?.K02_tracking_error_le_10px} sub={`RMSE ${fmt(stats?.trackingErrorRmsePx)} · max ${fmt(stats?.trackingErrorMaxPx, 1)}`} />
          <Tile label="Centroid error (RMSE)" value={fmt(stats?.centroidingErrorRmsePx, 3)} unit=" px" sub={`P95 ${fmt(stats?.centroidingErrorP95Px, 3)}`} />
          <Tile label="Target loss" value={fmt(stats?.targetLossPct, 1)} unit=" %" ok={c?.K03_target_loss_lt_5pct} sub={`lock retention ${fmt(stats?.lockRetentionRatePct, 1)} %`} />
          <Tile label="Re-acquisition (max)" value={fmt(stats?.reacquisitionTimeMaxSec)} unit=" s" ok={c?.K04_reacquisition_le_1s} sub={`${stats?.reacquisitionEvents ?? 0} events`} />
          <Tile label="Tracker FPS" value={fmt(stats?.averageFPS, 0)} unit="" ok={c?.K05_fps_ge_20} sub={`${fmt(stats?.processingTimeMeanMs, 1)} ms / frame`} />
        </section>

        <div className="grid2">
          <section className="panel view">
            <header>Virtual camera <span>{cfg.camW}×{cfg.camH} {cfg.cameraType === 'colour' ? 'colour' : 'mono'} · {(live.fov ?? cfg.fovX).toFixed(1)}°×{((live.fov ?? cfg.fovX) * cfg.camH / cfg.camW).toFixed(1)}°{cfg.acquisition === 'zoom' ? ' (zoom)' : ''}</span></header>
            <div className="camwrap">
              <canvas key={`${cfg.camW}x${cfg.camH}`} ref={camRef} width={cfg.camW} height={cfg.camH} className="cam" style={{ aspectRatio: `${cfg.camW}/${cfg.camH}`, maxWidth: cfg.camW }} />
            </div>
            <div className="legend"><i style={{ background: '#ef4444' }} />boresight <i style={{ background: '#22ff88' }} />detection <i style={{ background: '#fde047' }} />estimate <i style={{ background: '#22d3ee' }} />ROI <i style={{ background: '#ff4de0' }} />truth</div>
          </section>

          <section className="panel view">
            <header>Screen map <span>{cfg.screenSize}×{cfg.screenSize} px · {(cfg.screenSize / 160).toFixed(1)}°</span></header>
            <div className="camwrap">
              <canvas ref={mapRef} className="map" style={{ aspectRatio: `${cfg.camW}/${cfg.camH}`, maxWidth: cfg.camW }} />
            </div>
            <div className="legend"><i style={{ background: '#38bdf8' }} />camera FOV <i style={{ background: '#ff4de0' }} />beacon + trail <i style={{ background: '#22ff88' }} />estimate</div>
          </section>

          <section className="panel view">
            <header>Live error <span className="states">{Object.entries(STATE_COLOR).map(([k, c]) => <b key={k}><i style={{ background: c }} />{k}</b>)}</span></header>
            <canvas ref={plotRef} className="plot" />
          </section>

          <section className="panel view">
            <header>Tracker telemetry <span>t = {(live.t ?? 0).toFixed(2)} s · frame {live.frame ?? 0}</span></header>
            <dl className="telemetry">
              <dt>State</dt><dd style={{ color: STATE_COLOR[live.state] }}>{live.state}</dd>
              <dt>Sensing</dt><dd>{live.overview ? 'wide overview + narrow' : 'narrow camera'}</dd>
              <dt>Camera pointing</dt><dd>{live.cam ? `${live.cam.x.toFixed(0)}, ${live.cam.y.toFixed(0)} px` : '–'}</dd>
              <dt>Beacon speed (est.)</dt><dd>{live.v != null ? `${live.v.toFixed(0)} px/s` : '–'}</dd>
              <dt>Model mix CV / CA</dt><dd>{live.mu ? `${(live.mu[0] * 100).toFixed(0)} % / ${(live.mu[1] * 100).toFixed(0)} %` : '–'}</dd>
              <dt>Position σ (filter)</dt><dd>{live.sp != null ? `${live.sp.toFixed(1)} px` : '–'}</dd>
              <dt>Measurement noise (learned)</dt><dd>{live.rHat != null ? `${live.rHat.toFixed(1)} px` : '–'}</dd>
              <dt>Search window</dt><dd>{live.roi != null ? `±${live.roi.toFixed(0)} px` : '–'}</dd>
              <dt>Processing</dt><dd>{live.ms != null ? `${live.ms.toFixed(2)} ms` : '–'}</dd>
              <dt>Gimbal</dt><dd style={{ color: live.sat ? '#b45309' : undefined }}>{live.sat ? 'rate-limited (saturated)' : 'within limits'}</dd>
            </dl>
          </section>
        </div>

        <section className="panel bench">
          <div className="bench-head"><span className="bnum">B1</span><div><h2>Benchmark 1 — scenario suite</h2><p>Runs every built-in scenario headlessly (nominal, each disturbance at its spec maximum, all combined) and checks the five spec limits.</p></div></div>
          <div className="bench-body">
            <div className="bench-controls">
              <div className="bstep"><i>1</i><div><b>Choose run length</b><div className="brow"><label>Seconds per run <input type="number" min={5} max={120} value={batchSecs} onChange={(e) => setBatchSecs(Number(e.target.value))} /></label><label>Seeds <input type="number" min={1} max={10} value={batchSeeds} onChange={(e) => setBatchSeeds(Number(e.target.value))} /></label></div></div></div>
              <div className="bstep"><i>2</i><div><b>Run</b>
                <button className="btn primary wide" disabled={batch.running} onClick={runBatch}>{batch.running ? `Running… ${(batch.progress * 100).toFixed(0)}%` : '▶ Run all scenarios'}</button>
                {(batch.running || batch.progress > 0) && <div className="progress"><div style={{ width: `${(batch.progress * 100).toFixed(0)}%` }} /></div>}
              </div></div>
              {scenarioTable.length > 0 && <div className="bstep"><i>3</i><div><b>Export</b><button className="btn wide" onClick={() => download('scenario_suite.json', JSON.stringify(scenarioTable.map(({ metrics, ...r }) => ({ ...r, metrics })), null, 2), 'application/json')}>Export suite JSON</button></div></div>}
            </div>
            <div className="bench-out">
              {scenarioTable.length === 0 ? (
                <div className="placeholder"><div><strong>{SCENARIOS.length} scenarios · {batchSeeds} seed{batchSeeds > 1 ? 's' : ''} · {batchSecs} s each</strong><span>Results appear here with a pass/fail check for acquisition, error, loss, re-acquisition and FPS.</span>
                  <div className="chips2 center">{SCENARIOS.map((sc) => <span key={sc.id}>{sc.label.split(' ')[0]} {sc.label.split(' ').slice(1).join(' ')}</span>)}</div></div></div>
              ) : (
                <div className="tblscroll"><table className="tbl"><thead><tr><th>Scenario</th><th>Acq s</th><th>Err px</th><th>Cent RMSE</th><th>Loss %</th><th>Lock %</th><th>Re-acq s</th><th>FPS</th><th>Pass</th></tr></thead>
                  <tbody>{scenarioTable.map((r) => (
                    <tr key={r.id}><td>{r.label}</td><td className={r.checks.K01_acquisition_le_2s === r.runs ? 'g' : 'r'}>{r.acq.toFixed(2)}</td><td className={r.checks.K02_tracking_error_le_10px === r.runs ? 'g' : 'r'}>{r.err.toFixed(1)}</td><td>{r.cent.toFixed(2)}</td><td className={r.checks.K03_target_loss_lt_5pct === r.runs ? 'g' : 'r'}>{r.loss.toFixed(1)}</td><td>{r.lock.toFixed(1)}</td><td className={r.checks.K04_reacquisition_le_1s === r.runs ? 'g' : 'r'}>{r.reacq.toFixed(2)}</td><td>{r.fps.toFixed(0)}</td><td className={r.pass === r.runs ? 'g' : 'r'}>{r.pass}/{r.runs}</td></tr>
                  ))}</tbody></table></div>
              )}
            </div>
          </div>
        </section>

        <section className="panel bench">
          <div className="bench-head"><span className="bnum">B2</span><div><h2>Benchmark 2 — video input <em>PTZ bypassed</em></h2><p>Frame-exact decode of an .mp4 (any size; frames ≥ 1000 px are treated as the whole screen). The tracker finds the beacon in every frame and logs its centroid.</p></div></div>
          <div className="bench-body">
            <div className="bench-controls">
              <div className="bstep"><i>1</i><div><b>Video file</b><FilePick inputRef={videoFile} accept="video/*,.mp4" label="Choose .mp4" name={videoName} onPick={setVideoName} /></div></div>
              <div className="bstep"><i>2</i><div><b>Ground truth <small>optional</small></b><FilePick inputRef={gtFile} accept=".csv,.txt" label="Choose CSV" name={gtName} onPick={setGtName} /><span className="hint">Rows of <code>frame,x,y</code> (or <code>time_s,x,y</code>); header optional, 0- or 1-based frames auto-detected. Enables centroid-error metrics.</span><label className="fsel">Coordinate convention <select value={gtConv} onChange={(e) => setGtConv(e.target.value)}><option value="index">pixel index (centre of 1st pixel = 0)</option><option value="edge">pixel edge (centre of 1st pixel = 0.5)</option></select></label></div></div>
              <div className="bstep"><i>3</i><div><b>Run</b>
                <div className="brow"><label>Video fps <input type="number" min={1} max={120} value={videoFps} onChange={(e) => setVideoFps(Number(e.target.value))} /></label><label className="check" style={{ margin: 0 }}><input type="checkbox" checked={videoAI} onChange={(e) => setVideoAI(e.target.checked)} /> AI verifier (CNN v4)</label></div>
                <div className="brow"><button className="btn primary wide" disabled={video.busy} onClick={runVideoBench}>{video.busy ? `Processing… ${(video.progress * 100).toFixed(0)}%` : '▶ Run on video'}</button>{video.busy && <button className="btn" onClick={() => { cancelRef.current.stop = true }}>Stop</button>}</div>
                {(video.busy || video.progress > 0) && <div className="progress"><div style={{ width: `${(video.progress * 100).toFixed(0)}%` }} /></div>}
                {video.error && <div className="warn">{video.error}</div>}
              </div></div>
            </div>
            <div className="bench-out">
              <div className="previewbox" style={{ display: video.busy || video.result ? 'block' : 'none' }}><canvas ref={videoCanvas} width={480} height={360} className="vcanvas" /></div>
              {!(video.busy || video.result) && (
                <div className="placeholder tall"><div><strong>No video processed yet</strong><span>Choose an .mp4 on the left and press <b>Run on video</b>. Each frame is shown here with a green box on the detected beacon.</span></div></div>
              )}
              {video.result && (() => {
                const m = video.result.metrics
                return (
                  <>
                    <div className="mgrid">
                      <div className="mcard"><span>Acquisition</span><b>{m.acquisitionTimeSec ?? '–'}<small> s</small></b></div>
                      <div className="mcard"><span>Lock retention</span><b>{m.lockRetentionRatePct ?? '–'}<small> %</small></b></div>
                      <div className="mcard"><span>Centroid RMSE</span><b>{m.centroidingErrorRmsePx ?? 'n/a'}<small>{m.centroidingErrorRmsePx != null ? ' px' : ''}</small></b></div>
                      <div className="mcard"><span>Tracker FPS</span><b>{m.averageFPS ?? '–'}</b></div>
                      <div className="mcard"><span>Re-acq. max</span><b>{m.reacquisitionTimeMaxSec ?? '–'}<small> s</small></b></div>
                      <div className="mcard"><span>Frames</span><b>{m.frames}</b></div>
                    </div>
                    <details className="alltable"><summary>All metrics</summary>
                      <table className="tbl small metrics"><tbody>{Object.entries(m).map(([k, v]) => { const [label, unit] = METRIC_LABELS[k] ?? [k, '']; return <tr key={k} title={k}><td>{label}</td><td>{v == null ? <span className="na">n/a{k.startsWith('centroiding') ? ' · needs ground truth' : ''}</span> : <>{String(v)}{unit && <small> {unit}</small>}</>}</td></tr> })}</tbody></table>
                    </details>
                    <div className="brow">
                      <button className="btn" onClick={() => download('video_centroids.csv', videoRowsToCSV(video.result.rows), 'text/csv')}>Centroid log CSV</button>
                      <button className="btn" onClick={() => download('video_report.json', JSON.stringify(video.result.metrics, null, 2), 'application/json')}>Report JSON</button>
                    </div>
                  </>
                )
              })()}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
