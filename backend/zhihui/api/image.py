from flask import Blueprint, request, jsonify, current_app, send_file, abort
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.utils import secure_filename
from pypinyin import lazy_pinyin
import os
import datetime
import json
import re
import uuid
import tempfile

from zhihui.utils import get_db_connection,get_xf_image_api

image_bp = Blueprint('image', __name__)

# 允许的文件扩展名
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg'}

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

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
            #对文件名进行安全处理，但由于中文会丢失，所以把中文转化成拼音
            filename = secure_filename(''.join(lazy_pinyin(file.filename)))
            file_ext=filename.rsplit('.',1)[1].lower()
            # 生成唯一文件名
            unique_filename = f"{uuid.uuid4().hex}.{file_ext}"
            # 创建上传目录（如果不存在）
            upload_folder = current_app.config.get('UPLOAD_FOLDER', 'uploads')
            if not os.path.exists(upload_folder):
                os.makedirs(upload_folder)
            filepath = os.path.join(upload_folder, unique_filename)
            file.save(filepath)
            try:
                # 调用API获取评价
                evaluation_data = score_image(filepath)
                
                # 获取当前用户
                current_username = get_jwt_identity()
                conn = get_db_connection()
                try:
                    c = conn.cursor()
                    # 获取用户ID
                    c.execute("SELECT id FROM users WHERE username = %s", (current_username,))
                    user = c.fetchone()
                
                    if user:
                        user_id = user['id']
                        # 保存图片信息和评价到数据库
                        c.execute(
                            "INSERT INTO images (user_id, filename, original_name, score, evaluation, strengths, improvements, upload_time) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                            (user_id, unique_filename, filename, 
                            evaluation_data.get("score", 50), 
                            evaluation_data.get("evaluation", ""), 
                            json.dumps(evaluation_data.get("strengths", [])), 
                            json.dumps(evaluation_data.get("improvements", [])), 
                            datetime.datetime.now())
                        )
                        conn.commit()
                        # 返回完整的评价信息
                        return jsonify({
                            "message": "上传成功",
                            "score": evaluation_data.get("score", 50),
                            "evaluation": evaluation_data.get("evaluation", ""),
                            "strengths": evaluation_data.get("strengths", []),
                            "improvements": evaluation_data.get("improvements", []),
                            "filename": filename
                        }), 200
                    else:
                        if os.path.exists(filepath):
                            os.remove(filepath)
                finally:
                    conn.close()
            except Exception as ai_api_error:
                #API调用失败
                if os.path.exists(filepath):
                    os.remove(filepath)
                return jsonify({
                    "message":"作品评价失败",
                    "error":str(ai_api_error),
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
        conn = get_db_connection()
        try:
            c = conn.cursor()
            
            # 获取用户ID
            c.execute("SELECT id FROM users WHERE username = %s", (current_username,))
            user = c.fetchone()
            
            if user:
                user_id = user['id']
                # 获取用户上传的图片历史
                c.execute(
                    "SELECT id, original_name, filename, score, evaluation, strengths, improvements, upload_time FROM images WHERE user_id = %s ORDER BY upload_time DESC",
                    (user_id,)
                )
                images = c.fetchall()
                
                # 转换日期时间为字符串格式，并添加图片访问URL
                result = []
                for img in images:
                    result.append({
                        "id": img['id'],
                        "original_name": img['original_name'],
                        "filename": img['filename'],
                        "score": img['score'],
                        "evaluation": img['evaluation'],
                        "strengths": json.loads(img['strengths']) if img['strengths'] else [],
                        "improvements": json.loads(img['improvements']) if img['improvements'] else [],
                        "upload_time": img['upload_time'].isoformat() if hasattr(img['upload_time'], 'isoformat') else img['upload_time'],
                        "image_url": f"/image/file/{img['filename']}"  # 添加图片访问URL
                    })
      
                return jsonify({"images": result}), 200
            else:
                return jsonify({"message": "用户不存在"}), 404
        finally:
            conn.close()
            
    except Exception as e:
        print(f"获取历史记录失败: {e}")
        return jsonify({"message": "服务器错误，请稍后再试"}), 500

# 绘画作品评分函数
def score_image(image_path):
    """
    使用讯飞图片理解API分析作品并生成评价和评分
    
    Args:
        file_stream: 文件流对象
        filename: 原始文件名（用于确定文件类型）
    
    Returns:
        dict: 包含评分和评价的字典
    """
    # 获取讯飞API实例
    xf_api = get_xf_image_api()
    
    # 定义提示词，要求模型返回JSON格式的评价
    prompt = """请对这幅作品进行专业评价，并给出0-100的评分。请以JSON格式返回结果，包含以下字段：
    - score: 整数评分(0-100)
    - evaluation: 对作品的详细文字评价
    - strengths: 作品的优点列表
    - improvements: 可以改进的方面列表
    
    请确保只返回JSON格式的内容，不要有其他文本。"""
    
    try:
        # 调用讯飞API
        response = xf_api.analyze_image(image_path, prompt)
        required_fields = ["score", "evaluation", "strengths", "improvements"]
        # 尝试从响应中提取JSON
        try:
            # 尝试直接解析JSON
            evaluation_data = json.loads(response)
            # 验证JSON结构是否包含必要字段
            for field in required_fields:
                if field not in evaluation_data:
                    raise ValueError(f"缺少必要字段: {field}")
            
            # 验证评分是否在合理范围内
            score = evaluation_data.get("score", 0)
            if not isinstance(score, (int, float)) or score < 0 or score > 100:
                raise ValueError(f"无效的评分值: {score}")
        except (json.JSONDecodeError,ValueError) as e:
            # 如果失败，尝试提取JSON部分
            json_match = re.search(r'\{.*\}', response, re.DOTALL)
            if json_match:
                try:
                    evaluation_data = json.loads(json_match.group())
                    # 再次验证提取的JSON
                    for field in required_fields:
                        if field not in evaluation_data:
                            raise ValueError(f"提取的JSON缺少必要字段: {field}")
                except (json.JSONDecodeError, ValueError) as inner_e:
                    # 如果提取的JSON也无效，抛出异常
                    raise Exception(f"无法解析有效的评价数据: {inner_e}")
            else:
                # 如果无法提取JSON，抛出异常
                raise Exception("API响应不包含有效的JSON数据")
        
        return evaluation_data
        
    except Exception as e:
        print(f"讯飞API调用失败: {e}")
        raise Exception(f"作品评价失败: {str(e)}")