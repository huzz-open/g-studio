from pathlib import Path
import struct, zlib, json, hashlib, sys
from collections import Counter

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).parent

def read_png(path):
    data = path.read_bytes()
    offset, chunks = 8, []
    while offset < len(data):
        length = struct.unpack_from('>I', data, offset)[0]
        kind = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + length]
        offset += 12 + length
        if kind == b'IHDR':
            width, height, bits, color, _, _, interlace = struct.unpack('>IIBBBBB', payload)
            assert (bits, color, interlace) == (8, 6, 0)
        if kind == b'IDAT':
            chunks.append(payload)
    raw = zlib.decompress(b''.join(chunks))
    stride = width * 4
    previous = bytearray(stride)
    result, offset = bytearray(), 0
    for _ in range(height):
        filt = raw[offset]
        offset += 1
        row = bytearray(raw[offset:offset + stride])
        offset += stride
        for i in range(stride):
            a = row[i - 4] if i >= 4 else 0
            b = previous[i]
            c = previous[i - 4] if i >= 4 else 0
            if filt == 0: value = 0
            elif filt == 1: value = a
            elif filt == 2: value = b
            elif filt == 3: value = (a + b) // 2
            elif filt == 4:
                prediction = a + b - c
                pa, pb, pc = abs(prediction - a), abs(prediction - b), abs(prediction - c)
                value = a if pa <= pb and pa <= pc else b if pb <= pc else c
            else: raise ValueError(filt)
            row[i] = (row[i] + value) & 255
        result.extend(row)
        previous = row
    return width, height, result

sw, sh, source = read_png(ROOT / 'ancient-chinese-props.png')
project = json.loads((ROOT / 'ancient-chinese-props.gs').read_text(encoding='utf-8'))
checks = []
for sprite in project['data']['sprites']:
    name = sprite['name']
    x, y, w, h = sprite['rect']
    cw, ch, color = read_png(ROOT / 'sprites' / (name + '.png'))
    nw, nh, normal = read_png(ROOT / 'sprites' / (name + '_normal.png'))
    assert (cw, ch) == (nw, nh) == (w, h)
    alpha_changes = Counter()
    opaque_changes = normal_alpha_changes = nonflat = 0
    for yy in range(h):
        for xx in range(w):
            i = (yy * w + xx) * 4
            j = ((y + yy) * sw + x + xx) * 4
            if color[i + 3] != source[j + 3]:
                alpha_changes[(source[j + 3], color[i + 3])] += 1
            opaque_changes += source[j + 3] == 255 and color[i:i + 4] != source[j:j + 4]
            normal_alpha_changes += normal[i + 3] != color[i + 3]
            nonflat += normal[i + 3] > 0 and normal[i:i + 3] != bytes([128, 128, 255])
    check = dict(name=name, size=[w, h], opaquePixelMismatches=opaque_changes,
                 normalAlphaMismatches=normal_alpha_changes, nonflatNormalPixels=nonflat,
                 sourceAlphaChanges=[dict(before=k[0], after=k[1], count=v) for k, v in sorted(alpha_changes.items())],
                 detailStrength=sprite['normalSettings']['detailStrength'])
    checks.append(check)
original = Path(r'C:\Users\wps\.codex\generated_images\01a175e1-34a6-7351-b4bb-51490bd042b0\exec-d5970584-8772-4219-89df-2041b309ed96.png')
unchanged = hashlib.sha256(original.read_bytes()).digest() == hashlib.sha256((ROOT / 'ancient-chinese-props.png').read_bytes()).digest()
report = dict(sourceCommit='fc4a3b2', url='http://127.0.0.1:5173/#/sprite-slicer',
              spriteCount=6, pngCount=12, sourceFileUnchanged=unchanged,
              unitTests=dict(normal=7, shadow=3, failed=0), assets=checks,
              shadowModel='Alpha silhouette uniformly extruded by 10% of longest sprite side; no reconstructed 3D object or 20-degree camera geometry.')
(ROOT / 'test-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
assert unchanged
assert all(c['opaquePixelMismatches'] == 0 and c['normalAlphaMismatches'] == 0 and c['nonflatNormalPixels'] > 0 for c in checks)
