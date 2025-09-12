from flask import Flask,request,jsonify
from flask_jwt_extended import JWTManager,create_access_token,jwt_required,get_jwt_identity
from werkzeug.security import generate_password_hash,check_password_hash
from datetime import timedelta
import sqlite3
from functools import wraps
from flask_cors import CORS

"""
创建Flask应用实例
配置JWT密钥
设置JWT令牌过期时间为24小时
初始化JWT管理器
"""
app = Flask(__name__)
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

#注册的API
@app.route('/api/register',methods=['POST'])
def register():
    try:
        data=request.get_json()
        username=data.get('username')
        password=data.get('password')
        confirm_password=data.get('confirm_password')

        #验证输入
        if not username or not password:
            return jsonify({"message":"所有字段都要填写"}),400
        if password != confirm_password:
            return jsonify({"message":"两次输入的密码不一致"}),400
        if len(password)<6:
            return jsonify({"message":"密码长度至少6位"}),400
        
        #检查用户名是否已经存在
        conn=sqlite3.connect('database.db')
        c=conn.cursor()
        c.execute("SELECT id FROM users WHERE username=?",(username,))
        if c.fetchone():
            conn.close()
            return jsonify({"message":"用户名已存在"}),409
        hashed_password=generate_password_hash(password)
        c.execute("INSERT INTO users (username,password) VALUES(?,?)",
                  (username,hashed_password))
        conn.commit()
        conn.close()

        return jsonify({"message":"注册成功"}),201
    
    except Exception as e:
        print(f"注册失败: {e}")
        return jsonify({"message":"服务器错误，请稍后再试"}),500
    
#登录的API
@app.route('/api/login',methods=['POST'])
def login():
    try:
        data = request.get_json()
        username=data.get('username')
        password=data.get('password')

        if not username or not password:
            return jsonify({"message":"用户名或密码不能为空"}),400
        
        #查询用户
        conn=sqlite3.connect('database.db')
        c=conn.cursor()
        c.execute("SELECT id,username,password FROM users WHERE username = ?",(username,))
        user=c.fetchone()
        conn.close()

        #验证用户和密码
        if user and check_password_hash(user[2],password):
            access_token=create_access_token(identity=user[1])
            return jsonify({
                "message":"登录成功",
                "token":access_token,
                "user":{
                    "id":user[0],
                    "username":user[1]
                }
            }),200
        else:
            return jsonify({"message":"用户名或密码错误"}),401
        
    except Exception as e:
        print(f"登录失败: {e}")
        return jsonify({"message": "服务器繁忙，请稍后再试"}),500
    
#获取当前用户信息
@app.route('/api/me',methods=['GET'])
@jwt_required()
def get_current_user():
    try:
        current_username=get_jwt_identity()
        conn=sqlite3.connect('database.db')
        c=conn.cursor()
        c.execute("SELECT id,username,created_at FROM users WHERE username = ?",
                  (current_username,))
        user = c.fetchone()
        conn.close()

        if user:
            return jsonify({
                "user":{
                    "id":user[0],
                    "username":user[1],
                    "created_at":user[2]
                }
            }),200
        else:
            return jsonify({"message":"用户不存在"}),404
    except Exception as e:
        print(f"获取用户信息错误: {e}")
        return jsonify({"message":"服务器错误，请稍后再试"}),500
    
if __name__=='__main__':
    init_db()
    app.run(debug=True,port=5000)