import { useEffect, useRef, useState } from 'react'
import './home.css'
import Logo from './Logo.jsx'
import { ArchDiagram, StateDiagram } from './ArchDiagram.jsx'

const NAV = [
  ['overview', 'Overview'],
  ['problem', 'Problem'],
  ['architecture', 'Architecture'],
  ['innovation', 'Innovation'],
  ['stack', 'Tech Stack'],
  ['results', 'Results'],
  ['compliance', 'Compliance'],
  ['roadmap', 'Roadmap'],
]

const STATS = [
  ['0.5 s', 'Acquisition (spec ≤ 2 s)'],
  ['0.05 px', 'Centroid error (RMSE)'],
  ['0 %', 'Target loss (spec < 5 %)'],
  ['54', 'Automated tests'],
]

const TABS = {
  Detection: {
    head: 'Find a 5-px spot in noise',
    pts: [
      'Median filter only when salt pixels appear (>0.3 %), border-safe, 2 passes for dense noise.',
      'Box matched filter at 5 scales (5–20 px) via an integral image — O(pixels) per scale.',
      'CFAR threshold = median + 6σ of the filter output itself (MAD) — no noise model needed.',
      'Validation: blob must fill ≥35 % of its box; streak-like (rain) blobs rejected.',
      'Iterative weighted centroid with ring-median background: 0.02–0.2 px RMSE.',
    ],
  },
  Estimation: {
    head: 'Know where it is — and where it will be',
    pts: [
      'Two interacting models (CV + CA), model probabilities from innovation likelihoods.',
      'Measurement noise R observed from second differences: var(z[k]−2z[k−1]+z[k−2]) = 6R.',
      'Process noise adapted from normalised innovations: loose on manoeuvres, tight on steady motion.',
      'Chi-square gating + Huber inflation reject false detections and outliers.',
      'Latency-compensated prediction: the camera aims where the beacon will be, not where it was.',
    ],
  },
  Control: {
    head: 'Steer fast without overshooting',
    pts: [
      'u = g·(aim − p)/dt + (1 − g)·v̂ : feed-forward from the estimated velocity plus shaped feedback.',
      'Stopping profile |u − v̂| ≤ √(2·a·|d|) brakes before the target instead of ringing.',
      'Gimbal model enforces 5–10 °/s rate limit and acceleration limit; saturation is logged, not hidden.',
      'Pointing range extends 450 px past the screen so platform offsets stay compensable at the edge.',
    ],
  },
  'AI verifier': {
    head: 'A small CNN that says “beacon or not?”',
    pts: [
      '74 k-parameter convolutional network on a 32×32 window around each detector candidate (≈ 2 ms).',
      'Trained on ≈ 590 k simulator patches: random noise mixes, fog / rain / low light, zoomed-out views, video-codec artefacts, 5–20 px beacons of any shape and brightness.',
      'Hard negatives are the detector’s own false alarms on beacon-free frames — exactly what it will meet in service.',
      'Held-out test: 99.4 % accuracy; hard test (faint, foggy, noisy) 97.8 %; compressed-video test 99.6 %. JS inference matches PyTorch to 1e-6.',
      'Effect (measured): on low-light, rain, zoomed-out and compressed-video frames, false alarms on empty frames fall from 10–14 % to 0–2 %; faint beacons in fog are kept as well as by the classical detector (93 %). It does not improve centroid accuracy, so the classical centroid is kept.',
      'Fail-safe: very strong classical detections are never vetoed; the classical detector remains the fallback.',
    ],
  },
  Acquisition: {
    head: 'Acquire in under 2 seconds — three ways',
    pts: [
      'A fixed 4°×3° camera sees only 7.7 % of the 2000×2000 screen: a scan needs ≈ 12.5 s, so a plain sweep cannot meet 2 s.',
      'Wide-view mode (default): a 4×-binned overview of the whole screen is used only while searching or re-acquiring; two hits confirm, the camera slews at up to 800 px/s.',
      'Zoom-lens mode (camera only, no extra sensor): the same camera starts at the full-screen FOV, detects in ≈ 0.03 s, then narrows its FOV while centring — beacon centred at 4°×3° in ≤ 1.3 s.',
      'Raster-scan mode (fixed FOV) is also implemented and reported honestly: it cannot meet 2 s.',
    ],
  },
}

