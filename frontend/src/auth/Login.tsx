// src/auth/Login.tsx
import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import loginBg from '../assets/images/login-bg.png';

const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      
      const response = await axios.post('/user/login', {
        username,
        password
      });
      
      // 使用AuthProvider中的login方法
      login(response.data.token, response.data.user);
      //login(response.data.user, response.data.token);
      
      // 登录成功后跳转到评价系统页面
      navigate('/');
    } catch (err) {
      console.error('登录错误:', err);
      setError('登录失败，请检查用户名和密码或网络连接');
    }
  };

  return (
    <div 
      className="auth-page" 
      style={{ backgroundImage: `url(${loginBg})` }}  // 内联样式
    >
      <div className="login-container">
        <h2>用户登录</h2>
        {error && <div className="error-message">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">用户名:</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">密码:</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit">登录</button>
        </form>
        <p>还没有账号？<a href="/register">立即注册</a></p>
      </div>
    </div>
  );
};

export default Login;