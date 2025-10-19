from flask import Blueprint, request, jsonify, current_app, send_file, abort
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.utils import secure_filename
from pypinyin import lazy_pinyin
import os
import datetime
import json
import uuid
import io

from zhihui.utils import get_db_connection, gpt_api
# 修复：从具体模块导入 DINOv3 相关方法，避免 __init__ 未导出导致的 ImportError
from zhihui.utils.dinov3_integration import (
    detect_blank_spaces,
    calculate_bubble_positions,
    detect_keyword_regions,
    detect_content_regions,
)
# 新增：CN‑CLIP 文本-图像匹配
from zhihui.utils.clip_cn_integration import match_texts_to_image_blank_regions

image_bp = Blueprint('image', __name__)

# 允许的文件扩展名
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def compute_total_score(dimensions):
    """
    将所有维度的 weighted_score 相加，四舍五入为整数。
    若某项缺失 weighted_score，则视为 0。
    """
    total = 0.0
    for d in dimensions:
        ws = d.get("weighted_score")
        if isinstance(ws, (int, float)):
            total += float(ws)
    return int(round(total))

# 图片上传API
@image_bp.route('/image/upload', methods=['POST'])
@jwt_required()
def upload_image():
    try:
        # 检查是否有文件部分
        if 'file' not in request.files:
            return jsonify({"message": "没有文件部分"}), 400

        file = request.files['file']

        # 如果用户没有选择文件
        if file.filename == '':
            return jsonify({"message": "未选择文件"}), 400

        if file and allowed_file(file.filename):
            # 对文件名进行安全处理，但由于中文会丢失，所以把中文转化成拼音
            filename = secure_filename(''.join(lazy_pinyin(file.filename)))
            file_ext = filename.rsplit('.', 1)[1].lower()
            # 生成唯一文件名
            unique_filename = f"{uuid.uuid4().hex}.{file_ext}"
            # 创建上传目录（如果不存在）
            upload_folder = current_app.config.get('UPLOAD_FOLDER', 'uploads')
            if not os.path.exists(upload_folder):
                os.makedirs(upload_folder)
            filepath = os.path.join(upload_folder, unique_filename)

            try:
                file.stream.seek(0)  # 重置文件流位置
                # 调用API获取评价
                raw = gpt_api(file.stream)
                if raw is None:
                    raise Exception("AI 返回为空")

                # 处理API返回结果
                categorized_keywords = {}
                if isinstance(raw, dict):
                    if 'evaluation' in raw:
                        # 使用包含分类关键词的新结构
                        evaluation_data = raw['evaluation']
                        categorized_keywords = raw.get('categorized_keywords', {})
                    else:
                        # 兼容旧结构
                        evaluation_data = raw.get("data", raw)
                elif isinstance(raw, str):
                    try:
                        evaluation_data = json.loads(raw)
                    except Exception:
                        raise Exception("无法解析 AI 返回的字符串")
                else:
                    raise Exception("AI 返回格式不支持")

                # ==== 使用 DINOv3 检测空白区域和内容区域 ====
                try:
                    file.stream.seek(0)  # 重置文件流位置
                    from PIL import Image
                    img = Image.open(file.stream)
                    width, height = img.size

                    file.stream.seek(0)  # 重置文件流位置
                    # 空白区域（focus_on_content=False）
                    blank_spaces = detect_blank_spaces(file.stream, focus_on_content=False)

                    file.stream.seek(0)  # 重置文件流位置
                    # 内容区域
                    content_spaces = detect_content_regions(file.stream)

                    # 计算气泡批注的最佳位置（空白区域优先）
                    bubble_positions = calculate_bubble_positions(width, height, blank_spaces)

                    # 写入评价数据
                    evaluation_data['empty_regions'] = bubble_positions
                    evaluation_data['content_regions'] = content_spaces
                except Exception as e:
                    print(f"dinov3处理失败: {e}")
                    evaluation_data['empty_regions'] = []
                    evaluation_data['content_regions'] = []
                # =======================================

                # ==== 新增：使用 CN‑CLIP 进行中文文本与图像匹配 ====
                try:
                    # 汇总候选文本（strengths + suggestions + dimensions[].comment）
                    candidate_texts = []
                    summary = evaluation_data.get("summary", {}) or {}
                    strengths = summary.get("strengths", []) or []
                    suggestions = summary.get("suggestions", []) or []
                    dimensions = evaluation_data.get("dimensions", []) or []

                    for s in strengths:
                        if isinstance(s, str) and s.strip():
                            candidate_texts.append(s.strip())
                    for s in suggestions:
                        if isinstance(s, str) and s.strip():
                            candidate_texts.append(s.strip())
                    for d in dimensions:
                        c = (d or {}).get('comment')
                        if isinstance(c, str) and c.strip():
                            candidate_texts.append(c.strip())

                    # 按标点严格拆分为短句，并去重
                    import re
                    def split_into_phrases(text: str):
                        if not isinstance(text, str):
                            return []
                        s = text.strip()
                        if not s:
                            return []
                        # 按中文/英文逗号、顿号、分号、句号、问号、叹号拆分
                        parts = re.split(r'[，,、；;。\.！!？\?]+', s)
                        return [p.strip() for p in parts if p and p.strip()]

                    phrase_texts = []
                    seen_phrases = set()
                    for t in candidate_texts:
                        for p in split_into_phrases(t):
                            if p and p not in seen_phrases:
                                seen_phrases.add(p)
                                phrase_texts.append(p)

                    # 执行 CN‑CLIP 匹配：对每个“短句”独立计算置信度并定位部位
                    try:
                        file.stream.seek(0)
                    except Exception:
                        pass
                    cn_clip_result = match_texts_to_image_blank_regions(file.stream, phrase_texts, max_candidates=12)

                    # 并入结果：映射（短句级别）、以及可选区域字段
                    evaluation_data['text_region_mapping'] = cn_clip_result.get('text_region_mapping', [])
                    evaluation_data['content_regions_cnclip'] = cn_clip_result.get('content_regions', [])
                    evaluation_data['empty_regions_cnclip'] = cn_clip_result.get('empty_regions', [])

                    # 调试日志：打印短句数量与映射的置信度
                    print(f"[CN-CLIP] 原始候选总数: {len(candidate_texts)}")
                    print(f"[CN-CLIP] 标点拆分后的短句总数: {len(phrase_texts)}")
                    mapping_raw = evaluation_data['text_region_mapping'] or []
                    print("[CN-CLIP] 返回映射(短句)条数:", len(mapping_raw))
                    for m in mapping_raw:
                        print(f"[CN-CLIP] 短句='{m.get('text')}' 置信度={m.get('confidence')} 区域={m.get('region') or m.get('bbox')}")
                except Exception as e:
                    print(f"CN‑CLIP 匹配失败: {e}")
                    evaluation_data['text_region_mapping'] = []
                # =======================================

                # 覆盖：仅使用 CN‑CLIP 的具体部位作为气泡位置（减少数量）
                try:
                    # 上传图片() 内的“严格筛选阶段”参数与动态阈值
                    strict_top_k = int(current_app.config.get('CNCLIP_TOP_K_STRICT', 4))  # 从3提到4
                    strict_min_conf = float(current_app.config.get('CNCLIP_MIN_CONF_STRICT', 0.42))  # 稍微放宽
                    nms_iou_thresh = float(current_app.config.get('CNCLIP_NMS_IOU', 0.25))  # 更强抑制重叠
                except Exception:
                    strict_top_k = 4
                    strict_min_conf = 0.42
                    nms_iou_thresh = 0.25

                mapping_raw = evaluation_data.get('text_region_mapping') or []

                def _valid_rect(r: dict):
                    try:
                        x = float(r.get('x', 0.0))
                        y = float(r.get('y', 0.0))
                        w = float(r.get('width', 0.0))
                        h = float(r.get('height', 0.0))
                        return w > 0 and h > 0 and 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0
                    except Exception:
                        return False

                def _rect_iou(a: dict, b: dict):
                    ax, ay, aw, ah = float(a['x']), float(a['y']), float(a['width']), float(a['height'])
                    bx, by, bw, bh = float(b['x']), float(b['y']), float(b['width']), float(b['height'])
                    ax2, ay2 = ax + aw, ay + ah
                    bx2, by2 = bx + bw, by + bh
                    ix1, iy1 = max(ax, bx), max(ay, by)
                    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
                    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
                    inter = iw * ih
                    union = aw * ah + bw * bh - inter
                    return inter / union if union > 0 else 0.0

                def _nms(items, iou_thresh=0.3):
                    selected = []
                    for m in items:
                        keep = True
                        for s in selected:
                            if _rect_iou(m['region'], s['region']) >= iou_thresh:
                                keep = False
                                break
                        if keep:
                            selected.append(m)
                    return selected

                def _center_from_rect(rect: dict, conf: float):
                    x = float(rect.get('x', 0.0))
                    y = float(rect.get('y', 0.0))
                    w = float(rect.get('width', 0.0))
                    h = float(rect.get('height', 0.0))
                    return {
                        'x': x + w / 2.0,
                        'y': y + h / 2.0,
                        'confidence': float(conf),
                        'area': w * h
                    }

                # 融合分数并清洗（CN‑CLIP + DINO 内容/空白）
                def _fuse_score(clip_conf: float, content_conf: float, empty_conf: float) -> float:
                    # 保持到[0,1]区间的线性融合，稳定且可解释
                    clip_conf = max(0.0, min(1.0, clip_conf))
                    content_conf = max(0.0, min(1.0, content_conf))
                    empty_conf = max(0.0, min(1.0, empty_conf))
                    return min(1.0, max(0.0, 0.7 * clip_conf + 0.2 * content_conf + 0.1 * empty_conf))

                cleaned = []
                seen_text = set()
                scores_all = []
                for m in mapping_raw:
                    text = m.get('text')
                    region = m.get('region') or {}
                    clip_conf = float(m.get('confidence', 0.0))
                    content_conf = float(m.get('content_conf', 0.0))
                    empty_conf = float(m.get('empty_conf', 0.0))
                    if not isinstance(text, str) or not text.strip():
                        continue
                    if not _valid_rect(region):
                        continue
                    fused = _fuse_score(clip_conf, content_conf, empty_conf)
                    # 先应用“全局最小阈值”以避免过低分
                    if fused < strict_min_conf:
                        continue
                    key = text.strip()
                    if key in seen_text:
                        continue
                    seen_text.add(key)
                    item = {
                        'text': key,
                        'confidence': fused,  # 使用融合后的最终分数
                        'region': {
                            'x': float(region['x']),
                            'y': float(region['y']),
                            'width': float(region['width']),
                            'height': float(region['height'])
                        },
                        'score_clip': clip_conf,
                        'content_conf': content_conf,
                        'empty_conf': empty_conf,
                        'empty_region': m.get('empty_region') or None
                    }
                    cleaned.append(item)
                    scores_all.append(fused)

                # 基于该图的分布计算动态阈值 t_dyn（分位数 + clamping）
                # 动态阈值：分位从 P75 调整到 P70，略增通过率，并收敛上限到 0.52
                def _percentile(xs: list, p: float) -> float:
                    if not xs:
                        return strict_min_conf
                    ys = sorted(xs)
                    idx = max(0, min(len(ys) - 1, int(p * len(ys)) - 1))
                    return ys[idx]
                
                t_dyn_raw = _percentile(scores_all, 0.70)
                t_dyn = max(strict_min_conf, min(0.52, max(0.35, t_dyn_raw * 0.8)))

                # 按分数排序 + NMS + 动态阈值 + Top‑K
                cleaned.sort(key=lambda m: m['confidence'], reverse=True)
                nms_selected = _nms(cleaned, iou_thresh=nms_iou_thresh)
                dyn_selected = [m for m in nms_selected if m['confidence'] >= t_dyn]
                final_selected = (dyn_selected[:strict_top_k] or nms_selected[:1])  # 空结果回退Top‑1

                evaluation_data['cnclip_stats'] = {
                    'candidates_total': len(phrase_texts),
                    'candidates_passing_conf': len(cleaned),
                    'selected_after_nms': len(nms_selected),
                    'selected_after_dyn': len(dyn_selected),
                    'selected_final': len(final_selected),
                    'min_conf': strict_min_conf,
                    't_dyn': t_dyn,
                    'nms_iou_thresh': nms_iou_thresh
                }

                print("[CN-CLIP] 严格筛选后最终短句数量:", len(final_selected), "t_dyn=", t_dyn)
                for m in final_selected:
                    print(f"[CN-CLIP] 入选 短句='{m.get('text')}' 分数={m.get('confidence')} (clip={m.get('score_clip')}, content={m.get('content_conf')}, empty={m.get('empty_conf')}) 区域={m.get('region')}")

                if final_selected:
                    # 用短句级映射覆盖（内容中心）
                    evaluation_data['text_region_mapping'] = final_selected
                    evaluation_data['content_regions'] = [
                        _center_from_rect(m['region'], m['confidence']) for m in final_selected
                    ]
                    # 可选：若需要空白气泡位置，可传空白中心/矩形
                    evaluation_data['empty_regions'] = [
                        _center_from_rect(m['empty_region'], m['confidence']) for m in final_selected
                        if m.get('empty_region')
                    ]
                    evaluation_data['cnclip_override_used'] = True
                else:
                    evaluation_data['cnclip_override_used'] = False
                # 若无高置信度结果，则保持之前的 DINOv3 回退
                try:
                    # 解析评价结果并入库
                    dimensions = evaluation_data.get("dimensions", [])
                    dimensions_json = json.dumps(dimensions, ensure_ascii=False)
                    summary = evaluation_data.get("summary", {}) or {}
                    strengths = summary.get("strengths", []) or []
                    strengths_json = json.dumps(strengths, ensure_ascii=False)
                    suggestions = summary.get("suggestions", []) or []
                    suggestions_json = json.dumps(suggestions, ensure_ascii=False)
                    score = compute_total_score(dimensions)

                    # 序列化分类关键词
                    categorized_keywords_json = json.dumps(categorized_keywords, ensure_ascii=False)

                    # 获取当前用户
                    current_username = get_jwt_identity()
                    conn = get_db_connection()
                    c = conn.cursor()

                    # 获取用户ID
                    c.execute("SELECT id FROM users WHERE username = %s", (current_username,))
                    user = c.fetchone()

                    if user:
                        try:
                            file.stream.seek(0)
                        except Exception:
                            pass
                        file.save(filepath)
                        user_id = user['id']
                        image_url = f"/image/file/{unique_filename}"

                        # 写入数据库（保持既有表结构，不存 text_region_mapping）
                        sql = """
                            INSERT INTO images (user_id, score, upload_time, strengths, image_url, suggestions, dimensions, filename, original_name, empty_regions, content_regions, categorized_keywords)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """
                        params = (
                            user_id,
                            score,
                            datetime.datetime.now(),
                            strengths_json,
                            image_url,
                            suggestions_json,
                            json.dumps(dimensions, ensure_ascii=False),
                            unique_filename,
                            file.filename,
                            json.dumps(evaluation_data.get('empty_regions', []), ensure_ascii=False),
                            json.dumps(evaluation_data.get('content_regions', []), ensure_ascii=False),
                            categorized_keywords_json
                        )
                        c.execute(sql, params)
                        conn.commit()

                        # 返回完整的评价信息（包括 text_region_mapping，前端直接可用）
                        return jsonify({
                            "message": "上传成功",
                            "score": score,
                            "dimensions": dimensions,
                            "strengths": strengths,
                            "suggestions": suggestions,
                            "filename": unique_filename,
                            "original_name": file.filename,
                            "empty_regions": evaluation_data.get('empty_regions', []),
                            "content_regions": evaluation_data.get('content_regions', []),
                            "text_region_mapping": evaluation_data.get('text_region_mapping', []),
                            "categorized_keywords": categorized_keywords,
                            "cnclip_override_used": evaluation_data.get('cnclip_override_used', False),
                            "cnclip_stats": evaluation_data.get('cnclip_stats', {})
                        }), 200
                finally:
                    conn.close()
            except Exception as e:
                return jsonify({
                    "message": "作品评价失败",
                    "error": str(e),
                    "suggestion": "请稍后重试或联系管理员"
                }), 500
        else:
            return jsonify({"message": "文件类型不允许"}), 400

    except Exception as e:
        print(f"上传失败: {e}")
        return jsonify({"message": "服务器错误，请稍后再试"}), 500