const INNOV = [
  ['Two ways to acquire fast', 'A wide view (extra 4×-binned sensor) or the lens itself zooming out, then in — both reach ≤ 2 s where a fixed-FOV sweep needs ≈ 12 s.', 'accent'],
  ['Self-calibrated detector', 'Threshold taken from the filter output statistics (median + MAD) — works unchanged across salt & pepper, Gaussian, Poisson, fog and rain.', ''],
  ['Noise is observable', 'Jitter level is learned from second differences of consecutive measurements, independent of any motion model.', ''],
  ['Trained verifier', 'A 74 k-parameter CNN, trained on simulator data incl. zoomed-out and video-codec frames, vetoes false alarms (10–14 % → 0–2 % on low-light, rain and compressed frames); a strong classical hit always overrides it.', 'accent'],
  ['Adaptive IMM', 'Process noise reacts to manoeuvres within two frames and relaxes during steady motion — fixed a real lock-loss bug found in testing.', 'dark'],
  ['Ground-truth firewall', 'The tracker only receives pixels, the encoder angle and a clock. A unit test asserts the exact input keys.', ''],
  ['Everything auditable', 'Each run writes JSON, HTML and per-frame CSV logs with the full configuration, so any reported number can be reproduced.', ''],
  ['Reproducible by seed', 'Independent seeded random streams per subsystem: the same seed gives a bit-identical log.', ''],
]

const STACK = [
  ['Language', 'JavaScript (ES modules)', 'One engine runs in the browser, Node tests and Electron — no port, no server.'],
  ['GUI', 'React 19 + Vite 8, HTML canvas', 'Live 30 Hz drawing with a tiny bundle (≈ 90 kB gzipped).'],
  ['Detection', 'Custom matched filter + CFAR', 'No heavy dependency; 2–8 ms per frame; transparent behaviour for reviewers.'],
  ['Estimation', 'Custom IMM Kalman filter', 'Small matrices, exact control over adaptation and gating.'],
  ['Video input', 'HTML5 video, frame-exact seek', 'Decodes any browser-supported .mp4 with no native codec dependency.'],
  ['Desktop app', 'Electron 44 + @electron/packager', 'Standalone executable that runs offline on Linux / Windows / macOS.'],
  ['AI training', 'Python 3 + PyTorch (CPU)', 'Offline only: ml/train.py produces a 700 kB JSON; the app runs the network in plain JavaScript.'],
  ['Testing', 'node:test, puppeteer, ffmpeg', '54 tests, a real-browser Benchmark-2 test and a 21-video robustness matrix.'],
  ['Reports', 'JSON · CSV · HTML auto-generated', 'Performance log written at the end of every timed run.'],
]

const RESULTS = [
  ['Circular / line / figure-8 / random', '0.5–0.6', '0.1–0.6', '0.03–0.06', '0', '100', '3/3'],
  ['Gaussian σ = 20', '0.53', '1.2', '0.19', '0.1', '99.9', '3/3'],
  ['Salt & pepper 10 %', '0.54', '0.6', '0.11', '0', '100', '3/3'],
  ['Poisson noise', '0.54', '1.1', '0.06', '0', '100', '3/3'],
  ['Jitter ±20 px/frame', '0.56', '6.3', '0.04', '0', '100', '3/3'],
  ['Platform 20 px/frame', '1.17', '1.0', '0.04', '0', '100', '3/3'],
  ['Fog · rain · low light', '0.54', '0.6–0.7', '0.03–0.05', '0', '100', '3/3'],
  ['Decoys · beacon dropouts', '0.54', '0.6–1.1', '0.05', '0', '100', '3/3'],
  ['All disturbances at maximum', '1.16', '10.8', '0.20', '0.1', '99.9', '0/3'],
]

const SPEC = [
  ['Acquisition time', '≤ 2 s', '0.5–0.8 s (1.87 s worst case) · camera-only zoom: 0.03 s', true],
  ['Tracking error', '≤ 10 px', '0.1–1.2 px · 6.3 px at ±20 px/frame jitter', true],
  ['Target loss', '< 5 %', '0 – 0.1 %', true],
  ['Re-acquisition', '≤ 1 s', '≤ 0.5 s', true],
  ['Processing speed', '≥ 20 FPS', '2–8 ms / frame', true],
  ['Disturbances combined at maximum', '(not a spec row)', '10.8 px mean error — see limits', false],
]

