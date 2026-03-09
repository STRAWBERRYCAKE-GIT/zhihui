from flask import Blueprint, request, jsonify, current_app, send_file, abort
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.utils import secure_filename
from pypinyin import lazy_pinyin
import os
import threading
import datetime
import json
import uuid
from zhihui.utils.constants import ImageStatus  # 导入枚举
from collections import defaultdict
import re
from zhihui.utils import get_db_connection, gpt_api
# 从具体模块导入 DINOv3 相关方法，避免 __init__ 未导出导致的 ImportError
from zhihui.utils.dinov3_integration import (
    detect_blank_spaces,
    calculate_bubble_positions,
    detect_keyword_regions,
    detect_content_regions,
    generate_heatmap,
)
# CN‑CLIP 文本-图像匹配
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

def _quick_evaluate(image_id, user_id, app):
    """只执行 GPT 评价，返回 (result_dict, error)"""
    conn = get_db_connection()
    try:
        c = conn.cursor()
        # 获取图片信息
        c.execute("SELECT filename FROM images WHERE id = %s AND user_id = %s", (image_id, user_id))
        img = c.fetchone()
        if not img:
            return None, "图片不存在或无权限"

        filename = img['filename']
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        if not os.path.exists(filepath):
            return None, "图片文件不存在"

        with open(filepath, 'rb') as f:
            raw = gpt_api(f)
            if raw is None:
                return None, "AI 返回为空"

            # 解析返回结果
            categorized_keywords = {}
            keyword_mentions = {}          
            if isinstance(raw, dict):
                if 'evaluation' in raw:
                    evaluation_data = raw['evaluation']
                    categorized_keywords = raw.get('categorized_keywords', {})
                    keyword_mentions = raw.get('keyword_mentions', {})   # 关键词命中句子
                else:
                    evaluation_data = raw.get("data", raw)
            elif isinstance(raw, str):
                try:
                    evaluation_data = json.loads(raw)
                except Exception:
                    return None, "无法解析 AI 返回的字符串"
            else:
                return None, "AI 返回格式不支持"

            # 只提取评价相关字段
            dimensions = evaluation_data.get("dimensions", [])
            summary = evaluation_data.get("summary", {})
            strengths = summary.get("strengths", [])
            suggestions = summary.get("suggestions", [])
            score = compute_total_score(dimensions)

            # 更新数据库（批注字段暂时为空）
            c.execute("""
                UPDATE images SET
                    score = %s,
                    strengths = %s,
                    suggestions = %s,
                    dimensions = %s,
                    categorized_keywords = %s,
                    keyword_mentions = %s
                WHERE id = %s
            """, (
                score,
                json.dumps(strengths, ensure_ascii=False),
                json.dumps(suggestions, ensure_ascii=False),
                json.dumps(dimensions, ensure_ascii=False),
                json.dumps(categorized_keywords, ensure_ascii=False),
                json.dumps(keyword_mentions, ensure_ascii=False),
                image_id
            ))
            conn.commit()

            result = {
                "score": score,
                "dimensions": dimensions,
                "strengths": strengths,
                "suggestions": suggestions,
                "categorized_keywords": categorized_keywords,
                "keyword_mentions": keyword_mentions,
            }
            return result, None
    except Exception as e:
        conn.rollback()
        return None, str(e)
    finally:
        conn.close()

