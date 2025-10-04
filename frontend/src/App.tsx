import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import Login from './auth/Login';
import Register from './auth/Register';
import './App.css';
import axios from 'axios';
import RadarChart, { Dimension } from './components/RadarChart';
import DimensionDetail from './components/DimensionDetail';
import ScoreRing from './components/ScoreRing';
import ErrorBoundary from './components/ErrorBoundary';

function App() {
  const { isAuthenticated, logout, user } = useAuth();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [evaluation, setEvaluation] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  // 历史记录状态
  const [historyRecords, setHistoryRecords] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  // 存储每个历史记录项的缩略图数据
  const [thumbnails, setThumbnails] = useState<{ [key: string]: string }>({});
  // 存储正在加载的缩略图ID，避免重复加载
  const [loadingThumbnails, setLoadingThumbnails] = useState<Set<string>>(new Set());
  // 选中的维度状态
  const [selectedDimension, setSelectedDimension] = useState<Dimension | null>(null);

  // 图片上传处理函数
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // 立即显示本地预览（在评价生成前就可看到图片）
      try {
        // 释放上一个预览（若是 object URL）
        if (selectedImage && selectedImage.startsWith('blob:')) {
          try { URL.revokeObjectURL(selectedImage); } catch {}
        }
      } catch {}
      const previewUrl = URL.createObjectURL(file);
      setSelectedImage(previewUrl);
      setEvaluation(null); // 清空旧的评价，显示“正在生成评价...”
      setSelectedDimension(null);
      setUploading(true);
      setError(null);

      try {
        const formData = new FormData();
        formData.append('file', file);

        // 后端上传（token 由拦截器添加）
        const response = await axios.post(
          '/image/upload',
          formData,
          { headers: { 'Content-Type': 'multipart/form-data' } }
        );
        
        // 保存评价数据
        setEvaluation(response.data);
        
        await loadHistoryRecords();
        
      } catch (err: any) {
        let errorMessage = '上传失败，请稍后重试';
        
        if (err.code === 'NETWORK_ERROR' || !err.response) {
          errorMessage = '网络连接失败，请检查网络';
        } else if (err.code === 'TIMEOUT') {
          errorMessage = '请求超时，请稍后重试';
        } else if (err.response?.status === 413) {
          errorMessage = '文件太大，请选择较小的图片';
        } else if (err.response?.status === 401) {
          errorMessage = '登录已过期，请重新登录';
        } else if (err.response?.data?.message) {
          errorMessage = err.response.data.message;
        }
        
        setError(errorMessage);
        
        // 上传失败时清除本地预览
        if (selectedImage && selectedImage.startsWith('blob:')) {
          URL.revokeObjectURL(selectedImage);
          setSelectedImage(null);
        }
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

 
  // 加载历史记录函数
  const loadHistoryRecords = async () => {
    if (!isAuthenticated) return;
    
    setLoadingHistory(true);
    try {
    
      const response = await axios.get('/image/history');
      setHistoryRecords(response.data.images);
      // 重置缩略图状态
      setThumbnails({});
      setLoadingThumbnails(new Set());
      // 成功获取历史记录时清除错误状态
      setError(null);
    } catch (err: any) {
      console.error('加载历史记录失败:', err);
      let errorMessage = '加载历史记录失败';
      
      if (err.response?.status === 401) {
        errorMessage = '登录已过期，请重新登录';
      } else if (err.response?.status === 500) {
        errorMessage = '服务器错误，请稍后重试';
      }
      
      setError(errorMessage);
    } finally {
      setLoadingHistory(false);
    }
  };

  // 新增：加载单个历史记录项的缩略图
  const loadThumbnail = async (record: any) => {
    const recordId = record.id || record.filename;
    
    // 如果已经加载过或者正在加载，则不再重复加载
    if (thumbnails[recordId] || loadingThumbnails.has(recordId)) {
      return;
    }
    
    // 标记为正在加载
    setLoadingThumbnails(prev => new Set(prev).add(recordId));
    
    try {
      // 使用axios获取图片数据
      const response = await axios.get(`${record.image_url}`, {
        responseType: 'blob',
        timeout: 5000 // 缩略图加载可以设置较短的超时时间
      });
      
      // 将获取的图片数据转换为Data URL
      const thumbnailUrl = URL.createObjectURL(response.data);
      
      // 更新缩略图状态
      setThumbnails(prev => ({
        ...prev,
        [recordId]: thumbnailUrl
      }));
    } catch (err) {
      console.error(`加载缩略图失败 (ID: ${recordId}):`, err);
    }
  };

  // 点击历史记录项函数，优化错误处理
  const handleHistoryItemClick = async (record: any) => {
    try {
      // 先显示加载状态
      setEvaluation(null);
      setSelectedDimension(null)
      // 使用axios获取图片数据并确保携带token
      const response = await axios.get(`${record.image_url}`, {
        responseType: 'blob',
        timeout: 10000 // 添加超时设置
      });
      
      // 将获取的图片数据转换为Data URL
      const imageUrl = URL.createObjectURL(response.data);
      
      // 设置当前选中的图片和评价
      setSelectedImage(imageUrl);
      // 构建评价数据，确保 dimensions 是数组格式
      let dimensionsData = record.dimensions;
      
      // 如果 dimensions 是字符串，尝试解析为 JSON
      if (typeof dimensionsData === 'string') {
        try {
          dimensionsData = JSON.parse(dimensionsData);
        } catch (parseError) {
          console.error('解析 dimensions JSON 失败:', parseError);
          dimensionsData = [];
        }
      }
      
      // 确保 dimensions 是数组
      if (!Array.isArray(dimensionsData)) {
        console.warn('dimensions 不是数组格式:', dimensionsData);
        dimensionsData = [];
      }
    
      setEvaluation({
        score: record.score,
        strengths: record.strengths,
        suggestions: record.suggestions,
        dimensions: dimensionsData,
        filename: record.original_name
      });
      
      // 清除任何可能存在的错误
      setError(null);
    } catch (err: any) {
      console.error('加载历史记录项失败:', err);
      // 显示具体错误信息
      const errorMsg = err.response?.status === 403 ? 
        '没有权限查看此图片' : 
        '加载图片失败，请稍后重试';
      setError(errorMsg);
    }
  };

  // 处理维度点击
  const handleDimensionClick = (dimension: Dimension) => {
    setSelectedDimension(dimension);
  };

  // 处理返回
  const handleBackFromDetail = () => {
    setSelectedDimension(null);
  };

  // 组件挂载时加载历史记录
  useEffect(() => {
    if (isAuthenticated) {
      loadHistoryRecords();
    }
  }, [isAuthenticated]);

  // 新增：用户对象变化时也重新加载历史记录（确保是同一个用户）
  useEffect(() => {
    if (isAuthenticated && user?.id) { // 使用具体的用户ID而不是整个user对象
      // 只有在用户ID变化时才重新加载
      setHistoryRecords([]);
      setThumbnails({});
      setLoadingThumbnails(new Set());
      loadHistoryRecords();
    }
  }, [isAuthenticated, user?.id]); // 只依赖用户ID

  useEffect(() => {
  return () => {
    // 组件卸载时释放所有 Object URL
    if (selectedImage && selectedImage.startsWith('blob:')) {
      URL.revokeObjectURL(selectedImage);
    }
    Object.values(thumbnails).forEach(url => {
      if (typeof url === 'string' && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    });
  };
}, [selectedImage, thumbnails]);

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
                  <button 
                    className="plus-button" 
                    onClick={() => {
                      setSelectedImage(null);
                      setEvaluation(null);
                      setSelectedDimension(null);
                      setError(null);
                    }}
                  >+</button>
                  <div className="history-section">
                    {loadingHistory ? (
                      <div className="loading-history">加载中...</div>
                    ) : (
                      historyRecords.length > 0 ? (
                        historyRecords.map((record, index) => (
                          <div 
                            key={record.id || index}
                            className="history-item"
                            onClick={() => handleHistoryItemClick(record)}
                            onMouseEnter={() => loadThumbnail(record)} // 鼠标悬停时加载缩略图
                            style={{ cursor: 'pointer' }}
                          >
                            <div className="history-thumbnail">
                              {/* 如果已经加载了缩略图，则显示实际图片，否则显示占位符 */}
                              {thumbnails[record.id || record.filename] ? (
                                <img 
                                  src={thumbnails[record.id || record.filename]} 
                                  alt={record.filename || `历史${index + 1}`}
                                  className="thumbnail-image"
                                />
                              ) : (
                                <div className="thumbnail-placeholder">🖼️</div>
                              )}
                            </div>
                            {/* 保留文件名显示 */}
                            <div className="history-filename">
                              {record.filename || `历史${index + 1}`}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="no-history">暂无历史记录</div>
                      )
                    )}
                  </div>
                  <div className="dots">...</div>
                </div>
                <button className="exit-button" onClick={handleLogout}>退出</button>
              </aside>

              {/* 主内容区 */}
              <main className="main-content">
                <div className="section-title">素描</div>
                <div className="upload-container">
                  {selectedImage ? (
                    // 修改：显示图片时添加文件名
                    <div className="image-with-name">
                      <img 
                        src={selectedImage} 
                        alt={evaluation?.filename || "上传的图片"} 
                        className="uploaded-image"
                      />
                      {evaluation?.filename && (
                        <div className="image-filename">
                          {evaluation.filename}
                        </div>
                      )}
                    </div>
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
                    {/* 保持错误提示，但现在会在成功时清除 */}
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
                      {selectedDimension ? (
                        <DimensionDetail 
                          dimension={selectedDimension} 
                          onBack={handleBackFromDetail}
                        />
                      ) : (
                        <>
                          <ScoreRing initialScore={evaluation.score} maxScore={100} />
                          
                          {/* 使用雷达图组件 */}
                          {evaluation.dimensions && evaluation.dimensions.length > 0 && (
                            <ErrorBoundary>
                              <RadarChart 
                                dimensions={evaluation.dimensions}
                                onDimensionClick={handleDimensionClick}
                              />
                            </ErrorBoundary>
                          )}
                          
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
                          
                          {evaluation.suggestions && evaluation.suggestions.length > 0 && (
                            <div className="suggestions">
                              <h4>改进建议：</h4>
                              <ul>
                                {evaluation.suggestions.map((suggestion: string, index: number) => (
                                  <li key={index}>{suggestion}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </>
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
            <Navigate to="/login" replace />
          )
        } 
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;