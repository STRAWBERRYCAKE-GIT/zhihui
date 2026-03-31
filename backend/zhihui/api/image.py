from flask import Blueprint, request, jsonify, current_app, send_file, abort
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.utils import secure_filename
from pypinyin import lazy_pinyin
import os
import threading
import datetime
import json
import uuid
from collections import defaultdict
import re
from zhihui.utils import get_db_connection, gpt_api,ImageStatus,draw_masks_overlay
import cv2
from PIL import Image
import numpy as np
from pycocotools import mask as coco_mask

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
            keyword_mentions = {}          
            if isinstance(raw, dict):
                if 'evaluation' in raw:
                    evaluation_data = raw['evaluation']
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
                    keyword_mentions = %s
                WHERE id = %s
            """, (
                score,
                json.dumps(strengths, ensure_ascii=False),
                json.dumps(suggestions, ensure_ascii=False),
                json.dumps(dimensions, ensure_ascii=False),
                json.dumps(keyword_mentions, ensure_ascii=False),
                image_id
            ))
            conn.commit()

            result = {
                "score": score,
                "dimensions": dimensions,
                "strengths": strengths,
                "suggestions": suggestions,
                "keyword_mentions": keyword_mentions,
            }
            return result, None
    except Exception as e:
        conn.rollback()
        return None, str(e)
    finally:
        conn.close()

def _perform_annotation(image_id, user_id, app):
    conn = get_db_connection()
    try:
        c = conn.cursor()
        c.execute("""
            SELECT filename, strengths, suggestions, dimensions, 
                   keyword_mentions
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

        # ---------- 提取关键词 ----------
        keyword_mentions = json.loads(img['keyword_mentions']) if img['keyword_mentions'] else {}
        keywords = []
        if isinstance(keyword_mentions, list):
            for item in keyword_mentions:
                kw = item.get('keyword')
                if kw:
                    keywords.append(kw)
        elif isinstance(keyword_mentions, dict):
            keywords = list(keyword_mentions.keys())
        keywords = list(set(keywords))   # 去重

        # ----------DINO-x 检测 ----------
        grounding_client = app.config.get('GROUNDING_CLIENT')
        if grounding_client and keywords:
            try:
                # 构建 prompt（用英文点分隔）
                prompt = ".".join(keywords)+".background"
                with open(filepath, 'rb') as f:
                    detections = grounding_client.detect(f, prompt)
                print(f"Grounding DINO 检测到 {len(detections)} 个目标")

                # 生成掩码叠加图（调试用）
                if detections and app.config.get('DEBUG'):
                    masks_overlay_path = os.path.join(app.config['RESULT_FOLDER'], 'overlays', f"overlay_{image_id}.png")
                    os.makedirs(os.path.dirname(masks_overlay_path), exist_ok=True)
                    draw_masks_overlay(filepath, detections, masks_overlay_path, alpha=0.5)
              
            except Exception as e:
                print(f"Grounding DINO 调用失败: {e}")
                import traceback
                traceback.print_exc()
        else:
            print("Grounding DINO 客户端未初始化或没有关键词")
        conn.commit()

    except Exception as e:
        print(f"批注失败: {e}")
        import traceback
        traceback.print_exc()
        c.execute("UPDATE images SET status = %s WHERE id = %s", (ImageStatus.FAILED.value, image_id))
        conn.commit()
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

        # 启动后台线程执行批注
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
                    "SELECT id, score, upload_time, strengths, image_url, suggestions, dimensions, filename, original_name, empty_regions, content_regions, text_region_mapping, keyword_mentions FROM images WHERE user_id = %s ORDER BY upload_time DESC",
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

            result_folder = current_app.config.get('RESULT_FOLDER', 'results')
            overlays_path = os.path.join(result_folder, 'overlays', f"overlay_{image_id}.png")
            try:
                if os.path.exists(overlays_path):
                    os.remove(overlays_path)
                    print(f"已删除叠加图: {overlays_path}")
            except Exception as e:
                print(f"删除叠加图失败: {e}")
                
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
