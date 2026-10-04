"""Evaluate any exported weights JSON on a data directory: python ml/eval_weights.py weights.json [data_dir]"""
import json, sys, os
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, torch, torch.nn.functional as F
os.environ.setdefault('DATA_DIR', sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), 'data_v3'))
import train
ws = json.load(open(sys.argv[1]))
L = ws['layers']
convs = [(torch.tensor(l['w']).reshape(l['out'], l['in'], 3, 3), torch.tensor(l['b']), l['stride']) for l in L if l['type'] == 'conv']
fcs = [(torch.tensor(l['w']).reshape(l['out'], l['in']), torch.tensor(l['b'])) for l in L if l['type'] == 'fc']
def model(x):
    for w, b, s in convs: x = F.relu(F.conv2d(x, w, b, stride=s, padding=1))
    x = F.relu(F.linear(x.flatten(1), *fcs[0])); return F.linear(x, *fcs[1])
class M:  # adapter for train.evaluate (expects .eval() and __call__)
    def eval(self): pass
    def __call__(self, x): return model(x)
out = {}
for k in ('val', 'test', 'hard', 'codec', 'wide'):
    x, y = train.load(k); r = train.evaluate(M(), x, y)
    out[k] = {a: round(r[a], 4) for a in ('acc', 'tpr', 'fpr', 'offset_rmse_px')}
print(json.dumps(out))
