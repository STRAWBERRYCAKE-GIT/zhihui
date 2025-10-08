import React, { useEffect, useRef, useState, useCallback } from 'react';
import './ImageBubbles.css';

interface Bubble {
  id: string;
  position: Position;
  content: string;
  keyword?: string; // 新增关键词字段
  text?: string;    // 新增：与content相同的字段
  delay?: number;   // 新增：动画延迟字段
  width?: number;   // 新增：气泡宽度
  height?: number;  // 新增：气泡高度
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
  const bubbleRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  // 计算气泡主体在图片边缘的位置，更灵活的算法
  const calculateBubblePosition = useCallback((dotX: number, dotY: number, containerWidth: number, containerHeight: number, usedBubblePositions: { x: number; y: number; width: number; height: number }[], content: string) => {
    const margin = 20; // 减小边距，但仍保持合理距离
    
    // 动态计算基础宽度，基于内容长度
    const baseBubbleWidth = Math.min(300, Math.max(160, content.length * 7)); // 根据内容长度调整宽度，最多300px
    const baseBubbleHeight = Math.min(200, Math.max(50, (content.length / 20) * 20 + 40)); // 根据内容长度调整高度，最多200px
    
    // 根据气泡数量动态调整气泡大小，避免过多气泡导致遮挡
    const bubbleCount = usedBubblePositions.length + 1;
    const bubbleWidth = Math.max(baseBubbleWidth - bubbleCount * 5, 160); // 增大最小宽度到160像素
    const bubbleHeight = Math.max(baseBubbleHeight - bubbleCount * 2, 50); // 增大最小高度到50像素
    
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
        let bubblePos = null; 
        
        // 尝试找到不重叠的位置的最大尝试次数
        const maxAttempts = 100;
        let attempts = 0;
        
        while (!bestPosition && attempts < maxAttempts) {
          attempts++;
          let dotX, dotY;
          
          if (hasContentRegions && index < contentRegions.length) {
            const contentRegionIndex = index;
            const region = contentRegions[contentRegionIndex];
            
            // 计算图片实际尺寸与容器尺寸的比例
            const scaleX = containerWidth / imageDimensions.width;
            const scaleY = containerHeight / imageDimensions.height;
            
            // 计算圆点位置
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
            if (distance < 60) {
              dotOverlap = true;
              break;
            }
          }
          
          if (!dotOverlap) {
            // 计算气泡位置 - 传入内容以动态调整大小
            bubblePos = calculateBubblePosition(dotX, dotY, containerWidth, containerHeight, usedBubblePositions, sentence);
            const bubbleX = bubblePos.bubbleX;
            const bubbleY = bubblePos.bubbleY;
            
            // 检查气泡位置是否与已使用位置重叠
            let bubbleOverlap = false;
            const newBubblePos = {
              x: bubbleX, 
              y: bubbleY, 
              width: bubblePos.width,  
              height: bubblePos.height 
            };
            
            for (const usedPos of usedBubblePositions) {
              if (isPositionOverlapping(newBubblePos, usedPos)) {
                bubbleOverlap = true;
                break;
              }
            }
            
            // 如果没有重叠，允许气泡显示，不再强制要求空白区域
            if (!bubbleOverlap) {
              bestPosition = { dotX, dotY, bubbleX, bubbleY };
            }
          }
        }
        
        // 如果找到了合适的位置，添加到气泡列表
        if (bestPosition && bubblePos) { 
          const { dotX, dotY, bubbleX, bubbleY } = bestPosition;
          
          usedDotPositions.push({ x: dotX, y: dotY });
          usedBubblePositions.push({
            x: bubbleX, 
            y: bubbleY, 
            width: bubblePos.width,  
            height: bubblePos.height 
          });
          
          newBubbles.push({
            id: `bubble-${index}-${Date.now()}`,
            text: sentence,
            position: {
              dotX: (dotX / containerWidth) * 100,
              dotY: (dotY / containerHeight) * 100,
              bubbleX: (bubbleX / containerWidth) * 100,
              bubbleY: (bubbleY / containerHeight) * 100
            },
            content: sentence,
            delay: index * 0.15,
            width: bubblePos.width,  // 保存气泡宽度
            height: bubblePos.height  // 保存气泡高度
          });
        }
      });

