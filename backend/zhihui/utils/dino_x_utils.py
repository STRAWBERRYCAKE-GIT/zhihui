import cv2
import numpy as np
from pycocotools import mask as coco_mask

# 预定义颜色列表（BGR），7种对比明显的颜色
PREDEFINED_COLORS = [
    (0, 0, 255),     # 红色
    (255, 0, 0),     # 蓝色
    (0, 255, 255),   # 黄色
    (255, 0, 255),   # 品红
    (0, 255, 0),     # 绿色
    (255, 255, 0),   # 青色
    (128, 0, 255),   # 紫色
]
BACKGROUND_COLOR = (200, 255, 200)  # 浅绿色

def decode_rle(rle_dict):
    """
    解码 COCO RLE 掩码
    rle_dict: {"counts": str, "size": [height, width], "format": "coco_rle"}
    返回 numpy 数组 (height, width)，值 0/1
    """
    if 'counts' not in rle_dict or 'size' not in rle_dict:
        raise ValueError("RLE dict missing required keys")
    # pycocotools 要求 counts 是 bytes
    counts = rle_dict['counts']
    if isinstance(counts, str):
        counts = counts.encode('utf-8')
    rle = {'counts': counts, 'size': rle_dict['size']}
    return coco_mask.decode(rle)  # 返回 (h, w) 的 0/1 数组

def draw_masks_overlay(image_path, detections, output_path, alpha=0.5, draw_label=True):
    """
    在原图上叠加多个物体的掩码，每个物体不同颜色，并可选绘制标签
    image_path: 原图路径
    detections: list of dict，每个包含 'mask' (numpy 0/1), 'category'
    output_path: 保存路径
    alpha: 掩码透明度
    draw_label: 是否绘制类别文字
    """
    img = cv2.imread(image_path)
    if img is None:
        print(f"无法读取图片: {image_path}")
        return
    overlay = img.copy()

    idx = 0
    color_map = {}
    for det in detections:
        category = det.get('category', 'unknown')
        if category == 'background':
            color_map[category] = BACKGROUND_COLOR
        elif category not in color_map:
            color_map[category] = PREDEFINED_COLORS[idx]
            idx = (idx + 1) % len(PREDEFINED_COLORS)

    for det in detections:
        mask = det.get('mask')
        if mask is None:
            continue
        category = det.get('category', 'unknown')
        color = color_map.get(category, (255, 255, 255))
        # 将掩码区域涂上颜色
        colored_mask = np.zeros_like(img, dtype=np.uint8)
        colored_mask[mask == 1] = color
        mask_3ch = np.stack([mask]*3, axis=-1)  # 转为三通道掩码
        overlay = np.where(
            mask_3ch == 1,
            cv2.addWeighted(overlay, 1-alpha, colored_mask, alpha, 0),
            overlay
        )

    if draw_label:
        # 存储已放置的标签矩形 (x1, y1, x2, y2)
        placed_rects = []
        # 为每个检测生成标签信息
        labels_info = []

        for det in detections: 
            mask = det.get('mask')
            if mask is None:
                continue
            category = det.get('category', 'unknown')
            color = color_map.get(category, (255, 255, 255))
            ys, xs = np.where(mask == 1)
            if len(ys) == 0:
                continue
            cx, cy = xs[len(xs)//2], ys[len(ys)//2]  # 取掩码中心点作为标签位置
            text = category
            labels_info.append((cx, cy, text, color))

        for cx, cy, text, color in labels_info:
            # 绘制文字背景和标签
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 1
            thickness = 1
            (tw, th), _ = cv2.getTextSize(text, font, font_scale, thickness)
            # 标签矩形（文字 + 内边距）
            pad = 3
            rect_w = tw + 2 * pad
            rect_h = th + 2 * pad
            
            offset_x, offset_y = 0, 0
            candidate_x = cx + offset_x
            candidate_y = cy + offset_y
            # 碰撞检测并尝试移动
            max_attempts = 20
            for _ in range(max_attempts):
                rect = (candidate_x, candidate_y, candidate_x + rect_w, candidate_y + rect_h)
                # 检查是否与已放置矩形重叠
                overlap = False
                for (x1, y1, x2, y2) in placed_rects:
                    if not (rect[2] < x1 or rect[0] > x2 or rect[3] < y1 or rect[1] > y2):
                        overlap = True
                        break
                if not overlap:
                    placed_rects.append(rect)
                    break
                #移动
                offset_x += 5
                offset_y += 5
                candidate_x = cx + offset_x
                candidate_y = cy + offset_y

            # 绘制背景和文字
            cv2.rectangle(overlay, (candidate_x, candidate_y),
                        (candidate_x + rect_w, candidate_y + rect_h),
                        (0, 0, 0), -1)
            cv2.rectangle(overlay, (candidate_x, candidate_y),
                        (candidate_x + rect_w, candidate_y + rect_h),
                        color, 2)
            cv2.putText(overlay, text, (candidate_x + pad, candidate_y + th + pad),
                        font, font_scale, (255, 255, 255), thickness)
    cv2.imwrite(output_path, overlay)
    print(f"掩码叠加图已保存: {output_path}")

def draw_anchors_on_image(image_path, anchors, output_path):
    """
    在原图上绘制锚点（红色圆点）
    anchors: dict {keyword: (norm_x, norm_y)}
    """
    img = cv2.imread(image_path)
    if img is None:
        print(f"无法读取图片: {image_path}")
        return
    h, w = img.shape[:2]
    for keyword, (norm_x, norm_y) in anchors.items():
        px = int(norm_x * w)
        py = int(norm_y * h)
        cv2.circle(img, (px, py), 6, (0, 0, 255), -1)
        cv2.putText(img, keyword, (px + 8, py - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
    cv2.imwrite(output_path, img)
    print(f"锚点可视化已保存: {output_path}")