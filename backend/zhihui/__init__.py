from flask import Flask
from flask_jwt_extended import JWTManager
from flask_cors import CORS
from datetime import timedelta
import os


def create_app():
    app = Flask(__name__)
    app.config['MYSQL_HOST'] = 'localhost'
    app.config['MYSQL_USER'] = 'root'
    app.config['MYSQL_PASSWORD'] = '123456'
    app.config['MYSQL_DB'] = 'zhihui_db'

    app.config['JWT_SECRET_KEY'] = 'your-secret-key'    #挖个坑，以后记得设置一下
    app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(hours=24)
    
    # 添加图片上传配置
    app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(__file__), 'uploads')
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB限制


    jwt = JWTManager(app)
    
    # 配置CORS - 支持DELETE方法
    CORS(app, 
         origins=['http://localhost:5173'], 
         supports_credentials=True,
         methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
         allow_headers=['Content-Type', 'Authorization'])
    
    #导入蓝图
    from .api.user import user_bp
    from .api.image import image_bp
    
    #注册蓝图
    app.register_blueprint(user_bp)
    app.register_blueprint(image_bp)
    
    return app