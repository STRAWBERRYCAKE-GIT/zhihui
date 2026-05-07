from flask import Flask
from flask_jwt_extended import JWTManager
from flask_cors import CORS
from datetime import timedelta
from config import config
from .utils import grounding_client
import os


def create_app():
    app = Flask(__name__)
    # 初始化配置
    app.config['DEBUG'] = config.debug
    app.config['SECRET_KEY'] = config.secret_key
    app.config['JWT_SECRET_KEY'] = config.jwt_secret_key
    app.config['MAX_CONTENT_LENGTH'] = config.file_upload.max_file_size
    app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(__file__), config.file_upload.upload_folder)
    app.config['RESULT_FOLDER'] = os.path.join(os.path.dirname(__file__), config.file_result.result_folder)
    app.config['FONT_PATH'] = os.path.join(app.root_path, 'static', 'fonts', 'simhei.ttf')
    # 添加 JWT 有效期配置
    app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(hours=24)        # 访问令牌：1小时
    app.config['JWT_REFRESH_TOKEN_EXPIRES'] = timedelta(days=30)       # 刷新令牌：30天
    app.config['JWT_ALGORITHM'] = 'HS256'                              # 加密算法


    jwt = JWTManager(app)
    
    # # 加载 DINOv3 分割模型
    # try:
    #     app.config['SEGMENTOR'] = DinoV3Segmentor(config.dinov3)
    #     app.logger.info("DINOv3 segmentor loaded successfully.")
    # except Exception as e:
    #     app.logger.error(f"Failed to load DINOv3 segmentor: {e}")
    #     app.config['SEGMENTOR'] = None
    
    # 加载 DINO-X 客户端
    app.config['GROUNDING_CLIENT'] = grounding_client

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