"""Offline camera/ground identifiability audit on the saved depth evaluation.

Uses GeoCalib's published perspective-field equations with an independent scipy
robust least-squares fit of roll, pitch and focal. This is NOT upstream's exact
optimizer or a calibrated accuracy estimate. No ground plane or shadow is invented.
"""
import argparse
import hashlib
import io
import importlib.util
import json
import math
import re
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw
from scipy.optimize import least_squares

spec = importlib.util.spec_from_file_location("depth_eval", Path(__file__).with_name("evaluate-depth.py"))
depth_eval = importlib.util.module_from_spec(spec)
spec.loader.exec_module(depth_eval)

MODEL_REVISION = "c4982590dedf8e532a37db7174289e90fa53b6a6"
MODEL_SHA = "a724447e1bf7138352e5e70bbe0f011e6fb02909edd3148a5d0f46e8d153ae7b"
CONDITIONS = ["gray", "white", "padding", "translation"]


def up_vector(roll, pitch):
    return np.array([-np.sin(roll) * np.cos(pitch), -np.cos(roll) * np.cos(pitch), np.sin(pitch)])


def render_fields(xy, center, focal, gravity):
    uv = (xy - center) / focal
    up = gravity[:2] - gravity[2] * uv
    up /= np.maximum(np.linalg.norm(up, axis=1, keepdims=True), 1e-12)
    rays = np.column_stack([uv, np.ones(len(uv))])
    rays /= np.linalg.norm(rays, axis=1, keepdims=True)
    return up, rays @ gravity


def fit_camera(fields, foreground=None):
    up, confidence, latitude, lat_confidence = fields
    up = up[0].transpose(1, 2, 0).astype(np.float64)
    confidence = np.clip(confidence.squeeze(), 0, 1).astype(np.float64)
    latitude = latitude.squeeze().astype(np.float64)
    lat_confidence = np.clip(lat_confidence.squeeze(), 0, 1).astype(np.float64)
    height, width = confidence.shape
    yy, xx = np.indices((height, width))
    stride = max(1, math.ceil(math.sqrt(width * height / 6000)))
    keep = (xx % stride == 0) & (yy % stride == 0)
    if foreground is not None:
        keep &= foreground
    xy = np.column_stack([xx[keep], yy[keep]]).astype(np.float64)
    target_up = up[keep]
    target_up /= np.maximum(np.linalg.norm(target_up, axis=1, keepdims=True), 1e-12)
    target_lat = np.sin(latitude[keep])
    confidence_scale = max(float((confidence[keep].mean() + lat_confidence[keep].mean()) / 2), 1e-12)
    wu = np.sqrt(confidence[keep] / confidence_scale)
    wl = np.sqrt(lat_confidence[keep] / confidence_scale)
    if len(xy) < 30 or wu.sum() + wl.sum() < 1:
        raise ValueError("Insufficient calibration field support")
    center = np.array([width / 2, height / 2])

    def residual(parameters):
        g = up_vector(parameters[0], parameters[1])
        predicted_up, predicted_lat = render_fields(xy, center, np.exp(parameters[2]), g)
        up_residual = predicted_up - target_up
        lat_residual = predicted_lat - target_lat
        def robust_scale(magnitude):
            cost = np.where(magnitude <= 0.01, magnitude ** 2, 0.02 * magnitude - 0.0001)
            return np.sqrt(np.maximum(cost, 0)) / np.maximum(magnitude, 1e-12)
        return np.concatenate([(up_residual * (wu * robust_scale(np.linalg.norm(up_residual, axis=1)))[:, None]).ravel(),
                               lat_residual * wl * robust_scale(np.abs(lat_residual))])

    mean_up = np.average(target_up, weights=np.maximum(wu, 1e-9), axis=0)
    roll0 = np.arctan2(-mean_up[0], -mean_up[1])
    pitch0 = np.arcsin(np.clip(np.average(target_lat, weights=np.maximum(wl, 1e-9)), -0.95, 0.95))
    lower = [-np.pi, -np.pi / 2 + 0.01, np.log(max(width, height) * 0.1)]
    upper = [np.pi, np.pi / 2 - 0.01, np.log(max(width, height) * 20)]
    fits = [least_squares(residual, [roll0, pitch0, np.log(max(width, height) * ratio)], bounds=(lower, upper),
                          loss="linear", max_nfev=100, x_scale="jac", ftol=1e-9, xtol=1e-9, gtol=1e-9) for ratio in [0.5, 1, 3]]
    best = min(fits, key=lambda fit: fit.cost)
    roll, pitch, log_focal = best.x
    focal = np.exp(log_focal)
    g = up_vector(roll, pitch)
    predicted_up, predicted_lat = render_fields(xy, center, focal, g)
    up_error = np.degrees(np.arccos(np.clip((predicted_up * target_up).sum(axis=1), -1, 1)))
    lat_error = np.degrees(np.abs(np.arcsin(np.clip(predicted_lat, -1, 1)) - np.arcsin(np.clip(target_lat, -1, 1))))
    return {"roll_deg": float(np.degrees(roll)), "pitch_deg": float(np.degrees(pitch)), "downward_tilt_deg": float(-np.degrees(pitch)),
            "vertical_fov_deg": float(np.degrees(2 * np.arctan(height / (2 * focal)))), "focal_px": float(focal),
            "center_px": center.tolist(), "up_vector": g.tolist(), "field_up_median_error_deg": float(np.median(up_error)),
            "field_latitude_median_error_deg": float(np.median(lat_error)), "weighted_residual_rms": float(np.sqrt(np.mean(residual(best.x) ** 2))),
            "hessian_condition": float(np.linalg.cond(best.jac.T @ best.jac)),
            "focal_bound_hit": bool(log_focal < lower[2] + 0.01 or log_focal > upper[2] - 0.01),
            "sampled_pixels": len(xy), "network_confidence_mean": float((confidence[keep].mean() + lat_confidence[keep].mean()) / 2)}


