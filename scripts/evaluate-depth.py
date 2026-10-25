"""Offline stability screening of relative-depth estimates, NOT ground-height accuracy.

No source assets are modified. Model inference is local ONNX Runtime CPU.
The normal PNG is checked for alignment but is not an input to this RGB-only model.
Preprocessing follows the pinned model's DPT config and Transformers v4.44.2 sizing.
"""
import argparse
import hashlib
import html
import io
import json
import platform
import time
import urllib.request
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw, ImageFont
from scipy.stats import spearmanr

REVISION = "4472b7362082ad9968fee890ca0f1e5aca36b93d"
MODEL_SHA256 = "afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c"
MODEL_ROOT = f"https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/{REVISION}/"
SAMPLES = [(1, "房屋"), (2, "楼房"), (7, "树木"), (9, "摊位"), (10, "伞"), (12, "桌子"), (17, "盆栽"), (31, "石狮")]
VARIANTS = ["gray", "black", "white", "checker", "padding", "translation", "mirror", "nearest2x", "nearest2x_fixed"]
VARIANT_LABELS = {"black": "黑底", "white": "白底", "checker": "棋盘格", "padding": "增加留白", "translation": "平移", "mirror": "水平翻转", "nearest2x": "2倍像素放大", "nearest2x_fixed": "放大/固定网络尺寸"}


def ensure_model(cache):
    cache.mkdir(parents=True, exist_ok=True)
    for name in ["preprocessor_config.json", "config.json", "model.onnx"]:
        target = cache / name
        remote = "onnx/model.onnx" if name == "model.onnx" else name
        if not target.exists():
            temporary = target.with_suffix(".partial")
            with urllib.request.urlopen(MODEL_ROOT + remote, timeout=60) as response, temporary.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
            temporary.replace(target)
    actual = hashlib.sha256((cache / "model.onnx").read_bytes()).hexdigest()
    if actual != MODEL_SHA256:
        raise RuntimeError(f"Model checksum mismatch: {actual}")
    return cache / "model.onnx", json.loads((cache / "preprocessor_config.json").read_text())


