"""Dump a few test patches + PyTorch outputs so the JS inference can be checked numerically (ml/check.mjs)."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, torch
from train import Net, load, OFF
ws = json.load(open(os.environ.get('WEIGHTS', os.path.join(os.path.dirname(__file__), '..', 'src', 'engine', 'cnnWeights.json'))))
m = Net()
for name, L in zip(['c1', 'c2', 'c3', 'c4', 'f1', 'f2'], ws['layers']):
    mod = getattr(m, name)
    mod.weight.data = torch.tensor(L['w']).reshape(mod.weight.shape); mod.bias.data = torch.tensor(L['b'])
m.eval()
x, y = load('test')  # needs DATA_DIR (the test split) and WIDTH matching the weights
idx = np.arange(0, len(x), len(x) // 12)[:12]
with torch.no_grad():
    out = m(x[idx])
json.dump({'patches': x[idx].reshape(len(idx), -1).tolist(), 'out': [[float(torch.sigmoid(o[0])), float(o[1] * OFF), float(o[2] * OFF)] for o in out], 'y': y[idx].tolist()}, open(os.path.join(os.path.dirname(__file__), 'check.json'), 'w'))
print('ok', len(idx))
