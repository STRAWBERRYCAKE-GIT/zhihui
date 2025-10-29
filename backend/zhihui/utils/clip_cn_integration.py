import os
from typing import List, Dict, Any, Tuple
from io import BytesIO

import torch
import torch.nn.functional as F
from PIL import Image
import numpy as np

import cn_clip.clip as clip
from cn_clip.clip import load_from_name, tokenize

from .dinov3_integration import detect_content_regions, detect_blank_spaces

_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
_model = None
_preprocess = None

def _model_path() -> str:
    # 计算本地 checkpoint 的绝对路径：backend/cn_clip_model/clip_cn_vit-b-16.pt
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    return os.path.join(base_dir, "cn_clip_model", "clip_cn_vit-b-16.pt")

def _load_cn_clip() -> Tuple[torch.nn.Module, Any]:
    global _model, _preprocess
    if _model is not None and _preprocess is not None:
        return _model, _preprocess

    ckpt = _model_path()
    # 通过 load_from_name 使用本地 ckpt，需要显式提供 vision/text 名称与输入分辨率
    model, preprocess = load_from_name(
        name=ckpt,
        device=_device,
        vision_model_name="ViT-B-16",
        text_model_name="RoBERTa-wwm-ext-base-chinese",
        input_resolution=224,
    )
    _model, _preprocess = model, preprocess
    return _model, _preprocess

def _crop_patch(image: Image.Image, cx: int, cy: int, size: int) -> Image.Image:
    w, h = image.size
    half = size // 2
    left = max(cx - half, 0)
    top = max(cy - half, 0)
    right = min(cx + half, w)
    bottom = min(cy + half, h)
    return image.crop((left, top, right, bottom))

def _nearest_blank(image_w: int, image_h: int, target_x: int, target_y: int, blanks: List[Dict[str, float]]) -> Dict[str, float]:
    if not blanks:
        # 无空白点时，退化为目标点附近
        return {"x": target_x, "y": target_y, "confidence": 0.0}

    best = None
    best_score = -1.0
    for b in blanks:
        bx, by = int(b.get("x", 0)), int(b.get("y", 0))
        conf = float(b.get("confidence", 0.0))
        # 距离越近、置信度越高越好
        dist = np.sqrt((bx - target_x) ** 2 + (by - target_y) ** 2) + 1e-6
        score = conf / dist
        if score > best_score:
            best_score = score
            best = {"x": bx, "y": by, "confidence": conf}
    return best if best is not None else {"x": target_x, "y": target_y, "confidence": 0.0}

# 顶部工具函数区域（新增：_refine_local_patch）
# 新增：局部细化与空白质量评估（顶层辅助函数）
def _refine_local_patch(image: Image.Image, model: torch.nn.Module, preprocess, cx: int, cy: int, text_feat: torch.Tensor, base_patch_size: int, local_patch_size: int = 128, stride: int = 64) -> Dict[str, float]:
    w, h = image.size
    half = local_patch_size // 2
    def clamp_center(x: int, y: int):
        return (max(half, min(w - half, x)), max(half, min(h - half, y)))
    candidates = []
    for dx in (-stride, 0, stride):
        for dy in (-stride, 0, stride):
            nx, ny = clamp_center(cx + dx, cy + dy)
            patch = _crop_patch(image, nx, ny, local_patch_size)
            tensor = preprocess(patch).unsqueeze(0).to(_device)
            with torch.no_grad():
                feat = model.encode_image(tensor)
                feat = feat / feat.norm(dim=-1, keepdim=True)
                sim = float((feat @ text_feat.T).squeeze().item())
            candidates.append((sim, nx, ny))
    if not candidates:
        return {"cx": cx, "cy": cy, "patch_size": base_patch_size, "sim": 0.0}
    best_sim, best_x, best_y = max(candidates, key=lambda t: t[0])
    return {"cx": best_x, "cy": best_y, "patch_size": local_patch_size, "sim": best_sim}

def _measure_blank_cluster(blank_points, x: int, y: int, radius: int) -> float:
    cx, cy = float(x), float(y)
    r2 = float(radius * radius)
    count = 0
    conf_sum = 0.0
    for b in blank_points:
        bx, by = float(b.get("x", 0)), float(b.get("y", 0))
        if (bx - cx) * (bx - cx) + (by - cy) * (by - cy) <= r2:
            count += 1
            conf_sum += float(b.get("confidence", 0.0))
    if count == 0:
        return 0.0
    return (conf_sum / max(count, 1)) * (1.0 + count / 10.0)

