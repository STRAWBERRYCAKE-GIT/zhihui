from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.utils import secure_filename
import os
import datetime
from zhihui.utils import get_xf_image_api
import json
import re

from zhihui.utils import get_db_connection

image_bp = Blueprint('image', __name__)

# 允许的文件扩展名
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# 图片上传API
@image_bp.route('/upload', methods=['POST'])
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
            filename = secure_filename(file.filename)
            
            # 创建上传目录（如果不存在）
            upload_folder = current_app.config.get('UPLOAD_FOLDER', 'uploads')
            if not os.path.exists(upload_folder):
                os.makedirs(upload_folder)
            
            # 生成唯一文件名
            unique_filename = f"{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}_{filename}"
            filepath = os.path.join(upload_folder, unique_filename)
            file.save(filepath)

            # 调用讯飞API获取完整评价
            evaluation_data = score_image(filepath)
            
            # 确保evaluation_data包含所有必要字段
            if not isinstance(evaluation_data, dict):
                evaluation_data = {
                    "score": 50,
                    "evaluation": "评价生成失败",
                    "strengths": [],
                    "improvements": []
                }
            
            # 获取当前用户
            current_username = get_jwt_identity()
            conn = get_db_connection()
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
            conn.close()
            # 返回完整的评价信息
            return jsonify({
                "message": "上传成功",
                "score": evaluation_data.get("score", 50),
                "evaluation": evaluation_data.get("evaluation", ""),
                "strengths": evaluation_data.get("strengths", []),
                "improvements": evaluation_data.get("improvements", []),
                "filename": unique_filename
            }), 200
            # # 这里可以添加图片评分逻辑
            # # 假设有一个评分函数 score_image(image_path)
            # score = score_image(filepath)  # 您需要实现这个函数
            
            # # 获取当前用户
            # current_username = get_jwt_identity()
            # conn = get_db_connection()
            # c = conn.cursor()
            
            # # 获取用户ID
            # c.execute("SELECT id FROM users WHERE username = %s", (current_username,))
            # user = c.fetchone()
            
            # if user:
            #     user_id = user['id']
            #     # 保存图片信息到数据库
            #     c.execute(
            #         "INSERT INTO images (user_id, filename, original_name, score, upload_time) VALUES (%s, %s, %s, %s, %s)",
            #         (user_id, unique_filename, filename, score, datetime.datetime.now())
            #     )
            #     conn.commit()
            
            # conn.close()
            
            # return jsonify({
            #     "message": "上传成功",
            #     "score": score,
            #     "filename": unique_filename
            # }), 200
        
        else:
            return jsonify({"message": "文件类型不允许"}), 400
            
    except Exception as e:
        print(f"上传失败: {e}")
        return jsonify({"message": "服务器错误，请稍后再试"}), 500

# 获取用户历史图片
@image_bp.route('/history', methods=['GET'])
@jwt_required()
def get_history():
    try:
        current_username = get_jwt_identity()
        conn = get_db_connection()
        c = conn.cursor()
        
        # 获取用户ID
        c.execute("SELECT id FROM users WHERE username = %s", (current_username,))
        user = c.fetchone()
        
        if user:
            user_id = user['id']
            # 获取用户上传的图片历史
            c.execute(
                "SELECT id, original_name, filename, score, upload_time FROM images WHERE user_id = %s ORDER BY upload_time DESC",
                (user_id,)
            )
            images = c.fetchall()
            
            # 转换日期时间为字符串格式
            result = []
            for img in images:
                result.append({
                    "id": img['id'],
                    "original_name": img['original_name'],
                    "filename": img['filename'],
                    "score": img['score'],
                    "upload_time": img['upload_time'].isoformat() if hasattr(img['upload_time'], 'isoformat') else img['upload_time']
                })
            
            conn.close()
            return jsonify({"images": result}), 200
        else:
            conn.close()
            return jsonify({"message": "用户不存在"}), 404
            
    except Exception as e:
        print(f"获取历史记录失败: {e}")
        return jsonify({"message": "服务器错误，请稍后再试"}), 500

# # 图片评分函数
# def score_image(image_path):
#     # 这里应该是您的图片评分逻辑
#     # 可以是调用机器学习模型或其他评分算法
#     # 暂时返回一个随机分数作为示例
#     import random
#     return random.randint(0, 100)
def score_image(image_path):
    """
    使用讯飞图片理解API分析图片并生成评价和评分
    
    Args:
        image_path: 图片文件路径
    
    Returns:
        dict: 包含评分和评价的字典
    """
    # 获取讯飞API实例
    xf_api = get_xf_image_api()
    
    # 定义提示词，要求模型返回JSON格式的评价
    prompt = """请对这张图片进行专业评价，并给出0-100的评分。请以JSON格式返回结果，包含以下字段：
    - score: 整数评分(0-100)
    - evaluation: 对图片的详细文字评价
    - strengths: 图片的优点列表
    - improvements: 可以改进的方面列表
    
    请确保只返回JSON格式的内容，不要有其他文本。"""
    
    try:
        # 调用讯飞API
        response = xf_api.analyze_image(image_path, prompt)
        
        # 尝试从响应中提取JSON
        try:
            # 尝试直接解析JSON
            evaluation_data = json.loads(response)
        except json.JSONDecodeError:
            # 如果直接解析失败，尝试提取JSON部分
            json_match = re.search(r'\{.*\}', response, re.DOTALL)
            if json_match:
                evaluation_data = json.loads(json_match.group())
            else:
                # 如果无法提取JSON，使用默认值
                evaluation_data = {
                    "score": 50,
                    "evaluation": "无法解析API响应",
                    "strengths": [],
                    "improvements": []
                }
        
        return evaluation_data
        
    except Exception as e:
        print(f"讯飞API调用失败: {e}")
        # 返回默认评价
        return {
            "score": 50,
            "evaluation": "API调用失败，无法生成评价",
            "strengths": [],
            "improvements": []
        }