def prepare(rgb_image, foreground):
    width, height = rgb_image.size
    scale = 320 / min(width, height)
    new_w, new_h = int(width * scale), int(height * scale)
    rgb = np.asarray(rgb_image, dtype=np.float32) / 255
    resized = cv2.resize(rgb, (new_w, new_h), interpolation=cv2.INTER_AREA if scale <= 0.5 else cv2.INTER_LINEAR)
    mask = cv2.resize(foreground.astype(np.uint8), (new_w, new_h), interpolation=cv2.INTER_NEAREST)
    target_w, target_h = new_w // 32 * 32, new_h // 32 * 32
    left, top = math.ceil((new_w - target_w) / 2), math.ceil((new_h - target_h) / 2)
    image = resized[top:top + target_h, left:left + target_w]
    cropped_mask = mask[top:top + target_h, left:left + target_w].astype(bool)
    retained = float(cropped_mask.sum() / max(int(mask.sum()), 1))
    return np.ascontiguousarray(image.transpose(2, 0, 1)[None]), cropped_mask, {"scale_x": new_w / width, "scale_y": new_h / height, "crop_x": left, "crop_y": top, "width": target_w, "height": target_h, "foreground_retained_fraction": retained}


def angle(a, b):
    return float(np.degrees(np.arccos(np.clip(np.dot(a, b), -1, 1))))


def canonical_input(rgba):
    """Normalize transparent framing without assuming a ground plane or object shape."""
    bbox = rgba.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("Empty sprite")
    crop = rgba.crop(bbox)
    factor = 512 / max(crop.size)
    size = tuple(max(1, round(v * factor)) for v in crop.size)
    resized = crop.resize(size, Image.Resampling.NEAREST)
    pad = 51
    image = Image.new("RGB", (size[0] + 2*pad, size[1] + 2*pad), (128,128,128))
    image.paste(resized, (pad,pad), resized)
    foreground = np.zeros((image.height,image.width),dtype=np.uint8)
    foreground[pad:pad+size[1],pad:pad+size[0]] = np.asarray(resized)[:,:,3] >= 250
    return image,foreground,{"bbox":list(bbox),"size":list(size),"pad":pad,"scale_x":size[0]/crop.width,"scale_y":size[1]/crop.height}


