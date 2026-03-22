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
import ImageBubbles from './components/ImageBubbles';


function App() {
  const { isAuthenticated, logout, user } = useAuth();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadSuccess, setUploadSuccess] = useState<boolean>(false);
  const [evaluation, setEvaluation] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState<boolean>(false);
  const [currentImageId, setCurrentImageId] = useState<number | null>(null);
  const [evaluationCompleted, setEvaluationCompleted] = useState<boolean>(false);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);
  const [annotationCompleted, setAnnotationCompleted] = useState<boolean>(false);
  // 历史记录状态
  const [historyRecords, setHistoryRecords] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  // 缩略图状态
  const [thumbnails, setThumbnails] = useState<{ [key: string]: string }>({});
  const [loadingThumbnails, setLoadingThumbnails] = useState<Set<string>>(new Set());

  // 选中的维度
  const [selectedDimension, setSelectedDimension] = useState<Dimension | null>(null);

  // 气泡相关
  const [showBubbles, setShowBubbles] = useState<boolean>(false);
  const [bubbleSentences, setBubbleSentences] = useState<string[]>([]);

  // 拖拽态
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  // 视口扣减量（导航高度）
  const [viewportOffset, setViewportOffset] = useState(0);
  useEffect(() => {
    const selectors = ['.top-nav', '.app-header', 'header'];
    const computeOffset = () => {
      let h = 0;
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el) { h = el.offsetHeight; break; }
      }
      setViewportOffset(h);
    };
    computeOffset();
    window.addEventListener('resize', computeOffset);
    return () => window.removeEventListener('resize', computeOffset);
  }, []);

  // +按钮
  const handlePlusButtonClick = () => {
    const fileInput = document.getElementById('imageInput') as HTMLInputElement;
    if (fileInput) fileInput.click();
  };

  // 拖拽处理
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
        const mockEvent = { target: { files: [file] } } as unknown as React.ChangeEvent<HTMLInputElement>;
        handleImageUpload(mockEvent);
      } else {
        setError('请选择图片文件');
      }
    }
  };

  // 上传图片
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 立即预览
    try {
      if (selectedImage && selectedImage.startsWith('blob:')) {
        try { URL.revokeObjectURL(selectedImage); } catch {}
      }
    } catch {}
    const previewUrl = URL.createObjectURL(file);
    setSelectedImage(previewUrl);
    setEvaluation(null);
    setSelectedDimension(null);
    setUploading(true);
    setUploadSuccess(false);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await axios.post('/image/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      const { image_id, filename, original_name } = response.data;
      setCurrentImageId(image_id);
      setUploadSuccess(true);
      setUploading(false);
      setEvaluationCompleted(false);
      setAnnotationCompleted(false);
      setEvaluation({
        filename: original_name,
        strengths: [],
        suggestions: [],
        dimensions: [],
        empty_regions: [],
        content_regions: [],
        text_region_mapping: []
      });
      // // 立即设置评分与区域映射，避免评分区空白
      // setEvaluation({
      //   score: response.data?.score ?? 0,
      //   strengths: Array.isArray(response.data?.strengths) ? response.data.strengths : [],
      //   suggestions: Array.isArray(response.data?.suggestions) ? response.data.suggestions : [],
      //   dimensions: Array.isArray(response.data?.dimensions) ? response.data.dimensions : [],
      //   filename: response.data?.original_name ?? response.data?.filename ?? '',
      //   empty_regions: Array.isArray(response.data?.empty_regions) ? response.data.empty_regions : [],
      //   content_regions: Array.isArray(response.data?.content_regions) ? response.data.content_regions : [],
      //   text_region_mapping: Array.isArray(response.data?.text_region_mapping) ? response.data.text_region_mapping : []
      // });

      // // 仅使用关键词映射文本驱动气泡显示
      // const mapped = Array.isArray(response.data?.text_region_mapping)
      //   ? response.data.text_region_mapping
      //       .map((m: any) => (typeof m?.text === 'string' ? m.text.trim() : ''))
      //       .filter((t: string) => t.length > 0)
      //   : [];
      // setBubbleSentences(mapped);
      // setShowBubbles(mapped.length > 0);

      // // 先结束上传态，让评分/气泡先出现
      // setUploading(false);
      // setUploadSuccess(true);

      // 历史后台加载（不阻塞UI）
      loadHistoryRecords();

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

      // 上传失败清理预览
      if (selectedImage && selectedImage.startsWith('blob:')) {
        URL.revokeObjectURL(selectedImage);
        setSelectedImage(null);
      }
      setUploading(false);
    }
  };

  // const handleEvaluate = async () => {
  // if (!currentImageId) {
  //   setError('没有可评价的图片');
  //   return;
  // }
  // setEvaluating(true);
  // setError(null);
  // try {
  //   const response = await axios.post(`/image/evaluate/${currentImageId}`);
  //   const data = response.data;

  //   setEvaluation({
  //     score: data.score ?? 0,
  //     strengths: Array.isArray(data.strengths) ? data.strengths : [],
  //     suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
  //     dimensions: Array.isArray(data.dimensions) ? data.dimensions : [],
  //     filename: evaluation?.filename || '',
  //     empty_regions: Array.isArray(data.empty_regions) ? data.empty_regions : [],
  //     content_regions: Array.isArray(data.content_regions) ? data.content_regions : [],
  //     text_region_mapping: Array.isArray(data.text_region_mapping) ? data.text_region_mapping : []
  //   });

  //   const mapped = Array.isArray(data.text_region_mapping)
  //     ? data.text_region_mapping
  //         .map((m: any) => (typeof m?.text === 'string' ? m.text.trim() : ''))
  //         .filter((t: string) => t.length > 0)
  //     : [];
  //   setBubbleSentences(mapped);
  //   setShowBubbles(mapped.length > 0);
  //   setEvaluationCompleted(true);
  // } catch (err: any) {
  //   let errorMessage = '评价失败，请稍后重试';
  //   if (err.response?.data?.message) errorMessage = err.response.data.message;
  //   setError(errorMessage);
  //   setEvaluationCompleted(false);
  // } finally {
  //   setEvaluating(false);
  // }
  // };
  const handleEvaluate = async () => {
    if (!currentImageId) {
      setError('没有可评价的图片');
      return;
    }
    setEvaluating(true);
    setError(null);
    try {
      const response = await axios.post(`/image/evaluate/${currentImageId}`);
      const data = response.data;

      // 立即设置评价数据（不含批注）
      setEvaluation({
        score: data.score ?? 0,
        strengths: Array.isArray(data.strengths) ? data.strengths : [],
        suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
        dimensions: Array.isArray(data.dimensions) ? data.dimensions : [],
        filename: evaluation?.filename || '',
        empty_regions: [],            // 批注尚未生成
        content_regions: [],
        text_region_mapping: []
      });
      setEvaluationCompleted(true);
      setEvaluating(false);

      // 开始轮询批注状态
      startPolling(currentImageId);

    } catch (err: any) {
      // 错误处理...
      setEvaluating(false);
    }
  };

  const startPolling = (imageId: number) => {
    // 清除之前的轮询
    if (pollingInterval) clearInterval(pollingInterval);

    const poll = async () => {
      try {
        const res = await axios.get(`/image/${imageId}`);
        const img = res.data;

        // 如果批注字段已有数据，认为批注完成
        if (img.text_region_mapping && img.text_region_mapping.length > 0) {
          // 更新 evaluation 中的批注相关字段
          setEvaluation((prev: any) => ({
            ...prev,
            empty_regions: img.empty_regions || [],
            content_regions: img.content_regions || [],
            text_region_mapping: img.text_region_mapping || []
          }));

          // 更新气泡句子
          const mapped = (img.text_region_mapping || [])
            .map((m: any) => (typeof m?.text === 'string' ? m.text.trim() : ''))
            .filter((t: string) => t.length > 0);
          setBubbleSentences(mapped);
          setShowBubbles(mapped.length > 0);
          setAnnotationCompleted(true);

          // 停止轮询
          if (pollingInterval) clearInterval(pollingInterval);
          setPollingInterval(null);
        } else if (img.status === 'FAILED') {
          // 批注失败，停止轮询并提示
          setError('批注生成失败');
          if (pollingInterval) clearInterval(pollingInterval);
          setPollingInterval(null);
        }
        // 否则继续轮询
      } catch (err) {
        console.error('轮询批注失败:', err);
      }
    };

    // 立即执行一次
    poll();
    // 每 2 秒轮询
    const interval = setInterval(poll, 2000);
    setPollingInterval(interval);
  };
  const handleVideoExplanation = () => {
    alert('视频讲解功能尚未实现');
  };

  useEffect(() => {
    return () => {
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, [pollingInterval]);

  // 退出登录
  const handleLogout = () => {
    logout();
  };

  // 加载历史记录
  const loadHistoryRecords = async () => {
    if (!isAuthenticated) return;

    setLoadingHistory(true);
    try {
      const response = await axios.get('/image/history');
      setHistoryRecords(response.data.images);
      setThumbnails({});
      setLoadingThumbnails(new Set());
      setError(null);

      if (response.data.images && response.data.images.length > 0) {
        const initialLoadCount = Math.min(4, response.data.images.length);
        for (let i = 0; i < initialLoadCount; i++) {
          loadThumbnail(response.data.images[i]);
        }
        if (response.data.images.length > initialLoadCount) {
          for (let i = initialLoadCount; i < response.data.images.length; i++) {
            setTimeout(() => {
              loadThumbnail(response.data.images[i]);
            }, (i - initialLoadCount) * 300);
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

  // 加载缩略图
  const loadThumbnail = async (record: any) => {
    const recordId = record.id || record.filename;
    if (thumbnails[recordId] || loadingThumbnails.has(recordId)) return;

    setLoadingThumbnails(prev => new Set(prev).add(recordId));
    try {
      const response = await axios.get(`${record.image_url}`, {
        responseType: 'blob',
        timeout: 5000
      });
      const thumbnailUrl = URL.createObjectURL(response.data);
      setThumbnails(prev => ({ ...prev, [recordId]: thumbnailUrl }));
    } catch (err) {
      console.error(`加载缩略图失败 (ID: ${recordId}):`, err);
    }
  };

  // 点击历史记录项
  const handleHistoryItemClick = async (record: any) => {
    try {
      setEvaluation(null);
      setSelectedDimension(null);
      setUploading(false);
      setUploadSuccess(false);

      const response = await axios.get(`${record.image_url}`, {
        responseType: 'blob',
        timeout: 10000
      });
      const imageUrl = URL.createObjectURL(response.data);
      setSelectedImage(imageUrl);

      let dimensionsData = record.dimensions;
      let strengthsData = record.strengths;
      let suggestionsData = record.suggestions;
      let emptyRegionsData = record.empty_regions || record.emptyRegions || [];
      let contentRegionsData = record.content_regions || record.contentRegions || [];

      if (typeof dimensionsData === 'string') {
        try { dimensionsData = JSON.parse(dimensionsData); } catch { dimensionsData = []; }
      }
      if (typeof strengthsData === 'string') {
        try { strengthsData = JSON.parse(strengthsData); } catch { strengthsData = []; }
      }
      if (typeof suggestionsData === 'string') {
        try { suggestionsData = JSON.parse(suggestionsData); } catch { suggestionsData = []; }
      }
      if (typeof emptyRegionsData === 'string') {
        try { emptyRegionsData = JSON.parse(emptyRegionsData); } catch { emptyRegionsData = []; }
      }
      if (typeof contentRegionsData === 'string') {
        try { contentRegionsData = JSON.parse(contentRegionsData); } catch { contentRegionsData = []; }
      }

      if (!Array.isArray(dimensionsData)) dimensionsData = [];
      if (!Array.isArray(strengthsData)) strengthsData = [];
      if (!Array.isArray(suggestionsData)) suggestionsData = [];
      if (!Array.isArray(emptyRegionsData)) emptyRegionsData = [];
      if (!Array.isArray(contentRegionsData)) contentRegionsData = [];

      // 解析历史记录中的气泡映射信息
      let textRegionMappingData = record.text_region_mapping || [];
      
      console.log('🔍 历史记录批注数据调试:', {
        recordId: record.id,
        originalName: record.original_name,
        rawTextRegionMapping: record.text_region_mapping,
        dataType: typeof record.text_region_mapping,
        dataLength: record.text_region_mapping ? record.text_region_mapping.length : 0
      });
      
      if (typeof textRegionMappingData === 'string') {
        try { 
          textRegionMappingData = JSON.parse(textRegionMappingData); 
          console.log('✅ JSON解析成功:', textRegionMappingData);
        } catch (e) { 
          console.log('❌ JSON解析失败:', e);
          textRegionMappingData = []; 
        }
      }
      if (!Array.isArray(textRegionMappingData)) {
        console.log('⚠️ 数据不是数组，重置为空数组');
        textRegionMappingData = [];
      }

      // 设置评分与基础区域（历史项现在也包含气泡映射信息）
      setEvaluation({
        score: record.score,
        strengths: strengthsData,
        suggestions: suggestionsData,
        dimensions: dimensionsData,
        filename: record.original_name || record.filename || '',
        empty_regions: emptyRegionsData,
        content_regions: contentRegionsData,
        text_region_mapping: textRegionMappingData
      });

      // 气泡文本使用历史记录中的关键词映射
      const mapped = Array.isArray(textRegionMappingData)
        ? textRegionMappingData
            .map((m: any) => (typeof m?.text === 'string' ? m.text.trim() : ''))
            .filter((t: string) => t.length > 0)
        : [];
      
      console.log('🎈 气泡文本处理结果:', {
        mappingCount: textRegionMappingData.length,
        extractedTexts: mapped,
        willShowBubbles: mapped.length > 0
      });
      
      setBubbleSentences(mapped);
      setShowBubbles(mapped.length > 0);
      setError(null);
    } catch (err: any) {
      console.error('加载历史记录项失败:', err);
      const errorMsg = err.response?.status === 403 ? '没有权限查看此图片' : '加载图片失败，请稍后重试';
      setError(errorMsg);
    }
  };

  // 维度点击/返回
  const handleDimensionClick = (dimension: Dimension) => setSelectedDimension(dimension);
  const handleBackFromDetail = () => setSelectedDimension(null);

  // 气泡显示切换
  const toggleBubbles = () => setShowBubbles(!showBubbles);

  // 删除历史记录
  const handleDeleteImage = async (imageId: number, imageName: string) => {
    if (!window.confirm(`确定要删除图片"${imageName}"吗？此操作不可恢复。`)) {
      return;
    }

    try {
      const response = await axios.delete(`/image/delete/${imageId}`);
      
      if (response.status === 200) {
        // 从历史记录中移除已删除的图片
        setHistoryRecords(prev => prev.filter(record => record.id !== imageId));
        
        // 如果删除的是当前显示的图片，清空显示
        if (evaluation && historyRecords.find(r => r.id === imageId)) {
          const currentRecord = historyRecords.find(r => r.id === imageId);
          if (currentRecord && selectedImage && selectedImage.includes(currentRecord.filename)) {
            setSelectedImage(null);
            setEvaluation(null);
            setSelectedDimension(null);
            setShowBubbles(false);
            setBubbleSentences([]);
          }
        }
        
        // 清理缩略图缓存
        setThumbnails(prev => {
          const newThumbnails = { ...prev };
          const recordKey = imageId.toString();
          if (newThumbnails[recordKey]) {
            URL.revokeObjectURL(newThumbnails[recordKey]);
            delete newThumbnails[recordKey];
          }
          return newThumbnails;
        });
        
        alert('删除成功！');
      }
    } catch (err: any) {
      console.error('删除图片失败:', err);
      let errorMessage = '删除失败，请稍后重试';
      if (err.response?.status === 403) {
        errorMessage = '没有权限删除此图片';
      } else if (err.response?.status === 401) {
        errorMessage = '登录已过期，请重新登录';
      } else if (err.response?.data?.message) {
        errorMessage = err.response.data.message;
      }
      alert(errorMessage);
    }
  };

  // 初始化加载历史
  useEffect(() => {
    if (isAuthenticated) loadHistoryRecords();
  }, [isAuthenticated]);

  // 用户切换时重置并重新加载
  useEffect(() => {
    if (isAuthenticated && user?.id) {
      setHistoryRecords([]);
      setThumbnails({});
      setLoadingThumbnails(new Set());
      loadHistoryRecords();
    }
  }, [isAuthenticated, user?.id]);

  // 释放 Object URL
  useEffect(() => {
    return () => {
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
                    <button className="plus-button" onClick={handlePlusButtonClick}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="6" x2="12" y2="18" />
                        <line x1="6" y1="12" x2="18" y2="12" />
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
                              onMouseEnter={() => loadThumbnail(record)}
                            >
                              <div 
                                className="history-content"
                                onClick={() => handleHistoryItemClick(record)}
                                style={{ cursor: 'pointer' }}
                              >
                                <div className="history-thumbnail">
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
                                <div className="history-filename">
                                  {record.original_name || record.filename || `历史${index + 1}`}
                                </div>
                              </div>
                              <button
                                className="delete-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteImage(record.id, record.original_name || record.filename || `历史${index + 1}`);
                                }}
                                title="删除此图片"
                              >
                                ×
                              </button>
                            </div>
                          ))
                        ) : (
                          <div className="no-history">暂无历史记录</div>
                        )
                      )}
                    </div>
                  </div>
                </div>
                <div className="logout-area">
                  <button className="exit-button" onClick={handleLogout}>退出</button>
                </div>
              </aside>

              {/* 主内容区 */}
              <main className="main-content">
                {/* <div className="section-title">素描</div> */}
                {/* 气泡控制按钮 */}
                {selectedImage && (
                  <>
                    {evaluationCompleted && !annotationCompleted ? (
                      // 评价已完成，批注生成中 → 显示禁用按钮
                      <button
                        className="bubble-control-btn-aligned disabled"
                        disabled
                        title="批注正在生成中，请稍候..."
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                          <line x1="9" y1="9" x2="9.01" y2="9" />
                          <line x1="15" y1="9" x2="15.01" y2="9" />
                        </svg>
                        批注生成中
                      </button>
                    ) : annotationCompleted && bubbleSentences.length > 0 ? (
                      // 批注已完成且有气泡句子 → 显示可切换按钮
                      <button
                        className="bubble-control-btn-aligned"
                        onClick={toggleBubbles}
                        title={showBubbles ? '隐藏评价气泡' : '显示评价气泡'}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                          <line x1="9" y1="9" x2="9.01" y2="9" />
                          <line x1="15" y1="9" x2="15.01" y2="9" />
                        </svg>
                        {showBubbles ? '隐藏气泡' : '显示气泡'}
                      </button>
                    ) : null}
                  </>
                )}

                <div className="upload-container">
                  {selectedImage ? (
                    <div className="image-with-name">
                      <ImageBubbles
                        imageUrl={selectedImage}
                        sentences={[]} // 改为仅关键词驱动：不使用非关键词句子
                        isVisible={showBubbles}
                        emptyRegions={evaluation?.empty_regions || evaluation?.emptyRegions || []}
                        contentRegions={evaluation?.content_regions || evaluation?.contentRegions || []}
                        textRegionMapping={evaluation?.text_region_mapping || []} // 保持从后端原样传入（含 keyword/region/empty_region）
                        viewportOffset={viewportOffset}
                      />
                      {evaluation?.filename && (
                        <div className="image-filename">{evaluation.filename}</div>
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

                  {/* 隐藏文件输入 */}
                  <input
                    id="imageInput"
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    style={{ display: 'none' }}
                  />
                </div>
              </main>

              {/* 右侧评分区 */}
              <aside className="score-panel">
                <div className="score-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF7A45" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  评分结果
                </div>
                <div className="score-content">
                  {evaluation && evaluation.score !== undefined ? (
                    <>
                      {selectedDimension ? (
                        <DimensionDetail dimension={selectedDimension} onBack={handleBackFromDetail} />
                      ) : (
                        <>
                          <ScoreRing initialScore={Number(evaluation.score) || 0} maxScore={100} />
                          {evaluation.dimensions && evaluation.dimensions.length > 0 && (
                            <RadarChart dimensions={evaluation.dimensions} onDimensionClick={handleDimensionClick} />
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
                          <button className="video-button" onClick={handleVideoExplanation}>
                            <span className="video-icon">▶</span> 视频讲解
                          </button>
                        </>
                      )}
                    </>
                  ) :selectedImage ? (
                    evaluating ? (
                      <div className="loading-score">
                        <p>正在生成评价...</p>
                      </div>
                    ) : (
                      <div className="empty-score">
                          <p>图片已上传，点击“开始评价”获取评分</p>
                      </div>
                          
                    )
                  ) : (
                    <div className="empty-score">
                      <p>请上传图片以获取评分</p>
                    </div>
                  )
                }
                {selectedImage && !evaluationCompleted && !evaluating && currentImageId && (
                    <button className="evaluate-btn" onClick={handleEvaluate}>
                      开始评价
                    </button>
                )}
                </div>

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