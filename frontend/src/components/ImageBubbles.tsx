import React, { useEffect, useRef, useState } from 'react';
import './ImageBubbles.css';

interface Bubble {
  id: string;
  text: string;
  dotX: number; // 圆点位置 - 图片内的随机位置
  dotY: number; // 圆点位置 - 图片内的随机位置
  bubbleX: number; // 气泡主体位置 - 图片边缘
  bubbleY: number; // 气泡主体位置 - 图片边缘
  delay: number; // animation delay
}

interface ImageBubblesProps {
  imageUrl: string;
  sentences: string[];
  isVisible: boolean;
}

const ImageBubbles: React.FC<ImageBubblesProps> = ({ imageUrl, sentences, isVisible }) => {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [imageLoaded, setImageLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 计算气泡主体在图片边缘的位置
  const calculateBubblePosition = (dotX: number, dotY: number, containerWidth: number, containerHeight: number) => {
    const margin = 40; // 进一步增加边距，确保气泡不贴边
    const bubbleWidth = 180; // 气泡宽度
    const bubbleHeight = 60; // 气泡高度
    let bubbleX = dotX;
    let bubbleY = dotY;

    // 判断圆点靠近哪条边，将气泡主体放在对应的边缘，但确保在容器内
    if (dotX < containerWidth / 2) {
      // 圆点在左半部分，气泡放在左边
      bubbleX = margin;
    } else {
      // 圆点在右半部分，气泡放在右边
      bubbleX = containerWidth - margin - bubbleWidth;
    }

    if (dotY < containerHeight / 2) {
      // 圆点在上半部分，气泡放在上边
      bubbleY = margin;
    } else {
      // 圆点在下半部分，气泡放在下边
      bubbleY = containerHeight - margin - bubbleHeight;
    }

    // 确保气泡完全在容器内，并增加安全边距
    bubbleX = Math.max(margin, Math.min(bubbleX, containerWidth - margin - bubbleWidth));
    bubbleY = Math.max(margin, Math.min(bubbleY, containerHeight - margin - bubbleHeight));

    return { bubbleX, bubbleY };
  };

  // 生成随机位置的气泡
  useEffect(() => {
    if (!sentences.length || !imageLoaded || !containerRef.current) return;

    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;

    const newBubbles: Bubble[] = [];
    const usedDotPositions: { x: number; y: number }[] = [];
    const usedBubblePositions: { x: number; y: number; width: number; height: number }[] = [];
    
    sentences.forEach((sentence, index) => {
      let bestPosition = null;
      let minOverlap = Infinity;
      const maxAttempts = 500; // 增加尝试次数
      
      // 尝试找到最佳位置（完全不重叠）
      for (let i = 0; i < maxAttempts; i++) {
        const dotX = Math.random() * (containerWidth - 120) + 60;
        const dotY = Math.random() * (containerHeight - 120) + 60;
        
        const bubblePos = calculateBubblePosition(dotX, dotY, containerWidth, containerHeight);
        const bubbleX = bubblePos.bubbleX;
        const bubbleY = bubblePos.bubbleY;
        
        // 计算重叠程度
        let overlap = 0;
        let hasOverlap = false;
        
        // 检查圆点重叠 - 更严格的距离要求
        usedDotPositions.forEach(pos => {
          const distance = Math.sqrt(Math.pow(pos.x - dotX, 2) + Math.pow(pos.y - dotY, 2));
          if (distance < 80) { // 增加最小距离到80px
            overlap += (80 - distance) * 5; // 增加权重
            hasOverlap = true;
          }
        });
        
        // 检查气泡重叠 - 更严格的矩形检测
        usedBubblePositions.forEach(pos => {
          const bubbleWidth = 180;
          const bubbleHeight = 60;
          
          // 检查矩形重叠
          const left1 = bubbleX - bubbleWidth / 2;
          const right1 = bubbleX + bubbleWidth / 2;
          const top1 = bubbleY - bubbleHeight / 2;
          const bottom1 = bubbleY + bubbleHeight / 2;
          
          const left2 = pos.x - pos.width / 2;
          const right2 = pos.x + pos.width / 2;
          const top2 = pos.y - pos.height / 2;
          const bottom2 = pos.y + pos.height / 2;
          
          // 检查是否有重叠
          if (!(right1 < left2 || left1 > right2 || bottom1 < top2 || top1 > bottom2)) {
            // 计算重叠面积
            const overlapWidth = Math.min(right1, right2) - Math.max(left1, left2);
            const overlapHeight = Math.min(bottom1, bottom2) - Math.max(top1, top2);
            const overlapArea = overlapWidth * overlapHeight;
            overlap += overlapArea * 10; // 气泡重叠权重更高
            hasOverlap = true;
          }
        });
        
        // 检查圆点和气泡之间的重叠
        usedBubblePositions.forEach(pos => {
          const bubbleWidth = 180;
          const bubbleHeight = 60;
          
          // 检查圆点是否在气泡范围内
          const left = pos.x - pos.width / 2;
          const right = pos.x + pos.width / 2;
          const top = pos.y - pos.height / 2;
          const bottom = pos.y + pos.height / 2;
          
          if (dotX >= left && dotX <= right && dotY >= top && dotY <= bottom) {
            overlap += 1000; // 圆点在气泡内，严重重叠
            hasOverlap = true;
          }
        });
        
        // 如果找到完全不重叠的位置，直接使用
        if (!hasOverlap) {
          bestPosition = { dotX, dotY, bubbleX, bubbleY };
          break;
        }
        
        // 如果找到更好的位置，记录下来
        if (overlap < minOverlap) {
          minOverlap = overlap;
          bestPosition = { dotX, dotY, bubbleX, bubbleY };
        }
      }
      
      // 使用最佳位置
      if (bestPosition) {
        const { dotX, dotY, bubbleX, bubbleY } = bestPosition;
        
        usedDotPositions.push({ x: dotX, y: dotY });
        usedBubblePositions.push({ 
          x: bubbleX, 
          y: bubbleY, 
          width: 180, 
          height: 60 
        });
        
        newBubbles.push({
          id: `bubble-${index}`,
          text: sentence,
          dotX,
          dotY,
          bubbleX,
          bubbleY,
          delay: index * 0.2
        });
      }
    });

    setBubbles(newBubbles);
  }, [sentences, imageLoaded]);

  const handleImageLoad = () => {
    setImageLoaded(true);
  };

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
          <div key={bubble.id}>
            {/* 圆点标注 */}
            <div 
              className="bubble-dot" 
              style={{ 
                left: `${bubble.dotX}px`, 
                top: `${bubble.dotY}px`,
                animationDelay: `${bubble.delay}s`
              }}
            />
            
            {/* 连接线 */}
            <svg 
              className="bubble-line"
              style={{ 
                left: 0, 
                top: 0,
                animationDelay: `${bubble.delay + 0.1}s`
              }}
            >
              <line 
                x1={bubble.dotX} 
                y1={bubble.dotY} 
                x2={bubble.bubbleX} 
                y2={bubble.bubbleY}
                stroke="#FF7A45"
                strokeWidth="2"
                strokeDasharray="5,5"
              />
            </svg>
            
            {/* 气泡主体 - 放回容器内 */}
            <div 
              className="evaluation-bubble-new" 
              style={{ 
                left: `${bubble.bubbleX}px`, 
                top: `${bubble.bubbleY}px`,
                animationDelay: `${bubble.delay + 0.2}s`
              }}
            >
              <div className="bubble-content">{bubble.text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ImageBubbles;