import React, { useEffect, useRef, useState, useCallback } from 'react';
import './ImageBubbles.css';

interface Bubble {
  id: string;
  position: Position;
  content: string;
  keyword?: string; // 新增关键词字段
  text?: string;    // 新增：与content相同的字段
  delay?: number;   // 新增：动画延迟字段
}

interface Position {
  x: number;
  y: number;
  dotX?: number;    // 新增：圆点X坐标
  dotY?: number;    // 新增：圆点Y坐标
  bubbleX?: number; // 新增：气泡X坐标
  bubbleY?: number; // 新增：气泡Y坐标
}

interface ImageBubblesProps {
  imageUrl: string;
  sentences: string[];
  isVisible: boolean;
  contentRegions?: Position[]; // 新增：内容区域位置
  emptyRegions?: Position[]; // 新增：空白区域位置
}

const ImageBubbles: React.FC<ImageBubblesProps> = ({ 
  imageUrl, 
  sentences, 
  isVisible, 
  contentRegions = [],
  emptyRegions = []
}) => {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const previousImageUrl = useRef<string>(''); // 记录上一个图片URL
  const previousSentences = useRef<string[]>([]); // 记录上一组句子

  // 计算气泡主体在图片边缘的位置，更灵活的算法
  const calculateBubblePosition = useCallback((dotX: number, dotY: number, containerWidth: number, containerHeight: number, usedBubblePositions: { x: number; y: number; width: number; height: number }[]) => {
    const margin = 20; // 减小边距，但仍保持合理距离
    const baseBubbleWidth = 160;
    const baseBubbleHeight = 50;
    
    // 根据气泡数量动态调整气泡大小，避免过多气泡导致遮挡
    const bubbleCount = usedBubblePositions.length + 1;
    const bubbleWidth = Math.max(baseBubbleWidth - bubbleCount * 5, 120); // 最小120像素
    const bubbleHeight = Math.max(baseBubbleHeight - bubbleCount * 2, 40); // 最小40像素
    
    // 定义多个可能的气泡位置策略（左上、右上、左下、右下、上方、下方）
    const possiblePositions = [
      // 靠近圆点的四个角落
      { bubbleX: margin, bubbleY: margin },
      { bubbleX: containerWidth - margin - bubbleWidth, bubbleY: margin },
      { bubbleX: margin, bubbleY: containerHeight - margin - bubbleHeight },
      { bubbleX: containerWidth - margin - bubbleWidth, bubbleY: containerHeight - margin - bubbleHeight },
      // 靠近圆点的上下边
      { bubbleX: dotX - bubbleWidth / 2, bubbleY: margin },
      { bubbleX: dotX - bubbleWidth / 2, bubbleY: containerHeight - margin - bubbleHeight },
      // 靠近圆点的左右边
      { bubbleX: margin, bubbleY: dotY - bubbleHeight / 2 },
      { bubbleX: containerWidth - margin - bubbleWidth, bubbleY: dotY - bubbleHeight / 2 },
      // 更靠近圆点的位置
      { bubbleX: dotX - bubbleWidth / 2, bubbleY: dotY - bubbleHeight - 10 },
      { bubbleX: dotX - bubbleWidth / 2, bubbleY: dotY + 10 }
    ];
    
    // 对每个可能的位置计算评分（距离圆点的距离、与已使用位置的重叠程度、避免覆盖图片中心）
    let bestScore = -Infinity;
    let bestPosition = possiblePositions[0];
    
    possiblePositions.forEach(pos => {
      // 确保位置在容器内
      const adjustedPos = {
        bubbleX: Math.max(margin, Math.min(pos.bubbleX, containerWidth - margin - bubbleWidth)),
        bubbleY: Math.max(margin, Math.min(pos.bubbleY, containerHeight - margin - bubbleHeight))
      };
      
      // 计算到圆点的距离（距离越近越好）
      const distanceToDot = Math.sqrt(Math.pow(adjustedPos.bubbleX - dotX, 2) + Math.pow(adjustedPos.bubbleY - dotY, 2));
      
      // 计算与已使用位置的重叠程度（重叠越少越好）
      let overlapScore = 0;
      usedBubblePositions.forEach(usedPos => {
        const left1 = adjustedPos.bubbleX;
        const right1 = adjustedPos.bubbleX + bubbleWidth;
        const top1 = adjustedPos.bubbleY;
        const bottom1 = adjustedPos.bubbleY + bubbleHeight;
        
        const left2 = usedPos.x;
        const right2 = usedPos.x + usedPos.width;
        const top2 = usedPos.y;
        const bottom2 = usedPos.y + usedPos.height;
        
        // 检查是否有重叠
        if (!(right1 < left2 || left1 > right2 || bottom1 < top2 || top1 > bottom2)) {
          overlapScore -= 1000; // 大幅降低有重叠的位置评分
        } else {
          // 计算距离，距离越远越好
          const centerX1 = (left1 + right1) / 2;
          const centerY1 = (top1 + bottom1) / 2;
          const centerX2 = (left2 + right2) / 2;
          const centerY2 = (top2 + bottom2) / 2;
          const distance = Math.sqrt(Math.pow(centerX1 - centerX2, 2) + Math.pow(centerY1 - centerY2, 2));
          overlapScore += distance / 10; // 距离越远得分越高
        }
      });
      
      // 图片中心惩罚：避免气泡覆盖图片中心区域
      const centerPenalty = Math.sqrt(
        Math.pow(adjustedPos.bubbleX + bubbleWidth/2 - containerWidth/2, 2) + 
        Math.pow(adjustedPos.bubbleY + bubbleHeight/2 - containerHeight/2, 2)
      );
      
      // 综合评分：距离越近得分越高，没有重叠得分越高，远离中心区域得分越高
      const score = 1000 / (distanceToDot + 1) + overlapScore + centerPenalty / 10;
      
      if (score > bestScore) {
        bestScore = score;
        bestPosition = adjustedPos;
      }
    });
    
    return { ...bestPosition, width: bubbleWidth, height: bubbleHeight };
  }, []);

  // 检查两个位置是否重叠
  const isPositionOverlapping = (pos1: { x: number; y: number; width: number; height: number }, pos2: { x: number; y: number; width: number; height: number }) => {
    // 允许小部分重叠（10像素），提高布局灵活性
    const overlapThreshold = 10;
    return !(pos1.x + pos1.width - overlapThreshold < pos2.x || 
             pos1.x > pos2.x + pos2.width - overlapThreshold || 
             pos1.y + pos1.height - overlapThreshold < pos2.y || 
             pos1.y > pos2.y + pos2.height - overlapThreshold);
  };

  // 生成气泡位置
  useEffect(() => {
    // 当图片URL变化或sentences变化时，重新计算气泡位置
    if (!sentences.length || !imageLoaded || !containerRef.current || !imageUrl) {
      return;
    }
    
    // 检查sentences是否变化
    const sentencesChanged = JSON.stringify(sentences) !== JSON.stringify(previousSentences.current);
    previousSentences.current = [...sentences];
    
    // 只有当图片URL变化或sentences变化时才重新计算
    if (imageUrl !== previousImageUrl.current || sentencesChanged) {
      previousImageUrl.current = imageUrl;

      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const containerHeight = containerRect.height;

      const newBubbles: any[] = [];
      const usedDotPositions: { x: number; y: number }[] = [];
      const usedBubblePositions: { x: number; y: number; width: number; height: number }[] = [];
      
      // 分离内容区域和空白区域
      const hasContentRegions = contentRegions && contentRegions.length > 0;
      const hasEmptyRegions = emptyRegions && emptyRegions.length > 0;
      
      // 为每个句子生成气泡
      sentences.forEach((sentence, index) => {
        let bestPosition = null;
        let bubblePos = null; // 在外部作用域定义bubblePos变量
        
        // 尝试找到不重叠的位置的最大尝试次数
        const maxAttempts = 100;
        let attempts = 0;
        
        while (!bestPosition && attempts < maxAttempts) {
          attempts++;
          let dotX, dotY;
          
          // 修复方案
          // 在sentences.forEach循环内部
          if (hasContentRegions && index < contentRegions.length) {
          // 关键修复：始终使用与句子索引匹配的内容区域
          const contentRegionIndex = index; 
          const region = contentRegions[contentRegionIndex];
          
          // 计算图片实际尺寸与容器尺寸的比例
          const scaleX = containerWidth / imageDimensions.width;
          const scaleY = containerHeight / imageDimensions.height;
          
          // 移除随机偏移量，确保气泡准确指向内容区域
          dotX = region.x * scaleX;
          dotY = region.y * scaleY;
          
          // 确保位置在容器内
          dotX = Math.max(40, Math.min(dotX, containerWidth - 40));
          dotY = Math.max(40, Math.min(dotY, containerHeight - 40));
          } else {
          // 如果没有足够的内容区域，使用随机位置
          dotX = Math.random() * (containerWidth - 80) + 40;
          dotY = Math.random() * (containerHeight - 80) + 40;
          }
          
          // 检查圆点位置是否与已使用位置重叠过多
          let dotOverlap = false;
          for (const usedPos of usedDotPositions) {
            const distance = Math.sqrt(Math.pow(usedPos.x - dotX, 2) + Math.pow(usedPos.y - dotY, 2));
            if (distance < 60) { // 减小最小距离要求，提高布局灵活性
              dotOverlap = true;
              break;
            }
          }
          
          if (!dotOverlap) {
            // 计算气泡位置
            bubblePos = calculateBubblePosition(dotX, dotY, containerWidth, containerHeight, usedBubblePositions);
            const bubbleX = bubblePos.bubbleX;
            const bubbleY = bubblePos.bubbleY;
            
            // 检查气泡位置是否与已使用位置重叠
            let bubbleOverlap = false;
            const newBubblePos = { x: bubbleX, y: bubbleY, width: bubblePos.width, height: bubblePos.height };
            
            for (const usedPos of usedBubblePositions) {
              if (isPositionOverlapping(newBubblePos, usedPos)) {
                bubbleOverlap = true;
                break;
              }
            }
            
            // 如果有空白区域数据，优先检查气泡是否位于空白区域
            if (!bubbleOverlap && hasEmptyRegions) {
              let inEmptyRegion = false;
              
              // 允许有一些尝试次数来寻找空白区域
              if (attempts < maxAttempts * 0.7) {
                // 检查气泡是否在空白区域附近
                for (const emptyRegion of emptyRegions) {
                  const scaledEmptyX = emptyRegion.x * (containerWidth / imageDimensions.width);
                  const scaledEmptyY = emptyRegion.y * (containerHeight / imageDimensions.height);
                  const distanceToEmpty = Math.sqrt(
                    Math.pow(bubbleX + bubblePos.width/2 - scaledEmptyX, 2) + 
                    Math.pow(bubbleY + bubblePos.height/2 - scaledEmptyY, 2)
                  );
                  
                  if (distanceToEmpty < 80) { // 允许一定距离内
                    inEmptyRegion = true;
                    break;
                  }
                }
                
                // 如果不在空白区域，继续尝试
                if (!inEmptyRegion) continue;
              }
            }
            
            if (!bubbleOverlap) {
              bestPosition = { dotX, dotY, bubbleX, bubbleY };
            }
          }
        }
        
        // 如果找到了合适的位置，添加到气泡列表
        if (bestPosition && bubblePos) { // 添加对bubblePos的检查
          const { dotX, dotY, bubbleX, bubbleY } = bestPosition;
          
          usedDotPositions.push({ x: dotX, y: dotY });
          usedBubblePositions.push({
            x: bubbleX, 
            y: bubbleY, 
            width: bubblePos.width,  
            height: bubblePos.height 
          });
          
          newBubbles.push({
            id: `bubble-${index}-${Date.now()}`, // 添加时间戳确保ID唯一
            text: sentence,
            position: {
              dotX: (dotX / containerWidth) * 100,
              dotY: (dotY / containerHeight) * 100,
              bubbleX: (bubbleX / containerWidth) * 100,
              bubbleY: (bubbleY / containerHeight) * 100
            },
            content: sentence,
            delay: index * 0.15 // 减小延迟，使动画更流畅
          });
        }
      });

      setBubbles(newBubbles);
    }
  }, [imageUrl, sentences, imageLoaded, contentRegions, emptyRegions, imageDimensions, calculateBubblePosition]);

  // 获取图片实际尺寸
  // 1. 优化handleImageLoad函数中的重置逻辑
  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    setImageDimensions({ 
      width: img.naturalWidth, 
      height: img.naturalHeight 
    });
    setImageLoaded(true);
    
    // 优化：无论如何都先清空气泡状态
    setBubbles([]);
    
    // 优化：当图片URL变化时，完全重置状态
    if (img.src !== imageUrl || imageUrl !== previousImageUrl.current) {
      previousImageUrl.current = imageUrl;
      previousSentences.current = [];
    }
  };
  
  // 2. 添加图片URL变化时的副作用监听
  useEffect(() => {
    // 当图片URL变化时，立即清空气泡并重置状态
    if (imageUrl && imageUrl !== previousImageUrl.current) {
      setBubbles([]);
      setImageLoaded(false);
      previousImageUrl.current = '';
      previousSentences.current = [];
    }
  }, [imageUrl]);

  if (!imageUrl) {
    return null;
  }

  return (
    <div className="image-bubbles-container" ref={containerRef}>
      <div className="image-wrapper">
        <img 
          src={imageUrl} 
          alt="评价图片" 
          className="evaluation-image"
          onLoad={handleImageLoad}
        />
        
        {imageLoaded && isVisible && bubbles.map(bubble => (
          <div key={bubble.id} className="bubble-group">
            {/* 圆点标注 */}
            <div 
              className="bubble-dot" 
              style={{
                left: `${bubble.position.dotX}%`, 
                top: `${bubble.position.dotY}%`,
                animationDelay: `${bubble.delay}s`,
                backgroundColor: bubble.keyword ? '#4CAF50' : '#2196F3'
              }}
            />
            
            {/* 连接线 */}
            <svg 
              className="bubble-connector"
              style={{
                position: 'absolute',
                left: 0, 
                top: 0,
                width: '100%',
                height: '100%',
                animationDelay: `${bubble.delay + 0.1}s`
              }}
            >
              <line 
                x1={`${bubble.position.dotX}%`} 
                y1={`${bubble.position.dotY}%`} 
                x2={`${bubble.position.bubbleX}%`}
                y2={`${bubble.position.bubbleY}%`}
                stroke="#FF7A45"
                strokeWidth="2"
                strokeDasharray="5,5"
              />
            </svg>
            
            {/* 气泡主体 */}
            <div 
              className="evaluation-bubble-new" 
              style={{
                left: `${bubble.position.bubbleX}%`, 
                top: `${bubble.position.bubbleY}%`,
                animationDelay: `${bubble.delay + 0.2}s`
              }}
            >
              {/* 如果有关键词，显示关键词标签 */}
              {bubble.keyword && (
                <div className="bubble-keyword-tag">
                  {bubble.keyword}
                </div>
              )}
              <div className="bubble-content">{bubble.content}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ImageBubbles;