def canonical_invariance(rgba):
    baseline = canonical_input(rgba)[0]
    border = Image.new("RGBA",(rgba.width+100,rgba.height+160));border.paste(rgba,(37,83))
    hidden = np.asarray(rgba).copy();hidden[hidden[:,:,3]==0,:3]=[255,64,200]
    variants = {"transparent_padding_translation":border,"hidden_background_rgb":Image.fromarray(hidden),
                "nearest_2x":rgba.resize((rgba.width*2,rgba.height*2),Image.Resampling.NEAREST)}
    return {key: canonical_input(image)[0].size==baseline.size and canonical_input(image)[0].tobytes()==baseline.tobytes() for key,image in variants.items()}


def contact_sensitivity(depth, alpha, placement, preprocess, fit):
    """Lowest-point candidates across equally valid relative inverse-depth gauges.
    These candidates are NOT adopted as a ground plane. They expose the unresolved
    depth offset; even stable candidates do not prove physical ground contact.
    """
    keep = alpha >= 250
    yy, xx = np.where(keep)
    x0, y0, _, _ = placement
    xy = np.column_stack([(xx + x0) * preprocess["scale_x"] - preprocess["crop_x"],
                          (yy + y0) * preprocess["scale_y"] - preprocess["crop_y"]])
    rays = np.column_stack([(xy - fit["center_px"]) / fit["focal_px"], np.ones(len(xy))])
    values = depth[keep].astype(np.float64)
    span = np.percentile(values, 95) - np.percentile(values, 5)
    q = (values - values.min()) / max(span, 1e-8)
    contacts = []
    for offset in [0.1, 1.1, 4.1]:
        points = rays / (q[:, None] + offset)
        vertical = points @ np.asarray(fit["up_vector"])
        indices = np.argsort(vertical)[:max(1, round(len(vertical) * 0.005))]
        contacts.append({"inverse_depth_offset": offset, "candidate_pixel": [float(np.median(xx[indices])), float(np.median(yy[indices]))],
                         "relative_vertical_span": float(np.percentile(vertical, 99) - np.percentile(vertical, 1))})
    spread = max(np.linalg.norm(np.asarray(a["candidate_pixel"]) - b["candidate_pixel"]) for a in contacts for b in contacts)
    return {"candidates": contacts, "candidate_spread_pixels": float(spread), "spread_image_diagonal_fraction": float(spread / math.hypot(*depth.shape)),
            "ground_plane_accepted": False, "reason": "Only relative depth and model-estimated orientation are available; receiver surface and absolute depth offset are not established."}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evaluation", type=Path, required=True)
    parser.add_argument("--model", type=Path, default=Path("node_modules/.cache/depth-eval/geocalib_fields.onnx"))
    parser.add_argument("--ids", nargs="*")
    args = parser.parse_args()
    if hashlib.sha256(args.model.read_bytes()).hexdigest() != MODEL_SHA:
        raise RuntimeError("Calibration model SHA-256 mismatch")
    depth_report = json.loads((args.evaluation / "results.json").read_text(encoding="utf-8"))
    options = ort.SessionOptions(); options.intra_op_num_threads = 4; options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(args.model), sess_options=options, providers=["CPUExecutionProvider"])
    depth_model, depth_config = depth_eval.ensure_model(args.model.parent)
    depth_session = ort.InferenceSession(str(depth_model), sess_options=options, providers=["CPUExecutionProvider"])
    records = []
    for source in depth_report["samples"]:
        if args.ids and source["id"] not in args.ids:
            continue
        source_bytes = Path(source["source"]).read_bytes()
        if hashlib.sha256(source_bytes).hexdigest() != source["source_sha256"]:
            raise RuntimeError(f'{source["id"]}: image changed since depth evaluation; rerun that stage first')
        rgba = Image.open(io.BytesIO(source_bytes)).convert("RGBA")
        alpha = np.asarray(rgba)[:, :, 3]
        predictions = np.load(args.evaluation / (source["id"] + "-raw-depth.npz"))
        cases = {}
        for condition in CONDITIONS:
            rgb, placement, _ = depth_eval.compose(rgba, condition)
            x, y, w, h = placement
            mask = np.zeros((rgb.height, rgb.width), dtype=np.uint8); mask[y:y+h, x:x+w] = alpha >= 250
            tensor, network_mask, preprocessing = prepare(rgb, mask)
            start = time.perf_counter(); outputs = session.run(None, {session.get_inputs()[0].name: tensor}); inference_time = time.perf_counter() - start
            by_name = dict(zip([o.name for o in session.get_outputs()], outputs))
            fields = [by_name[k] for k in ["up_field", "up_confidence", "latitude_field", "latitude_confidence"]]
            full = fit_camera(fields)
            foreground = fit_camera(fields, network_mask)
            contact = contact_sensitivity(predictions[condition], alpha, placement, preprocessing, foreground)
            cases[condition] = {"all_pixels_fit": full, "foreground_fit": foreground, "foreground_vs_all_angle_deg": angle(full["up_vector"], foreground["up_vector"]),
                                "contact_sensitivity": contact, "preprocessing": preprocessing, "inference_seconds": inference_time}
            np.savez_compressed(args.evaluation / f'{source["id"]}-camera-{condition}.npz', **by_name)
            print(f'{source["id"]} {condition}: tilt={foreground["downward_tilt_deg"]:.1f}deg vfov={foreground["vertical_fov_deg"]:.1f}deg, fit residual={foreground["weighted_residual_rms"]:.3f}, contact spread={contact["candidate_spread_pixels"]:.1f}px', flush=True)
        gravity_spread = max(angle(a["foreground_fit"]["up_vector"], b["foreground_fit"]["up_vector"]) for a in cases.values() for b in cases.values())
        canonical_rgb, canonical_mask, mapping = canonical_input(rgba)
        tensor, network_mask, preprocessing = prepare(canonical_rgb,canonical_mask)
        outputs = session.run(None,{session.get_inputs()[0].name:tensor})
        by_name = dict(zip([o.name for o in session.get_outputs()],outputs))
        fields = [by_name[k] for k in ["up_field","up_confidence","latitude_field","latitude_confidence"]]
        canonical_full, canonical_fg = fit_camera(fields), fit_camera(fields,network_mask)
        predicted,_,_ = depth_eval.infer(depth_session,canonical_rgb,depth_config)
        pad=mapping['pad'];cw,ch=mapping['size'];x1,y1,x2,y2=mapping['bbox']
        canonical_depth=np.zeros(alpha.shape,dtype=np.float32)
        canonical_depth[y1:y2,x1:x2]=cv2.resize(predicted[pad:pad+ch,pad:pad+cw],(x2-x1,y2-y1),interpolation=cv2.INTER_CUBIC)
        effective={**preprocessing,'scale_x':preprocessing['scale_x']*mapping['scale_x'],'scale_y':preprocessing['scale_y']*mapping['scale_y']}
        placement=(pad/mapping['scale_x']-x1,pad/mapping['scale_y']-y1,rgba.width,rgba.height)
        canonical_contact=contact_sensitivity(canonical_depth,alpha,placement,effective,canonical_fg)
        invariant=canonical_invariance(rgba)
        np.savez_compressed(args.evaluation/f'{source["id"]}-canonical-geometry.npz',depth=canonical_depth,**by_name)
        canonical = {'all_pixels_fit':canonical_full,'foreground_fit':canonical_fg,
                     'foreground_vs_all_angle_deg':angle(canonical_full['up_vector'],canonical_fg['up_vector']),
                     'input_sha256':hashlib.sha256(canonical_rgb.tobytes()).hexdigest(),'normalization_invariance':invariant,
                     'contact_sensitivity':canonical_contact,'input_mapping':mapping,'preprocessing':preprocessing}
        print(f'{source["id"]} canonical: tilt={canonical_fg["downward_tilt_deg"]:.1f}deg, foreground/all disagreement={canonical["foreground_vs_all_angle_deg"]:.1f}deg, framing invariant={all(invariant.values())}',flush=True)
        records.append({"id": source["id"], "label": source["label"], "source_sha256": source["source_sha256"], "cases": cases,
                        "orientation_spread_deg": gravity_spread,
                        "canonical":canonical,
                        "ground_status": "not_established", "shadow_generated": False})

        (args.evaluation / "calibration.partial.json").write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    result = {"model": "mprib/geocalib-fields-onnx", "revision": MODEL_REVISION, "model_sha256": MODEL_SHA,
              "method": "GeoCalib fields + independent scipy confidence-weighted robust least squares, fitting roll/pitch/focal with center principal point, square pixels and pinhole projection.",
              "limits": "Model hypotheses are explicit; no pixel-art calibration ground truth. Reported residuals and variation are not accuracy. No receiver plane is assumed or accepted.",
              "normalization": "Alpha bounding box, nearest-neighbor resize to 512 on the longest side, 51-pixel padding, gray 128. Transparent padding/translation, hidden RGB and 2x pixel replication are tested for identical inputs.",
              "decision": {"input_invariance_passed": all(all(r['canonical']['normalization_invariance'].values()) for r in records),
                           "camera_validated_against_ground_truth": False, "receiver_established": False, "shadow_generation_enabled": False},
              "runtime": {"onnxruntime": ort.__version__, "providers": session.get_providers(), "camera_input_cases": len(records)*5, "canonical_depth_cases": len(records)},
              "references": ["https://github.com/cvg/GeoCalib", "https://huggingface.co/mprib/geocalib-fields-onnx"], "samples": records}
    write_outputs(result, args.evaluation)


