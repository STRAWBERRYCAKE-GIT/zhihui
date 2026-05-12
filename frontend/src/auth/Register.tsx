import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const Register: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 验证表单
    if (!username || !password) {
      setError('请填写所有必填字段');
      return;
    }
    
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    
    try {
      
      // 发送注册请求 - 调用正确的API端点并传递所有必要参数
      await axios.post('/user/signin', {
        username,
        password,
        confirm_password: confirmPassword
      });
      
      setSuccess('注册成功，请登录');
      setError('');
      
      // 3秒后跳转到登录页面
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (err) {
      console.error('注册错误:', err);
      // 尝试从错误响应中获取更具体的错误信息
      if (err instanceof Error && 'response' in (err as any) && (err as any).response?.data?.message) {
        setError((err as any).response.data.message);
      } else {
        setError('注册失败，请检查网络连接或稍后重试');
      }
      setSuccess('');
    }
  };

  return (
    <div className="register-container">
      <h2>用户注册</h2>
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}
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
        <div className="form-group">
          <label htmlFor="confirmPassword">确认密码:</label>
          <input
            type="password"
            id="confirmPassword"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>
        <button type="submit">注册</button>
      </form>
      <p>已有账号？<a href="/login">立即登录</a></p>
    </div>
  );
};

export default Register;