# 提供图片访问的API
@image_bp.route('/image/file/<filename>', methods=['GET'])
@jwt_required()
def get_image_file(filename):
    try:
        current_username = get_jwt_identity()

        # 验证用户是否有权访问此图片
        conn = get_db_connection()
        try:
            c = conn.cursor()

            # 检查图片是否属于当前用户
            c.execute("""
                SELECT i.filename 
                FROM images i 
                JOIN users u ON i.user_id = u.id 
                WHERE u.username = %s AND i.filename = %s
            """, (current_username, filename))

            image = c.fetchone()

            if not image:
                abort(403)  # 无权访问

            # 构建图片完整路径
            upload_folder = current_app.config.get('UPLOAD_FOLDER', 'uploads')
            image_path = os.path.join(upload_folder, filename)

            if not os.path.exists(image_path):
                abort(404)  # 图片不存在

            # 发送图片文件
            return send_file(image_path)

        finally:
            conn.close()

    except Exception as e:
        print(f"获取图片失败: {e}")
        abort(500)

# 获取用户历史图片
@image_bp.route('/image/history', methods=['GET'])
@jwt_required()
def get_history():
    try:
        current_username = get_jwt_identity()
        print(f"当前登录用户: {current_username}")

        conn = get_db_connection()
        try:
            c = conn.cursor()

            # 获取用户ID
            c.execute("SELECT id FROM users WHERE username = %s", (current_username,))
            user = c.fetchone()

            if user:
                user_id = user['id']
                print(f"用户ID: {user_id}")

                # 添加 categorized_keywords 字段
                c.execute(
                    "SELECT id, score, upload_time, strengths, image_url, suggestions, dimensions, filename, original_name, empty_regions, content_regions, categorized_keywords FROM images WHERE user_id = %s ORDER BY upload_time DESC",
                    (user_id,)
                )
                images = c.fetchall()
                print(f"查询到图片数量: {len(images)}")

                # 转换为前端需要的格式
                result = []
                for img in images:
                    strengths = json.loads(img['strengths']) if img['strengths'] else []
                    suggestions = json.loads(img['suggestions']) if img['suggestions'] else []
                    dimensions = json.loads(img['dimensions']) if img['dimensions'] else []
                    empty_regions = json.loads(img['empty_regions']) if img['empty_regions'] else []
                    content_regions = json.loads(img['content_regions']) if img.get('content_regions') else []
                    categorized_keywords = json.loads(img['categorized_keywords']) if img.get('categorized_keywords') else {}

                    result.append({
                        "id": img['id'],
                        "score": img['score'],
                        "upload_time": img['upload_time'].isoformat(),
                        "strengths": strengths,
                        "image_url": img['image_url'],
                        "suggestions": suggestions,
                        "dimensions": dimensions,
                        "filename": img['filename'],
                        "original_name": img['original_name'],
                        "empty_regions": empty_regions,
                        "content_regions": content_regions,
                        "categorized_keywords": categorized_keywords
                    })

                return jsonify({
                    "images": result,
                    "total": len(result)
                }), 200
            else:
                return jsonify({"message": "用户不存在"}), 404
        finally:
            conn.close()
    except Exception as e:
        print(f"获取历史记录失败: {e}")
        return jsonify({"message": "服务器错误，请稍后再试"}), 500

