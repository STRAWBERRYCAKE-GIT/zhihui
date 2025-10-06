from flask import Blueprint, request, jsonify, current_app, send_file, abort
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.utils import secure_filename
from pypinyin import lazy_pinyin
import os
import datetime
import json
import uuid
import io  # 添加io模块导入
from zhihui.utils import get_db_connection, gpt_api, detect_blank_spaces, calculate_bubble_positions, detect_keyword_regions  # 添加detect_keyword_regions导入

image_bp = Blueprint('image', __name__)

# 允许的文件扩展名
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg','webp'}

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

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
            file_ext = filename.rsplit('.',1)[1].lower()
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
                
                # ==== 新增部分：使用dinov3检测空白区域 ====
                try:
                    file.stream.seek(0)  # 再次重置文件流位置
                    # 打开图片获取尺寸信息
                    from PIL import Image
                    img = Image.open(file.stream)
                    width, height = img.size
                    
                    file.stream.seek(0)  # 重置文件流位置
                    # 调用dinov3检测空白区域
                    blank_spaces = detect_blank_spaces(file.stream)
                    
                    # 计算气泡批注的最佳位置
                    bubble_positions = calculate_bubble_positions(width, height, blank_spaces)
                    # 将气泡位置信息添加到评价数据中
                    evaluation_data['empty_regions'] = bubble_positions
                except Exception as e:
                    print(f"dinov3处理失败: {e}")
                    # 如果dinov3处理失败，添加默认位置
                    evaluation_data['empty_regions'] = []
                # =======================================
                
                try:
                    # 解析评价结果
                    dimensions = evaluation_data.get("dimensions", [])
                    dimensions_json = json.dumps(dimensions, ensure_ascii=False)
                    summary = evaluation_data.get("summary", {})
                    strengths = summary.get("strengths", [])
                    strengths_json = json.dumps(strengths, ensure_ascii=False)
                    suggestions = summary.get("suggestions", [])
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
                        
                        # 修改SQL语句，添加categorized_keywords字段
                        sql = """
                            INSERT INTO images (user_id, score, upload_time, strengths, image_url, suggestions, dimensions, filename, original_name, empty_regions, categorized_keywords)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                            categorized_keywords_json
                        )
                        c.execute(sql, params)
                        conn.commit()
                        # 返回完整的评价信息，包括分类关键词
                        return jsonify({
                            "message": "上传成功",
                            "score": score,
                            "dimensions": dimensions,
                            "strengths": strengths,
                            "suggestions": suggestions,
                            "filename": unique_filename,
                            "original_name": file.filename,
                            "empty_regions": evaluation_data.get('empty_regions', []),
                            "categorized_keywords": categorized_keywords
                        }), 200
                finally:
                    conn.close()
            except Exception as e:
                return jsonify({
                    "message":"作品评价失败",
                    "error":str(e),
                    "suggestion":"请稍后重试或联系管理员"
                }),500

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
        print(f"当前登录用户: {current_username}")  # 添加调试日志
        
        conn = get_db_connection()
        try:
            c = conn.cursor()
            
            # 获取用户ID
            c.execute("SELECT id FROM users WHERE username = %s", (current_username,))
            user = c.fetchone()
            
            if user:
                user_id = user['id']
                print(f"用户ID: {user_id}")  # 添加调试日志
                
                # 修改SQL查询，添加categorized_keywords字段
                c.execute(
                    "SELECT id, score, upload_time, strengths, image_url, suggestions, dimensions, filename, original_name, empty_regions, categorized_keywords FROM images WHERE user_id = %s ORDER BY upload_time DESC",
                    (user_id,)
                )
                images = c.fetchall()
                print(f"查询到图片数量: {len(images)}")  # 添加调试日志
                
                # 转换日期时间为字符串格式，并添加图片访问URL
                result = []
                for img in images:
                    # 修复：移除错误的文件流操作，数据库查询中没有file对象
                    strengths = json.loads(img['strengths']) if img['strengths'] else []
                    suggestions = json.loads(img['suggestions']) if img['suggestions'] else []
                    dimensions = json.loads(img['dimensions']) if img['dimensions'] else []
                    empty_regions = json.loads(img['empty_regions']) if img['empty_regions'] else []
                    # 解析分类关键词
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

# 添加新API: 基于关键词检测图像区域
@image_bp.route('/image/detect_by_keywords', methods=['POST'])  # 修改为image_bp.route
@jwt_required()  # 修改为jwt_required
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
        
        # 使用关键词检测区域
        detected_regions = detect_keyword_regions(image_stream, keywords, num_regions=5)
        
        return jsonify({
            'regions': detected_regions,
            'success': True
        })
    except Exception as e:
        print(f"关键词检测出错: {e}")
        return jsonify({'error': str(e)}), 500

