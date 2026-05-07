import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

# -------------------- 工具函数 --------------------
def compute_integral_map(mask):
    """计算二值掩码的积分图，返回uint64前缀和数组"""
    integral = np.pad(mask, ((1, 0), (1, 0)), constant_values=0).astype(np.uint64).cumsum(axis=0).cumsum(axis=1)
    return integral

def sum_in_rect(integral, y1, x1, y2, x2):
    """积分图矩形区域求和，[y1:y2, x1:x2]"""
    return integral[y2, x2] - integral[y1, x2] - integral[y2, x1] + integral[y1, x1]

def segments_intersect(p1, p2, q1, q2):
    """判断线段 p1-p2 与 q1-q2 是否相交（含端点）"""
    def cross(a, b, c):
        return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])
    def on_segment(p, a, b):
        return min(a[0],b[0]) <= p[0] <= max(a[0],b[0]) and min(a[1],b[1]) <= p[1] <= max(a[1],b[1])
    d1 = cross(p1, p2, q1)
    d2 = cross(p1, p2, q2)
    d3 = cross(q1, q2, p1)
    d4 = cross(q1, q2, p2)
    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
       ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True
    if d1 == 0 and on_segment(q1, p1, p2): return True
    if d2 == 0 and on_segment(q2, p1, p2): return True
    if d3 == 0 and on_segment(p1, q1, q2): return True
    if d4 == 0 and on_segment(p2, q1, q2): return True
    return False

def get_text_size(text, font):
    """估算文本单行渲染尺寸 (width, height)"""
    bbox = font.getbbox(text)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]

def wrap_text_precise(text, font, max_width):
    """
    按像素宽度将文本自动换行，返回行列表。
    逐字符累加，一旦超过 max_width 就折行。
    """
    lines = []
    current_line = ""
    for char in text:
        test_line = current_line + char
        if font.getlength(test_line) <= max_width:
            current_line = test_line
        else:
            if current_line:
                lines.append(current_line)
            current_line = char
    if current_line:
        lines.append(current_line)
    return lines

def rect_overlap(rect1, rect2):
    """矩形是否重叠 (x, y, w, h)"""
    x1, y1, w1, h1 = rect1
    x2, y2, w2, h2 = rect2
    return not (x1 + w1 <= x2 or x2 + w2 <= x1 or y1 + h1 <= y2 or y2 + h2 <= y1)

def segment_intersects_rect(p1, p2, rect):
    """判断线段 p1->p2 是否与矩形相交（含端点在内）"""
    x, y, w, h = rect
    # 快速排斥
    if (max(p1[0], p2[0]) < x or min(p1[0], p2[0]) > x + w or
        max(p1[1], p2[1]) < y or min(p1[1], p2[1]) > y + h):
        return False
    # 精确检测：若任一端点在矩形内则相交
    if (x <= p1[0] <= x + w and y <= p1[1] <= y + h) or \
       (x <= p2[0] <= x + w and y <= p2[1] <= y + h):
        return True
    # 线段与矩形四条边相交检测
    def cross(a, b, c):
        return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])
    def on_segment(p, a, b):
        return min(a[0],b[0]) <= p[0] <= max(a[0],b[0]) and min(a[1],b[1]) <= p[1] <= max(a[1],b[1])
    edges = [
        ((x, y), (x + w, y)),
        ((x + w, y), (x + w, y + h)),
        ((x + w, y + h), (x, y + h)),
        ((x, y + h), (x, y))
    ]
    for e1, e2 in edges:
        d1 = cross(p1, p2, e1)
        d2 = cross(p1, p2, e2)
        d3 = cross(e1, e2, p1)
        d4 = cross(e1, e2, p2)
        if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
           ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
            return True
        if d1 == 0 and on_segment(e1, p1, p2): return True
        if d2 == 0 and on_segment(e2, p1, p2): return True
        if d3 == 0 and on_segment(p1, e1, e2): return True
        if d4 == 0 and on_segment(p2, e1, e2): return True
    return False

