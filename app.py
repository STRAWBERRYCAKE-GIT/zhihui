from flask import Flask,request,jsonify
from flask_jwt_extended import JWTManager,create_access_token,jwt_required,get_jwt_identity
from werkzeug.security import generate_password_hash,check_password_hash
from datetime import timedelta
import sqlite3
from functools import wraps
from flask_cors import CORS

from zhihui import create_app

"""
创建Flask应用实例
配置JWT密钥
设置JWT令牌过期时间为24小时
初始化JWT管理器
"""
app = create_app()
app.config['JWT_SECRET_KEY'] = 'your-secret-key'
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(hours=24)
jwt = JWTManager(app)
CORS(app)

#数据库初始化
def init_db():
    conn=sqlite3.connect('database.db')
    c=conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                 username TEXT UNIQUE NOT NULL,
                 password TEXT NOT NULL,
                 created_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    conn.commit()
    conn.close()


    
if __name__=='__main__':
    init_db()
    app.run(debug=True,port=5000)