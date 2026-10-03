// Single source of truth for every configurable parameter (spec IDs from the problem statement).
// Units: screen pixels ("sp") = 1/160 deg at the default 4 deg FOV; camera pixels ("cp") are
// sensor pixels. Angles in degrees.

export const SCREEN_DEG_X = 12.5; // 2000 px / 160 px per deg
export const PPD = 160; // screen pixels per degree (640 px / 4 deg)

/** screen pixels per camera pixel (1.0 at the default 640 px / 4 deg). */
export const camScale = (c) => (c.fovX * PPD) / c.camW;

export const MOTIONS = [
  { id: 'linear', label: 'Straight line' },
  { id: 'circular', label: 'Circular' },
  { id: 'figure8', label: 'Figure of 8' },
  { id: 'random', label: 'Random' },
  { id: 'spiral', label: 'Spiral' },
  { id: 'sinusoidal', label: 'Sinusoidal' },
  { id: 'waypoints', label: 'User waypoints' },
];

export const ATMOSPHERES = {
  clear: { label: 'Clear', contrast: 1.0, brightness: 0, blur: 0, streaks: false, shot: 1 },
  haze: { label: 'Haze', contrast: 0.7, brightness: 18, blur: 1.0, streaks: false, shot: 1 },
  fog: { label: 'Fog', contrast: 0.45, brightness: 35, blur: 2.0, streaks: false, shot: 1 },
  rain: { label: 'Rain', contrast: 0.75, brightness: 5, blur: 0.8, streaks: true, shot: 1 },
  lowlight: { label: 'Low light', contrast: 0.35, brightness: -5, blur: 0, streaks: false, shot: 3 },
};

export const PLATFORM_MODELS = [
  { id: 'linear', label: 'Linear (default)' },
  { id: 'circular', label: 'Circular' },
  { id: 'random', label: 'Random' },
  { id: 'spiral', label: 'Spiral' },
  { id: 'figure8', label: 'Figure of 8' },
];

export const DEFAULTS = {
  seed: 1,
  duration: 30, // s of simulated time per run

  // Camera (P01-P06)
  screenSize: 2000,
  cameraType: 'mono', // mono | colour (tracker uses luminance)
  camW: 640,
  camH: 480,
  fovX: 4, // deg (FOV_y = fovX * 3/4)
  fps: 30, // camera update rate (>= 30 Hz)
  maxPanSpeed: 5, // deg/s (5-10)
  maxTiltSpeed: 5,
  maxAccel: 20, // deg/s^2 (gimbal acceleration limit, not specified by the statement)
  extraLatency: 0, // additional command latency, frames

  // Target (P07-P12)
  numTargets: 1, // designated beacon + (n-1) decoys
  targetShape: 'square', // square | circle | diamond
  targetSize: 10, // px, 5-20
  targetIntensity: 230,
  motion: 'circular',
  targetSpeed: 200, // screen px / s
  startMode: 'random', // random | user
  startX: 1000,
  startY: 1000,
  waypoints: '300,300\n1700,400\n1500,1600\n400,1500',

  // Disturbances (D01-D05)
  saltPepper: false,
  saltPepperDensity: 0.1,
  gaussian: false,
  gaussianSigma: 10, // grey levels
  poisson: false,
  jitter: false,
  jitterMax: 10, // +- px / frame (<= 20)
  atmosphere: 'clear',
  atmosphereLevel: 1, // 0..1 interpolation from clear
  turbulence: 0, // 0..1: beam wander + scintillation + PSF blur
  dropout: false, // beacon blinks out (cloud / occlusion) to exercise re-acquisition
  dropoutEvery: 6, // s between dropouts
  dropoutLen: 0.5, // s
  platform: false,
  platformModel: 'linear',
  platformSpeed: 10, // px / frame (<= 20)
  background: 20,

  // Tracker
  acquisition: 'overview', // overview | scan
  controlGain: 0.85,
  coastFrames: 20,
  detectThreshold: 6,
};

export function clampConfig(c) {
  const o = { ...DEFAULTS, ...c };
  const cl = (v, a, b) => Math.min(b, Math.max(a, Number(v)));
  o.fps = cl(o.fps, 30, 120);
  o.screenSize = Math.round(cl(o.screenSize, 2000, 6000));
  o.camW = Math.round(cl(o.camW, 160, 1280));
  o.camH = Math.round(cl(o.camH, 120, 960));
  o.targetSize = cl(o.targetSize, 5, 20);
  o.maxPanSpeed = cl(o.maxPanSpeed, 5, 10);
  o.maxTiltSpeed = cl(o.maxTiltSpeed, 5, 10);
  o.jitterMax = cl(o.jitterMax, 0, 20);
  o.platformSpeed = cl(o.platformSpeed, 0, 20);
  o.saltPepperDensity = cl(o.saltPepperDensity, 0, 0.1);
  o.gaussianSigma = cl(o.gaussianSigma, 0, 20);
  o.fovX = cl(o.fovX, 1, 12);
  o.numTargets = Math.round(cl(o.numTargets, 1, 6));
  o.atmosphereLevel = cl(o.atmosphereLevel, 0, 1);
  o.turbulence = cl(o.turbulence, 0, 1);
  o.dropoutEvery = cl(o.dropoutEvery, 1, 60);
  o.dropoutLen = cl(o.dropoutLen, 0.05, 3);
  return o;
}

/** Named scenarios used by Benchmark-1 style runs and the headless benchmark. */
export const SCENARIOS = [
  { id: 'nominal', label: 'A1 Nominal (circular)', cfg: { motion: 'circular' } },
  { id: 'line', label: 'A2 Straight line', cfg: { motion: 'linear', targetSpeed: 300 } },
  { id: 'fig8', label: 'A3 Figure of 8', cfg: { motion: 'figure8' } },
  { id: 'random', label: 'A4 Random walk', cfg: { motion: 'random' } },
  { id: 'gauss', label: 'B1 Gaussian noise σ=20', cfg: { gaussian: true, gaussianSigma: 20 } },
  { id: 'sp', label: 'B2 Salt & pepper 10%', cfg: { saltPepper: true, saltPepperDensity: 0.1 } },
  { id: 'poisson', label: 'B3 Poisson noise', cfg: { poisson: true } },
  { id: 'jitter', label: 'B4 Jitter ±20 px/frame', cfg: { jitter: true, jitterMax: 20 } },
  { id: 'platform', label: 'B5 Platform 20 px/frame', cfg: { platform: true, platformSpeed: 20, targetSpeed: 120 } },
  { id: 'fog', label: 'B6 Fog', cfg: { atmosphere: 'fog' } },
  { id: 'rain', label: 'B7 Rain', cfg: { atmosphere: 'rain' } },
  { id: 'lowlight', label: 'B8 Low light', cfg: { atmosphere: 'lowlight' } },
  { id: 'dropout', label: 'B10 Beacon dropouts (0.5 s)', cfg: { dropout: true, dropoutEvery: 5, dropoutLen: 0.5 } },
  { id: 'decoys', label: 'B9 Decoys (3 targets)', cfg: { numTargets: 3 } },
  {
    id: 'allmax',
    label: 'C1 All disturbances (max)',
    cfg: {
      saltPepper: true, gaussian: true, gaussianSigma: 20, poisson: true,
      jitter: true, jitterMax: 20, platform: true, platformSpeed: 20,
      atmosphere: 'haze', turbulence: 0.5, targetSpeed: 120,
    },
  },
];
