// Declarative description of the configuration panel (drives the UI; defaults live in engine/config.js).
import { MOTIONS, ATMOSPHERES, PLATFORM_MODELS } from './engine/config.js';

const atmOpts = Object.entries(ATMOSPHERES).map(([id, a]) => [id, a.label]);

export const SECTIONS = [
  {
    title: 'Scenario & Run',
    open: true,
    fields: [
      { k: 'seed', label: 'Random seed', type: 'number', min: 0, max: 99999, restart: true },
      { k: 'duration', label: 'Run duration (s, 0 = endless)', type: 'number', min: 0, max: 600 },
    ],
  },
  {
    title: 'Virtual Camera',
    fields: [
      { k: 'screenSize', label: 'Screen size (px, square, ≥ 2000)', type: 'number', min: 2000, max: 6000, restart: true },
      { k: 'cameraType', label: 'Camera type', type: 'select', opts: [['mono', 'Monochrome FPA (default)'], ['colour', 'Colour (optional)']], restart: true },
      { k: 'camW', label: 'Camera width (px)', type: 'number', min: 160, max: 1280, restart: true },
      { k: 'camH', label: 'Camera height (px)', type: 'number', min: 120, max: 960, restart: true },
      { k: 'fovX', label: 'FOV horizontal (°) — default 4 (×3/4 vertical)', type: 'num', min: 1, max: 12, step: 0.5, restart: true },
      { k: 'fps', label: 'Camera update rate (Hz, ≥30)', type: 'int', min: 30, max: 120, restart: true },
      { k: 'maxPanSpeed', label: 'Max pan speed (°/s)', type: 'num', min: 5, max: 10, step: 0.5, restart: true },
      { k: 'maxTiltSpeed', label: 'Max tilt speed (°/s)', type: 'num', min: 5, max: 10, step: 0.5, restart: true },
      { k: 'maxAccel', label: 'Gimbal acceleration (°/s²)', type: 'num', min: 5, max: 100, step: 5, restart: true },
      { k: 'extraLatency', label: 'Extra command latency (frames)', type: 'int', min: 0, max: 4, restart: true },
    ],
  },
  {
    title: 'Target',
    open: true,
    fields: [
      { k: 'motion', label: 'Motion', type: 'select', opts: MOTIONS.map((m) => [m.id, m.label]), restart: true },
      { k: 'targetSpeed', label: 'Target speed (px/s)', type: 'num', min: 20, max: 700, step: 10, restart: true },
      { k: 'targetSize', label: 'Target size (px)', type: 'num', min: 5, max: 20, step: 1, restart: true },
      { k: 'targetShape', label: 'Shape', type: 'select', opts: [['square', 'Square'], ['circle', 'Circle'], ['diamond', 'Diamond']], restart: true },
      { k: 'numTargets', label: 'Targets (1 = beacon, >1 adds decoys)', type: 'int', min: 1, max: 6, restart: true },
      { k: 'startMode', label: 'Initial location', type: 'select', opts: [['random', 'Random'], ['user', 'User-defined']], restart: true },
      { k: 'startX', label: 'Start X / path centre (px)', type: 'int', min: 0, max: 2000, restart: true, show: (c) => c.startMode === 'user' },
      { k: 'startY', label: 'Start Y / path centre (px)', type: 'int', min: 0, max: 2000, restart: true, show: (c) => c.startMode === 'user' },
      { k: 'waypoints', label: 'Waypoints (x,y per line)', type: 'text', restart: true, show: (c) => c.motion === 'waypoints' },
    ],
  },
  {
    title: 'Image Noise',
    fields: [
      { k: 'saltPepper', label: 'Salt & pepper', type: 'check' },
      { k: 'saltPepperDensity', label: 'Density (≤ 10 %)', type: 'num', min: 0, max: 0.1, step: 0.005, show: (c) => c.saltPepper },
      { k: 'gaussian', label: 'Gaussian', type: 'check' },
      { k: 'gaussianSigma', label: 'σ (grey levels, ≤ 20)', type: 'num', min: 0, max: 20, step: 1, show: (c) => c.gaussian },
      { k: 'poisson', label: 'Poisson (shot noise)', type: 'check' },
    ],
  },
  {
    title: 'Jitter, Platform, Atmosphere',
    fields: [
      { k: 'jitter', label: 'Camera jitter', type: 'check' },
      { k: 'jitterMax', label: 'Max jitter (± px/frame)', type: 'num', min: 0, max: 20, step: 1, show: (c) => c.jitter },
      { k: 'platform', label: 'Platform motion', type: 'check' },
      { k: 'platformModel', label: 'Platform model', type: 'select', opts: PLATFORM_MODELS.map((m) => [m.id, m.label]), restart: true, show: (c) => c.platform },
      { k: 'platformSpeed', label: 'Platform speed (px/frame, ≤ 20)', type: 'num', min: 0, max: 20, step: 1, show: (c) => c.platform },
      { k: 'atmosphere', label: 'Atmosphere', type: 'select', opts: atmOpts },
      { k: 'atmosphereLevel', label: 'Severity', type: 'num', min: 0, max: 1, step: 0.05, show: (c) => c.atmosphere !== 'clear' },
      { k: 'dropout', label: 'Beacon dropouts (cloud / occlusion)', type: 'check' },
      { k: 'dropoutEvery', label: 'Dropout period (s)', type: 'num', min: 1, max: 60, step: 1, show: (c) => c.dropout },
      { k: 'dropoutLen', label: 'Dropout length (s)', type: 'num', min: 0.05, max: 3, step: 0.05, show: (c) => c.dropout },
      { k: 'turbulence', label: 'Turbulence (wander / scintillation / blur)', type: 'num', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Tracker',
    fields: [
      { k: 'acquisition', label: 'Acquisition', type: 'select', opts: [['overview', 'Wide-view overview (fast)'], ['scan', 'Raster scan (no overview)']], restart: true },
      { k: 'controlGain', label: 'Control gain', type: 'num', min: 0.2, max: 1, step: 0.05 },
      { k: 'detectThreshold', label: 'Detection threshold (σ)', type: 'num', min: 4, max: 10, step: 0.5 },
      { k: 'coastFrames', label: 'Coast before re-search (frames)', type: 'int', min: 3, max: 90 },
    ],
  },
];

export const LIVE_KEYS = new Set(SECTIONS.flatMap((s) => s.fields).filter((f) => !f.restart).map((f) => f.k));