def _perform_annotation(image_id, user_id, app):
    """后台执行批注（DINOv3 + CN‑CLIP），更新数据库"""
    conn = get_db_connection()
    try:
        c = conn.cursor()
        # 获取图片文件名以及已保存的评价字段
        c.execute("""
            SELECT filename, strengths, suggestions, dimensions, 
                   categorized_keywords, keyword_mentions
            FROM images 
            WHERE id = %s AND user_id = %s
        """, (image_id, user_id))
        img = c.fetchone()
        if not img:
            return

        filename = img['filename']
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        if not os.path.exists(filepath):
            return

        # 构造 evaluation_data 字典，包含已有的评价数据
        evaluation_data = {
            'strengths': json.loads(img['strengths']) if img['strengths'] else [],
            'suggestions': json.loads(img['suggestions']) if img['suggestions'] else [],
            'dimensions': json.loads(img['dimensions']) if img['dimensions'] else [],
            'categorized_keywords': json.loads(img['categorized_keywords']) if img['categorized_keywords'] else {},
            'keyword_mentions': json.loads(img['keyword_mentions']) if img['keyword_mentions'] else {}
        }
        # 构建 summary 对象，供 CN‑CLIP 兜底逻辑使用
        evaluation_data['summary'] = {
            'strengths': evaluation_data['strengths'],
            'suggestions': evaluation_data['suggestions']
        }

        with open(filepath, 'rb') as f:
            f.seek(0)
            from PIL import Image
            img_pil = Image.open(f)
            width, height = img_pil.size
            f.seek(0)
            
            # 构造缓存目录
            upload_folder = app.config.get('UPLOAD_FOLDER', 'uploads')
            cache_dir = upload_folder  # 特征图缓存将放在 uploads/feature_maps/ 下

            # ---------- CN‑CLIP 处理 ----------
            try:
                # 汇总评价文本（作为兜底）
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
                    comment = (d or {}).get('comment')
                    if isinstance(comment, str) and comment.strip():
                        candidate_texts.append(comment.strip())

                # 解析 GPT 返回的 keyword_mentions，聚合为“关键词 -> 多个子句/短语”
                keyword_mentions = evaluation_data.get('keyword_mentions', {}) or {}
                keyword_to_phrases = defaultdict(list)
                try:
                    if isinstance(keyword_mentions, list):
                        for entry in keyword_mentions:
                            kw = (entry or {}).get('keyword')
                            sents = (entry or {}).get('sentences', []) or []
                            if isinstance(kw, str) and kw.strip() and isinstance(sents, list):
                                kw_norm = kw.strip()
                                for s in sents:
                                    if isinstance(s, str) and s.strip():
                                        keyword_to_phrases[kw_norm].append(s.strip())
                    elif isinstance(keyword_mentions, dict):
                        for kw, sents in (keyword_mentions or {}).items():
                            if isinstance(kw, str) and kw.strip() and isinstance(sents, list):
                                kw_norm = kw.strip()
                                for s in sents:
                                    if isinstance(s, str) and s.strip():
                                        keyword_to_phrases[kw_norm].append(s.strip())
                except Exception:
                    keyword_to_phrases = defaultdict(list)
                print(f"解析后的 keyword_to_phrases: {dict(keyword_to_phrases)}")
                # 加载同义词词库
                try:
                    # 根据蓝图所在目录定位 utils/keyword_lexicon.json
                    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                    lexicon_path = os.path.join(base_dir, 'utils', 'keyword_lexicon.json')
                    with open(lexicon_path, 'r', encoding='utf-8') as lex_f:
                        _lexicon_cache = json.load(lex_f)
                except Exception:
                    _lexicon_cache = {}

                def _trim_sentence_for_keyword(sent: str, kw: str) -> str:
                    if not isinstance(sent, str) or not sent.strip() or not isinstance(kw, str) or not kw.strip():
                        return sent.strip() if isinstance(sent, str) else ""
                    sent_norm = sent.strip()
                    variants = (list((_lexicon_cache.get(kw, []) or [])) + [kw])
                    clauses = [c.strip() for c in re.split(r"[，。,；;、,！？!?:：]", sent_norm) if c.strip()]
                    for clause in clauses:
                        for v in variants:
                            if v and v in clause:
                                return clause
                    for v in variants:
                        idx = sent_norm.find(v)
                        if idx != -1:
                            start = max(0, idx - 8)
                            end = min(len(sent_norm), idx + len(v) + 12)
                            return sent_norm[start:end]
                    return sent_norm

                def _pick_representative(phrases: list, kw: str) -> str:
                    """选一个代表短语用于图像匹配"""
                    if not phrases:
                        return kw
                    variants = (list((_lexicon_cache.get(kw, []) or [])) + [kw])
                    scored = []
                    for p in phrases:
                        pn = p.strip()
                        needs_trim = (len(pn) > 34) or sum(ch in pn for ch in "，。,；;、,！？!?:：") >= 2
                        if needs_trim:
                            pn = _trim_sentence_for_keyword(pn, kw)
                        contains_kw = any(v in pn for v in variants)
                        length = len(pn)
                        target_len_bonus = -abs(length - 18)
                        scored.append((contains_kw, target_len_bonus, length, pn))
                    scored.sort(key=lambda t: (not t[0], -t[1], t[2]))
                    return scored[0][3] if scored else kw

                def _aggregate_phrases(phrases: list, kw: str, max_len: int = 30) -> str:
                    """将同一关键词的多个短语精简合并为一个气泡文本"""
                    if not phrases:
                        return kw
                    variants = (list((_lexicon_cache.get(kw, []) or [])) + [kw])
                    uniq = []
                    seen = set()
                    for p in phrases:
                        pn = p.strip()
                        if pn and pn not in seen:
                            seen.add(pn)
                            uniq.append(pn)
                    uniq.sort(key=lambda x: (not any(v in x for v in variants), len(x)))
                    out = []
                    total = 0
                    for item in uniq:
                        piece = item
                        if len(piece) > 28 or sum(ch in piece for ch in "，。,；;、,！？!?:：") >= 3:
                            piece = _trim_sentence_for_keyword(piece, kw)
                        add_len = len(piece) + (1 if out else 0)
                        if total + add_len <= max_len:
                            out.append(piece)
                            total += add_len
                        else:
                            break
                    if not out:
                        out = [_pick_representative(uniq, kw)]
                    return "；".join(out)

                keywords_sorted = list(keyword_to_phrases.keys())
                rep_map = {}      # keyword -> representative phrase
                bubble_text_map = {}  # keyword -> aggregated concise text
                for kw in keywords_sorted:
                    phrases = keyword_to_phrases.get(kw, [])
                    rep_map[kw] = _pick_representative(phrases, kw)
                    bubble_text_map[kw] = _aggregate_phrases(phrases, kw, max_len=int(app.config.get('BUBBLE_MAX_TEXT', 30)))

                max_cand = int(app.config.get('CNCLIP_MAX_CANDIDATES', 12))
                candidate_texts_for_clip = [rep_map[k] for k in keywords_sorted[:max_cand]]
                phrase_to_keyword = {rep_map[k]: k for k in keywords_sorted[:max_cand]}

                strict_min_conf = float(app.config.get('CNCLIP_MIN_CONF_STRICT', 0.42))
                f.seek(0)
                cnclip_out = match_texts_to_image_blank_regions(
                    f,
                    candidate_texts_for_clip,
                    max_candidates=len(candidate_texts_for_clip),
                    image_id=image_id,
                    cache_dir=cache_dir
                )
                mapping_raw = cnclip_out.get('text_region_mapping', []) or []
                
                # 将 keyword 注入映射，并将显示文本替换为“精简合并文本”
                for m in mapping_raw:
                    txt = m.get('text')
                    kw = phrase_to_keyword.get(txt)
                    m['keyword'] = kw
                    if kw:
                        m['text'] = bubble_text_map.get(kw) or txt

                def _center_from_rect(rect, conf):
                    try:
                        cx = (float(rect.get('x', 0.0)) + float(rect.get('width', 0.0)) / 2.0) * float(width)
                        cy = (float(rect.get('y', 0.0)) + float(rect.get('height', 0.0)) / 2.0) * float(height)
                        return {'x': int(round(cx)), 'y': int(round(cy)), 'confidence': float(conf)}
                    except Exception:
                        return {'x': int(width * 0.5), 'y': int(height * 0.5), 'confidence': float(conf)}

                def _fused_conf(m):
                    cnclip = float(m.get('confidence', 0.0))
                    content_conf = float(m.get('content_conf', 0.0))
                    empty_conf = float(m.get('empty_conf', 0.0))
                    return 0.7 * cnclip + 0.2 * content_conf + 0.1 * empty_conf

                def _rect_iou(a, b):
                    ax1, ay1 = float(a.get('x', 0.0)), float(a.get('y', 0.0))
                    ax2, ay2 = ax1 + float(a.get('width', 0.0)), ay1 + float(a.get('height', 0.0))
                    bx1, by1 = float(b.get('x', 0.0)), float(b.get('y', 0.0))
                    bx2, by2 = bx1 + float(b.get('width', 0.0)), by1 + float(b.get('height', 0.0))
                    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
                    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
                    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
                    inter = iw * ih
                    area_a = max(0.0, (ax2 - ax1)) * max(0.0, (ay2 - ay1))
                    area_b = max(0.0, (bx2 - bx1)) * max(0.0, (by2 - by1))
                    union = area_a + area_b - inter + 1e-6
                    return inter / union

                def _apply_nms(mappings, iou_thresh=0.35, use_content_region=True):
                    picked = []
                    for m in sorted(mappings, key=_fused_conf, reverse=True):
                        rect = m.get('region' if use_content_region else 'empty_region') or {}
                        if not picked:
                            picked.append(m); continue
                        ok = True
                        for pm in picked:
                            prect = pm.get('region' if use_content_region else 'empty_region') or {}
                            if _rect_iou(rect, prect) >= iou_thresh:
                                ok = False; break
                        if ok: picked.append(m)
                    return picked

                cleaned = [m for m in mapping_raw if float(m.get('confidence', 0.0)) >= strict_min_conf]
                cleaned = _apply_nms(cleaned, iou_thresh=0.35, use_content_region=True)
                final_selected = sorted(cleaned, key=_fused_conf, reverse=True)

                evaluation_data['cnclip_stats'] = {
                    'candidates_total': len(mapping_raw),
                    'candidates_passing_conf': len(cleaned),
                    'selected_after_nms': len(cleaned),
                    'selected_after_dyn': len(cleaned),
                    'selected_final': len(final_selected),
                    'min_conf': strict_min_conf,
                    't_dyn': None,
                    'nms_iou_thresh': None
                }
                if final_selected:
                    evaluation_data['text_region_mapping'] = final_selected
                    evaluation_data['content_regions'] = [
                        _center_from_rect(m.get('region', {}), m.get('confidence', 0.0)) for m in final_selected
                    ]
                    evaluation_data['empty_regions'] = [
                        _center_from_rect(m.get('empty_region', {}), m.get('confidence', 0.0)) for m in final_selected
                        if m.get('empty_region')
                    ]
                    evaluation_data['cnclip_override_used'] = True
                else:
                    evaluation_data['cnclip_override_used'] = False

            except Exception as e:
                print(f"CN‑CLIP 处理失败: {e}")
                evaluation_data['text_region_mapping'] = []
                evaluation_data['cnclip_stats'] = {}
                evaluation_data['cnclip_override_used'] = False

            # ---------- 异步生成热力图（不阻塞后续） ----------
            def generate_heatmap_task():
                try:
                    with app.app_context():
                        heatmap_folder = os.path.join(upload_folder, 'heatmaps')
                        os.makedirs(heatmap_folder, exist_ok=True)
                        heatmap_filename = f"heatmap_{image_id}.png"
                        heatmap_path = os.path.join(heatmap_folder, heatmap_filename)
                        # 注意：这里需要重新打开文件流，因为当前文件流可能已被后续操作移动
                        with open(filepath, 'rb') as f2:
                            generate_heatmap(f2, heatmap_path, cache_dir=cache_dir, image_id=image_id)
                        print(f"热力图已生成: {heatmap_path}")
                except Exception as e:
                    print(f"热力图生成任务失败: {e}")

            # 启动热力图生成线程（守护线程，随主线程退出而终止）
            heatmap_thread = threading.Thread(target=generate_heatmap_task)
            heatmap_thread.daemon = True
            heatmap_thread.start()

            # ---------- 解析评价结果，准备更新数据库 ----------
            c.execute("""
                UPDATE images SET
                    empty_regions = %s,
                    content_regions = %s,
                    text_region_mapping = %s,
                    status = %s
                WHERE id = %s
            """, (
                json.dumps(evaluation_data.get('empty_regions', []), ensure_ascii=False),
                json.dumps(evaluation_data.get('content_regions', []), ensure_ascii=False),
                json.dumps(evaluation_data.get('text_region_mapping', []), ensure_ascii=False),
                ImageStatus.COMPLETED.value,  # 全部完成
                image_id
            ))
            conn.commit()
    except Exception as e:
        # 批注失败，将状态置为 FAILED
        c.execute("UPDATE images SET status = %s WHERE id = %s", (ImageStatus.FAILED.value, image_id))
        conn.commit()
        print(f"批注失败: {e}")
    finally:
        conn.close()

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
            # 保存文件
            file.save(filepath)

            # 获取当前用户ID
            current_username = get_jwt_identity()
            conn = get_db_connection()
            try:
                c = conn.cursor()
                c.execute("SELECT id FROM users WHERE username = %s", (current_username,))
                user = c.fetchone()
                if not user:
                    return jsonify({"message": "用户不存在"}), 404
                user_id = user['id']
                image_url = f"/image/file/{unique_filename}"
                # 插入初始记录
                sql = """
                    INSERT INTO images 
                    (user_id, upload_time, filename, original_name, image_url, status)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """
                c.execute(sql, (
                    user_id,
                    datetime.datetime.now(),
                    unique_filename,
                    file.filename,
                    image_url,
                    ImageStatus.PENDING.value
                ))
                conn.commit()
                image_id = c.lastrowid
                return jsonify({
                    "message": "文件上传成功",
                    "filename": unique_filename,
                    "original_name": file.filename,
                    "image_id": image_id
                }), 200
            finally:
                conn.close()
        else:
            return jsonify({"message": "文件类型不允许"}), 400
    except Exception as e:
        print(f"upload-only 失败: {e}")
        return jsonify({"message": "服务器错误，请稍后再试"}), 500
        
