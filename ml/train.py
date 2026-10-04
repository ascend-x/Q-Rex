"""Train the tiny beacon verifier / refiner (CPU).  usage: python ml/train.py
Reads ml/data/*.f32 produced by scripts/gen-dataset.mjs, writes src/engine/cnnWeights.json and ml/report.json."""
import glob, json, os, sys, time
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F

torch.set_num_threads(os.cpu_count() or 4)
torch.manual_seed(0); np.random.seed(0)
P = 32
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('DATA_DIR', os.path.join(HERE, 'data'))

def load(prefix_glob):
    xs, ys = [], []
    for fx in sorted(glob.glob(os.path.join(DATA, prefix_glob + '_x.f32'))):
        x = np.fromfile(fx, dtype=np.float32).reshape(-1, 1, P, P)
        y = np.fromfile(fx.replace('_x.f32', '_y.f32'), dtype=np.float32).reshape(-1, 3)
        xs.append(x); ys.append(y)
    return torch.from_numpy(np.concatenate(xs)), torch.from_numpy(np.concatenate(ys))

WIDTH = os.environ.get('WIDTH', 'small')  # small = 37 k params (v1/v2), wide = 74 k params (v3)
CH = {'small': (12, 16, 24, 32, 48), 'wide': (16, 24, 32, 48, 64)}[WIDTH]

class Net(nn.Module):
    def __init__(self):
        super().__init__()
        a, b, c, d, e = CH
        self.c1 = nn.Conv2d(1, a, 3, padding=1)
        self.c2 = nn.Conv2d(a, b, 3, stride=2, padding=1)
        self.c3 = nn.Conv2d(b, c, 3, stride=2, padding=1)
        self.c4 = nn.Conv2d(c, d, 3, stride=2, padding=1)
        self.f1 = nn.Linear(d * 4 * 4, e)
        self.f2 = nn.Linear(e, 3)
    def forward(self, x):
        x = F.relu(self.c1(x)); x = F.relu(self.c2(x)); x = F.relu(self.c3(x)); x = F.relu(self.c4(x))
        return self.f2(F.relu(self.f1(x.flatten(1))))

OFF = 8.0  # offsets are regressed in units of 8 px
OUT = os.environ.get('OUT_WEIGHTS', os.path.join(HERE, '..', 'src', 'engine', 'cnnWeights.json'))

def augment(x, y):
    # dihedral symmetries: the beacon physics is rotation / mirror invariant; offsets transform accordingly
    y = y.clone()
    if np.random.rand() < 0.5: x = x.flip(3); y[:, 1] = -y[:, 1]
    if np.random.rand() < 0.5: x = x.flip(2); y[:, 2] = -y[:, 2]
    if np.random.rand() < 0.5: x = x.transpose(2, 3); y = y[:, [0, 2, 1]]
    return x, y

def losses(out, y):
    cls = F.binary_cross_entropy_with_logits(out[:, 0], y[:, 0])
    pos = y[:, 0] > 0.5
    off = F.smooth_l1_loss(out[pos, 1:], y[pos, 1:] / OFF) if pos.any() else out.sum() * 0
    return cls, off

@torch.no_grad()
def evaluate(model, x, y):
    model.eval()
    out = torch.cat([model(x[i:i + 4096]) for i in range(0, len(x), 4096)])
    p = torch.sigmoid(out[:, 0]); lab = y[:, 0] > 0.5
    acc = ((p > 0.5) == lab).float().mean().item()
    # AUC via rank statistic
    order = torch.argsort(p); ranks = torch.empty_like(order, dtype=torch.float32); ranks[order] = torch.arange(len(p), dtype=torch.float32)
    npos = lab.sum().item(); nneg = len(lab) - npos
    auc = ((ranks[lab].sum() - npos * (npos - 1) / 2) / (npos * nneg)).item() if npos and nneg else float('nan')
    err = (out[lab, 1:] * OFF - y[lab, 1:])
    rmse = err.pow(2).sum(1).mean().sqrt().item()
    base = y[lab, 1:].pow(2).sum(1).mean().sqrt().item()  # error if the candidate position were used as-is
    tpr = (p[lab] > 0.5).float().mean().item(); fpr = (p[~lab] > 0.5).float().mean().item()
    return dict(acc=acc, auc=auc, offset_rmse_px=rmse, offset_rmse_if_unrefined_px=base, tpr=tpr, fpr=fpr, n=len(x), pos=int(npos))

def main():
    xtr, ytr = load('train*'); xva, yva = load('val'); xte, yte = load('test'); xhd, yhd = load('hard')
    extra = {k: load(k) for k in ('codec', 'wide') if glob.glob(os.path.join(DATA, k + '_x.f32'))}
    print('train', xtr.shape, 'pos frac', (ytr[:, 0] > 0.5).float().mean().item(), flush=True)
    model = Net(); print('params', sum(p.numel() for p in model.parameters()), flush=True)
    EPOCHS, BS = int(os.environ.get('EPOCHS', 22)), 512
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=EPOCHS * ((len(xtr) + BS - 1) // BS))
    best, best_state = -1, None
    for ep in range(EPOCHS):
        model.train(); perm = torch.randperm(len(xtr)); t0 = time.time(); tl = 0
        for i in range(0, len(xtr), BS):
            idx = perm[i:i + BS]; x, y = augment(xtr[idx], ytr[idx])
            out = model(x); c, o = losses(out, y); loss = c + 3 * o
            opt.zero_grad(); loss.backward(); opt.step(); sched.step(); tl += loss.item() * len(idx)
        v = evaluate(model, xva, yva)
        score = v['auc'] - 0.01 * v['offset_rmse_px']
        if score > best: best, best_state = score, {k: t.clone() for k, t in model.state_dict().items()}
        print(f"ep {ep+1:2d} loss {tl/len(xtr):.4f}  val acc {v['acc']:.4f} auc {v['auc']:.4f} off-rmse {v['offset_rmse_px']:.3f}px  ({time.time()-t0:.0f}s)", flush=True)
    model.load_state_dict(best_state)
    rep = {'val': evaluate(model, xva, yva), 'test': evaluate(model, xte, yte), 'hard_test': evaluate(model, xhd, yhd), 'params': sum(p.numel() for p in model.parameters()), 'width': WIDTH}
    for k, (xe, ye) in extra.items(): rep[k + '_test'] = evaluate(model, xe, ye)
    print(json.dumps(rep, indent=1))
    json.dump(rep, open(os.path.join(HERE, 'report.json'), 'w'), indent=1)
    # export weights for the JS runtime
    layers = []
    for name, m in [('c1', model.c1), ('c2', model.c2), ('c3', model.c3), ('c4', model.c4)]:
        layers.append({'type': 'conv', 'in': m.in_channels, 'out': m.out_channels, 'stride': m.stride[0],
                       'w': [round(float(v), 6) for v in m.weight.detach().flatten()], 'b': [round(float(v), 6) for v in m.bias.detach()]})
    for name, m in [('f1', model.f1), ('f2', model.f2)]:
        layers.append({'type': 'fc', 'in': m.in_features, 'out': m.out_features,
                       'w': [round(float(v), 6) for v in m.weight.detach().flatten()], 'b': [round(float(v), 6) for v in m.bias.detach()]})
    json.dump({'patch': P, 'offsetScale': OFF, 'layers': layers, 'report': rep}, open(OUT, 'w'), separators=(',', ':'))
    print('exported', OUT)

if __name__ == '__main__':
    main()