const EVAL = [
  ['Functional verification', '20 %', 'Live GUI with spec pass/fail tiles, 7 motions, every noise and disturbance live-adjustable, scenario loader.'],
  ['Benchmark 1 — scenarios', '30 %', 'One-click scenario suite, per-frame centroiding-error CSV, auto JSON/HTML/CSV performance logs.'],
  ['Benchmark 2 — .mp4 video', '30 %', 'Frame-exact video input, PTZ bypassed, centroid log, RMSE / acquisition / re-acquisition / lock / FPS, ground-truth comparison.'],
  ['Technical evaluation', '20 %', '14-page report, architecture, trained CNN with measured ablation, traceability matrix, honest limitations, roadmap, 54 tests.'],
]

const ROADMAP_DONE = [
  ['Video tracker: identity + coast', 'A fast beacon no longer loses to a static noise blob; coast prediction cannot run off-screen. 2000² dim beacon: miss (591 px) → pass (0.47 px).'],
  ['Impulse-safe coarse search', 'Trimmed-mean down-sampling plus a full-resolution first pass: 1280×720 dim + 10 % S&P went from 38 % to 90 % lock (679 → 15 px RMSE).'],
  ['AI verifier v4', '74 k parameters, ≈ 590 k patches incl. zoomed-out and codec data: faint-in-fog recall back to 93 %, compressed-video false alarms 10–14 % → 0 %.'],
  ['Evidence refreshed', '21-video matrix, 54 tests, rebuilt PDFs, single file and Linux / Windows executables.'],
]

const ROADMAP_NEXT = [
  ['1', 'GPU-trained multi-frame verifier', 'A short stack of patches in time, 0.2–0.4 M parameters, millions of patches. Single-frame SNR is the real limit for faint and zoomed-out beacons.', 'Needs the NVIDIA driver (sudo + reboot)'],
  ['2', 'Offline smoothing for Benchmark 2', 'Forward–backward (Viterbi / RTS) pass over per-frame candidates, reported separately as non-causal. Targets the dim crf-36 video: 15 px → a few px.', '≈ 1 h'],
  ['3', 'Track-before-detect for zoom acquisition', 'Weak candidates (z ≈ 4) confirmed over 3–4 frames with a tight motion gate; may bring the 2.10 s seed under 2 s. Checked against false alarms first.', '≈ 1–1.5 h'],
  ['4', 'Real recorded video', 'Training and evaluation on the organisers’ sample files to close the simulator-to-real gap.', 'Needs sample files'],
]

const LIMITS = [
  'Jitter ±20 px/frame, platform 20 px/frame and every noise at once: 10.8 px mean error against 10 px. An ideal causal filter that must hit the beacon one frame ahead bottoms out at ≈ 10.4 px on these sequences (measured), so 10 px is not reachable in this combined case; the result also depends on the gimbal acceleration, which the statement does not specify (14.3 px at 20 °/s², 10.8 px at 60 °/s² default). Each disturbance alone passes. The beacon is never lost.',
  'The AI is modest by design: adaptive estimation (IMM, online noise identification) plus a small CNN verifier (v4) that removes false alarms. It does not improve centroid accuracy and still loses hits on zoomed-out low-light frames (91 % → 78 %, with 82 % → 1 % false alarms), so it is optional and the classical detector stays the default.',
  'Acquisition ≤ 2 s needs a wide view or the zoom lens (a fixed-FOV sweep takes ≈ 12.5 s). Both are implemented; which one the organisers accept is an open question for the mentors. In zoom mode one of three seeds needs 2.10 s in the all-disturbances case.',
  'The judges’ own scenarios and videos have not been run — results come from our simulator and 21 self-generated videos (several resolutions, codecs, noise types; 20 meet the pass line, one extreme dim + heavy-compression case locks 90 % with 15 px RMSE). The Windows build is verified by CI on a real Windows runner, not by us locally.',
]