def draw_dashed_line(draw, start, end, dash_length=8, gap_length=6, **kwargs):
    """在两点之间绘制虚线"""
    x1, y1 = start
    x2, y2 = end
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    if length == 0:
        return
    ux, uy = dx / length, dy / length
    pos = 0.0
    while pos < length:
        seg_end = min(pos + dash_length, length)
        sx = x1 + ux * pos
        sy = y1 + uy * pos
        ex = x1 + ux * seg_end
        ey = y1 + uy * seg_end
        draw.line([(sx, sy), (ex, ey)], **kwargs)
        pos += dash_length + gap_length

# -------------------- 圆角矩形辅助 --------------------
def draw_rounded_rectangle(draw, xy, radius=8, fill=None, outline=None, width=1):
    """在 Pillow 上绘制圆角矩形，兼容不支持 rounded_rectangle 的版本"""
    if hasattr(draw, 'rounded_rectangle'):
        draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)
        return
    # 手动绘制
    x1, y1, x2, y2 = xy
    r = min(radius, (x2-x1)//2, (y2-y1)//2)
    # 填充
    if fill:
        draw.rectangle([x1+r, y1, x2-r, y2], fill=fill)
        draw.rectangle([x1, y1+r, x2, y2-r], fill=fill)
        draw.pieslice([x1, y1, x1+2*r, y1+2*r], 180, 270, fill=fill)
        draw.pieslice([x2-2*r, y1, x2, y1+2*r], 270, 360, fill=fill)
        draw.pieslice([x1, y2-2*r, x1+2*r, y2], 90, 180, fill=fill)
        draw.pieslice([x2-2*r, y2-2*r, x2, y2], 0, 90, fill=fill)
    # 轮廓
    if outline:
        # 简化：只画弧线
        draw.arc([x1, y1, x1+2*r, y1+2*r], 180, 270, fill=outline, width=width)
        draw.arc([x2-2*r, y1, x2, y1+2*r], 270, 360, fill=outline, width=width)
        draw.arc([x1, y2-2*r, x1+2*r, y2], 90, 180, fill=outline, width=width)
        draw.arc([x2-2*r, y2-2*r, x2, y2], 0, 90, fill=outline, width=width)
        draw.line([x1+r, y1, x2-r, y1], fill=outline, width=width)
        draw.line([x1+r, y2, x2-r, y2], fill=outline, width=width)
        draw.line([x1, y1+r, x1, y2-r], fill=outline, width=width)
        draw.line([x2, y1+r, x2, y2-r], fill=outline, width=width)

# -------------------- 布局核心 --------------------

# def layout_annotations(image_size, detections, comments, font_path, background_mask=None):
#     """
#     返回每个标注的布局信息，文本框支持根据空白区域形状自适应宽高（固定字号20）。
#     :param image_size: (W, H)
#     :param detections: Grounding DINO 检测结果列表，每项含 'bbox','mask','category'
#     :param comments: 对应评语字符串列表
#     :param font_path: 字体路径
#     :param background_mask: (H,W) 二值掩码，背景为1，若为 None 则全图为背景
#     :return: 列表，每项含 'anchor','text_pos','text_rect','comment','wrapped_lines','font_size'
#     """
#     W, H = image_size
#     pad = 10                     # 文本框内边距
#     font_size = 20               # 固定字号
#     font = ImageFont.truetype(font_path, font_size)
#     line_height = font.size + 4
#     min_bg_ratio = 0.5           # 至少 50% 区域在背景上
#     max_fg_overlap = 0.15        # 最多遮挡主体 15%
#     edge_margin = 10             # 离图像边缘最小距离

#     # 预处理掩码
#     fg_union_mask = np.zeros((H, W), dtype=np.uint8)
#     fg_detections = [d for d in detections if d.get('category') != 'background']
#     for d in fg_detections:
#         mask = d.get('mask')
#         if mask is not None:
#             fg_union_mask = np.logical_or(fg_union_mask, mask).astype(np.uint8)
#     if background_mask is None:
#         bg_mask = np.ones((H, W), dtype=np.uint8)
#     else:
#         bg_mask = background_mask.astype(np.uint8)

#     placed = []   # 存储 {(text_rect), anchor, line}  用于防冲突
#     results = []

#     for i, det in enumerate(fg_detections):
#         # ---- 确定锚点 ----
#         mask = det.get('mask')
#         bbox = det.get('bbox', [0,0,0,0])
#         anchor = None
#         if mask is not None and mask.any():
#             ys, xs = np.where(mask > 0)
#             if len(ys) > 0:
#                 img_center = np.array([W/2, H/2])
#                 points = np.column_stack((xs, ys))
#                 dists = np.linalg.norm(points - img_center, axis=1)
#                 nearest_idx = np.argmin(dists)
#                 anchor = (int(xs[nearest_idx]), int(ys[nearest_idx]))
#         if anchor is None:
#             if len(bbox) == 4:
#                 x1, y1, x2, y2 = bbox
#                 anchor = (int((x1+x2)/2), int((y1+y2)/2))
#             else:
#                 anchor = (W//2, H//2)

#         comment = comments[i]

#         # ---- 生成候选文本框尺寸（固定字号，多种宽度） ----
#         max_text_widths = [
#             int(W * 0.45) - 2*pad,   # 宽
#             int(W * 0.35) - 2*pad,   # 中
#             int(W * 0.25) - 2*pad,   # 窄
#             int(W * 0.18) - 2*pad    # 极窄（备用）
#         ]
#         best_placement = None
#         best_score = -1e9

#         for tw_limit in max_text_widths:
#             wrapped = wrap_text_precise(comment, font, tw_limit)
#             if not wrapped:
#                 wrapped = [" "]
#             text_w_px = int(max(font.getlength(line) for line in wrapped))
#             tw = text_w_px + 2 * pad
#             th = len(wrapped) * line_height + 2 * pad

#             # ---- 在背景区域内搜索候选位置 ----
#             grid_step = max(15, min(W, H) // 30)
#             x_starts = range(edge_margin, max(edge_margin+1, W - tw - edge_margin), grid_step)
#             y_starts = range(edge_margin, max(edge_margin+1, H - th - edge_margin), grid_step)
#             candidates = []
#             for x in x_starts:
#                 for y in y_starts:
#                     # 计算背景覆盖率
#                     if y+th > H or x+tw > W:
#                         continue
#                     crop_bg = bg_mask[y:y+th, x:x+tw]
#                     bg_ratio = np.sum(crop_bg) / (tw*th) if tw*th>0 else 0
#                     if bg_ratio < min_bg_ratio:
#                         continue
#                     # 前景遮挡率
#                     crop_fg = fg_union_mask[y:y+th, x:x+tw]
#                     fg_overlap_ratio = np.sum(crop_fg) / (tw*th)
#                     if fg_overlap_ratio > max_fg_overlap:
#                         continue
#                     candidates.append((x, y, bg_ratio, fg_overlap_ratio))

#             # 按背景覆盖率排序，取前若干候选
#             candidates.sort(key=lambda c: c[2] - c[3], reverse=True)
#             for (x, y, bg_r, fg_r) in candidates[:80]:
#                 rect = (x, y, tw, th)
#                 # 与其他已放置框重叠？
#                 if any(rect_overlap(rect, p['text_rect']) for p in placed):
#                     continue
#                 # 引线交叉检测：从锚点到文本框中心
#                 cx, cy = x + tw//2, y + th//2
#                 cross = False
#                 for p in placed:
#                     # 引线是否穿过其他框？
#                     if segment_intersects_rect((anchor[0], anchor[1]), (cx, cy), p['text_rect']):
#                         cross = True
#                         break
#                 if cross:
#                     continue
#                 # 计算评分
#                 dist = math.hypot(cx - anchor[0], cy - anchor[1])
#                 dist_score = 1.0 / (1.0 + dist / 200)
#                 score = bg_r * 8 - fg_r * 5 + dist_score * 2
#                 if score > best_score:
#                     best_score = score
#                     best_placement = (x, y, tw, th, wrapped)

#         # 如果所有宽度都没找到合适位置，放宽限制（降低背景覆盖率要求，允许稍多遮挡）
#         if best_placement is None:
#             for tw_limit in max_text_widths[:3]:  # 不尝试极窄
#                 wrapped = wrap_text_precise(comment, font, tw_limit)
#                 if not wrapped:
#                     wrapped = [" "]
#                 text_w_px = int(max(font.getlength(line) for line in wrapped))
#                 tw = text_w_px + 2 * pad
#                 th = len(wrapped) * line_height + 2 * pad
#                 # 放宽的搜索
#                 grid_step = max(20, min(W, H) // 20)
#                 x_starts = range(edge_margin, W - tw - edge_margin + 1, grid_step)
#                 y_starts = range(edge_margin, H - th - edge_margin + 1, grid_step)
#                 for x in x_starts:
#                     for y in y_starts:
#                         if any(rect_overlap((x,y,tw,th), p['text_rect']) for p in placed):
#                             continue
#                         cx, cy = x+tw//2, y+th//2
#                         if any(segment_intersects_rect((anchor[0],anchor[1]),(cx,cy), p['text_rect']) for p in placed):
#                             continue
#                         if best_placement is None:
#                             best_placement = (x, y, tw, th, wrapped)
#                         else:
#                             # 选距离锚点最近的
#                             old_cx, old_cy = best_placement[0]+best_placement[2]//2, best_placement[1]+best_placement[3]//2
#                             old_dist = math.hypot(old_cx-anchor[0], old_cy-anchor[1])
#                             new_dist = math.hypot(cx-anchor[0], cy-anchor[1])
#                             if new_dist < old_dist:
#                                 best_placement = (x, y, tw, th, wrapped)

#         # 最终兜底：放在离锚点最近的角落，使用最窄宽度
#         if best_placement is None:
#             wrapped = wrap_text_precise(comment, font, max_text_widths[-1])
#             if not wrapped: wrapped = [" "]
#             text_w_px = int(max(font.getlength(l) for l in wrapped))
#             tw = text_w_px + 2*pad
#             th = len(wrapped) * line_height + 2*pad
#             x = min(W - tw - edge_margin, max(edge_margin, anchor[0] - tw//2))
#             y = min(H - th - edge_margin, max(edge_margin, anchor[1] - th//2))
#             best_placement = (x, y, tw, th, wrapped)

#         x, y, tw, th, wrapped = best_placement
#         rect = (x, y, tw, th)
#         placed.append({
#             'text_rect': rect,
#             'anchor': anchor,
#             'line': ((anchor[0], anchor[1]), (x+tw//2, y+th//2))
#         })
#         results.append({
#             'anchor': anchor,
#             'text_pos': (x, y),
#             'text_rect': rect,
#             'comment': comment,
#             'wrapped_lines': wrapped,
#             'font_size': font_size  # 始终为 20
#         })

#     return results

def layout_annotations(image_size, detections, comments, font_path, background_mask=None):
    W, H = image_size
    # ---------- 动态字号与边距 ----------
    short_side = min(W, H)
    # 字号在 14~28 之间随短边线性变化
    font_size = int(14 + (28 - 14) * min(max(short_side - 600, 0) / 1400.0, 1.0))
    pad = max(6, int(font_size / 2))   # 内边距自适应
    edge_margin = pad * 2

    font = ImageFont.truetype(font_path, font_size)
    metrics = font.getmetrics()
    line_height = metrics[0] + metrics[1] + 2

    # ---------- 掩码预处理 ----------
    fg_union_mask = np.zeros((H, W), dtype=np.uint8)
    fg_detections = [d for d in detections if d.get('category') != 'background']
    for d in fg_detections:
        mask = d.get('mask')
        if mask is not None:
            fg_union_mask = np.logical_or(fg_union_mask, mask).astype(np.uint8)

    if background_mask is None:
        bg_mask = np.ones((H, W), dtype=np.uint8)
    else:
        bg_mask = background_mask.astype(np.uint8)

    # 构建积分图（大幅加速区域统计）
    bg_integral = compute_integral_map(bg_mask)
    fg_integral = compute_integral_map(fg_union_mask)

    # ---------- 排序：面积大的前景先处理 ----------
    fg_with_area = []
    for det in fg_detections:
        mask = det.get('mask')
        area = np.sum(mask) if mask is not None else 0
        bbox = det.get('bbox', [0,0,0,0])
        if len(bbox) == 4:
            x1,y1,x2,y2 = bbox
            area = max(area, (x2-x1)*(y2-y1))  # 无mask时用bbox面积
        fg_with_area.append((area, det))
    fg_with_area.sort(key=lambda x: x[0], reverse=True)
    sorted_detections = [d for _, d in fg_with_area]

    # 为保持 comments 与检测顺序一致，需要根据原顺序重新映射
    # 建立 category -> comment 的映射（避免顺序依赖）
    comment_by_cat = {}
    for det, comment in zip(fg_detections, comments):
        cat = det.get('category', '')
        comment_by_cat[cat] = comment   # 若有重复类别，保留最后一个（简单处理）

    placed = []   # 存储 {'text_rect', 'anchor', 'line'}
    results = []

    for det in sorted_detections:
        # ---- 确定锚点（距离 bbox 中心最近） ----
        mask = det.get('mask')
        bbox = det.get('bbox', [0,0,0,0])
        anchor = None
        if mask is not None and mask.any():
            ys, xs = np.where(mask > 0)
            if len(ys) > 0:
                # 计算 bbox 中心
                if len(bbox) == 4:
                    bcx, bcy = (bbox[0]+bbox[2])/2, (bbox[1]+bbox[3])/2
                else:
                    bcx, bcy = W/2, H/2
                points = np.column_stack((xs, ys))
                dists = np.linalg.norm(points - np.array([bcx, bcy]), axis=1)
                nearest_idx = np.argmin(dists)
                anchor = (int(xs[nearest_idx]), int(ys[nearest_idx]))
        if anchor is None:
            if len(bbox) == 4:
                anchor = (int((bbox[0]+bbox[2])/2), int((bbox[1]+bbox[3])/2))
            else:
                anchor = (W//2, H//2)

        category = det.get('category', '')
        comment = comment_by_cat.get(category, f"{category}: 无评语")

        # ---- 候选宽度（保持原有四档，但紧跟字号） ----
        max_text_widths = [
            int(W * 0.45) - 2*pad,
            int(W * 0.35) - 2*pad,
            int(W * 0.25) - 2*pad,
            int(W * 0.18) - 2*pad
        ]

        best_placement = None
        best_score = -1e9

        # 更精细的网格步长
        grid_step = max(6, min(W, H) // 60)

        for tw_limit in max_text_widths:
            wrapped = wrap_text_precise(comment, font, tw_limit)
            if not wrapped:
                wrapped = [" "]
            text_w_px = int(max(font.getlength(line) for line in wrapped))
            tw = text_w_px + 2 * pad
            th = len(wrapped) * line_height + 2 * pad

            # ---- 生成候选位置并评分（使用积分图） ----
            candidates = []
            x_starts = range(edge_margin, max(edge_margin+1, W - tw - edge_margin), grid_step)
            y_starts = range(edge_margin, max(edge_margin+1, H - th - edge_margin), grid_step)
            for x in x_starts:
                for y in y_starts:
                    # 用积分图 O(1) 计算背景和前景覆盖
                    bg_count = sum_in_rect(bg_integral, y, x, y+th, x+tw)
                    fg_count = sum_in_rect(fg_integral, y, x, y+th, x+tw)
                    total_pixels = tw * th
                    bg_ratio = bg_count / total_pixels if total_pixels > 0 else 0
                    fg_ratio = fg_count / total_pixels if total_pixels > 0 else 0
                    if bg_ratio < 0.5 or fg_ratio > 0.15:
                        continue
                    # 距离项
                    cx, cy = x + tw//2, y + th//2
                    dist = math.hypot(cx - anchor[0], cy - anchor[1])
                    dist_score = 1.0 / (1.0 + dist / 200)
                    candidates.append((x, y, bg_ratio, fg_ratio, dist_score, wrapped))
            # 按评分排序
            candidates.sort(key=lambda c: c[2]*8 - c[3]*5 + c[4]*2, reverse=True)
            # 限制候选数（提高上限）
            for (x, y, bg_r, fg_r, dist_s, wrapped_lines) in candidates[:200]:
                rect = (x, y, tw, th)
                # 矩形重叠
                if any(rect_overlap(rect, p['text_rect']) for p in placed):
                    continue

                # ---- 全面的引线冲突检测 ----
                line_new = (anchor, (x + tw//2, y + th//2))
                conflict = False
                for p in placed:
                    # 1) 新引线是否穿过已放置卡片
                    if segment_intersects_rect(line_new[0], line_new[1], p['text_rect']):
                        conflict = True
                        break
                    # 2) 已有引线是否穿过新卡片
                    if segment_intersects_rect(p['line'][0], p['line'][1], rect):
                        conflict = True
                        break
                    # 3) 新引线与已有引线相交（扣分而非直接拒绝，放在评分阶段更好，此处做硬拒绝也可，但密集时可能无解，改为扣分后统一评判）
                if conflict:
                    # 完全不允许穿卡，但引线互穿可稍微宽松：如果仅与已有引线相交（未穿卡），我们仍然接受但降低评分
                    # 为了简化，这里先硬拒绝所有穿卡冲突，引线互穿单独处理
                    pass
                else:
                    # 额外检查引线互穿
                    line_cross_penalty = 0
                    for p in placed:
                        if segments_intersect(line_new[0], line_new[1], p['line'][0], p['line'][1]):
                            line_cross_penalty += 3  # 惩罚值
                    score = bg_r*8 - fg_r*5 + dist_s*2 - line_cross_penalty
                    if score > best_score:
                        best_score = score
                        best_placement = (x, y, tw, th, wrapped_lines)

        # 若以上严格条件未找到，放宽限制（不检查背景/前景占比，仅避免矩形重叠和穿卡）
        if best_placement is None:
            # 放宽的搜索同样使用积分图和缩小步长
            for tw_limit in max_text_widths:
                wrapped = wrap_text_precise(comment, font, tw_limit)
                if not wrapped:
                    wrapped = [" "]
                text_w_px = int(max(font.getlength(line) for line in wrapped))
                tw = text_w_px + 2*pad
                th = len(wrapped) * line_height + 2*pad
                grid_step = max(6, min(W,H)//50)
                x_starts = range(edge_margin, max(edge_margin+1, W - tw - edge_margin), grid_step)
                y_starts = range(edge_margin, max(edge_margin+1, H - th - edge_margin), grid_step)
                for x in x_starts:
                    for y in y_starts:
                        rect = (x,y,tw,th)
                        if any(rect_overlap(rect, p['text_rect']) for p in placed):
                            continue
                        # 引线穿卡检查
                        def crossing_existing_cards(anchor, rect, placed):
                            line_new = (anchor, (x+tw//2, y+th//2))
                            for p in placed:
                                if segment_intersects_rect(line_new[0], line_new[1], p['text_rect']):
                                    return True
                                if segment_intersects_rect(p['line'][0], p['line'][1], rect):
                                    return True
                            return False
                        if crossing_existing_cards(anchor, rect, placed):
                            continue
                        # 选距离最近的
                        cx, cy = x+tw//2, y+th//2
                        new_dist = math.hypot(cx-anchor[0], cy-anchor[1])
                        if best_placement is None or new_dist < best_placement[5]:
                            # 暂时记下
                            best_placement = (x, y, tw, th, wrapped, new_dist)
            if best_placement:
                x,y,tw,th,wrapped_lines, _ = best_placement
            else:
                # 最终兜底
                wrapped = wrap_text_precise(comment, font, max_text_widths[-1])
                if not wrapped: wrapped = [" "]
                text_w_px = int(max(font.getlength(l) for l in wrapped))
                tw = text_w_px + 2*pad
                th = len(wrapped) * line_height + 2*pad
                x = min(W - tw - edge_margin, max(edge_margin, anchor[0] - tw//2))
                y = min(H - th - edge_margin, max(edge_margin, anchor[1] - th//2))
                best_placement = (x, y, tw, th, wrapped)
                
        x, y, tw, th, wrapped_lines = best_placement[:5]
        rect = (x, y, tw, th)
        placed.append({
            'text_rect': rect,
            'anchor': anchor,
            'line': (anchor, (x+tw//2, y+th//2))
        })
        results.append({
            'anchor': anchor,
            'text_pos': (x, y),
            'text_rect': rect,
            'comment': comment,
            'wrapped_lines': wrapped_lines,
            'font_size': font_size,
            'pad': pad,
            'line_height': line_height
        })

    return results
# -------------------- 绘图 --------------------

def draw_annotations(image_path, layout, output_path, font_path):
    """
    绘制标注图。
    :param image_path: 原图路径
    :param layout: layout_annotations 返回的列表
    :param output_path: 输出路径
    :param font_path: 字体路径
    """
    img = Image.open(image_path).convert('RGBA')
    font_size = layout[0].get('font_size', 20) if layout else 20
    font = ImageFont.truetype(font_path, font_size)

    for item in layout:
        ax, ay = item['anchor']
        tx, ty = item['text_pos']
        tw, th = item['text_rect'][2], item['text_rect'][3]
        wrapped = item.get('wrapped_lines', [item['comment']])
        line_height = item.get('line_height', font_size + 4)
        pad = item.get('pad', max(6, int(font_size/2)))

        draw = ImageDraw.Draw(img)
        # 引线虚线
        line_end = (tx + tw//2, ty + th//2)
        draw_dashed_line(draw, (ax, ay), line_end, fill='#ff8c42', width=2, dash_length=8, gap_length=6)

        # 锚点圆点
        r = 5
        draw.ellipse([(ax-r, ay-r), (ax+r, ay+r)], fill='#ff8c42', outline='white', width=2)

        # 投影
        shadow = Image.new('RGBA', img.size, (0,0,0,0))
        sd = ImageDraw.Draw(shadow)
        draw_rounded_rectangle(sd, [tx+3, ty+3, tx+tw+3, ty+th+3], radius=8, fill=(0,0,0,60))
        shadow = shadow.filter(ImageFilter.GaussianBlur(4))
        img = Image.alpha_composite(img, shadow)

        # 卡片（白底橙边）
        card = Image.new('RGBA', img.size, (0,0,0,0))
        cd = ImageDraw.Draw(card)
        draw_rounded_rectangle(cd, [tx, ty, tx+tw, ty+th], radius=8, fill=(255,255,255,240))
        draw_rounded_rectangle(cd, [tx, ty, tx+tw, ty+th], radius=8, outline='#ff8c42', width=2)
        img = Image.alpha_composite(img, card)

        # 文字
        text_layer = Image.new('RGBA', img.size, (0,0,0,0))
        td = ImageDraw.Draw(text_layer)
        y_off = ty + pad
        for line in wrapped:
            td.text((tx+pad, y_off), line, fill='#c44536', font=font)
            y_off += line_height
        img = Image.alpha_composite(img, text_layer)

    img.convert('RGB').save(output_path)