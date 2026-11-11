"""tools/rigpreview.py NAME — собирает риг врага из частей (координаты листа) и кладёт рядом с цельной фигурой: проверка суставов."""
import sys, json, math
from PIL import Image
R = json.load(open('tools/rigs.json', encoding='utf-8'))
def piece(name):
    im = Image.open(f'art/gen/{name}.png').convert('RGBA'); return im
def draw(canvas, im, joint_src, joint_dst, scale, ang, flip=False, dark=1.0):
    w, h = im.size; im2 = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    if dark < 1: px = im2.load(); im2 = Image.merge('RGBA', [c.point(lambda v: int(v * dark)) if i < 3 else c for i, c in enumerate(im2.split())])
    jx, jy = joint_src[0] * scale, joint_src[1] * scale
    big = Image.new('RGBA', (im2.width * 3, im2.height * 3)); big.alpha_composite(im2, (im2.width, im2.height))
    big = big.rotate(-math.degrees(ang), center=(im2.width + jx, im2.height + jy), resample=Image.BICUBIC)
    canvas.alpha_composite(big, (round(joint_dst[0] - im2.width - jx), round(joint_dst[1] - im2.height - jy)))
def build(cfg, ph, out):
    full = piece(cfg['full']); W, H = full.size
    c = Image.new('RGBA', (W * 2 + 40, H + 60), (40, 34, 60, 255)); c.alpha_composite(full, (0, 30))
    ox, oy = W + 40 - cfg['full_box'][0], 30 - cfg['full_box'][1]   # A-coords → canvas
    A = lambda p: (p[0] + ox, p[1] + oy)
    for part in cfg['parts']:
        im = piece(part['tex']); bx, by = part['box']
        js = (part['joint'][0] - bx, part['joint'][1] - by)
        a = part.get('rest', 0) + part.get('swing', 0) * math.sin(ph + part.get('phase', 0))
        draw(c, im, js, A(part['at']), part.get('scale', 1), a, dark=part.get('dark', 1))
    c.save(out)
if __name__ == '__main__':
    n = sys.argv[1]; cfg = R[n]
    import os; os.makedirs('frames/rig', exist_ok=True)
    for i, ph in enumerate([0, 1.57, 3.14, 4.71]): build(cfg, ph, f'frames/rig/{n}_{i}.png')
    print('ok')