def _local_emptiness(gray_np: np.ndarray, x: int, y: int, win: int) -> float:
    h, w = gray_np.shape[:2]
    half = max(2, int(win // 2))
    left = max(0, x - half)
    right = min(w, x + half)
    top = max(0, y - half)
    bottom = min(h, y + half)
    patch = gray_np[top:bottom, left:right]
    if patch.size == 0:
        return 0.0
    std = float(np.std(patch))
    return 1.0 / (1.0 + std)

# 顶部工具函数区域（与 _nearest_blank 同级处新增）
def _generate_grid_centers(w: int, h: int, patch_size: int, stride: int, max_patches: int) -> List[Dict[str, float]]:
    centers = []
    half = patch_size // 2
    xs = list(range(half, max(w - half, half), max(stride, 1)))
    ys = list(range(half, max(h - half, half), max(stride, 1)))
    for cy in ys:
        for cx in xs:
            centers.append({"x": float(cx), "y": float(cy)})
    # 限制总量，均匀抽样
    if len(centers) > max_patches:
        step = max(1, len(centers) // max_patches)
        centers = centers[::step]
    return centers

# 函数：match_texts_to_image_blank_regions（统一稳健细化路径，移除提前 return）
def _nms(boxes: List[Dict], iou_thresh: float = 0.35) -> List[Dict]:
    def iou(a: Dict, b: Dict) -> float:
        ax1, ay1, aw, ah = a['x'], a['y'], a['width'], a['height']
        bx1, by1, bw, bh = b['x'], b['y'], b['width'], b['height']
        ax2, ay2 = ax1 + aw, ay1 + ah
        bx2, by2 = bx1 + bw, by1 + bh
        iw = max(0.0, min(ax2, bx2) - max(ax1, bx1))
        ih = max(0.0, min(ay2, by2) - max(ay1, by1))
        inter = iw * ih
        union = aw * ah + bw * bh - inter
        return inter / (union + 1e-9)
    selected = []
    boxes = sorted(boxes, key=lambda d: d.get('confidence', 0.0), reverse=True)
    for b in boxes:
        if all(iou(b, s) <= iou_thresh for s in selected):
            selected.append(b)
    return selected

def _grid_patches(image: Image.Image, grid_sizes: List[Tuple[int, int]]) -> List[Tuple[Image.Image, Dict]]:
    w, h = image.size
    patches = []
    for rows, cols in grid_sizes:
        cell_w = w / cols
        cell_h = h / rows
        for r in range(rows):
            for c in range(cols):
                x1 = int(c * cell_w)
                y1 = int(r * cell_h)
                x2 = int((c + 1) * cell_w)
                y2 = int((r + 1) * cell_h)
                patch = image.crop((x1, y1, x2, y2)).convert('RGB')
                # 归一化坐标与尺寸（0..1）
                patches.append((patch, {
                    'x': (x1 + x2) / 2 / w - ((x2 - x1) / (2 * w)),
                    'y': (y1 + y2) / 2 / h - ((y2 - y1) / (2 * h)),
                    'width': (x2 - x1) / w,
                    'height': (y2 - y1) / h,
                    'row': r, 'col': c, 'rows': rows, 'cols': cols
                }))
    return patches

def _compute_cn_clip_similarity(model: torch.nn.Module, preprocess, patch: Image.Image, phrase: str) -> float:
    # 统一的相似度计算函数，供网格或细化使用
    img = preprocess(patch).unsqueeze(0).to(_device)
    tokens = tokenize(phrase, context_length=52).to(_device)
    with torch.no_grad():
        img_feat = model.encode_image(img)
        img_feat = img_feat / img_feat.norm(dim=-1, keepdim=True)
        txt_feat = model.encode_text(tokens)
        txt_feat = txt_feat / txt_feat.norm(dim=-1, keepdim=True)
        sim = float((img_feat @ txt_feat.T).squeeze().item())
    return sim

def match_texts_to_image_blank_regions(
    image_stream,
    candidate_texts: List[str],
    max_candidates: int = 8,
    patch_size: int = 224
) -> Dict[str, Any]:
    """
    使用 CN-CLIP 将候选中文文本与图像进行匹配，
    统一采用：粗定位（批量编码） → 局部细化 → 动态矩形 + 贴边空白选择。
    保障：每个输入文本至少产出一个映射（不做相似度阈值删选）。
    返回：
      - text_region_mapping: [{ text, region: {x, y, width, height}, empty_region: {...}, confidence }]
      - content_regions: [{ x, y, width, height, confidence }]
      - empty_regions: [{ x, y, width, height, confidence }]
    """
    if not candidate_texts:
        return {"text_region_mapping": [], "content_regions": [], "empty_regions": []}

    # 打开图像
    image = Image.open(image_stream).convert("RGB")
    w, h = image.size
    image_stream.seek(0)

    # 加载模型与预处理
    model, preprocess = _load_cn_clip()
    model.eval()

    # 内容区域候选（用于生成图像局部 patch）
    content_points = detect_content_regions(image_stream, num_regions=max(len(candidate_texts), 5)) or []
    # 重置流，获取空白位置候选
    image_stream.seek(0)
    blank_points = detect_blank_spaces(image_stream, focus_on_content=False) or []
    gray_np = np.array(image.convert("L"))

    # 如果没内容点，使用中心点兜底
    if not content_points:
        content_points = [{"x": int(w * 0.5), "y": int(h * 0.5), "confidence": 1.0}]

    # 稀疏网格中心，增强候选 patch 集合
    grid_centers = _generate_grid_centers(
        w, h,
        patch_size=patch_size,
        stride=int(patch_size * 0.75),   # 约 25% 重叠
        max_patches=64                   # 控制算力
    )
    # 合并：内容点 + 稀疏网格（给网格一个较低置信度权重）
    merged_centers = [{"x": float(p["x"]), "y": float(p["y"]), "confidence": float(p.get("confidence", 0.5))} for p in content_points]
    merged_centers.extend([{"x": c["x"], "y": c["y"], "confidence": 0.5} for c in grid_centers])

    # 计算所有候选中心对应的图像特征（批量编码）
    image_feats = []
    patch_infos = []
    batch_tensors = []
    batch_infos = []
    batch_size = 32

    with torch.no_grad():
        for c in merged_centers:
            cx, cy = int(c["x"]), int(c["y"])
            patch = _crop_patch(image, cx, cy, patch_size)
            batch_tensors.append(preprocess(patch))
            batch_infos.append({"cx": cx, "cy": cy, "width": patch_size, "height": patch_size, "confidence": float(c["confidence"])})
            # 批次编码
            if len(batch_tensors) == batch_size:
                batch = torch.stack(batch_tensors, dim=0).to(_device)
                feats = model.encode_image(batch)
                feats = feats / feats.norm(dim=-1, keepdim=True)
                image_feats.append(feats)
                patch_infos.extend(batch_infos)
                batch_tensors, batch_infos = [], []

        # 处理残余批次
        if batch_tensors:
            batch = torch.stack(batch_tensors, dim=0).to(_device)
            feats = model.encode_image(batch)
            feats = feats / feats.norm(dim=-1, keepdim=True)
            image_feats.append(feats)
            patch_infos.extend(batch_infos)

        # 拼接为 [N, D]；无候选则兜底整图
        if image_feats:
            image_feats = torch.cat(image_feats, dim=0)
        else:
            tensor = preprocess(image).unsqueeze(0).to(_device)
            feat = model.encode_image(tensor)
            feat = feat / feat.norm(dim=-1, keepdim=True)
            image_feats = feat
            patch_infos = [{"cx": int(w * 0.5), "cy": int(h * 0.5), "width": patch_size, "height": patch_size, "confidence": 1.0}]

    # 为每个文本找到最佳匹配 patch，并选择最近空白点作为气泡位置
    mappings: List[Dict[str, Any]] = []
    content_regions_out: List[Dict[str, Any]] = []
    empty_regions_out: List[Dict[str, Any]] = []

    # 在 match_texts_to_image_blank_regions() 的循环里加入细化并用细化结果重算 region/empty_region
    with torch.no_grad():
        for text in candidate_texts[:max_candidates]:
            tokens = tokenize(text, context_length=52).to(_device)
            text_feat = model.encode_text(tokens)
            text_feat = text_feat / text_feat.norm(dim=-1, keepdim=True)

            sims = (image_feats @ text_feat.T).squeeze(dim=1)
            best_idx = int(torch.argmax(sims).item())
            best_sim = float(sims[best_idx].item())

            # 粗定位中心
            best_patch = patch_infos[best_idx]
            coarse_cx, coarse_cy = best_patch["cx"], best_patch["cy"]

            # 二阶段细化：更小patch + 更密stride
            refine = _refine_local_patch(
                image, model, preprocess,
                coarse_cx, coarse_cy, text_feat,
                base_patch_size=patch_size,
                local_patch_size=int(patch_size * 0.6),
                stride=int(patch_size * 0.3)
            )
            cx, cy = refine["cx"], refine["cy"]
            pw, ph = int(refine["patch_size"]), int(refine["patch_size"])
            best_sim = max(best_sim, float(refine["sim"]))

            # 空白点：贴边 + 空白质量优先
            def _edge_biased_blank(blank_points: List[Dict[str, float]], cx: int, cy: int, patch_size: int, gray_np: np.ndarray) -> Dict[str, float]:
                if not blank_points:
                    return {"x": cx, "y": cy, "confidence": 0.0, "quality": 0.0}
                min_r = max(8, int(patch_size * 0.4))
                max_r = int(patch_size * 1.5)
                best, best_score = None, -1.0
                for b in blank_points:
                    bx, by = int(b.get("x", 0)), int(b.get("y", 0))
                    conf = float(b.get("confidence", 0.0))
                    dist = np.hypot(bx - cx, by - cy) + 1e-6
                    if min_r <= dist <= max_r:
                        cluster = _measure_blank_cluster(blank_points, bx, by, radius=int(patch_size * 0.6))
                        emptiness = _local_emptiness(gray_np, bx, by, win=int(patch_size * 0.4))
                        quality = (0.4 * conf + 0.3 * emptiness + 0.3 * cluster)
                        score = quality / dist
                        if score > best_score:
                            best_score = score
                            best = {"x": bx, "y": by, "confidence": conf, "quality": float(quality)}
                return best if best is not None else {"x": cx, "y": cy, "confidence": 0.0, "quality": 0.0}

            edge_blank = _edge_biased_blank(blank_points, cx, cy, pw, gray_np)
            nearest_blank = edge_blank if edge_blank else _nearest_blank(w, h, cx, cy, blank_points)

            # 用细化后的中心与尺寸重算内容矩形与空白矩形（动态尺寸）
            left = max(0, cx - pw // 2)
            top = max(0, cy - ph // 2)
            rect_w = min(pw, w - left)
            rect_h = min(ph, h - top)
            region_norm = {
                "x": max(0.0, min(1.0, left / float(w))),
                "y": max(0.0, min(1.0, top / float(h))),
                "width": max(0.0, min(1.0, rect_w / float(w))),
                "height": max(0.0, min(1.0, rect_h / float(h))),
            }

            blank_quality = float(nearest_blank.get("quality", 0.0))
            scale_w = 0.6 + 0.5 * max(0.0, min(1.0, blank_quality))
            scale_h = 0.5 + 0.5 * max(0.0, min(1.0, blank_quality))
            blank_rect_w = int(pw * scale_w)
            blank_rect_h = int(ph * scale_h)
            blank_left = max(0, int(nearest_blank["x"]) - blank_rect_w // 2)
            blank_top = max(0, int(nearest_blank["y"]) - blank_rect_h // 2)
            blank_w = min(blank_rect_w, w - blank_left)
            blank_h = min(blank_rect_h, h - blank_top)
            empty_region_norm = {
                "x": max(0.0, min(1.0, blank_left / float(w))),
                "y": max(0.0, min(1.0, blank_top / float(h))),
                "width": max(0.0, min(1.0, blank_w / float(w))),
                "height": max(0.0, min(1.0, blank_h / float(h))),
            }

            mappings.append({
                "text": text,
                "region": region_norm,
                "empty_region": empty_region_norm,
                "confidence": best_sim,                              # 使用细化后的高相似度（不做阈值过滤）
                "content_conf": float(best_patch["confidence"]),
                "empty_conf": float(nearest_blank.get("confidence", 0.0)),
            })

            content_regions_out.append({
                "x": cx, "y": cy, "width": pw, "height": ph,
                "confidence": float(best_patch["confidence"])
            })
            empty_regions_out.append({
                "x": int(nearest_blank["x"]),
                "y": int(nearest_blank["y"]),
                "width": blank_rect_w,
                "height": blank_rect_h,
                "confidence": float(nearest_blank.get("confidence", 0.0))
            })

    return {
        "text_region_mapping": mappings,
        "content_regions": content_regions_out,
        "empty_regions": empty_regions_out
    }