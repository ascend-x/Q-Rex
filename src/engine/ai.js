// Loader for the trained beacon verifier / refiner (weights produced by ml/train.py).
import weights from './cnnWeights.json' with { type: 'json' };
import { PatchNet } from './cnn.js';

let net = null;
export const getNet = () => (net ??= new PatchNet(weights));
export const aiReport = weights.report;
