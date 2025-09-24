from flask import Blueprint, request, jsonify, current_app, send_file, abort
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.utils import secure_filename
from pypinyin import lazy_pinyin
import os
import datetime
import json
import uuid

from zhihui.utils import get_db_connection,gpt_api

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
            
            try:
                file.stream.seek(0)  # 重置文件流位置
                # 调用API获取评价
                evaluation_data = gpt_api(file.stream)
                if isinstance(evaluation_data, str):
                    evaluation_data = json.loads(evaluation_data)
                # 获取当前用户
                current_username = get_jwt_identity()
                conn = get_db_connection()
                try:
                    c = conn.cursor()
                    # 获取用户ID
                    c.execute("SELECT id FROM users WHERE username = %s", (current_username,))
                    user = c.fetchone()
                
                    if user:
                        file.save(filepath)
                        user_id = user['id']
                        # 保存图片信息和评价到数据库
                        c.execute(
                            "INSERT INTO images (user_id, filename, original_name, score, strengths, improvements, upload_time) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                            (user_id, unique_filename, filename, 
                            evaluation_data.get("overall_score", 50), 
                            json.dumps(evaluation_data.get("strengths", [])), 
                            json.dumps(evaluation_data.get("suggestions", [])), 
                            datetime.datetime.now())
                        )
                        conn.commit()
                        # 返回完整的评价信息
                        return jsonify({
                            "message": "上传成功",
                            "composition": evaluation_data.get("composition", ""),
                            "line_quality": evaluation_data.get("line_quality", ""),
                            "shading": evaluation_data.get("shading", ""),
                            "creativity": evaluation_data.get("creativity", ""),
                            "overall_score": evaluation_data.get("overall_score", 0),
                            "strengths": evaluation_data.get("strengths", []),
                            "suggestions": evaluation_data.get("suggestions", []),
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
                
                # 获取用户上传的图片历史
                c.execute(
                    "SELECT id, original_name, filename, score, strengths, improvements, upload_time FROM images WHERE user_id = %s ORDER BY upload_time DESC",
                    (user_id,)
                )
                images = c.fetchall()
                print(f"查询到图片数量: {len(images)}")  # 添加调试日志
                
                # 转换日期时间为字符串格式，并添加图片访问URL
                result = []
                for img in images:
                    result.append({
                        "id": img['id'],
                        "original_name": img['original_name'],
                        "filename": img['filename'],
                        "score": img['score'],
                        "strengths": json.loads(img['strengths']) if img['strengths'] else [],
                        "improvements": json.loads(img['improvements']) if img['improvements'] else [],
                        "upload_time": img['upload_time'].isoformat() if hasattr(img['upload_time'], 'isoformat') else img['upload_time'],
                        "image_url": f"/image/file/{img['filename']}"
                    })
      
                return jsonify({"images": result}), 200
            else:
                print(f"未找到用户: {current_username}")  # 添加调试日志
                return jsonify({"message": "用户不存在"}), 404
        finally:
            conn.close()
            
    except Exception as e:
        print(f"获取历史记录失败: {e}")
        return jsonify({"message": "服务器错误，请稍后再试"}), 500