/** Small live illustration: a beacon on a figure-8 path, the camera FOV box chasing it with lag, and its trail. */
function HeroViz() {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    let raf, t0 = performance.now()
    const cam = { x: null, y: 0 }, trail = []
    const draw = (now) => {
      raf = requestAnimationFrame(draw)
      const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight
      if (!W || !H) return
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr) }
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0)
      const t = (now - t0) / 1000
      const bx = W / 2 + Math.sin(t * 0.9) * W * 0.36, by = H / 2 + Math.sin(t * 1.8) * H * 0.3
      if (cam.x === null) { cam.x = bx; cam.y = by }
      cam.x += (bx - cam.x) * 0.07; cam.y += (by - cam.y) * 0.07
      trail.push([bx, by]); if (trail.length > 70) trail.shift()
      g.fillStyle = '#0d1b2a'; g.fillRect(0, 0, W, H)
      g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1
      for (let x = 0; x < W; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke() }
      for (let y = 0; y < H; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke() }
      g.strokeStyle = 'rgba(255,84,0,.55)'; g.lineWidth = 2; g.beginPath()
      trail.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke()
      const fw = Math.min(150, W * 0.3), fh = fw * 0.75
      g.strokeStyle = '#38bdf8'; g.lineWidth = 2; g.strokeRect(cam.x - fw / 2, cam.y - fh / 2, fw, fh)
      g.strokeStyle = 'rgba(56,189,248,.5)'; g.beginPath(); g.moveTo(cam.x - 10, cam.y); g.lineTo(cam.x + 10, cam.y); g.moveTo(cam.x, cam.y - 10); g.lineTo(cam.x, cam.y + 10); g.stroke()
      g.shadowColor = '#ff8a3d'; g.shadowBlur = 16; g.fillStyle = '#fff'; g.fillRect(bx - 5, by - 5, 10, 10); g.shadowBlur = 0
      g.strokeStyle = '#22ff88'; g.lineWidth = 2; g.strokeRect(bx - 9, by - 9, 18, 18)
      g.font = '600 11px "JetBrains Mono", monospace'; g.fillStyle = '#94a3b8'
      g.fillText('beacon', bx + 14, by - 12); g.fillStyle = '#38bdf8'; g.fillText('camera FOV 4°×3°', cam.x - fw / 2, cam.y - fh / 2 - 6)
      const e = Math.hypot(bx - cam.x, by - cam.y)
      g.fillStyle = '#22ff88'; g.fillText(`pointing error ${e.toFixed(0)} px (virtual)`, 12, H - 12)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} className="heroviz" aria-label="Animated illustration of a camera tracking a beacon" />
}