def compose(rgba, variant):
    width, height = rgba.size
    pad = max(8, round(max(width, height) * 0.1))
    if variant == "padding":
        pad = max(8, round(max(width, height) * 0.35))
    size = (width + 2 * pad, height + 2 * pad)
    x, y = pad, pad
    if variant == "translation":
        x += pad
        y -= pad // 2
    gray = {"black": 16, "white": 240}.get(variant, 128)
    background = Image.new("RGB", size, (gray, gray, gray))
    if variant == "checker":
        yy, xx = np.indices((size[1], size[0]))
        pattern = np.where((xx // 8 + yy // 8) % 2, 112, 64).astype(np.uint8)
        background = Image.fromarray(np.repeat(pattern[:, :, None], 3, axis=2))
    background.paste(rgba, (x, y), rgba)
    factor = 2 if variant.startswith("nearest2x") else 1
    if factor == 2:
        background = background.resize((size[0] * 2, size[1] * 2), Image.Resampling.NEAREST)
    if variant == "mirror":
        background = background.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    return background, (x, y, width, height), factor


def network_size(image, config):
    width, height = image.size
    sw, sh = config["size"]["width"] / width, config["size"]["height"] / height
    if config.get("keep_aspect_ratio", False):
        # DPT's minimal resize rule: choose the scale closest to 1.
        if abs(1 - sw) < abs(1 - sh):
            sh = sw
        else:
            sw = sh
    multiple = config.get("ensure_multiple_of", 1)
    return max(multiple, round(sw * width / multiple) * multiple), max(multiple, round(sh * height / multiple) * multiple)


def infer(session, image, config, forced_size=None):
    size = forced_size or network_size(image, config)
    pixels = np.asarray(image.resize(size, Image.Resampling.BICUBIC), dtype=np.float32)
    pixels *= config["rescale_factor"]
    pixels = (pixels - np.asarray(config["image_mean"], dtype=np.float32)) / np.asarray(config["image_std"], dtype=np.float32)
    batch = np.ascontiguousarray(pixels.transpose(2, 0, 1)[None])
    start = time.perf_counter()
    predicted = session.run(None, {"pixel_values": batch})[0][0]
    elapsed = time.perf_counter() - start
    if not np.isfinite(predicted).all():
        raise RuntimeError("Non-finite model output")
    restored = cv2.resize(predicted, image.size, interpolation=cv2.INTER_CUBIC)
    return restored, size, elapsed


def metrics(reference, candidate, mask):
    y, x = reference[mask].astype(np.float64), candidate[mask].astype(np.float64)
    span = float(np.percentile(y, 95) - np.percentile(y, 5))
    if span < 1e-8 or len(x) < 20:
        raise RuntimeError("Insufficient foreground variation for a stability comparison")
    xc, yc = x - x.mean(), y - y.mean()
    slope = max(0.0, float(xc @ yc / max(xc @ xc, 1e-12)))
    intercept = float(y.mean() - slope * x.mean())
    aligned = candidate * slope + intercept
    nrmse = float(np.sqrt(np.mean((aligned[mask] - reference[mask]) ** 2)) / span)
    candidate_flat = float(x.std()) < 1e-10
    correlation = 0.0 if candidate_flat else float(spearmanr(x, y).statistic)
    rng = np.random.default_rng(20261025)
    i, j = rng.integers(0, len(x), (2, 20000))
    usable = np.abs(y[i] - y[j]) >= span * 0.1
    flips = float(np.mean((x[i[usable]] - x[j[usable]]) * (y[i[usable]] - y[j[usable]]) < 0))
    return {"spearman": correlation, "positive_affine_nrmse": nrmse, "rank_flip_fraction": flips, "candidate_flat": candidate_flat,
            "tested_pairs": int(usable.sum()), "alignment_scale": slope, "alignment_shift": intercept}, aligned


def font(size):
    try:
        return ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", size)
    except OSError:
        return ImageFont.load_default()


def preview_tile(values, alpha, low, high, difference=False):
    normalized = np.clip((values - low) / max(high - low, 1e-8), 0, 1)
    if difference:
        colors = np.stack([np.full_like(normalized, 255), 255 * (1 - normalized), 255 * (1 - normalized)], axis=-1)
    else:
        colors = np.repeat((normalized * 255)[:, :, None], 3, axis=-1)
    result = Image.fromarray(np.uint8(colors))
    background = Image.new("RGB", result.size, (40, 40, 40))
    background.paste(result, (0, 0), Image.fromarray(alpha))
    return background


def make_contact(rows, output):
    titles = ["原图", "相对深度：灰底", "相对深度：白底", "最不稳定输入", "最大差异（对齐后）"]
    cell_w, cell_h = 210, 190
    sheet = Image.new("RGB", (len(titles) * cell_w, 80 + len(rows) * cell_h + 55), (27, 29, 33))
    draw = ImageDraw.Draw(sheet)
    draw.text((12, 8), "自动深度稳定性检查 · 亮色表示预测更靠近相机，不表示离地更高", font=font(18), fill="white")
    for i, title in enumerate(titles):
        draw.text((i * cell_w + 8, 45), title, font=font(15), fill=(200, 210, 220))
    for row_id, row in enumerate(rows):
        rgba, maps = row["rgba"], row["maps"]
        alpha = np.asarray(rgba)[:, :, 3]
        base = maps["gray"]
        low, high = np.percentile(base[row["core"]], [5, 95])
        max_error = np.maximum.reduce([np.abs(maps[v] - base) for v in VARIANTS[1:]]) / max(high - low, 1e-8)
        source = Image.new("RGB", rgba.size, (128, 128, 128)); source.paste(rgba, (0, 0), rgba)
        worst = row["worst_variant"]
        tiles = [source, preview_tile(base, alpha, low, high), preview_tile(maps["white"], alpha, low, high),
                 preview_tile(maps[worst], alpha, low, high), preview_tile(max_error, alpha, 0, 0.5, True)]
        for col, tile in enumerate(tiles):
            tile.thumbnail((cell_w - 18, cell_h - 35), Image.Resampling.NEAREST)
            left = col * cell_w + (cell_w - tile.width) // 2
            top = 80 + row_id * cell_h + (cell_h - 35 - tile.height) // 2
            sheet.paste(tile, (left, top))
        draw.text((10, 80 + row_id * cell_h + cell_h - 29), f'{row["id"]} · {row["label"]}', font=font(14), fill="white")
        draw.text((3 * cell_w + 8, 80 + row_id * cell_h + cell_h - 29), f'{VARIANT_LABELS[worst]} · ρ={row["worst_correlation"]:.3f}', font=font(13), fill=(200, 210, 220))
    draw.text((12, sheet.height - 43), "每行共用参考范围；变体先做正比例缩放/平移对齐。红色表示变化，非真实高度误差。", font=font(14), fill=(180, 190, 205))
    sheet.save(output / "comparison.png")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--cache", type=Path, default=Path("node_modules/.cache/depth-eval"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ids", nargs="*", type=int)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    model_path, config = ensure_model(args.cache)
    options = ort.SessionOptions(); options.intra_op_num_threads = 4; options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(model_path), sess_options=options, providers=["CPUExecutionProvider"])
    records, visual_rows = [], []
    for sample_id, label in SAMPLES:
        if args.ids and sample_id not in args.ids:
            continue
        name = f"sprite-{sample_id:02d}"
        source = args.assets / f"{name}.png"
        normal_path = args.assets / f"{name}_normal.png"
        source_bytes, normal_bytes = source.read_bytes(), normal_path.read_bytes()
        rgba = Image.open(io.BytesIO(source_bytes)).convert("RGBA")
        normal = Image.open(io.BytesIO(normal_bytes)).convert("RGBA")
        alpha = np.asarray(rgba)[:, :, 3]
        core = alpha >= 250
        maps, aligned_maps, runs = {}, {}, {}
        reference_size = None
        for variant in VARIANTS:
            image, (x, y, w, h), factor = compose(rgba, variant)
            forced = reference_size if variant == "nearest2x_fixed" else None
            prediction, input_size, elapsed = infer(session, image, config, forced)
            if variant == "gray":
                reference_size = input_size
            if variant == "mirror":
                prediction = prediction[:, ::-1]
            crop = prediction[y * factor:(y + h) * factor, x * factor:(x + w) * factor]
            if factor != 1:
                crop = cv2.resize(crop, (w, h), interpolation=cv2.INTER_AREA)
            maps[variant] = crop
            record = {"network_size": list(input_size), "inference_seconds": elapsed}
            if variant != "gray":
                stats, aligned = metrics(maps["gray"], crop, core)
                record.update(stats); aligned_maps[variant] = aligned
            else:
                aligned_maps[variant] = crop
            runs[variant] = record
            print(f"{name} {variant:16s} {elapsed:.2f}s" + (f" rho={record['spearman']:.3f} flips={record['rank_flip_fraction']:.1%}" if variant != "gray" else ""), flush=True)
        np.savez_compressed(args.output / f"{name}-raw-depth.npz", **maps)
        records.append({"id": name, "label": label, "source": str(source.resolve()), "source_sha256": hashlib.sha256(source_bytes).hexdigest(),
                        "normal_source": str(normal_path.resolve()), "normal_sha256": hashlib.sha256(normal_bytes).hexdigest(),
                        "size": list(rgba.size), "normal_size_matches": normal.size == rgba.size,
                        "normal_alpha_matches": normal.size == rgba.size and bool(np.array_equal(np.asarray(normal)[:, :, 3], alpha)),
                        "evaluated_pixels": int(core.sum()), "variants": runs})
        worst = min(VARIANTS[1:], key=lambda key: runs[key]["spearman"])
        visual_rows.append({"id": name, "label": label, "rgba": rgba, "core": core, "maps": aligned_maps,
                            "worst_variant": worst, "worst_correlation": runs[worst]["spearman"]})
        (args.output / "results.partial.json").write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    all_runs = [run for record in records for key, run in record["variants"].items() if key != "gray"]
    report = {"model": "onnx-community/depth-anything-v2-small", "revision": REVISION, "model_sha256": MODEL_SHA256,
              "runtime": {"python": platform.python_version(), "onnxruntime": ort.__version__, "providers": session.get_providers(), "threads": 4},
              "sources": {"model": "https://huggingface.co/onnx-community/depth-anything-v2-small/tree/" + REVISION,
                          "preprocessing": "https://github.com/huggingface/transformers/blob/v4.44.2/src/transformers/models/dpt/image_processing_dpt.py"},
              "method": {"input": "RGB only; normal PNGs checked for alignment, not used by the model", "output": "relative depth score (larger usually nearer), NOT height above ground",
                         "foreground_mask": "alpha >= 250/255", "reference": "gray background 128 with 10% padding",
                         "normalization": "positive affine fit on foreground; RMSE divided by reference p95-p5",
                         "rank_flips": "20,000 fixed-seed random pairs, excluding reference differences below 10% of p95-p5",
                         "resize": "DPT minimal aspect-preserving resize, multiple of 14; PIL bicubic; nearest2x_fixed holds baseline network size",
                         "ground_truth": "none; stability screening only, not accuracy or a confidence estimate"},
              "summary": {"samples": len(records), "inferences": len(records) * len(VARIANTS),
                          "minimum_spearman": min(run["spearman"] for run in all_runs),
                          "maximum_rank_flip_fraction": max(run["rank_flip_fraction"] for run in all_runs),
                          "maximum_affine_nrmse": max(run["positive_affine_nrmse"] for run in all_runs)}, "samples": records}
    (args.output / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    make_contact(visual_rows, args.output)
    table = "".join(f"<tr><td>{html.escape(r['id']+' '+r['label'])}</td><td>{min(v['spearman'] for k,v in r['variants'].items() if k!='gray'):.3f}</td><td>{max(v['rank_flip_fraction'] for k,v in r['variants'].items() if k!='gray'):.1%}</td></tr>" for r in records)
    (args.output / "report.html").write_text(f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>自动深度稳定性评估</title>
<style>body{{max-width:1100px;margin:30px auto;padding:0 20px;background:#1b1d21;color:#ddd;font:16px/1.6 system-ui}}table{{border-collapse:collapse;width:100%}}td,th{{padding:8px;border-bottom:1px solid #555;text-align:left}}img{{width:100%}}a{{color:#8ab4f8}}</style>
<h1>自动深度稳定性评估</h1><p>模型：Depth Anything V2 Small · FP32 ONNX · 本地 CPU 推理。共 {len(records)} 个实际素材，{len(records)*len(VARIANTS)} 次推理。</p>
<p><strong>这是相对深度，不是离地高度。没有高度真值，以下数值只衡量输入变换前后的稳定性，不是准确率。</strong></p>
<p>法线图只核对尺寸与透明度，未作为模型输入。变化包括背景、留白、位置、镜像和像素放大。候选深度按正比例缩放／平移对齐后再比较。</p>
<table><tr><th>素材</th><th>最低排序相关性</th><th>最高远近次序翻转率</th></tr>{table}</table>
<p><a href="results.json">完整指标与来源</a> · 模型版本 {REVISION}</p><img src="comparison.png" alt="原图与不同输入条件下的相对深度比较">
<p>稳定不代表真实高度正确；明显不稳定则说明仍不宜直接驱动可控投影。本报告未生成阴影，也未修改项目预览。</p></html>""", encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
