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

# 函数：match_texts_to_image_blank_regions（返回短句级映射，融合DINO空白点）
def match_texts_to_image_blank_regions(
    image_stream: BytesIO,
    candidate_texts: List[str],
    max_candidates: int = 8,
    patch_size: int = 224
) -> Dict[str, Any]:
    """
    使用 CN-CLIP 将候选中文文本与图像进行匹配，
    为每个文本找到对应内容位置，并选择附近空白位置作为气泡位置。
    返回：
      - text_region_mapping: [{ text, region: {x, y}, confidence }]
        其中 region 为归一化坐标（0..1），表示空白位置，用于前端气泡贴近空白区域
      - content_regions: [{ x, y, width, height, confidence }]
      - empty_regions: [{ x, y, width, height, confidence }]
    """
    if not candidate_texts:
        return {"text_region_mapping": [], "content_regions": [], "empty_regions": []}

    # 打开图像
    image = Image.open(image_stream).convert("RGB")
    w, h = image.size
    # 重置流供后续 DINOv3 函数使用
    image_stream.seek(0)

    # 加载模型与预处理
    model, preprocess = _load_cn_clip()
    model.eval()

    # 内容区域候选（用于生成图像局部 patch）
    content_points = detect_content_regions(image_stream, num_regions=max(len(candidate_texts), 5)) or []
    # 重置流，获取空白位置候选
    image_stream.seek(0)
    blank_points = detect_blank_spaces(image_stream, focus_on_content=False) or []

    # 如果没有内容点，使用中心点兜底
    if not content_points:
        content_points = [{"x": int(w * 0.5), "y": int(h * 0.5), "confidence": 1.0}]

    # 计算所有内容点对应的图像特征
    image_feats = []
    patch_infos = []  # 保存每个 patch 的中心与边框
    with torch.no_grad():
        for p in content_points:
            cx, cy = int(p.get("x", w // 2)), int(p.get("y", h // 2))
            patch = _crop_patch(image, cx, cy, patch_size)
            tensor = preprocess(patch).unsqueeze(0).to(_device)
            feat = model.encode_image(tensor)
            # 归一化
            feat = feat / feat.norm(dim=-1, keepdim=True)
            image_feats.append(feat)
            patch_infos.append({"cx": cx, "cy": cy, "width": patch_size, "height": patch_size, "confidence": float(p.get("confidence", 0.0))})
        if image_feats:
            image_feats = torch.cat(image_feats, dim=0)  # [N, D]
        else:
            # 没有 patch 时兜底使用整图
            tensor = preprocess(image).unsqueeze(0).to(_device)
            feat = model.encode_image(tensor)
            feat = feat / feat.norm(dim=-1, keepdim=True)
            image_feats = feat
            patch_infos = [{"cx": int(w * 0.5), "cy": int(h * 0.5), "width": patch_size, "height": patch_size, "confidence": 1.0}]

    # 为每个文本找到最佳匹配 patch，并选择最近空白点作为气泡位置
    mappings: List[Dict[str, Any]] = []
    content_regions_out: List[Dict[str, Any]] = []
    empty_regions_out: List[Dict[str, Any]] = []

    with torch.no_grad():
        for text in candidate_texts[:max_candidates]:
            tokens = tokenize(text, context_length=52).to(_device)
            text_feat = model.encode_text(tokens)
            text_feat = text_feat / text_feat.norm(dim=-1, keepdim=True)

            sims = (image_feats @ text_feat.T).squeeze(dim=1)
            best_idx = int(torch.argmax(sims).item())
            best_sim = float(sims[best_idx].item())

            # 在文件顶部新增一个“贴边优先”的空白点选择函数
            def _edge_biased_blank(blank_points: List[Dict[str, float]], cx: int, cy: int, patch_size: int) -> Dict[str, float]:
                if not blank_points:
                    return {"x": cx, "y": cy, "confidence": 0.0}
                # 目标：优先选择距离内容patch边缘附近的空白点（避免在主体上）
                min_r = max(8, int(patch_size * 0.4))
                max_r = int(patch_size * 1.5)
                best, best_score = None, -1.0
                for b in blank_points:
                    bx, by = int(b.get("x", 0)), int(b.get("y", 0))
                    conf = float(b.get("confidence", 0.0))
                    dist = np.sqrt((bx - cx) ** 2 + (by - cy) ** 2) + 1e-6
                    if min_r <= dist <= max_r:
                        score = conf / dist  # 距近优先，带置信度权重
                        if score > best_score:
                            best_score = score
                            best = {"x": bx, "y": by, "confidence": conf}
                return best if best is not None else {"x": cx, "y": cy, "confidence": 0.0}
            # 在 match_texts_to_image_blank_regions() 的循环里使用贴边优先的空白点
            best_patch = patch_infos[best_idx]
            cx, cy = best_patch["cx"], best_patch["cy"]
            pw, ph = best_patch["width"], best_patch["height"]
            # 选择距离patch边缘附近的空白点（更贴近描述部位而不遮挡）
            edge_blank = _edge_biased_blank(blank_points, cx, cy, patch_size)
            nearest_blank = edge_blank if edge_blank else _nearest_blank(w, h, cx, cy, blank_points)

            # 归一化内容矩形（用于NMS与前端中心点计算）
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

            # 归一化空白矩形（供需要时展示或参考）
            blank_rect_w = int(patch_size * 0.8)
            blank_rect_h = int(patch_size * 0.6)
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

            # 映射项：保留分解分数，最终融合在api层
            mappings.append({
                "text": text,
                "region": region_norm,                 # 内容矩形（归一化）
                "empty_region": empty_region_norm,     # 空白矩形（归一化）
                "confidence": best_sim,                # 原始CN‑CLIP相似度
                "content_conf": float(best_patch["confidence"]),     # DINO内容置信
                "empty_conf": float(nearest_blank["confidence"]),    # DINO空白置信
            })

            # 额外输出像素坐标的参考区域（可选）
            content_regions_out.append({
                "x": cx, "y": cy, "width": pw, "height": ph,
                "confidence": float(best_patch["confidence"])
            })
            empty_regions_out.append({
                "x": int(nearest_blank["x"]),
                "y": int(nearest_blank["y"]),
                "width": blank_rect_w,
                "height": blank_rect_h,
                "confidence": float(nearest_blank["confidence"])
            })

    return {
        "text_region_mapping": mappings,
        "content_regions": content_regions_out,
        "empty_regions": empty_regions_out
    }