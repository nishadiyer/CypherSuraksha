"""UltraFace RFB-320 face detector decoding in Python (same math as src/offscreen/shields/pixel/faceDetect.ts)."""
import os
import numpy as np, onnxruntime as ort
from PIL import Image
DEFAULT_MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'models', 'face-detector.ultraface.onnx')
W, H = 320, 240
def priors():
    fm = [[40, 20, 10, 5], [30, 15, 8, 4]]; strides = [8, 16, 32, 64]
    mins = [[10, 16, 24], [32, 48], [64, 96], [128, 192, 256]]
    out = []
    for k in range(4):
        for j in range(fm[1][k]):
            for i in range(fm[0][k]):
                cx = (i + 0.5) * strides[k] / W; cy = (j + 0.5) * strides[k] / H
                for m in mins[k]: out.append([cx, cy, m / W, m / H])
    return np.array(out, np.float32)
PRI = priors(); assert len(PRI) == 4420
def nms(b, s, thr=0.3):
    order = np.argsort(-s); keep = []
    while len(order):
        i = order[0]; keep.append(i)
        if len(order) == 1: break
        r = order[1:]
        xx1 = np.maximum(b[i, 0], b[r, 0]); yy1 = np.maximum(b[i, 1], b[r, 1]); xx2 = np.minimum(b[i, 2], b[r, 2]); yy2 = np.minimum(b[i, 3], b[r, 3])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        iou = inter / ((b[i, 2] - b[i, 0]) * (b[i, 3] - b[i, 1]) + (b[r, 2] - b[r, 0]) * (b[r, 3] - b[r, 1]) - inter)
        order = r[iou <= thr]
    return keep
class Det:
    def __init__(s, model=DEFAULT_MODEL): s.sess = ort.InferenceSession(model, providers=['CPUExecutionProvider'])
    def __call__(s, img_u8, thr=0.6):
        h0, w0 = img_u8.shape[:2]
        x = np.asarray(Image.fromarray(img_u8).resize((W, H), Image.BILINEAR), np.float32)
        x = ((x - 127) / 128).transpose(2, 0, 1)[None]
        scores, boxes = s.sess.run(None, {s.sess.get_inputs()[0].name: x})
        scores, boxes = scores[0, :, 1], boxes[0]
        m = scores > thr
        if not m.any(): return []
        p = PRI[m]; bx = boxes[m]
        c = p[:, :2] + bx[:, :2] * 0.1 * p[:, 2:]; wh = p[:, 2:] * np.exp(bx[:, 2:] * 0.2)
        xyxy = np.concatenate([c - wh / 2, c + wh / 2], 1) * np.array([w0, h0, w0, h0], np.float32)
        keep = nms(xyxy, scores[m])
        return [(*xyxy[k], float(scores[m][k])) for k in keep]
