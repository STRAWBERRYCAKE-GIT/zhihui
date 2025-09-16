from flask import Flask
from flask_jwt_extended import JWTManager
from datetime import timedelta

def create_app():
    app=Flask(__name__)
    app.config['MYSQL_HOST']='localhost'
    app.config['MYSQL_USER']='root'
    app.config['MYSQL_PASSWORD']='123456'       #注意改成自己的MYSQL密码，并且要创建数据库和表
    app.config['MYSQL_DB']='zhihui_db'
    app.config['JWT_SECRET_KEY'] = 'your-secret-key'    #之后记得要设置一下密钥
    app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(hours=24)
    jwt = JWTManager(app)
    from .views import user
    app.register_blueprint(user.user_bp)
    return app