def write_outputs(result, evaluation):
    records=result['samples']
    sources={s['id']:s for s in json.loads((evaluation/'results.json').read_text(encoding='utf-8'))['samples']}
    thumbnails=[]
    for record in records:
        source=Path(sources[record['id']]['source'])
        data=source.read_bytes()
        if hashlib.sha256(data).hexdigest()!=record['source_sha256']:
            raise RuntimeError('Source changed since evaluation')
        rgba=Image.open(io.BytesIO(data)).convert('RGBA')
        thumbnail=Image.new('RGB',rgba.size,(128,128,128));thumbnail.paste(rgba,(0,0),rgba)
        thumbnail.thumbnail((180,170),Image.Resampling.NEAREST);thumbnails.append(thumbnail)
    (evaluation / "calibration.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    sheet = Image.new("RGB", (1100, 90 + len(records) * 190), (27, 29, 33)); draw = ImageDraw.Draw(sheet)
    draw.text((15, 12), "自动相机与接地关系评估 · 均为模型估计，未生成候选阴影", fill="white", font=depth_eval.font(20))
    for row, record in enumerate(records):
        top = 80 + row * 190; image = thumbnails[row]; sheet.paste(image, (12 + (180-image.width)//2, top))
        cases = record["cases"]
        tilts = [c["foreground_fit"]["downward_tilt_deg"] for c in cases.values()]
        canonical=record['canonical'];f=canonical['foreground_fit'];contact=canonical['contact_sensitivity']['candidate_spread_pixels']
        lines = [f'{record["id"]} · {record["label"]}',
                 f'统一输入前：估计俯角 {min(tilts):.1f}° ～ {max(tilts):.1f}°；向上方向变化 {record["orientation_spread_deg"]:.1f}°',
                 f'统一输入后：俯角候选 {f["downward_tilt_deg"]:.1f}°；仅看前景/整图估计差异 {canonical["foreground_vs_all_angle_deg"]:.1f}°',
                 f'输入归一化：{"通过" if all(canonical["normalization_invariance"].values()) else "需复查"}；深度基准变化使最低点候选移动 {contact:.1f} px',
                 '接地关系：未确定。没有填入固定俯角、接地点或物体厚度。']
        for i, line in enumerate(lines):
            draw.text((220, top + i*30), line, fill="white" if i == 0 else (185, 196, 208), font=depth_eval.font(16 if i == 0 else 15))
    sheet.save(evaluation / "calibration.png")
    report_path=evaluation/'report.html'
    if report_path.exists():
        text=report_path.read_text(encoding='utf-8')
        text=re.sub(r'<section id="camera-audit">.*?</section>','',text,flags=re.S)
        section='<section id="camera-audit"><h2>第二阶段：自动相机与接地关系</h2><p>已统一透明边界、灰色背景及输入尺寸，并用 GeoCalib 视角场计算相机候选。统一输入解决的是预处理一致性，不等于真实相机标定已经正确。</p><p>现有深度仍缺少确定的基准；最低点候选对深度基准的变化敏感。因此未接受任何接地平面，也未生成候选阴影。</p><p><a href="calibration.json">完整标定结果与假设</a></p><img src="calibration.png" alt="相机与接地关系评估"></section>'
        report_path.write_text(text.replace('</html>',section+'</html>'),encoding='utf-8')
    print('Saved calibration.json and calibration.png', flush=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
