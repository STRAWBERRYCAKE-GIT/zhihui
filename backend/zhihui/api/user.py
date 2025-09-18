from flask import Blueprint,request,jsonify,current_app
from flask_jwt_extended import create_access_token,jwt_required,get_jwt_identity
from werkzeug.security import generate_password_hash,check_password_hash
from zhihui.utils import get_db_connection


#用户相关的蓝图，包括注册、登录、注销等
user_bp=Blueprint('user',__name__)



#注册的API
@user_bp.route('/user/signin',methods=['POST'])
def signin():
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
        conn=get_db_connection()
        c=conn.cursor()
        c.execute("SELECT id FROM users WHERE username=%s",(username,))
        if c.fetchone():
            conn.close()
            return jsonify({"message":"用户名已存在"}),409
        hashed_password=generate_password_hash(password)
        c.execute("INSERT INTO users (username,password) VALUES(%s,%s)",
                  (username,hashed_password))
        conn.commit()
        conn.close()

        return jsonify({"message":"注册成功"}),201
    
    except Exception as e:
        print(f"注册失败: {e}")
        return jsonify({"message":"服务器错误，请稍后再试"}),500
    
#登录的API
@user_bp.route('/user/login',methods=['POST'])
def login():
    try:
        data = request.get_json()
        username=data.get('username')
        password=data.get('password')

        if not username or not password:
            return jsonify({"message":"用户名或密码不能为空"}),400

        
        #查询用户
        conn=get_db_connection()
        c=conn.cursor()
        c.execute("SELECT id,username,password FROM users WHERE username = %s",(username,))
        user=c.fetchone()
        conn.close()
        #验证用户和密码
        if user and check_password_hash(user['password'],password):
            access_token=create_access_token(identity=user['username'])
            return jsonify({
                "message":"登录成功",
                "token":access_token,
                "user":{
                    "id":user['id'],
                    "username":user['username']
                }
            }),200
        else:
            return jsonify({"message":"用户名或密码错误"}),401
        
    except Exception as e:
        print(f"登录失败: {e}")
        return jsonify({"message": "服务器繁忙，请稍后再试"}),500
    
#获取当前用户信息
@user_bp.route('/user/me',methods=['GET'])
@jwt_required()
def get_current_user():
    try:
        current_username=get_jwt_identity()
        conn=get_db_connection()
        c=conn.cursor()
        c.execute("SELECT id,username,created_at FROM users WHERE username = %s",
                  (current_username,))
        user = c.fetchone()
        conn.close()

        if user:
            # 确保日期时间以 ISO 格式返回
            created_at = user['created_at']
            created_at_str = created_at.isoformat()
            
            return jsonify({
                "user":{
                    "id":user['id'],
                    "username":user['username'],
                    "created_at":created_at_str
                }
            }),200
        else:
            return jsonify({"message":"用户不存在"}),404
    except Exception as e:
        print(f"获取用户信息错误: {e}")
        return jsonify({"message":"服务器错误，请稍后再试"}),500