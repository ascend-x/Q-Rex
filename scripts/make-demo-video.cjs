// Records the 3-5 minute demo video of the GUI (headless Chromium + puppeteer screencast + ffmpeg), following docs/DEMO_SCRIPT.md.
// usage: node scripts/make-demo-video.cjs [url=file://.../dist-single/q-rex.html] [out=demo/q-rex-demo.mp4]
// Needs: ffmpeg, chromium at /usr/bin/chromium, global puppeteer (npm i -g puppeteer).
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require(execSync('npm root -g').toString().trim() + '/puppeteer');

const root = path.resolve(__dirname, '..');
const URL0 = process.argv[2] || 'file://' + path.join(root, 'dist-single/q-rex.html');
const OUT = path.resolve(process.argv[3] || path.join(root, 'demo/q-rex-demo.mp4'));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qrex-demo-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeSampleVideo() {
  // 2000x2000 H.264 clip with a moving beacon + ground truth, same generator as the e2e test
  const mp4 = path.join(tmp, 'judge-style.mp4'), csv = path.join(tmp, 'gt.csv');
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', '2000x2000', '-r', '30', '-i', '-', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', mp4], { stdio: ['pipe', 'inherit', 'inherit'] });
  let s = 7; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const gt = ['frame,x,y'];
  for (let k = 0; k < 90; k++) {
    const f = Buffer.alloc(2000 * 2000);
    for (let i = 0; i < f.length; i++) f[i] = Math.max(0, Math.min(255, 24 + (rnd() + rnd() + rnd() - 1.5) * 24));
    const cx = 300 + 18 * k, cy = Math.round(1000 + 350 * Math.sin(k / 18));
    for (let y = -5; y < 5; y++) for (let x = -5; x < 5; x++) f[(cy + y) * 2000 + cx + x] = 230;
    gt.push(`${k},${cx - 0.5},${cy - 0.5}`);
    if (!ff.stdin.write(f)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end(); await new Promise((r) => ff.on('close', r));
  fs.writeFileSync(csv, gt.join('\n'));
  return { mp4, csv };
}

(async () => {
  const sample = await makeSampleVideo();
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--allow-file-access-from-files', '--window-size=1440,900'], headless: true, defaultViewport: { width: 1440, height: 900 } });
  const page = await browser.newPage();
  const webm = path.join(tmp, 'rec.webm');
  const rec = await page.screencast({ path: webm });
  const go = (hash) => page.evaluate((h) => { window.location.hash = h; }, hash);
  const cap = async (text, ms, sub = '') => {
    await page.evaluate((t, s2) => {
      let d = document.getElementById('demo-cap');
      if (!d) {
        d = document.createElement('div'); d.id = 'demo-cap';
        d.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99999;max-width:1100px;background:#0d1b2a;color:#fff;border:3px solid #111;border-radius:14px;box-shadow:6px 6px 0 #ff5400;padding:12px 22px;font:700 20px "Space Grotesk",system-ui,sans-serif;text-align:center;pointer-events:none';
        document.body.appendChild(d);
        const st = document.createElement('style'); st.textContent = 'body{padding-bottom:104px}.layout{height:calc(100vh - 104px)!important}'; document.head.appendChild(st); // leave room for the captions
      }
      d.innerHTML = t + (s2 ? `<div style="font:500 14px 'JetBrains Mono',monospace;color:#cbd5e1;margin-top:4px">${s2}</div>` : '');
    }, text, sub);
    await wait(ms);
  };
  const clickText = async (sel, text) => { for (const el of await page.$$(sel)) if ((await el.evaluate((e) => e.textContent)).trim().toLowerCase().includes(text.toLowerCase())) { await el.click(); return true; } return false; };
  const load = async (id, label, ms, sub) => {
    for (const s of await page.$$('.sidebar select')) if (await s.evaluate((e, i) => [...e.options].some((o) => o.value === i), id)) await s.select(id);
    await clickText('.sidebar button', 'Load');
    await cap(label, ms, sub);
  };
  const toggleSection = async (title) => { for (const s of await page.$$('.section summary')) if ((await s.evaluate((e) => e.textContent)).toLowerCase().includes(title.toLowerCase())) { await s.click(); return; } };

  // ---- 1. home page
  await page.goto(URL0, { waitUntil: 'load' }); await wait(1500);
  await cap('Q-Rex — coarse alignment, in software', 5000, 'virtual pan-tilt camera for FSOC terminals · ISRO PS-26169');
  for (const [id, t, sub] of [['overview', 'Why: hardware is expensive, algorithms need iteration', 'runs offline in a browser or as a desktop app'], ['problem', 'Every spec requirement, measured', 'acquisition 0.6 s · error < 1 px · loss 0 %'], ['architecture', 'Architecture: sensor → detector → Kalman → states → control → gimbal', 'the tracker only ever sees pixels and its encoder angle'], ['innovation', 'What is different: two-tier sensing, learned noise, a CNN verifier', ''], ['results', 'Results: 54 tests, a 21-video robustness matrix and a 15-scenario benchmark', 'limits are stated plainly'], ['maths', 'The maths it actually runs', 'matched filter · IMM Kalman · controller · CNN — every formula is the one in the code'], ['roadmap', 'Roadmap: what is done and what comes next', 'GPU-trained multi-frame verifier · offline smoothing · track-before-detect']]) {
    await page.evaluate((i) => document.getElementById(i)?.scrollIntoView({ behavior: 'smooth' }), id);
    await cap(t, 5500, sub);
  }
  // ---- 2. workstation
  await go('#/app'); await wait(1500);
  await cap('Workstation: live virtual camera, screen map, error plot, telemetry', 7000, 'status tiles turn green when a spec target is met');
  await load('line', 'Straight line', 6000, 'motions: straight · circular · figure-8 · random · spiral · sinusoidal · waypoints');
  await load('fig8', 'Figure of 8', 6000);
  await load('random', 'Random walk', 6000);
  await toggleSection('Target');
  await load('decoys', 'Three targets: decoys do not steal the lock', 7000, 'designated beacon identified by gating on the prediction');
  await load('sp', 'Salt & pepper noise, 10 % of pixels', 7000, 'impulse-robust matched filter · self-calibrated CFAR');
  await load('gauss', 'Gaussian noise σ = 20', 6000);
  await load('poisson', 'Poisson (shot) noise', 5000);
  await load('fog', 'Fog: contrast and brightness collapse', 6000);
  await load('rain', 'Rain: streaks rejected by shape', 6000);
  await load('lowlight', 'Low light', 6000);
  await load('jitter', 'Camera jitter ±20 px / frame', 7000, 'boresight error excludes the unrecoverable per-frame shake');
  await load('platform', 'Platform motion 20 px / frame', 8000, 'the camera counter-moves 600 px/s while tracking');
  await load('dropout', 'Beacon dropouts: COAST → re-acquire', 12000, 'watch the state strip: TRACK → COAST → TRACK within 1 s');
  await load('allmax', 'All disturbances at their maximum — honest limit', 9000, '≈ 11 px mean error: just above the 10 px target — an ideal causal filter bottoms out at ≈ 10.4 px');
  await load('nominal', 'Nominal again — now the acquisition modes', 2500);
  await toggleSection('Tracker');
  const setAcq = async (v) => { for (const s of await page.$$('.sidebar select')) if (await s.evaluate((e, x) => [...e.options].some((o) => o.value === x), v)) await s.select(v); };
  await setAcq('zoom');
  // slow the lens a little (12 -> 4 deg/s) so the zoom-in is easy to watch
  for (const f of await page.$$('.sidebar .field')) {
    if ((await f.evaluate((e) => e.textContent)).includes('Zoom speed')) { const r = await f.$('input[type=range]'); await r.focus(); for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowLeft'); }
  }
  await cap('Zoom-lens acquisition: the SAME camera starts at the full-screen FOV, then zooms in', 12000, 'no extra sensor · beacon detected in 0.03 s · centred at 4°×3° in about 1 s — watch the FOV (4.0° → full screen → 4.0°) in the camera header');
  await setAcq('overview');
  await cap('Back to the wide-view mode — and the optional AI verifier', 2500);
  await clickText('.sidebar label', 'AI verifier'); await cap('Optional CNN verifier on detections (74 k parameters, trained on simulator data)', 7000, 'classical detector stays the guaranteed fallback');
  // ---- 3. benchmark 1
  await page.evaluate(() => document.querySelector('.main').scrollTo({ top: 99999, behavior: 'smooth' })); await wait(1200);
  await cap('Benchmark 1: one click runs the whole scenario suite', 3000);
  const inputs = await page.$$('.bench-controls input[type=number]');
  const setNum = async (el, v) => { await el.click(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.type(String(v)); };
  await setNum(inputs[0], 6); await setNum(inputs[1], 1);
  await clickText('.bench button', 'Run all scenarios');
  await cap('Running 15 scenarios headlessly…', 60000, 'acquisition · error · loss · re-acquisition · FPS, each with pass/fail');
  await page.evaluate(() => document.querySelector('.tblscroll')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await cap('Benchmark 1 results', 8000, 'exportable as JSON');
  // ---- 4. benchmark 2
  await page.evaluate(() => [...document.querySelectorAll('.bench')][1]?.scrollIntoView({ behavior: 'smooth' })); await wait(800);
  const files = await page.$$('input[type=file]');
  await files[0].uploadFile(sample.mp4); await files[1].uploadFile(sample.csv);
  await cap('Benchmark 2: a 2000×2000 H.264 video with ground truth, PTZ camera bypassed', 4000);
  await clickText('.bench button', 'Run on video');
  await cap('Frame-exact decoding · same detector · per-frame centroid log', 12000);
  await cap('Centroid RMSE 0.07 px · acquisition 0.03 s · lock 100 %', 7000, 'plus centroid CSV and report JSON');
  await cap('Performance report: JSON · HTML · per-frame CSV — saved automatically at the end of a run', 7000);
  await go('#/'); await wait(500);
  await cap('Q-Rex — source, report, manual and tests included', 6000, 'thank you');

  await rec.stop(); await browser.close();
  execSync(`ffmpeg -loglevel error -y -i "${webm}" -c:v libx264 -preset slow -pix_fmt yuv420p -crf 29 -movflags +faststart "${OUT}"`);
  const dur = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${OUT}"`).toString().trim();
  console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB, ${Number(dur).toFixed(0)} s)`);
})();