      setBubbles(newBubbles);
    }
  }, [imageUrl, sentences, imageLoaded, contentRegions, emptyRegions, imageDimensions, calculateBubblePosition]);

  // 动态调整气泡大小
  useEffect(() => {
    if (!isVisible || bubbles.length === 0) {
      return;
    }

    // 使用setTimeout确保DOM已经渲染
    const timer = setTimeout(() => {
      const newBubbles = [...bubbles];
      let hasChanges = false;

      newBubbles.forEach((bubble, index) => {
        const bubbleRef = bubbleRefs.current[bubble.id];
        if (bubbleRef) {
          const contentDiv = bubbleRef.querySelector('.bubble-content') as HTMLElement;
          if (contentDiv) {
            // 获取内容实际尺寸
            const contentWidth = contentDiv.scrollWidth + 28; // 加上padding
            const contentHeight = contentDiv.scrollHeight + 20; // 加上padding
            
            // 如果内容尺寸大于气泡当前尺寸，更新气泡尺寸
            if (contentWidth > (bubble.width || 0) || contentHeight > (bubble.height || 0)) {
              const container = containerRef.current;
              if (container) {
                const containerRect = container.getBoundingClientRect();
                const containerWidth = containerRect.width;
                const containerHeight = containerRect.height;
                
                // 计算新的气泡尺寸，不超过容器的80%
                const newWidth = Math.min(contentWidth, containerWidth * 0.8);
                const newHeight = Math.min(contentHeight, containerHeight * 0.5);
                
                // 调整气泡位置，确保不超出容器
                const bubbleXPercent = bubble.position.bubbleX || 0;
                const bubbleYPercent = bubble.position.bubbleY || 0;
                
                // 计算实际像素位置
                const currentX = (bubbleXPercent / 100) * containerWidth;
                const currentY = (bubbleYPercent / 100) * containerHeight;
                
                // 调整位置，确保气泡不超出容器
                let newX = currentX;
                let newY = currentY;
                
                // 检查右侧边界
                if (currentX + newWidth > containerWidth - 20) {
                  newX = containerWidth - newWidth - 20;
                }
                // 检查底部边界
                if (currentY + newHeight > containerHeight - 20) {
                  newY = containerHeight - newHeight - 20;
                }
                // 检查左侧边界
                if (newX < 20) {
                  newX = 20;
                }
                // 检查顶部边界
                if (newY < 20) {
                  newY = 20;
                }
                
                // 更新气泡属性
                newBubbles[index] = {
                  ...bubble,
                  width: newWidth,
                  height: newHeight,
                  position: {
                    ...bubble.position,
                    bubbleX: (newX / containerWidth) * 100,
                    bubbleY: (newY / containerHeight) * 100
                  }
                };
                hasChanges = true;
              }
            }
          }
        }
      });

      if (hasChanges) {
        setBubbles(newBubbles);
      }
    }, 100); // 延迟100ms，确保气泡已经渲染

    return () => clearTimeout(timer);
  }, [bubbles, isVisible]);

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
            {/* 移除：圆点标注 */}
            {/* <div 
              className="bubble-dot" 
              style={{
                left: `${bubble.position.dotX}%`, 
                top: `${bubble.position.dotY}%`,
                animationDelay: `${bubble.delay}s`,
                backgroundColor: bubble.keyword ? '#4CAF50' : '#2196F3'
              }}
            /> */}
            
            {/* 移除：连接线 */}
            {/* <svg 
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
            </svg> */}
            
            {/* 气泡主体 - 动态设置宽度和高度 */}
            <div 
              ref={el => bubbleRefs.current[bubble.id] = el}
              className="evaluation-bubble-new" 
              style={{
                left: `${bubble.position.bubbleX}%`, 
                top: `${bubble.position.bubbleY}%`,
                animationDelay: `${bubble.delay + 0.2}s`,
                width: bubble.width ? `${bubble.width}px` : 'auto',
                minHeight: bubble.height ? `${bubble.height}px` : 'auto'
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