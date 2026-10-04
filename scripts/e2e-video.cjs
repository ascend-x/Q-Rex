// End-to-end Benchmark-2 check in a real browser: synthesises a noisy 2000x2000 @30 fps H.264 video with a moving
// beacon (exact ground truth), uploads it through the GUI together with the ground-truth CSV, and reads the metrics.
// usage: node scripts/e2e-video.cjs   (needs ffmpeg, chromium and a global puppeteer)
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require(execSync('npm root -g').toString().trim() + '/puppeteer');

const W = 2000, N = 90, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qrex-e2e-'));
const mp4 = path.join(dir, 'beacon.mp4'), csv = path.join(dir, 'gt.csv');

function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
async function makeVideo() {
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${W}x${W}`, '-r', '30', '-i', '-', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', mp4], { stdio: ['pipe', 'inherit', 'inherit'] });
  const rnd = lcg(7), gt = ['frame,x,y'];
  for (let k = 0; k < N; k++) {
    const f = Buffer.alloc(W * W);
    for (let i = 0; i < f.length; i++) f[i] = Math.max(0, Math.min(255, 24 + (rnd() + rnd() + rnd() - 1.5) * 24)); // ~gaussian sigma 12
    const cx = 300 + 18 * k, cy = Math.round(1000 + 350 * Math.sin(k / 18));
    for (let y = -5; y < 5; y++) for (let x = -5; x < 5; x++) f[(cy + y) * W + cx + x] = 230;
    gt.push(`${k},${cx - 0.5},${cy - 0.5}`); // pixel-index convention: centre of a 10x10 block starting at cx-5
    if (!ff.stdin.write(f)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  fs.writeFileSync(csv, gt.join('\n'));
}

(async () => {
  await makeVideo();
  const b = await puppeteer.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--allow-file-access-from-files'], headless: true, defaultViewport: { width: 1500, height: 1000 } });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(process.argv[2] || 'file://' + path.resolve(__dirname, '../dist-single/q-rex.html') + '#/app', { waitUntil: 'load' });
  const inputs = await p.$$('input[type=file]');
  await inputs[0].uploadFile(mp4);
  await inputs[1].uploadFile(csv);
  for (const bt of await p.$$('button')) if ((await bt.evaluate((e) => e.textContent)).includes('Run on video')) { await bt.click(); break; }
  await p.waitForFunction(() => [...document.querySelectorAll('button')].some((x) => x.textContent.includes('Centroid log CSV')) || document.querySelector('.warn'), { timeout: 180000 });
  const m = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.tbl.small tr')].map((r) => [r.cells[0].textContent, r.cells[1].textContent])));
  await b.close();
  console.log(JSON.stringify(m, null, 1));
  const ok = errs.length === 0 && Number(m.centroidingErrorRmsePx) < 1.0 && Number(m.lockRetentionRatePct) >= 99 && Number(m.acquisitionTimeSec) <= 0.2 && Number(m.groundTruthFrames) >= N - 2;
  console.log(ok ? 'E2E VIDEO: PASS' : 'E2E VIDEO: FAIL', errs.join(';'));
  process.exit(ok ? 0 : 1);
})();
