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
# upload_image 路由函数：优先使用 keyword_mentions，标注 keyword 并返回
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
                keyword_mentions = {}
                if isinstance(raw, dict):
                    if 'evaluation' in raw:
                        # 使用包含分类关键词的新结构
                        evaluation_data = raw['evaluation']
                        categorized_keywords = raw.get('categorized_keywords', {})
                        keyword_mentions = raw.get('keyword_mentions', {})  # 关键词命中句子（兼容列表/字典）
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

                # ==== 使用 CN‑CLIP（每个关键词仅一个气泡，内容精简为短子句/短语） ====
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
                        c = (d or {}).get('comment')
                        if isinstance(c, str) and c.strip():
                            candidate_texts.append(c.strip())

                    # 解析 GPT 返回的 keyword_mentions，聚合为“关键词 -> 多个子句/短语”
                    from collections import defaultdict
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

                    # 词库（同义词/近义词）用于截取与排序
                    try:
                        lexicon_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'utils', 'keyword_lexicon.json'))
                        with open(lexicon_path, 'r', encoding='utf-8') as f:
                            _lexicon_cache = json.load(f)
                    except Exception:
                        _lexicon_cache = {}

                    import re
                    def _trim_sentence_for_keyword(sent: str, kw: str) -> str:
                        if not isinstance(sent, str) or not sent.strip() or not isinstance(kw, str) or not kw.strip():
                            return sent.strip() if isinstance(sent, str) else ""
                        sent_norm = sent.strip()
                        variants = (list((_lexicon_cache.get(kw, []) or [])) + [kw])
                        # 按标点切分为子句
                        clauses = [c.strip() for c in re.split(r"[，。,；;、,！？!?:：]", sent_norm) if c.strip()]
                        # 优先返回包含关键词或同义词的子句
                        for clause in clauses:
                            for v in variants:
                                if v and v in clause:
                                    return clause
                        # 次优：返回关键词附近的片段
                        for v in variants:
                            idx = sent_norm.find(v)
                            if idx != -1:
                                start = max(0, idx - 8)
                                end = min(len(sent_norm), idx + len(v) + 12)
                                return sent_norm[start:end]
                        # 兜底：返回原句
                        return sent_norm

                    def _pick_representative(phrases: list, kw: str) -> str:
                        """选一个代表短语用于图像匹配：优先包含关键词/同义词、长度适中、最短优先"""
                        if not phrases:
                            return kw
                        variants = (list((_lexicon_cache.get(kw, []) or [])) + [kw])
                        scored = []
                        for p in phrases:
                            pn = p.strip()
                            # 对明显是“整句”的做一次兜底截取
                            needs_trim = (len(pn) > 34) or sum(ch in pn for ch in "，。,；;、,！？!?:：") >= 2
                            if needs_trim:
                                pn = _trim_sentence_for_keyword(pn, kw)
                            contains_kw = any(v in pn for v in variants)
                            length = len(pn)
                            # 关键字优先、长度 8–28 最优、其次最短
                            target_len_bonus = -abs(length - 18)
                            scored.append((contains_kw, target_len_bonus, length, pn))
                        scored.sort(key=lambda t: (not t[0], -t[1], t[2]))  # True优先、长度贴近18优先、短优先
                        return scored[0][3] if scored else kw

                    def _aggregate_phrases(phrases: list, kw: str, max_len: int = 30) -> str:
                        """将同一关键词的多个短语精简合并为一个气泡文本（限长）"""
                        if not phrases:
                            return kw
                        variants = (list((_lexicon_cache.get(kw, []) or [])) + [kw])
                        # 去重并排序：关键词命中优先、短优先
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
                            # 对超长/复杂标点再截一截
                            if len(piece) > 28 or sum(ch in piece for ch in "，。,；;、,！？!?:：") >= 3:
                                piece = _trim_sentence_for_keyword(piece, kw)
                            add_len = len(piece) + (1 if out else 0)  # 分隔符长度
                            if total + add_len <= max_len:
                                out.append(piece)
                                total += add_len
                            else:
                                break
                        # 如果一个都没塞进去，至少放代表短语
                        if not out:
                            out = [_pick_representative(uniq, kw)]
                        return "；".join(out)

                    # 为每个关键词选一个“代表短语”用于 CN‑CLIP 匹配；同时保留全量短语用于气泡显示
                    keywords_sorted = list(keyword_to_phrases.keys())
                    if not keywords_sorted:
                        # 无关键词时退化为评价文本（保持兼容）
                        keywords_sorted = []
                        # 可选：从 candidate_texts 里抽若干短语作为“伪关键词”显示
                    rep_map = {}  # keyword -> representative phrase
                    bubble_text_map = {}  # keyword -> aggregated concise text
                    for kw in keywords_sorted:
                        phrases = keyword_to_phrases.get(kw, [])
                        rep_map[kw] = _pick_representative(phrases, kw)
                        bubble_text_map[kw] = _aggregate_phrases(phrases, kw, max_len=int(current_app.config.get('BUBBLE_MAX_TEXT', 30)))

                    # 送入 CN‑CLIP（每个关键词仅一个候选文本）
                    max_cand = int(current_app.config.get('CNCLIP_MAX_CANDIDATES', 12))
                    candidate_texts_for_clip = [rep_map[k] for k in keywords_sorted[:max_cand]]
                    phrase_to_keyword = {rep_map[k]: k for k in keywords_sorted[:max_cand]}

                    strict_min_conf = float(current_app.config.get('CNCLIP_MIN_CONF_STRICT', 0.42))
                    file.stream.seek(0)
                    cnclip_out = match_texts_to_image_blank_regions(
                        file.stream,
                        candidate_texts_for_clip,
                        max_candidates=len(candidate_texts_for_clip)
                    )
                    mapping_raw = cnclip_out.get('text_region_mapping', []) or []

                    # 将 keyword 注入映射，并将显示文本替换为“精简合并文本”
                    for m in mapping_raw:
                        txt = m.get('text')
                        kw = phrase_to_keyword.get(txt)
                        m['keyword'] = kw
                        if kw:
                            m['text'] = bubble_text_map.get(kw) or txt  # 气泡显示用精简文本

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

                    # 在筛选与排序附近新增NMS工具并应用
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

                    # 筛选与排序（按融合置信度）+ NMS 去重
                    cleaned = [m for m in mapping_raw if float(m.get('confidence', 0.0)) >= strict_min_conf]
                    cleaned = _apply_nms(cleaned, iou_thresh=0.35, use_content_region=True)
                    final_selected = sorted(cleaned, key=_fused_conf, reverse=True)

                    # 输出区域与统计（确保一关键词一气泡）
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
                        evaluation_data['text_region_mapping'] = final_selected  # 每项含 {text(精简), keyword, region, ...}
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

                    # 入库与返回保持原样（新增 keyword_mentions、text_region_mapping 带 keyword）
                    dimensions = evaluation_data.get("dimensions", [])
                    dimensions_json = json.dumps(dimensions, ensure_ascii=False)
                    strengths = summary.get("strengths", []) or []
                    strengths_json = json.dumps(strengths, ensure_ascii=False)
                    suggestions = summary.get("suggestions", []) or []
                    suggestions_json = json.dumps(suggestions, ensure_ascii=False)
                    score = compute_total_score(dimensions)

                    # 序列化分类关键词
                    categorized_keywords_json = json.dumps(categorized_keywords, ensure_ascii=False)

                    # 获取当前用户并写库、返回（保留原有结构，新增 keyword_mentions 返回）
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

                        # 写入数据库（包含 text_region_mapping 和 keyword_mentions）
                        sql = """
                            INSERT INTO images (user_id, score, upload_time, strengths, image_url, suggestions, dimensions, filename, original_name, empty_regions, content_regions, categorized_keywords, text_region_mapping, keyword_mentions)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """
                        
                        # 序列化气泡映射信息
                        text_region_mapping_json = json.dumps(evaluation_data.get('text_region_mapping', []), ensure_ascii=False)
                        keyword_mentions_json = json.dumps(keyword_mentions, ensure_ascii=False)
                        
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
                            categorized_keywords_json,
                            text_region_mapping_json,
                            keyword_mentions_json
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
                            "keyword_mentions": keyword_mentions,
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