# 使用dinov3检测图片空白区域的API
@image_bp.route('/image/detect_blank', methods=['POST'])
@jwt_required()
def detect_image_blank():
    try:
        # 检查是否有文件部分
        if 'file' not in request.files:
            return jsonify({"message": "没有文件部分"}), 400

        file = request.files['file']

        # 如果用户没有选择文件
        if file.filename == '':
            return jsonify({"message": "未选择文件"}), 400

        if file and allowed_file(file.filename):
            try:
                # 打开图片获取尺寸信息
                from PIL import Image
                img = Image.open(file.stream)
                width, height = img.size

                file.stream.seek(0)  # 重置文件流位置
                # 调用dinov3检测空白区域
                blank_spaces = detect_blank_spaces(file.stream)

                # 计算气泡批注的最佳位置
                bubble_positions = calculate_bubble_positions(width, height, blank_spaces)

                return jsonify({
                    "message": "空白区域检测成功",
                    "empty_regions": bubble_positions
                }), 200
            except Exception as e:
                return jsonify({
                    "message": "空白区域检测失败",
                    "error": str(e)
                }), 500
        else:
            return jsonify({"message": "文件类型不允许"}), 400
    except Exception as e:
        print(f"检测空白区域失败: {e}")
        return jsonify({"message": "服务器错误，请稍后再试"}), 500

# 基于关键词检测图像区域
@image_bp.route('/image/detect_by_keywords', methods=['POST'])
@jwt_required()
def detect_by_keywords():
    try:
        # 检查是否有文件上传
        if 'file' not in request.files:
            return jsonify({'error': '没有文件上传'}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': '没有选择文件'}), 400

        # 获取用户提供的关键词（可选）
        keywords = request.json.get('keywords', []) if request.is_json else []

        # 处理图像
        image_stream = io.BytesIO(file.read())

        # 使用关键词检测区域（DINOv3 简化语义）
        detected_regions = detect_keyword_regions(image_stream, keywords, num_regions=5)

        return jsonify({
            'regions': detected_regions,
            'success': True
        })
    except Exception as e:
        print(f"关键词检测出错: {e}")
        return jsonify({'error': str(e)}), 500

