from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
import os
from werkzeug.utils import secure_filename
import datetime

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
            
            # 这里可以添加图片评分逻辑
            # 假设有一个评分函数 score_image(image_path)
            score = score_image(filepath)  # 您需要实现这个函数
            
            # 获取当前用户
            current_username = get_jwt_identity()
            conn = get_db_connection()
            c = conn.cursor()
            
            # 获取用户ID
            c.execute("SELECT id FROM users WHERE username = %s", (current_username,))
            user = c.fetchone()
            
            if user:
                user_id = user['id']
                # 保存图片信息到数据库
                c.execute(
                    "INSERT INTO images (user_id, filename, original_name, score, upload_time) VALUES (%s, %s, %s, %s, %s)",
                    (user_id, unique_filename, filename, score, datetime.datetime.now())
                )
                conn.commit()
            
            conn.close()
            
            return jsonify({
                "message": "上传成功",
                "score": score,
                "filename": unique_filename
            }), 200
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

# 图片评分函数
def score_image(image_path):
    # 这里应该是您的图片评分逻辑
    # 可以是调用机器学习模型或其他评分算法
    # 暂时返回一个随机分数作为示例
    import random
    return random.randint(0, 100)