# ---------- 评价图片（执行AI分析） ----------
@image_bp.route('/image/evaluate/<int:image_id>', methods=['POST'])
@jwt_required()
def evaluate_image(image_id):
    try:
        current_username = get_jwt_identity()
        conn = get_db_connection()
        try:
            c = conn.cursor()
            c.execute("SELECT id FROM users WHERE username = %s", (current_username,))
            user = c.fetchone()
            if not user:
                return jsonify({"message": "用户不存在"}), 404
            user_id = user['id']
            c.execute("UPDATE images SET status = %s WHERE id = %s", (ImageStatus.PROCESSING.value, image_id))
            conn.commit()
        finally:
            conn.close()

        result, error = _quick_evaluate(image_id, user_id, current_app._get_current_object())
        conn = get_db_connection()
        try:
            c = conn.cursor()
            if error:
                print(f"评价失败，错误信息: {error}")
                c.execute("UPDATE images SET status = %s WHERE id = %s", (ImageStatus.FAILED.value, image_id))
                conn.commit()
                return jsonify({"message": "评价失败", "error": error}), 500
        finally:
            conn.close()

        # 2. 启动后台线程执行批注
        def run_annotation(app, image_id, user_id):
            with app.app_context():
                _perform_annotation(image_id, user_id, app)

        app = current_app._get_current_object()  # 获取真实应用对象
        thread = threading.Thread(target=run_annotation, args=(app, image_id, user_id))
        thread.daemon = True
        thread.start()

        # 立即返回评价结果
        return jsonify({"message": "评价成功，批注正在生成", **result}), 200
    
    except Exception as e:
        print(f"评价失败: {e}")
        return jsonify({"message": "服务器错误，请稍后再试"}), 500
    