export default function Home() {
  const [tab, setTab] = useState('Detection')
  const t = TABS[tab]
  return (
    <div className="home">
      <nav className="hnav">
        <a className="hlogo" href="#/"><Logo size={42} /><span>Q-Rex</span><span className="logo-tag">ISRO PS-26169</span></a>
        <div className="hlinks">
          {NAV.map(([id, label]) => <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }) }}>{label}</a>)}
          <a className="ws-badge" href="#/app">🎯 Workstation</a>
        </div>
        <a className="hbtn primary" href="#/app">Launch Workstation</a>
      </nav>

      <header className="hhero">
        <div className="hero-card">
          <div className="chips"><span>ISRO · PS-26169</span><span>Software</span><span>Smart Automation</span><span>Space Technology</span></div>
          <h1><span className="brand-word">Q-Rex</span></h1>
          <div className="tagline"><span>Coarse alignment,</span> <span className="tag-hl">in software</span></div>
          <p className="hero-sub">
            A virtual pan-tilt camera that <strong>finds</strong> a moving optical beacon, <strong>locks</strong> onto it and
            <strong> keeps it centred</strong> — through noise, jitter, platform motion and bad weather — so free-space optical
            terminals can be developed and validated without any hardware.
          </p>
          <div className="hero-actions">
            <a className="hbtn primary" href="#/app">Launch Workstation</a>
            <a className="hbtn outline" href="#architecture" onClick={(e) => { e.preventDefault(); document.getElementById('architecture')?.scrollIntoView({ behavior: 'smooth' }) }}>Explore Architecture</a>
          </div>
          <HeroViz />
          <div className="stat-row">
            {STATS.map(([n, l]) => <div className="stat" key={l}><div className="num">{n}</div><div className="lab">{l}</div></div>)}
          </div>
        </div>
      </header>

      <section id="overview" className="hsec">
        <div className="label">00 / Executive overview</div>
        <div className="shead"><h2>Point the beam before you fine-tune it</h2>
          <p className="subtext">Free-space optical links use laser beams only micro-radians wide. Before a fast steering mirror can take over, a coarse stage must observe the sky, detect the remote beacon, estimate its position and keep it in view — Q-Rex does exactly that, entirely in software.</p></div>
        <div className="bento">
          <div className="tile large"><div className="tag">The problem</div><h3>Hardware is expensive; algorithms need iteration</h3><p>Cameras, pan-tilt mounts and optics cost far more than the code that drives them. A faithful virtual camera lets teams develop, stress-test and benchmark tracking algorithms on a laptop — and compare them on the same disturbances.</p><span className="tbadge">PAT · coarse alignment</span></div>
          <div className="tile small accent"><div className="tag">Offline</div><h3>Runs anywhere</h3><p>Browser, Node and a standalone desktop app. No server, no internet.</p></div>
          <div className="tile third dark"><div className="tag">Sees only pixels</div><h3>No cheating</h3><p>The tracker never receives ground truth — only frames and its own encoder angle.</p></div>
          <div className="tile third"><div className="tag">Everything configurable</div><h3>Scene, camera, disturbances</h3><p>Screen, resolution, FOV, 7 motions, decoys, noise, jitter, platform, atmosphere, turbulence, mono or colour.</p></div>
          <div className="tile third"><div className="tag">Measured</div><h3>Live statistics</h3><p>Acquisition, error, loss, re-acquisition and FPS shown against the spec in real time, logged automatically.</p></div>
        </div>
      </section>

      <section id="problem" className="hsec">
        <div className="label">01 / Specification vs. measured</div>
        <div className="shead"><h2>Every requirement, measured</h2>
          <p className="subtext">Results from the headless benchmark: 3 seeds × 20 s per scenario, one disturbance at its specification maximum at a time.</p></div>
        <div className="twrap"><table className="btable"><thead><tr><th>Requirement</th><th>Spec</th><th>Measured</th><th>Status</th></tr></thead>
          <tbody>{SPEC.map(([a, b, c, ok]) => <tr key={a}><td><b>{a}</b></td><td className="mono">{b}</td><td>{c}</td><td><span className={`pill ${ok ? 'ok' : 'warn'}`}>{ok ? 'MET' : 'LIMIT'}</span></td></tr>)}</tbody></table></div>
      </section>

      <section id="architecture" className="hsec">
        <div className="label">02 / System architecture</div>
        <div className="shead"><h2>From photons to pointing</h2>
          <p className="subtext">Every frame flows through the same closed loop: the sensor model renders what the camera would see, the tracker detects, estimates and steers, and the virtual gimbal moves the camera for the next exposure. Ground truth only ever flows to the recorder.</p></div>
        <ArchDiagram />
        <div className="arch-box">
          <div className="tabs">{Object.keys(TABS).map((k) => <button key={k} className={`tab ${k === tab ? 'active' : ''}`} onClick={() => setTab(k)}>{k}</button>)}</div>
          <h3>{t.head}</h3>
          <ul>{t.pts.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <h3 className="subhead">Tracker state machine</h3>
        <StateDiagram />
      </section>

      <section id="innovation" className="hsec">
        <div className="label">03 / Innovation</div>
        <div className="shead"><h2>What makes it different</h2></div>
        <div className="bento">{INNOV.map(([h, p, c]) => <div key={h} className={`tile third ${c}`}><div className="tag">Idea</div><h3>{h}</h3><p>{p}</p></div>)}</div>
      </section>

      <section id="stack" className="hsec">
        <div className="label">04 / Tech stack &amp; rationale</div>
        <div className="shead"><h2>Boring tools, sharp engineering</h2></div>
        <div className="twrap"><table className="btable"><thead><tr><th>Layer</th><th>Choice</th><th>Why</th></tr></thead>
          <tbody>{STACK.map(([a, b, c]) => <tr key={a}><td><b>{a}</b></td><td className="mono">{b}</td><td>{c}</td></tr>)}</tbody></table></div>
      </section>

      <section id="results" className="hsec">
        <div className="label">05 / Proof of concept</div>
        <div className="shead"><h2>Benchmark results</h2>
          <p className="subtext">Mean over 3 seeds, 20 s each. Pass = all five checks (acquisition, error, loss, re-acquisition, FPS) met on every seed.</p></div>
        <div className="twrap"><table className="btable"><thead><tr><th>Scenario</th><th>Acq. s</th><th>Error px</th><th>Centroid px</th><th>Loss %</th><th>Lock %</th><th>Pass</th></tr></thead>
          <tbody>{RESULTS.map((r) => <tr key={r[0]} className={r[6] === '0/3' ? 'bad' : ''}><td><b>{r[0]}</b></td>{r.slice(1, 6).map((c, i) => <td key={i} className="mono">{c}</td>)}<td><span className={`pill ${r[6] === '3/3' ? 'ok' : 'warn'}`}>{r[6]}</span></td></tr>)}</tbody></table></div>
        <div className="terminal">
          <div className="tbar"><i /><i /><i /><span>npm test · npm run e2e</span></div>
          <pre>{`✔ #12 motions: ≥4 required + spiral, sinusoidal, user-defined
✔ #19 re-acquisition after beacon dropouts (0.5 s blink-out)
✔ #21.1 image noise: salt&pepper, Gaussian, Poisson — selectable
✔ #21.5 platform motion ≤ 20 px/frame: linear + 4 optional models
✔ ground truth never reaches the tracker
ℹ tests 54   ℹ pass 54   ℹ fail 0

E2E VIDEO (2000×2000 H.264, σ≈12, ground truth)
  acquisition 0.033 s · lock 100 % · centroid RMSE 0.072 px
E2E VIDEO: PASS`}</pre>
        </div>
      </section>

      <section id="compliance" className="hsec">
        <div className="label">06 / Evaluation &amp; honest limits</div>
        <div className="shead"><h2>How it maps to the evaluation</h2></div>
        <div className="evals">{EVAL.map(([a, b, c]) => <div className="evalcard" key={a}><div className="pct">{b}</div><h4>{a}</h4><p>{c}</p></div>)}</div>
        <div className="limits"><h3>Stated plainly — what is not met</h3><ul>{LIMITS.map((x) => <li key={x}>{x}</li>)}</ul></div>
      </section>

      <section id="roadmap" className="hsec">
        <div className="label">07 / Roadmap</div>
        <div className="shead"><h2>What is done and what comes next</h2>
          <p className="subtext">Planned work is listed with its reason and its cost. Two limits stay by physics: the 10.4 px causal floor of jitter + platform + all noise (a faster gimbal does not help) and the geometric 12.5 s sweep of a fixed-FOV scan.</p></div>
        <div className="bento">{ROADMAP_DONE.map(([h, p]) => <div key={h} className="tile third" style={{ gridColumn: "span 3", minHeight: 200 }}><div className="tag">Done</div><h3>{h}</h3><p>{p}</p></div>)}</div>
        <div className="twrap" style={{ marginTop: '2.2rem' }}><table className="btable"><thead><tr><th>#</th><th>Planned improvement</th><th>Why / expected effect</th><th>Needs</th></tr></thead>
          <tbody>{ROADMAP_NEXT.map((r) => <tr key={r[0]}><td className="mono">{r[0]}</td><td><b>{r[1]}</b></td><td>{r[2]}</td><td><span className="pill">{r[3]}</span></td></tr>)}</tbody></table></div>
      </section>

      <footer className="hfoot">
        <div className="cta"><h2>See it track.</h2><p>Open the workstation, load a scenario and push the disturbances to their limits.</p>
          <div className="hero-actions"><a className="hbtn primary" href="#/app">Launch Workstation</a><a className="hbtn outline" href="#overview" onClick={(e) => { e.preventDefault(); document.getElementById('overview')?.scrollIntoView({ behavior: 'smooth' }) }}>Back to top</a></div></div>
        <div className="fbottom"><span>© Q-Rex — FSOC coarse-alignment virtual camera tracker · ISRO / Department of Space PS-26169</span>
          <span className="flinks"><a href="#problem">Spec</a><a href="#architecture">Architecture</a><a href="#results">Results</a><a href="#roadmap">Roadmap</a><a href="#/app">Workstation</a></span></div>
      </footer>
    </div>
  )
}
