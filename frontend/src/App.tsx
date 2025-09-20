import React, { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import Login from './auth/Login';
import Register from './auth/Register';
import './App.css';
import axios from 'axios';

function App() {
  const { isAuthenticated, logout } = useAuth(); // 从useAuth中获取logout函数
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [evaluation, setEvaluation] = useState<any>(null); // 存储评价数据
  const [error, setError] = useState<string | null>(null);

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setUploading(true);
      setError(null);
      
      try {
        // 创建FormData对象
        const formData = new FormData();
        formData.append('file', file);
        
        // 调用后端API上传图片并获取评价
        const response = await axios.post(
          'http://localhost:5000/image/upload',
          formData,
          {
            headers: {
              'Content-Type': 'multipart/form-data'
              // token会由AuthProvider的拦截器自动添加
            }
          }
        );
        
        // 保存评价数据
        setEvaluation(response.data);
        
        // 显示上传的图片
        const reader = new FileReader();
        reader.onloadend = () => {
          setSelectedImage(reader.result as string);
        };
        reader.readAsDataURL(file);
        
      } catch (err: any) {
        // 处理错误
        setError(err.response?.data?.message || '上传失败，请稍后重试');
        console.error('上传错误:', err);
      } finally {
        setUploading(false);
      }
    }
  };

  const handleVideoExplanation = () => {
    alert('视频讲解功能尚未实现');
  };

  // 添加handleLogout函数来处理退出登录
  const handleLogout = () => {
    logout(); // 调用AuthProvider中的logout函数清除认证状态
  };

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route 
        path="/" 
        element={
          isAuthenticated ? (
            <div className="app-container">
              {/* 左侧导航栏 */}
              <aside className="sidebar">
                <div className="logo">LOGO</div>
                <div className="sidebar-buttons">
                  <button className="plus-button">+</button>
                  <div className="history-section">
                    <div className="history-item">历史1</div>
                    <div className="history-item">历史2</div>
                    <div className="history-item">历史3</div>
                  </div>
                  <div className="dots">...</div>
                </div>
                <button className="exit-button" onClick={handleLogout}>退出</button> {/* 添加onClick事件 */}
              </aside>

              {/* 主内容区 */}
              <main className="main-content">
                <div className="section-title">素描</div>
                <div className="upload-container">
                  {selectedImage ? (
                    <img src={selectedImage} alt="上传的图片" className="uploaded-image" />
                  ) : (
                    <div className="upload-placeholder">
                      <div className="upload-icon">
                        <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#FFB59E" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="21 15 16 10 5 21" />
                          <line x1="17" y1="10" x2="17" y2="21" />
                        </svg>
                      </div>
                      <p className="upload-text">上传图片智绘评分</p>
                    </div>
                  )}
                  <div className="upload-button-container">
                    <label htmlFor="image-upload" className="upload-button">
                      <span className="upload-icon-text">📁</span> 上传文件或图片
                      <input 
                        id="image-upload" 
                        type="file" 
                        accept="image/*" 
                        onChange={handleImageUpload} 
                        style={{ display: 'none' }}
                      />
                    </label>
                    {uploading && <span className="uploading-text">上传中...</span>}
                    {error && <span className="error-text">{error}</span>}
                  </div>
                </div>
              </main>

              {/* 右侧评分结果区 */}
              <aside className="score-panel">
                <div className="score-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF7A45" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  评分结果
                </div>
                <div className="score-content">
                  {evaluation ? (
                    <> 
                      <div className="overall-score">
                        <div className="score-number">{evaluation.score}</div>
                        <div className="score-label">综合评分</div>
                      </div>
                      
                      <div className="evaluation-text">
                        <h4>评价：</h4>
                        <p>{evaluation.evaluation}</p>
                      </div>
                      
                      {evaluation.strengths && evaluation.strengths.length > 0 && (
                        <div className="strengths">
                          <h4>优点：</h4>
                          <ul>
                            {evaluation.strengths.map((strength: string, index: number) => (
                              <li key={index}>{strength}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {evaluation.improvements && evaluation.improvements.length > 0 && (
                        <div className="improvements">
                          <h4>改进建议：</h4>
                          <ul>
                            {evaluation.improvements.map((improvement: string, index: number) => (
                              <li key={index}>{improvement}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : selectedImage ? (
                    <div className="loading-score">
                      <p>正在生成评价...</p>
                    </div>
                  ) : (
                    <div className="empty-score">
                      <p>请上传图片以获取评分</p>
                    </div>
                  )}
                </div>
                <button className="video-button" onClick={handleVideoExplanation}>
                  <span className="video-icon">▶</span> 视频讲解
                </button>
              </aside>
            </div>
          ) : (
            // 未认证用户自动重定向到登录页面
            <Navigate to="/login" replace />
          )
        } 
      />
      {/* 添加一个通配符路由，当用户访问不存在的路径时也重定向到登录页 */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;