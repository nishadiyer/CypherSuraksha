"""Cloak-ensemble research harness (the experiment summarised in MODELS.md, "Ensemble experiment").

Runs the same EOT-PGD cloak as the extension, with PyTorch autograd, against a chosen ensemble of face recognisers, then
measures rank-1 identification on LFW for EVERY recogniser (members marked *, the rest are unseen). Also has --diag, which
bisects where the effect is lost (inside the optimisation / on the realised photo / in the attacker's crop).

    python scripts/cloak/fetch_eval_assets.py WORK
    python scripts/cloak/bench_ensemble.py WORK 40 30 '[["vggface2","casia"],["vggface2","casia","ir18"]]' 8 --cpu
    python scripts/cloak/bench_ensemble.py WORK 8 30 '[["ir101"]]' 8 --diag --cpu --ctx 2.2 --smin 0.4 --smax 1.1 --shift 0.35

Positional args: WORK N_IDENTITIES STEPS CONFIGS_JSON EPS_255. Options: --cpu (MPS cannot run the backward pass), --diag, --speed,
--ctx --smin --smax --shift --ss (crop jitter / context / supersampling), --native. Run it inside .venv-cloak (npm run models:cloak).
Recognisers: vggface2, casia (FaceNet), ir18, ir101 (iResNet, AdaFace), vitA, vitB (ViT-tiny), arcface (InsightFace R50, eval only, never shipped).
"""
import importlib.util, json, os, sys, time, numpy as np, torch, torch.nn.functional as F, onnxruntime as ort
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.abspath(sys.argv[1]) + '/'
sys.argv = [sys.argv[0]] + sys.argv[2:]   # the rest of the script uses the positional layout N STEPS CONFIGS EPS
sys.path.insert(0, HERE)
spec = importlib.util.spec_from_file_location('recognisers', HERE + '/recognisers.py'); R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
from ultraface import Det
from facenet_pytorch import InceptionResnetV1
torch.set_num_threads(8)
DEV = 'mps' if torch.backends.mps.is_available() and '--cpu' not in sys.argv else 'cpu'
def opt(name, default): return float(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default
GRID, CTX, EPS_STEP = 224, opt('--ctx', 1.6), 2.5
SMIN, SMAX, SHIFT, SS = opt('--smin', 0.8), opt('--smax', 1.3), opt('--shift', 0.1), int(opt('--ss', 1))
class FN(torch.nn.Module):
    def __init__(s, which): super().__init__(); s.n = InceptionResnetV1(pretrained=which).eval()
    def forward(s, x): return s.n(x * 2 - 1)
NETS = {'vggface2': (FN('vggface2'), 160), 'casia': (FN('casia-webface'), 160),
        'ir18': (R.load_iresnet(WORK + 'rec/ir18.safetensors', 18), 112), 'ir101': (R.load_iresnet(WORK + 'rec/ir101.safetensors', 100), 112),
        'vitA': (R.load_vit_tiny(WORK + 'rec/vit_adaface.safetensors'), 112), 'vitB': (R.load_vit_tiny(WORK + 'rec/vit_arcface.safetensors'), 112)}
for n, (m, _) in NETS.items():
    m.to(DEV).eval()
    for p in m.parameters(): p.requires_grad_(False)
ARC = ort.InferenceSession(WORK + 'rec/arcface_r50.onnx', providers=['CPUExecutionProvider'])
DET = Det()
z = np.load(WORK + 'lfw_small.npz'); imgs, tgt = z['images'], z['target']
N_ID = int(sys.argv[1]); STEPS = int(sys.argv[2]); CONFIGS = json.loads(sys.argv[3]); EPS = float(sys.argv[4]) / 255 if len(sys.argv) > 4 and not sys.argv[4].startswith('--') else 8 / 255
rng = np.random.RandomState(7); ids = rng.choice([i for i in np.unique(tgt) if (tgt == i).sum() >= 2], N_ID, replace=False)
gal = [imgs[np.where(tgt == i)[0][0]] for i in ids]; probe = [imgs[np.where(tgt == i)[0][1]] for i in ids]
def crop(img, size): return np.asarray(Image.fromarray(img[60:190, 60:190]).resize((size, size), Image.BILINEAR), np.float32) / 255
@torch.no_grad()
def emb_eval(name, img):
    if name == 'arcface':
        x = ((crop(img, 112) * 255 - 127.5) / 127.5).transpose(2, 0, 1)[None].astype(np.float32); e = ARC.run(None, {ARC.get_inputs()[0].name: x})[0][0]; return e / np.linalg.norm(e)
    m, s = NETS[name]; e = m(torch.from_numpy(crop(img, s).transpose(2, 0, 1)[None]).to(DEV))[0].float().cpu().numpy(); return e / np.linalg.norm(e)
def rank1(g, p, name):
    GE = np.stack([emb_eval(name, i) for i in g]); PE = np.stack([emb_eval(name, i) for i in p]); return float((np.argmax(PE @ GE.T, 1) == np.arange(len(g))).mean())
def sample(xa, size, sc, dx, dy, base):
    size = size * SS
    side = base * sc; c = GRID / 2; j = (torch.arange(size, device=xa.device, dtype=torch.float32) + 0.5) / size
    xs = ((c + dx - side / 2 + j * side) / GRID) * 2 - 1; ys = ((c + dy - side / 2 + j * side) / GRID) * 2 - 1
    gy, gx = torch.meshgrid(ys, xs, indexing='ij'); g = torch.stack([gx, gy], -1)[None]
    out = F.grid_sample(xa[None], g, mode='bilinear', padding_mode='zeros', align_corners=False)
    return F.avg_pool2d(out, SS) if SS > 1 else out
def cloak(img, members, eps, mu=0.9):
    f = DET(img)
    if f: x1, y1, x2, y2, _ = max(f, key=lambda b: (b[2] - b[0]) * (b[3] - b[1])); cx, cy, sd = (x1 + x2) / 2, (y1 + y2) / 2, max(x2 - x1, y2 - y1)
    else: cx, cy, sd = 125, 125, 130
    global LAST_BOX
    LAST_BOX = (cx, cy, sd)
    L = max(8, int(round(sd * CTX))); rx0, ry0 = int(round(cx - L / 2)), int(round(cy - L / 2))
    global GRID
    if '--native' in sys.argv: GRID = L   # delta lives at the photo's own resolution: nothing is resampled when it is applied
    pad = np.pad(img, ((L, L), (L, L), (0, 0)), mode='edge'); region = pad[ry0 + L:ry0 + 2 * L, rx0 + L:rx0 + 2 * L]
    x0 = torch.from_numpy(np.asarray(Image.fromarray(region).resize((GRID, GRID), Image.BILINEAR), np.float32) / 255).permute(2, 0, 1).to(DEV)
    base = GRID / CTX; delta = torch.zeros_like(x0); mom = torch.zeros_like(x0); alpha = EPS_STEP * eps / STEPS
    r0 = np.random.RandomState(abs(hash(img.tobytes())) % (2 ** 31))
    tg = {}
    with torch.no_grad():
        for m in members:
            net, s = NETS[m]; tg[m] = F.normalize(net(sample(x0, s, 1, 0, 0, base)), dim=1)
    for _ in range(STEPS):
        sc = r0.uniform(SMIN, SMAX); dx, dy = r0.uniform(-SHIFT, SHIFT) * base, r0.uniform(-SHIFT, SHIFT) * base; tot = torch.zeros_like(x0)
        for m in members:
            net, s = NETS[m]; d = delta.clone().requires_grad_(True); xa = x0 + d; xa = xa + (xa.clamp(0, 1) - xa).detach()
            e = F.normalize(net(sample(xa, s, sc, dx, dy, base)), dim=1); g, = torch.autograd.grad((e * tg[m]).sum(), d); tot += g / (g.abs().sum() + 1e-12)
        mom = mu * mom + tot / (tot.abs().sum() + 1e-12); delta = (delta - alpha * mom.sign()).clamp(-eps, eps); delta = (x0 + delta).clamp(0, 1) - x0
    with torch.no_grad():
        global LAST_INT
        LAST_INT = {m: float((F.normalize(NETS[m][0](sample((x0 + delta).clamp(0, 1), NETS[m][1], 1, 0, 0, base)), dim=1) * tg[m]).sum()) for m in members}
    dl = delta.permute(1, 2, 0).cpu().numpy()
    d = np.stack([np.asarray(Image.fromarray(dl[:, :, c]).resize((L, L), Image.BILINEAR)) for c in range(3)], 2)
    out = np.pad(img.astype(np.float32), ((L, L), (L, L), (0, 0)), mode='edge'); out[ry0 + L:ry0 + 2 * L, rx0 + L:rx0 + 2 * L] += d * 255
    res = np.clip(np.round(out[L:-L, L:-L]), 0, 255).astype(np.uint8)
    # bisect: the realised native uint8 image viewed through the attack's own sampler
    pad2 = np.pad(res, ((L, L), (L, L), (0, 0)), mode='edge'); region2 = pad2[ry0 + L:ry0 + 2 * L, rx0 + L:rx0 + 2 * L]
    x2 = torch.from_numpy(np.asarray(Image.fromarray(region2).resize((GRID, GRID), Image.BILINEAR), np.float32) / 255).permute(2, 0, 1).to(DEV)
    global LAST_ATK
    ak, adx, ady = 130 / sd, (125 - cx) / sd * base, (125 - cy) / sd * base     # the attacker's fixed box, in my grid units
    with torch.no_grad(): LAST_ATK = {m: float((F.normalize(NETS[m][0](sample(x0, NETS[m][1], ak, adx, ady, base)), dim=1) * F.normalize(NETS[m][0](sample(x2, NETS[m][1], ak, adx, ady, base)), dim=1)).sum()) for m in members}
    global LAST_REAL
    with torch.no_grad(): LAST_REAL = {m: float((F.normalize(NETS[m][0](sample(x2, NETS[m][1], 1, 0, 0, base)), dim=1) * tg[m]).sum()) for m in members}
    return res
NAMES = ['vggface2', 'casia', 'ir18', 'ir101', 'vitA', 'vitB', 'arcface']
if '--diag' in sys.argv:
    for members in CONFIGS:
        ints, exts, reals, atks = [], [], [], []
        views = {k: [] for k in (0.8, 1.0, 1.3, 1.6, 2.0)}; ratios = []
        for g in gal[:8]:
            c = cloak(g, members, EPS); ints.append(np.mean(list(LAST_INT.values()))); reals.append(np.mean(list(LAST_REAL.values()))); atks.append(np.mean(list(LAST_ATK.values())))
            exts.append(np.mean([float(emb_eval(m, g) @ emb_eval(m, c)) for m in members]))
            cx, cy, sd = LAST_BOX; ratios.append(130 / sd)
            def view(im, k, name):
                side = sd * k; x0_, y0_ = int(round(cx - side / 2)), int(round(cy - side / 2)); n = int(round(side))
                pad = np.pad(im, ((n, n), (n, n), (0, 0)), mode='edge'); cr = pad[y0_ + n:y0_ + 2 * n, x0_ + n:x0_ + 2 * n]
                size = NETS[name][1]; x = torch.from_numpy((np.asarray(Image.fromarray(cr).resize((size, size), Image.BILINEAR), np.float32) / 255).transpose(2, 0, 1)[None]).to(DEV)
                with torch.no_grad(): e = NETS[name][0](x)[0].float().cpu().numpy()
                return e / np.linalg.norm(e)
            for k in views: views[k].append(np.mean([float(view(g, k, m) @ view(c, k, m)) for m in members]))
        print(f'{"+".join(members):22s} internal {np.mean(ints):.3f} | realised-via-attack-sampler {np.mean(reals):.3f} | via-sampler-at-ATTACKER-geometry {np.mean(atks):.3f} | attacker-view(PIL) cos {np.mean(exts):.3f}  (1.0 = unchanged)', flush=True)
        print('     PIL crops at k x face box:', {k: round(float(np.mean(v)), 3) for k, v in views.items()}, '| attacker fixed box is', round(float(np.mean(ratios)), 2), 'x the face box', flush=True)
    sys.exit()
if '--speed' in sys.argv:
    for cfgm in CONFIGS:
        t0 = time.time(); cloak(gal[0], cfgm, EPS); print(cfgm, f'{time.time() - t0:.1f}s per image on {DEV}'); 
    sys.exit()
print(f'device {DEV}; N={N_ID} steps={STEPS} eps={EPS*255:.0f}/255', flush=True)
print('clean              ', {n: round(rank1(gal, probe, n), 3) for n in NAMES}, flush=True)
for members in CONFIGS:
    t0 = time.time(); cl = [cloak(g, members, EPS) for g in gal]; dmax = max(int(np.abs(c.astype(int) - g.astype(int)).max()) for c, g in zip(cl, gal))
    res = {n + ('*' if n in members else ''): round(rank1(cl, probe, n), 3) for n in NAMES}
    print(f'{"+".join(members):28s} {res}  maxdiff={dmax} ({time.time() - t0:.0f}s)', flush=True)
