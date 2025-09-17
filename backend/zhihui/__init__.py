from flask import Flask
from flask_jwt_extended import JWTManager
from datetime import timedelta
import os

def create_app():
    app = Flask(__name__)
    app.config['MYSQL_HOST'] = 'localhost'
    app.config['MYSQL_USER'] = 'root'
    app.config['MYSQL_PASSWORD'] = '123456'
    app.config['MYSQL_DB'] = 'zhihui_db'
    app.config['JWT_SECRET_KEY'] = 'your-secret-key'
    app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(hours=24)
    
    # 添加图片上传配置
    app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(__file__), 'uploads')
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB限制
    
    jwt = JWTManager(app)
    
    from .user import user_bp
    from .image import image_bp  # 导入新的蓝图
    
    app.register_blueprint(user_bp)
    app.register_blueprint(image_bp)  # 注册新的蓝图
    
    return app