@image_bp.route('/image/<int:image_id>', methods=['GET'])
@jwt_required()
def get_image_detail(image_id):
    current_username = get_jwt_identity()
    conn = get_db_connection()
    try:
        c = conn.cursor()
        c.execute("""
            SELECT i.* FROM images i
            JOIN users u ON i.user_id = u.id
            WHERE u.username = %s AND i.id = %s
        """, (current_username, image_id))
        img = c.fetchone()
        if not img:
            return jsonify({"message": "图片不存在或无权限"}), 404

        # 辅助解析函数，处理 None 和 JSON 解析失败
        def parse_json_field(value, default=None):
            if value is None:
                return default
            try:
                return json.loads(value)
            except:
                return default

        # 根据字段预期类型传入默认值
        result = {
            "id": img['id'],
            "score": img['score'],
            "strengths": parse_json_field(img['strengths'], []),
            "suggestions": parse_json_field(img['suggestions'], []),
            "dimensions": parse_json_field(img['dimensions'], []),
            "empty_regions": parse_json_field(img['empty_regions'], []),
            "content_regions": parse_json_field(img['content_regions'], []),
            "text_region_mapping": parse_json_field(img['text_region_mapping'], []),
            "categorized_keywords": parse_json_field(img['categorized_keywords'], {}),
            "keyword_mentions": parse_json_field(img['keyword_mentions'], {}),
            "status": img['status']
        }
        return jsonify(result), 200
    finally:
        conn.close()

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

                # 查询包含气泡信息的完整数据
                c.execute(
                    "SELECT id, score, upload_time, strengths, image_url, suggestions, dimensions, filename, original_name, empty_regions, content_regions, categorized_keywords, text_region_mapping, keyword_mentions FROM images WHERE user_id = %s ORDER BY upload_time DESC",
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
                    
                    # 解析气泡映射信息
                    text_region_mapping = json.loads(img['text_region_mapping']) if img.get('text_region_mapping') else []
                    keyword_mentions = json.loads(img['keyword_mentions']) if img.get('keyword_mentions') else {}

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
                        "categorized_keywords": categorized_keywords,
                        "text_region_mapping": text_region_mapping,
                        "keyword_mentions": keyword_mentions
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

# 删除历史记录API
@image_bp.route('/image/delete/<int:image_id>', methods=['DELETE', 'OPTIONS'])
@jwt_required(optional=True)
def delete_image(image_id):
    # 处理预检请求
    if request.method == 'OPTIONS':
        return '', 200
    
    try:
        current_username = get_jwt_identity()
        
        # 确保DELETE请求需要认证
        if not current_username:
            return jsonify({"message": "需要登录"}), 401
        
        conn = get_db_connection()
        try:
            c = conn.cursor()
            
            # 验证图片是否属于当前用户
            c.execute("""
                SELECT i.id, i.filename 
                FROM images i 
                JOIN users u ON i.user_id = u.id 
                WHERE u.username = %s AND i.id = %s
            """, (current_username, image_id))
            
            image = c.fetchone()
            
            if not image:
                return jsonify({"message": "图片不存在或无权限删除"}), 403
            
            # 删除物理文件
            upload_folder = current_app.config.get('UPLOAD_FOLDER', 'uploads')
            image_path = os.path.join(upload_folder, image['filename'])
            
            try:
                if os.path.exists(image_path):
                    os.remove(image_path)
                    print(f"已删除文件: {image_path}")
            except Exception as e:
                print(f"删除文件失败: {e}")
                # 文件删除失败不影响数据库删除

            # 删除特征图缓存
            cache_dir = os.path.join(upload_folder, 'feature_maps')
            cache_path = os.path.join(cache_dir, f"{image_id}.npy")
            try:
                if os.path.exists(cache_path):
                    os.remove(cache_path)
                    print(f"已删除特征图缓存: {cache_path}")
            except Exception as e:
                print(f"删除特征图缓存失败: {e}")

            # 删除热力图文件
            heatmap_dir = os.path.join(upload_folder, 'heatmaps')
            heatmap_path = os.path.join(heatmap_dir, f"heatmap_{image_id}.png")
            try:
                if os.path.exists(heatmap_path):
                    os.remove(heatmap_path)
                    print(f"已删除热力图: {heatmap_path}")
            except Exception as e:
                print(f"删除热力图失败: {e}")
                
            # 删除数据库记录
            c.execute("DELETE FROM images WHERE id = %s", (image_id,))
            conn.commit()
            
            return jsonify({
                "message": "删除成功",
                "deleted_id": image_id
            }), 200
            
        finally:
            conn.close()
            
    except Exception as e:
        print(f"删除图片失败: {e}")
        return jsonify({"message": "删除失败，请稍后再试"}), 500

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