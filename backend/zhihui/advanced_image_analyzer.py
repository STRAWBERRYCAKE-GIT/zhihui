from typing import Optional, List, Dict, Tuple
import math
from PIL import Image

# 统一的适配层（支持 CN-CLIP / HF 中文版 / 英文 CLIP）
from zhihui.clip_adapter import CLIPAdapter


class AdvancedImageAnalyzer:
    def __init__(self, backend_preference: Optional[str] = None, device: Optional[str] = None):
        """
        初始化图像分析器，绑定 CLIP 适配层。
        backend_preference: 'cn_clip' | 'hf_cn_clip' | 'openai_clip' 或 None（自动选择）
        device: 'cuda' | 'cpu' 或 None（适配层自动决定）
        """
        self.clip = CLIPAdapter(backend_preference=backend_preference, device=device)

    # =========================
    # 文本预处理（轻量）
    # =========================
    def preprocess_text_for_clip(self, text: str) -> str:
        """
        针对整段文本的轻量预处理。此处保持最小改动，避免过度模板化影响阈值判断。
        """
        if not text:
            return ""
        return text.strip()

    def preprocess_phrase_for_clip(self, phrase: str) -> str:
        """
        针对短语的轻量预处理，保持语义清晰且不过度修改原始词面。
        """
        if not phrase:
            return ""
        phrase = phrase.strip()
        # 可选：为泛化提升，加入极简上下文。若不需要可直接返回原始短语。
        return phrase

    # =========================
    # 网格与裁剪工具
    # =========================
    def _grid_size_to_cells(self, grid_size: Tuple[int, int]) -> Tuple[int, int]:
        rows, cols = grid_size
        rows = max(1, int(rows))
        cols = max(1, int(cols))
        return rows, cols

    def _iter_grid_patches(self, image: Image.Image, grid_size: Tuple[int, int]):
        """
        将图像切分为 grid_size 网格，迭代返回每个 patch 及其区域信息。
        区域信息采用归一化坐标：[0,1] 的 x/y/w/h（x/y 为左上角）。
        同时返回 grid 行列索引。
        """
        rows, cols = self._grid_size_to_cells(grid_size)
        width, height = image.size

        cell_w = width // cols
        cell_h = height // rows

        for r in range(rows):
            for c in range(cols):
                left = c * cell_w
                top = r * cell_h
                right = width if c == cols - 1 else (left + cell_w)
                bottom = height if r == rows - 1 else (top + cell_h)

                patch = image.crop((left, top, right, bottom))

                region = {
                    "x": left / max(width, 1),
                    "y": top / max(height, 1),
                    "w": (right - left) / max(width, 1),
                    "h": (bottom - top) / max(height, 1),
                    "row": r,
                    "col": c,
                }
                yield patch, region

    # =========================
    # 整段文本映射（保留）
    # =========================
    def analyze_text_region_mapping(self, image: Image.Image, text: str, grid_size: Tuple[int, int] = (12, 12)):
        """
        针对整段文本，返回与图像网格中最相关的区域（按相似度排序）。
        不做 is_global 判定，不进行阈值过滤（调用方可自行按需要过滤）。
        """
        text_proc = self.preprocess_text_for_clip(text)
        if not text_proc:
            return []

        candidates: List[Dict] = []
        for patch, region in self._iter_grid_patches(image, grid_size):
            try:
                score = float(self.clip.compute_similarity(image=patch, text=text_proc))
            except Exception as e:
                # 单个 patch 失败不影响整体
                print(f"[CLIP] text-region similarity failed at row/col {region.get('row')}/{region.get('col')}: {e}")
                continue

            candidates.append({
                "text": text,
                "confidence": score,
                "region": region,
                "grid_size": {"rows": grid_size[0], "cols": grid_size[1]},
            })

        # 按置信度从高到低排序
        candidates.sort(key=lambda m: m.get("confidence", 0.0), reverse=True)
        return candidates

    # =========================
    # 短语区域映射（核心）
    # =========================
    def analyze_phrase_region_mapping(self, image: Image.Image, phrases: List[str], grid_size: Tuple[int, int] = (12, 12)):
        threshold = 0.35
        mappings: List[Dict] = []

        if not phrases or image is None:
            return mappings

        for phrase in phrases:
            phrase_proc = self.preprocess_phrase_for_clip(phrase)
            if not phrase_proc:
                continue

            similarities: List[Tuple[float, Dict]] = []
            for patch, region in self._iter_grid_patches(image, grid_size):
                try:
                    score = float(self.clip.compute_similarity(image=patch, text=phrase_proc))
                except Exception as e:
                    print(f"[CLIP] phrase-region similarity failed at row/col {region.get('row')}/{region.get('col')}: {e}")
                    score = 0.0

                similarities.append((score, region))

            if not similarities:
                continue

            # 选择该短语的 Top1 区域
            similarities.sort(key=lambda x: x[0], reverse=True)
            top_score, top_region = similarities[0]

            # 仅按置信度是否达到阈值决定是否返回
            if top_score >= threshold:
                mappings.append({
                    "phrase": phrase,
                    "confidence": top_score,
                    "region": top_region,
                    "grid_size": {"rows": grid_size[0], "cols": grid_size[1]},
                    "is_global": False  # 兼容旧前端：保留字段但不参与过滤
                })

        # 结果按置信度从高到低排序，便于前端渲染
        mappings.sort(key=lambda m: m.get("confidence", 0.0), reverse=True)
        return mappings

    # =========================
    # is_global 判定（保留但不参与过滤）
    # 如果后续需要恢复全局/局部判定，可以直接复用。
    # =========================
    def is_global_by_clip_distribution(self,
                                       similarities: List[Tuple[float, Dict]],
                                       entropy_threshold: float = 0.92,
                                       dominance_threshold: float = 1.2,
                                       gap_threshold: float = 0.03,
                                       strong_score_threshold: float = 0.5) -> bool:
        """
        基于 CLIP 相似度在图像网格上的空间分布，自动判定全局/局部描述。
        当前业务未使用该判定结果。本方法保留以备后续需要。
        """
        if not similarities or len(similarities) < 2:
            return True

        top_k = min(20, len(similarities))
        sims_sorted = sorted(similarities, key=lambda x: x[0], reverse=True)[:top_k]
        scores = [max(0.0, s) for s, _ in sims_sorted]
        total = sum(scores)
        if total <= 0:
            return True

        p = [s / total for s in scores]
        H = -sum(pi * math.log(pi + 1e-12) for pi in p)
        H_norm = H / math.log(len(p))

        sorted_scores = sorted(scores, reverse=True)
        top1 = sorted_scores[0]
        top2 = sorted_scores[1]
        avg = total / len(scores)
        dominance = top1 / max(avg, 1e-6)
        top_gap = top1 - top2

        top5_mean = sum(sorted_scores[:5]) / min(5, len(sorted_scores))
        peak_ratio = top1 / max(top5_mean, 1e-6)

        coords = [reg for _, reg in sims_sorted]
        xs = [c['x'] for c in coords]
        ys = [c['y'] for c in coords]
        x_span = max(xs) - min(xs) if xs else 1.0
        y_span = max(ys) - min(ys) if ys else 1.0
        radius = 0.15 * min(x_span, y_span)
        top1_coord = coords[0] if coords else {'x': 0, 'y': 0}

        def is_neighbor(c):
            dx = c['x'] - top1_coord['x']
            dy = c['y'] - top1_coord['y']
            return (dx * dx + dy * dy) ** 0.5 <= radius

        neighbor_count = sum(1 for c in coords[1:5] if is_neighbor(c))

        if (top1 >= strong_score_threshold) and (
            peak_ratio >= 1.15 or dominance >= 1.2 or (top_gap >= gap_threshold and neighbor_count >= 2)
        ):
            return False

        if H_norm > entropy_threshold or dominance < 1.1:
            return True

        if H_norm < 0.8 and top_gap > gap_threshold and peak_ratio >= 1.2:
            return False

        if neighbor_count >= 2 and peak_ratio >= 1.1:
            return False

        return True

    # =========================
    # 关键词提取（保留）
    # =========================
    def extract_keywords(self, text: str) -> List[str]:
        """
        简单的关键词提取占位方法。
        真实项目可接入分词/词性标注模型，这里保留以兼容可能调用。
        """
        if not text:
            return []
        # 以空格/常见分隔符拆分，保留非空项
        raw = [t.strip() for t in text.replace("，", " ").replace("。", " ").replace(",", " ").split(" ")]
        return [t for t in raw if t]