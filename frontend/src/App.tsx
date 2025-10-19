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
import ImageBubbles from './components/ImageBubbles';
import { filterEvaluationText } from './utils/textFilter';

function App() {
  const { isAuthenticated, logout, user } = useAuth();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadSuccess, setUploadSuccess] = useState<boolean>(false); // 新增：跟踪上传是否成功
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
  // 气泡相关状态
  const [showBubbles, setShowBubbles] = useState<boolean>(false);
  const [bubbleSentences, setBubbleSentences] = useState<string[]>([]);
  // 拖拽状态
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  // +按钮点击处理函数
  const handlePlusButtonClick = () => {
    const fileInput = document.getElementById('imageInput') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  };

  // 拖拽事件处理函数
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        // 创建模拟的文件输入事件
        const mockEvent = {
          target: {
            files: [file]
          }
        } as unknown as React.ChangeEvent<HTMLInputElement>;
        
        handleImageUpload(mockEvent);
      } else {
        setError('请选择图片文件');
      }
    }
  };

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
      setUploadSuccess(false); // 确保开始新上传时重置成功状态
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
        console.log('Upload response data:', response.data);
        setEvaluation(response.data);
        
        // 生成气泡文本
        const sentences = filterEvaluationText(response.data);
        console.log('原始评价数据:', response.data);
        console.log('概括化后的气泡文本:', sentences);
        setBubbleSentences(sentences);
        setShowBubbles(true);
        
        await loadHistoryRecords();
        
        // 新增：上传成功，更新状态
        setUploading(false);
        setUploadSuccess(true);
        
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
      
      // 新增：自动渐进式加载缩略图
      // 先加载前几个缩略图（比如前4个），让用户尽快看到内容
      if (response.data.images && response.data.images.length > 0) {
        // 立即加载前4个缩略图
        const initialLoadCount = Math.min(4, response.data.images.length);
        for (let i = 0; i < initialLoadCount; i++) {
          loadThumbnail(response.data.images[i]);
        }
        
        // 使用setTimeout延迟加载剩余的缩略图，避免一次性加载过多影响性能
        if (response.data.images.length > initialLoadCount) {
          for (let i = initialLoadCount; i < response.data.images.length; i++) {
            setTimeout(() => {
              loadThumbnail(response.data.images[i]);
            }, (i - initialLoadCount) * 300); // 每个缩略图间隔300毫秒加载
          }
        }
      }
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
      setSelectedDimension(null);
      setUploading(false); // 重置上传状态
      setUploadSuccess(false); // 重置成功状态
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
      let strengthsData = record.strengths;
      let suggestionsData = record.suggestions;
      let emptyRegionsData = record.empty_regions || record.emptyRegions || [];
      let contentRegionsData = record.content_regions || record.contentRegions || [];
      
      // 如果 dimensions 是字符串，尝试解析为 JSON
      if (typeof dimensionsData === 'string') {
        try {
          dimensionsData = JSON.parse(dimensionsData);
        } catch (parseError) {
          console.error('解析 dimensions JSON 失败:', parseError);
          dimensionsData = [];
        }
      }
      
      // 如果 strengths 是字符串，尝试解析为 JSON
      if (typeof strengthsData === 'string') {
        try {
          strengthsData = JSON.parse(strengthsData);
        } catch (parseError) {
          console.error('解析 strengths JSON 失败:', parseError);
          strengthsData = [];
        }
      }
      
      // 如果 suggestions 是字符串，尝试解析为 JSON
      if (typeof suggestionsData === 'string') {
        try {
          suggestionsData = JSON.parse(suggestionsData);
        } catch (parseError) {
          console.error('解析 suggestions JSON 失败:', parseError);
          suggestionsData = [];
        }
      }
      
      // 解析 empty_regions 数据
      if (typeof emptyRegionsData === 'string') {
        try {
          emptyRegionsData = JSON.parse(emptyRegionsData);
        } catch (parseError) {
          console.error('解析 empty_regions JSON 失败:', parseError);
          emptyRegionsData = [];
        }
      }
      
      // 解析 content_regions 数据
      if (typeof contentRegionsData === 'string') {
        try {
          contentRegionsData = JSON.parse(contentRegionsData);
        } catch (parseError) {
          console.error('解析 content_regions JSON 失败:', parseError);
          contentRegionsData = [];
        }
      }
      
      // 确保都是数组
      if (!Array.isArray(dimensionsData)) {
        console.warn('dimensions 不是数组格式:', dimensionsData);
        dimensionsData = [];
      }
      if (!Array.isArray(strengthsData)) {
        console.warn('strengths 不是数组格式:', strengthsData);
        strengthsData = [];
      }
      if (!Array.isArray(suggestionsData)) {
        console.warn('suggestions 不是数组格式:', suggestionsData);
        suggestionsData = [];
      }
      if (!Array.isArray(emptyRegionsData)) {
        console.warn('empty_regions 不是数组格式:', emptyRegionsData);
        emptyRegionsData = [];
      }
      if (!Array.isArray(contentRegionsData)) {
        console.warn('content_regions 不是数组格式:', contentRegionsData);
        contentRegionsData = [];
      }
    
      setEvaluation({
        score: record.score,
        strengths: strengthsData,
        suggestions: suggestionsData,
        dimensions: dimensionsData,
        filename: record.original_name,
        emptyRegions: emptyRegionsData,  // 添加空白区域数据
        contentRegions: contentRegionsData  // 添加内容区域数据
      });
      
      // 生成气泡文本
      const sentences = filterEvaluationText({
        score: record.score,
        strengths: strengthsData,
        suggestions: suggestionsData,
        dimensions: dimensionsData
      });
      console.log('历史记录评价数据:', {
        score: record.score,
        strengths: strengthsData,
        suggestions: suggestionsData,
        dimensions: dimensionsData,
        emptyRegions: emptyRegionsData,
        contentRegions: contentRegionsData
      });
      console.log('历史记录概括化后的气泡文本:', sentences);
      setBubbleSentences(sentences);
      setShowBubbles(true);
      
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

  // 切换气泡显示
  const toggleBubbles = () => {
    setShowBubbles(!showBubbles);
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
                 <div className="sidebar-content">
                   <div className="logo">LOGO</div>
                   <div className="sidebar-buttons">
                     <button 
                       className="plus-button" 
                       onClick={handlePlusButtonClick}
                     >
                       <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                         <line x1="12" y1="6" x2="12" y2="18"/>
                         <line x1="6" y1="12" x2="18" y2="12"/>
                       </svg>
                     </button>
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
                   </div>
                 </div>
                 
                 {/* 固定在底部的退出按钮区域 */}
                 <div className="logout-area">
                   <button className="exit-button" onClick={handleLogout}>退出</button>
                 </div>
               </aside>

              {/* 主内容区 */}
           <main className="main-content">
             <div className="section-title">素描</div>
             
             {/* 气泡控制按钮 - 与素描字样同高度，与图片右边缘对齐 */}
             {selectedImage && bubbleSentences.length > 0 && (
               <button 
                 className="bubble-control-btn-aligned"
                 onClick={toggleBubbles}
                 title={showBubbles ? "隐藏评价气泡" : "显示评价气泡"}
               >
                 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                   <circle cx="12" cy="12" r="10"/>
                   <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                   <line x1="9" y1="9" x2="9.01" y2="9"/>
                   <line x1="15" y1="9" x2="15.01" y2="9"/>
                 </svg>
                 {showBubbles ? '隐藏气泡' : '显示气泡'}
               </button>
             )}
             
             <div className="upload-container">
                  {selectedImage ? (
                    // 修改：显示图片时添加文件名和气泡
                    <div className="image-with-name">
                      <ImageBubbles 
                        imageUrl={selectedImage}
                        sentences={bubbleSentences}
                        isVisible={showBubbles}
                        emptyRegions={evaluation?.empty_regions || evaluation?.emptyRegions || []}
                        contentRegions={evaluation?.content_regions || evaluation?.contentRegions || []}
                        textRegionMapping={evaluation?.text_region_mapping || []}
                      />
                      {evaluation?.filename && (
                        <div className="image-filename">
                          {evaluation.filename}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div 
                      className={`upload-placeholder ${isDragOver ? 'drag-over' : ''}`}
                      onDragOver={handleDragOver}
                      onDragEnter={handleDragEnter}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                    >
                      <div className="upload-icon">
                        <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#FFB59E" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="21,15 16,10 5,21" />
                        </svg>
                      </div>
                      <div className="upload-text">
                        <p>拖拽图片到此处</p>
                      </div>
                    </div>
                  )}
                  
                  {uploading && <span className="uploading-text">上传中...</span>}
                  {uploadSuccess && !uploading && <span className="success-text">上传成功</span>}
                  {error && <span className="error-text">{error}</span>}
                  
                  {/* 隐藏的文件输入，供+按钮使用 */}
                  <input
                    id="imageInput"
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    style={{ display: 'none' }}
                  />
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
                          <ScoreRing initialScore={Number(evaluation.score) || 0} maxScore={100} />
                          
                          {/* 使用雷达图组件 */}
                          {evaluation.dimensions && evaluation.dimensions.length > 0 && (
                            <RadarChart 
                              dimensions={evaluation.dimensions} 
                              onDimensionClick={handleDimensionClick}
                            />
                          )}
                          
                          {evaluation.strengths && evaluation.strengths.length > 0 && (
                            <div className="strengths">
                              <h4>优点：</h4>
                              <ul>
                                {evaluation.strengths.map((strength: any, index: number) => (
                                  <li key={index}>{typeof strength === 'string' ? strength : String(strength)}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          
                          {evaluation.suggestions && evaluation.suggestions.length > 0 && (
                            <div className="suggestions">
                              <h4>改进建议：</h4>
                              <ul>
                                {evaluation.suggestions.map((suggestion: any, index: number) => (
                                  <li key={index}>{typeof suggestion === 'string' ? suggestion : String(suggestion)}</li>
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