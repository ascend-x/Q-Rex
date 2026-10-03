import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Simulation } from './engine/simulation.js'
import { camScale, DEFAULTS, SCENARIOS, clampConfig } from './engine/config.js'
import { computeMetrics, recordsToCSV, metricsToHTML } from './engine/metrics.js'
import { loadVideo, runVideo, videoRowsToCSV } from './engine/videoRunner.js'
import { parseGroundTruth } from './engine/videoTracker.js'
import { SECTIONS, LIVE_KEYS } from './fields.js'
import './index.css'

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
    ctx.fillText(`FOV ${sim.cfg.fovX}°×${(sim.cfg.fovX * h / w).toFixed(1)}°  ${w}×${h}`, 8, h - 8)

    // minimap
    const mc = mapRef.current
    if (mc) {
      const m = mc.getContext('2d'), S = mc.width / sim.cfg.screenSize
      m.fillStyle = '#0b1020'; m.fillRect(0, 0, mc.width, mc.height)
      m.strokeStyle = 'rgba(255,255,255,.08)'
      for (let g = 500; g < sim.cfg.screenSize; g += 500) { m.beginPath(); m.moveTo(g * S, 0); m.lineTo(g * S, mc.height); m.moveTo(0, g * S); m.lineTo(mc.width, g * S); m.stroke() }
      const recs = sim.records, n0 = Math.max(0, recs.length - 150)
      m.strokeStyle = 'rgba(255,77,224,.5)'; m.beginPath()
      for (let i = n0; i < recs.length; i++) { const x = recs[i].worldX * S, y = recs[i].worldY * S; if (i === n0) m.moveTo(x, y); else m.lineTo(x, y) }
      m.stroke()
      const sc = camScale(sim.cfg)
      const { view } = sim.last
      m.strokeStyle = '#38bdf8'; m.lineWidth = 1.5
      m.strokeRect((view.cx - (w / 2) * sc) * S, (view.cy - (h / 2) * sc) * S, w * sc * S, h * sc * S)
      m.lineWidth = 1
      sim.last.tgts.forEach((t, i) => { m.fillStyle = i === 0 ? '#ff4de0' : '#9ca3af'; m.beginPath(); m.arc(t.x * S, t.y * S, i === 0 ? 4 : 3, 0, 6.3); m.fill() })
      if (out.estWorld) { m.strokeStyle = '#22ff88'; m.beginPath(); m.arc((out.estWorld.x + sim.last.view.cx - sim.last.cam.x) * S, (out.estWorld.y + sim.last.view.cy - sim.last.cam.y) * S, 8, 0, 6.3); m.stroke() }
    }
    // error plot
    const pc = plotRef.current
    if (pc) {
      const p = pc.getContext('2d'), W = pc.width, H = pc.height
      p.fillStyle = '#fff'; p.fillRect(0, 0, W, H)
      const recs = sim.records, N = 300, n0 = Math.max(0, recs.length - N), YM = 40
      const yy = (e) => H - 18 - Math.min(e, YM) / YM * (H - 28)
      p.strokeStyle = '#dc2626'; p.setLineDash([5, 4]); p.beginPath(); p.moveTo(0, yy(10)); p.lineTo(W, yy(10)); p.stroke(); p.setLineDash([])
      p.fillStyle = '#dc2626'; p.font = '10px monospace'; p.fillText('10 px spec', 4, yy(10) - 3)
      for (let i = n0; i < recs.length; i++) { p.fillStyle = STATE_COLOR[recs[i].state] || '#999'; p.fillRect(((i - n0) / N) * W, H - 12, W / N + 1, 12) }
      p.strokeStyle = '#111'; p.lineWidth = 1.5; p.beginPath()
      for (let i = n0; i < recs.length; i++) { const x = ((i - n0) / N) * W, y = yy(recs[i].errTrack); if (i === n0) p.moveTo(x, y); else p.lineTo(x, y) }
      p.stroke(); p.lineWidth = 1
      p.fillStyle = '#555'; p.fillText('boresight error (px), clipped at 40', 4, 11)
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
      setLive({ state: sim.last.out.state, t: sim.last.rec.t, err: sim.last.rec.errTrack, ms: sim.last.rec.procMs })
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
        fps: videoFps, gt: gtText ? parseGroundTruth(gtText) : null, cancel: cancelRef.current,
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

  const scenarioTable = useMemo(() => batch.rows, [batch.rows])
  const c = stats?.checks
  const slewPx = Math.min(cfg.maxPanSpeed, cfg.maxTiltSpeed) * 160
  const worstRel = cfg.targetSpeed + (cfg.platform ? cfg.platformSpeed * cfg.fps : 0)
  const feasible = worstRel <= slewPx

  return (
    <div className="layout">
      <aside className="sidebar panel">
        <div className="brand"><h1>Q-Rex</h1><p>FSOC coarse-alignment virtual camera tracker</p></div>
        <div className="btnrow">
          <button className="btn primary" onClick={() => setRunning((r) => !r)}>{running ? 'Pause' : 'Run'}</button>
          <button className="btn" onClick={() => { restart(cfg); setRunning(true) }}>Restart</button>
        </div>
        <div className="field">
          <label>Sim speed <b>{speed >= 50 ? 'max' : `${speed}×`}</b></label>
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            <option value={0.25}>0.25×</option><option value={0.5}>0.5×</option><option value={1}>1× (real time)</option><option value={2}>2×</option><option value={4}>4×</option><option value={100}>max</option>
          </select>
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
        <div className="btnrow" style={{ marginTop: 'auto' }}>
          <button className="btn" onClick={() => exportAll('json')}>JSON</button>
          <button className="btn" onClick={() => exportAll('csv')}>CSV log</button>
          <button className="btn" onClick={() => exportAll('html')}>HTML</button>
        </div>
      </aside>

      <main className="main">
        <section className="panel statbar">
          <div className="status" style={{ background: STATE_COLOR[live.state] }}>{live.state}{done ? ' · DONE' : ''}</div>
          <Tile label="Acquisition" value={fmt(stats?.acquisitionTimeSec)} unit=" s" ok={c?.K01_acquisition_le_2s} sub="spec ≤ 2 s" />
          <Tile label="Tracking error (mean)" value={fmt(stats?.trackingErrorMeanPx)} unit=" px" ok={c?.K02_tracking_error_le_10px} sub={`RMSE ${fmt(stats?.trackingErrorRmsePx)} · max ${fmt(stats?.trackingErrorMaxPx, 1)}`} />
          <Tile label="Centroid error (RMSE)" value={fmt(stats?.centroidingErrorRmsePx, 3)} unit=" px" sub={`P95 ${fmt(stats?.centroidingErrorP95Px, 3)}`} />
          <Tile label="Target loss" value={fmt(stats?.targetLossPct, 1)} unit=" %" ok={c?.K03_target_loss_lt_5pct} sub={`lock retention ${fmt(stats?.lockRetentionRatePct, 1)} %`} />
          <Tile label="Re-acquisition (max)" value={fmt(stats?.reacquisitionTimeMaxSec)} unit=" s" ok={c?.K04_reacquisition_le_1s} sub={`${stats?.reacquisitionEvents ?? 0} events`} />
          <Tile label="Tracker FPS" value={fmt(stats?.averageFPS, 0)} unit="" ok={c?.K05_fps_ge_20} sub={`${fmt(stats?.processingTimeMeanMs, 1)} ms / frame`} />
        </section>

        <div className="grid">
          <section className="panel view">
            <header>Virtual camera <span>{cfg.camW}×{cfg.camH} {cfg.cameraType === 'colour' ? 'colour' : 'mono'} · {cfg.fovX}°×{(cfg.fovX * cfg.camH / cfg.camW).toFixed(1)}°</span></header>
            <canvas key={`${cfg.camW}x${cfg.camH}`} ref={camRef} width={cfg.camW} height={cfg.camH} className="cam" style={{ aspectRatio: `${cfg.camW}/${cfg.camH}` }} />
            <div className="legend"><i style={{ background: '#ef4444' }} />boresight <i style={{ background: '#22ff88' }} />detection <i style={{ background: '#fde047' }} />estimate <i style={{ background: '#22d3ee' }} />ROI <i style={{ background: '#ff4de0' }} />truth</div>
          </section>
          <div className="side">
            <section className="panel view">
              <header>Screen map <span>{cfg.screenSize}×{cfg.screenSize} px · {(cfg.screenSize / 160).toFixed(1)}°</span></header>
              <canvas ref={mapRef} width={320} height={320} className="map" />
            </section>
            <section className="panel view">
              <header>Live error</header>
              <canvas ref={plotRef} width={320} height={150} className="plot" />
            </section>
          </div>
        </div>

        <section className="panel pad">
          <h2>Benchmark 1 — scenario suite</h2>
          <div className="btnrow wrap">
            <label>Seconds/run <input type="number" min={5} max={120} value={batchSecs} onChange={(e) => setBatchSecs(Number(e.target.value))} /></label>
            <label>Seeds <input type="number" min={1} max={10} value={batchSeeds} onChange={(e) => setBatchSeeds(Number(e.target.value))} /></label>
            <button className="btn primary" disabled={batch.running} onClick={runBatch}>{batch.running ? `Running ${(batch.progress * 100).toFixed(0)}%` : 'Run all scenarios'}</button>
            {scenarioTable.length > 0 && <button className="btn" onClick={() => download('scenario_suite.json', JSON.stringify(scenarioTable.map(({ metrics, ...r }) => ({ ...r, metrics })), null, 2), 'application/json')}>Export suite JSON</button>}
          </div>
          {scenarioTable.length > 0 && (
            <table className="tbl"><thead><tr><th>Scenario</th><th>Acq s</th><th>Err px</th><th>Cent RMSE</th><th>Loss %</th><th>Lock %</th><th>Re-acq s</th><th>FPS</th><th>Pass</th></tr></thead>
              <tbody>{scenarioTable.map((r) => (
                <tr key={r.id}><td>{r.label}</td><td className={r.checks.K01_acquisition_le_2s === r.runs ? 'g' : 'r'}>{r.acq.toFixed(2)}</td><td className={r.checks.K02_tracking_error_le_10px === r.runs ? 'g' : 'r'}>{r.err.toFixed(1)}</td><td>{r.cent.toFixed(2)}</td><td className={r.checks.K03_target_loss_lt_5pct === r.runs ? 'g' : 'r'}>{r.loss.toFixed(1)}</td><td>{r.lock.toFixed(1)}</td><td className={r.checks.K04_reacquisition_le_1s === r.runs ? 'g' : 'r'}>{r.reacq.toFixed(2)}</td><td>{r.fps.toFixed(0)}</td><td className={r.pass === r.runs ? 'g' : 'r'}>{r.pass}/{r.runs}</td></tr>
              ))}</tbody></table>
          )}
        </section>

        <section className="panel pad">
          <h2>Benchmark 2 — video input (PTZ bypassed)</h2>
          <p className="muted">Frame-exact decode of an .mp4 (any size; ≥1000 px frames are treated as the whole screen). Optional ground truth CSV: <code>frame,x,y</code>.</p>
          <div className="btnrow wrap">
            <input type="file" accept="video/*" ref={videoFile} />
            <input type="file" accept=".csv,.txt" ref={gtFile} title="ground truth csv" />
            <label>fps <input type="number" min={1} max={120} value={videoFps} onChange={(e) => setVideoFps(Number(e.target.value))} /></label>
            <button className="btn primary" disabled={video.busy} onClick={runVideoBench}>{video.busy ? `Processing ${(video.progress * 100).toFixed(0)}%` : 'Run on video'}</button>
            {video.busy && <button className="btn" onClick={() => { cancelRef.current.stop = true }}>Stop</button>}
          </div>
          {video.error && <div className="warn">{video.error}</div>}
          <div className="vrow">
            <canvas ref={videoCanvas} width={480} height={360} className="vcanvas" />
            {video.result && (
              <div>
                <table className="tbl small"><tbody>{Object.entries(video.result.metrics).map(([k, v]) => <tr key={k}><td>{k}</td><td>{String(v ?? 'n/a')}</td></tr>)}</tbody></table>
                <div className="btnrow">
                  <button className="btn" onClick={() => download('video_centroids.csv', videoRowsToCSV(video.result.rows), 'text/csv')}>Centroid log CSV</button>
                  <button className="btn" onClick={() => download('video_report.json', JSON.stringify(video.result.metrics, null, 2), 'application/json')}>Report JSON</button>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
