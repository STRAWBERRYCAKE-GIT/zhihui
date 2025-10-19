import React, { useEffect, useRef, useState } from 'react';
import './ImageBubbles.css';

interface Bubble {
  id: string;
  position: Position;
  content: string;
  keyword?: string; // 关键词字段
  text?: string;    // 与content相同的字段
  delay?: number;   // 动画延迟字段
  width?: number;   // 氣泡宽度
  height?: number;  // 氣泡高度
}

interface Position {
  x: number;
  y: number;
  dotX?: number;    // 圆点X坐标（百分比）
  dotY?: number;    // 圆点Y坐标（百分比）
  bubbleX?: number; // 气泡X坐标（百分比）
  bubbleY?: number; // 气泡Y坐标（百分比）
}

// 后端可能返回的区域结构（支持归一化或像素）
type Region = {
  x: number;
  y: number;
  width?: number;
  height?: number;
};

interface ImageBubblesProps {
  imageUrl: string;
  sentences: string[];
  isVisible: boolean;
  contentRegions?: Region[]; // 内容区域位置（矩形/点）
  emptyRegions?: Region[];   // 空白区域位置（矩形/点）
}

const MARGIN = 40; // 容器边界裁剪边距

const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(val, max));

const isNormalizedRect = (r: Region | undefined) => {
  if (!r) return false;
  const values = [r.x, r.y, r.width ?? 0, r.height ?? 0];
  // 如果值都在[0,1]范围内，认为是归一化坐标
  return values.every(v => v >= 0 && v <= 1);
};

const getCenter = (r: Region) => ({
  cx: r.x + (r.width ?? 0) / 2,
  cy: r.y + (r.height ?? 0) / 2
});

// 将区域中心转换到容器像素坐标（统一归一化/像素输入）
function centerToContainerPixels(
  r: Region,
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number
) {
  const { cx, cy } = getCenter(r);

  // 如果是归一化坐标，先转到图片像素
  if (isNormalizedRect(r)) {
    const px = cx * imageWidth;
    const py = cy * imageHeight;
    // 再按图片到容器的缩放比转换
    const scaleX = containerWidth / imageWidth;
    const scaleY = containerHeight / imageHeight;
    return { x: px * scaleX, y: py * scaleY };
  }

  // 像素坐标：假定以图片像素为参考，按缩放到容器
  const scaleX = containerWidth / imageWidth;
  const scaleY = containerHeight / imageHeight;
  return { x: cx * scaleX, y: cy * scaleY };
}

// 计算气泡建议尺寸（与原逻辑一致，动态根据内容长度）
function computeBubbleSize(content: string, currentCount: number) {
  const baseBubbleWidth = Math.min(300, Math.max(160, content.length * 7));
  const baseBubbleHeight = Math.min(200, Math.max(50, (content.length / 20) * 20 + 40));
  const bubbleWidth = Math.max(baseBubbleWidth - currentCount * 5, 160);
  const bubbleHeight = Math.max(baseBubbleHeight - currentCount * 2, 50);
  return { bubbleWidth, bubbleHeight };
}

// 检查两个位置是否重叠（允许10px微重叠）
const isPositionOverlapping = (
  pos1: { x: number; y: number; width: number; height: number },
  pos2: { x: number; y: number; width: number; height: number }
) => {
  const overlapThreshold = 10;
  return !(
    pos1.x + pos1.width - overlapThreshold < pos2.x ||
    pos1.x > pos2.x + pos2.width - overlapThreshold ||
    pos1.y + pos1.height - overlapThreshold < pos2.y ||
    pos1.y > pos2.y + pos2.height - overlapThreshold
  );
};

// 回退：基于圆点的智能分布算法（普通函数版本，避免 useCallback 顶层 Hook 问题）
// 修改 calculateBubblePosition 以避开内容并偏向空白
function calculateBubblePosition(
  dotX: number,
  dotY: number,
  containerWidth: number,
  containerHeight: number,
  usedBubblePositions: { x: number; y: number; width: number; height: number }[],
  content: string,
  contentBoxes: { x: number; y: number; width: number; height: number }[],
  emptyBoxes: { x: number; y: number; width: number; height: number }[],
  ctx: CanvasRenderingContext2D | null,
  imageWidth: number,
  imageHeight: number
) {
  const margin = 20;

  const bubbleCount = usedBubblePositions.length + 1;
  const { bubbleWidth, bubbleHeight } = computeBubbleSize(content, bubbleCount);

  // 以圆点为中心的一圈候选 + 边缘/角落备选
  const ringOffsets = [
    { dx: 0, dy: -(bubbleHeight + 12) },
    { dx: 0, dy: bubbleHeight + 12 },
    { dx: -(bubbleWidth + 12), dy: 0 },
    { dx: bubbleWidth + 12, dy: 0 },
    { dx: -(bubbleWidth + 12), dy: -(bubbleHeight + 12) },
    { dx: bubbleWidth + 12, dy: -(bubbleHeight + 12) },
    { dx: -(bubbleWidth + 12), dy: bubbleHeight + 12 },
    { dx: bubbleWidth + 12, dy: bubbleHeight + 12 }
  ];

  const possiblePositions = [
    ...ringOffsets.map(({ dx, dy }) => ({
      bubbleX: dotX + dx - bubbleWidth / 2,
      bubbleY: dotY + dy - bubbleHeight / 2
    })),
    { bubbleX: margin, bubbleY: margin },
    { bubbleX: containerWidth - margin - bubbleWidth, bubbleY: margin },
    { bubbleX: margin, bubbleY: containerHeight - margin - bubbleHeight },
    { bubbleX: containerWidth - margin - bubbleWidth, bubbleY: containerHeight - margin - bubbleHeight },
    { bubbleX: dotX - bubbleWidth / 2, bubbleY: margin },
    { bubbleX: dotX - bubbleWidth / 2, bubbleY: containerHeight - margin - bubbleHeight },
    { bubbleX: margin, bubbleY: dotY - bubbleHeight / 2 },
    { bubbleX: containerWidth - margin - bubbleWidth, bubbleY: dotY - bubbleHeight / 2 }
  ];

  let bestScore = -Infinity;
  let bestPosition = possiblePositions[0];

  possiblePositions.forEach((pos) => {
    const adjustedPos = {
      bubbleX: clamp(pos.bubbleX, margin, containerWidth - margin - bubbleWidth),
      bubbleY: clamp(pos.bubbleY, margin, containerHeight - margin - bubbleHeight)
    };

    const candidateRect = {
      x: adjustedPos.bubbleX,
      y: adjustedPos.bubbleY,
      width: bubbleWidth,
      height: bubbleHeight
    };

    // 距离圆点（希望靠近）
    const dx = adjustedPos.bubbleX + bubbleWidth / 2 - dotX;
    const dy = adjustedPos.bubbleY + bubbleHeight / 2 - dotY;
    const distanceToDot = Math.sqrt(dx * dx + dy * dy);

    let score = 0;

    // 距离得分
    score += 1500 / (distanceToDot + 1);

    // 避免气泡之间重叠
    for (const usedPos of usedBubblePositions) {
      if (isPositionOverlapping(candidateRect, usedPos)) {
        score -= 500;
      }
    }

    // 强烈避免与内容区域重叠
    for (const box of contentBoxes) {
      if (isPositionOverlapping(candidateRect, box)) {
        score -= 1200;
      }
    }

    // 空白评分（Canvas 采样）
    const emptinessScore = computeEmptinessScoreForRect(
      candidateRect,
      containerWidth,
      containerHeight,
      imageWidth,
      imageHeight,
      ctx
    );
    score += emptinessScore * 800;

    // 如果落在后端提供的空白区域内，额外加分
    const inEmptyBox = emptyBoxes.some((b) => isPositionOverlapping(candidateRect, b));
    if (inEmptyBox) {
      score += 300;
    }

    if (score > bestScore) {
      bestScore = score;
      bestPosition = adjustedPos;
    }
  });

  return { ...bestPosition, width: bubbleWidth, height: bubbleHeight };
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

  // 新增：离屏 Canvas 及上下文用于图片采样
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  // 生成气泡位置
  useEffect(() => {
    if (!sentences.length || !imageLoaded || !containerRef.current || !imageUrl) {
      return;
    }

    // 检查sentences是否变化
    const sentencesChanged = JSON.stringify(sentences) !== JSON.stringify(previousSentences.current);
    previousSentences.current = [...sentences];

    if (imageUrl !== previousImageUrl.current || sentencesChanged) {
      previousImageUrl.current = imageUrl;

      const container = containerRef.current!;
      // 优先使用图片元素的尺寸，防止容器为0导致除零/NaN
      const imgEl = container.querySelector('.evaluation-image') as HTMLImageElement | null;
      const rectFromImg = imgEl ? imgEl.getBoundingClientRect() : null;
      const containerRect = container.getBoundingClientRect();
      const baseRect = rectFromImg ?? containerRect;
      const containerWidth = Math.max(baseRect.width, 1);
      const containerHeight = Math.max(baseRect.height, 1);

      try {
        const newBubbles: Bubble[] = [];
        const usedDotPositions: { x: number; y: number }[] = [];
        const usedBubblePositions: { x: number; y: number; width: number; height: number }[] = [];

        const hasContentRegions = contentRegions && contentRegions.length > 0;
        const hasEmptyRegions = emptyRegions && emptyRegions.length > 0;

        console.log('ImageBubbles数据:', {
          hasContentRegions,
          contentRegionsCount: contentRegions?.length,
          hasEmptyRegions,
          emptyRegionsCount: emptyRegions?.length,
          sentencesCount: sentences.length,
          containerWidth,
          containerHeight
        });

        // 为每个句子生成气泡
        sentences.forEach((sentence, index) => {
          let bestPosition: { dotX: number; dotY: number; bubbleX: number; bubbleY: number } | null = null;
          let finalBubbleBox: { x: number; y: number; width: number; height: number } | null = null;

          // 圆点位置：优先内容区域中心
          let dotX: number, dotY: number;

          if (hasContentRegions && index < contentRegions.length) {
            const c = contentRegions[index];
            const center = centerToContainerPixels(c, containerWidth, containerHeight, imageDimensions.width, imageDimensions.height);
            dotX = clamp(center.x, MARGIN, containerWidth - MARGIN);
            dotY = clamp(center.y, MARGIN, containerHeight - MARGIN);
          } else {
            // 无内容区域：使用随机但边界内的位置（尽量靠近中心）
            dotX = Math.random() * (containerWidth - 2 * MARGIN) + MARGIN;
            dotY = Math.random() * (containerHeight - 2 * MARGIN) + MARGIN;
          }

          // 避免圆点过近
          const minDotDistance = 60;
          let dotOverlapTooClose = false;
          for (const used of usedDotPositions) {
            const d = Math.hypot(used.x - dotX, used.y - dotY);
            if (d < minDotDistance) {
              dotOverlapTooClose = true;
              break;
            }
          }
          if (dotOverlapTooClose && hasContentRegions) {
            // 发生过近时轻微抖动偏移（减少随机性）
            dotX = clamp(dotX + 12, MARGIN, containerWidth - MARGIN);
            dotY = clamp(dotY + 12, MARGIN, containerHeight - MARGIN);
          }

          // 气泡位置：优先空白区域中心
          let bubbleX: number, bubbleY: number;
          let bubbleSize = computeBubbleSize(sentence, usedBubblePositions.length + 1);

          if (hasEmptyRegions && index < emptyRegions.length) {
            const e = emptyRegions[index];
            const center = centerToContainerPixels(e, containerWidth, containerHeight, imageDimensions.width, imageDimensions.height);
            bubbleX = clamp(center.x - bubbleSize.bubbleWidth / 2, MARGIN, containerWidth - MARGIN - bubbleSize.bubbleWidth);
            bubbleY = clamp(center.y - bubbleSize.bubbleHeight / 2, MARGIN, containerHeight - MARGIN - bubbleSize.bubbleHeight);

            const candidateBox = { x: bubbleX, y: bubbleY, width: bubbleSize.bubbleWidth, height: bubbleSize.bubbleHeight };

            // 检查和已用气泡是否重叠，重叠则回退到智能分布
            let overlap = false;
            for (const used of usedBubblePositions) {
              if (isPositionOverlapping(candidateBox, used)) {
                overlap = true;
                break;
              }
            }

            if (overlap) {
              const fallback = calculateBubblePosition(
                dotX,
                dotY,
                containerWidth,
                containerHeight,
                usedBubblePositions,
                sentence
              );
              bubbleX = fallback.bubbleX;
              bubbleY = fallback.bubbleY;
              bubbleSize = { bubbleWidth: fallback.width, bubbleHeight: fallback.height };
            }
          } else {
            // 无空白区域或索引不足，使用回退策略
            const fallback = calculateBubblePosition(
              dotX,
              dotY,
              containerWidth,
              containerHeight,
              usedBubblePositions,
              sentence
            );
            bubbleX = fallback.bubbleX;
            bubbleY = fallback.bubbleY;
            bubbleSize = { bubbleWidth: fallback.width, bubbleHeight: fallback.height };
          }

          bestPosition = { dotX, dotY, bubbleX, bubbleY };
          finalBubbleBox = { x: bubbleX, y: bubbleY, width: bubbleSize.bubbleWidth, height: bubbleSize.bubbleHeight };

          // 写入已用位置集合
          usedDotPositions.push({ x: dotX, y: dotY });
          usedBubblePositions.push(finalBubbleBox);

          // 生成 Bubble
          newBubbles.push({
            id: `bubble-${index}-${Date.now()}`,
            text: sentence,
            position: {
              // 同步提供 x/y，避免外部代码读取时报错
              x: (bestPosition.dotX / containerWidth) * 100,
              y: (bestPosition.dotY / containerHeight) * 100,
              dotX: (bestPosition.dotX / containerWidth) * 100,
              dotY: (bestPosition.dotY / containerHeight) * 100,
              bubbleX: (bestPosition.bubbleX / containerWidth) * 100,
              bubbleY: (bestPosition.bubbleY / containerHeight) * 100
            },
            content: sentence,
            delay: index * 0.15,
            width: bubbleSize.bubbleWidth,
            height: bubbleSize.bubbleHeight
          });
        });

        console.log('生成的气泡数量:', newBubbles.length);
        setBubbles(newBubbles);
      } catch (err) {
        console.error('ImageBubbles生成位置时出现异常:', err);
        setBubbles([]);
      }
    }
  }, [
    imageUrl,
    sentences,
    imageLoaded,
    contentRegions,
    emptyRegions,
    imageDimensions
  ]);

  // 动态调整气泡大小（保留原逻辑）
  useEffect(() => {
    if (!isVisible || bubbles.length === 0) {
      return;
    }

    const timer = setTimeout(() => {
      const newBubbles = [...bubbles];
      let hasChanges = false;

      newBubbles.forEach((bubble, index) => {
        const bubbleRef = bubbleRefs.current[bubble.id];
        if (bubbleRef) {
          const contentDiv = bubbleRef.querySelector('.bubble-content') as HTMLElement;
          if (contentDiv) {
            const contentWidth = contentDiv.scrollWidth + 28; // padding
            const contentHeight = contentDiv.scrollHeight + 20; // padding

            if (contentWidth > (bubble.width || 0) || contentHeight > (bubble.height || 0)) {
              const container = containerRef.current;
              if (container) {
                const containerRect = container.getBoundingClientRect();
                // 容器尺寸为0时直接跳过，避免NaN
                if (containerRect.width <= 0 || containerRect.height <= 0) {
                  return;
                }
                const containerWidth = containerRect.width;
                const containerHeight = containerRect.height;

                const newWidth = Math.min(contentWidth, containerWidth * 0.8);
                const newHeight = Math.min(contentHeight, containerHeight * 0.5);

                const bubbleXPercent = bubble.position.bubbleX || 0;
                const bubbleYPercent = bubble.position.bubbleY || 0;

                const currentX = (bubbleXPercent / 100) * containerWidth;
                const currentY = (bubbleYPercent / 100) * containerHeight;

                let newX = currentX;
                let newY = currentY;

                if (currentX + newWidth > containerWidth - 20) {
                  newX = containerWidth - newWidth - 20;
                }
                if (currentY + newHeight > containerHeight - 20) {
                  newY = containerHeight - newHeight - 20;
                }
                if (newX < 20) {
                  newX = 20;
                }
                if (newY < 20) {
                  newY = 20;
                }

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
    }, 100);

    return () => clearTimeout(timer);
  }, [bubbles, isVisible]);

  // 图片加载，记录自然尺寸
  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    setImageDimensions({
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height
    });
    setImageLoaded(true);
  
    // 建立离屏 Canvas 用于采样图片空白度
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvasRef.current = canvas;
        ctxRef.current = ctx;
      } else {
        canvasRef.current = null;
        ctxRef.current = null;
      }
    } catch {
      // 跨域图片可能导致 canvas 读取失败，降级处理
      canvasRef.current = null;
      ctxRef.current = null;
    }
  
    // 重置气泡状态
    setBubbles([]);
  
    // 图片URL变化时重置缓存
    if (img.src !== imageUrl || imageUrl !== previousImageUrl.current) {
      previousImageUrl.current = imageUrl;
      previousSentences.current = [];
    }
  };

  // 图片URL变化，清空状态
  useEffect(() => {
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
            {/* 可选：圆点标注与连线（当前保留注释，避免遮挡主体） */}
            {/*
            <div
              className="bubble-dot"
              style={{
                left: `${bubble.position.dotX}%`,
                top: `${bubble.position.dotY}%`,
                animationDelay: `${bubble.delay}s`,
                backgroundColor: bubble.keyword ? '#4CAF50' : '#2196F3'
              }}
            />
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
            */}

            {/* 气泡主体 - 动态设置宽度和高度 */}
            <div
              ref={el => (bubbleRefs.current[bubble.id] = el)}
              className="evaluation-bubble-new"
              style={{
                left: `${bubble.position.bubbleX}%`,
                top: `${bubble.position.bubbleY}%`,
                animationDelay: `${bubble.delay + 0.2}s`,
                width: bubble.width ? `${bubble.width}px` : 'auto',
                minHeight: bubble.height ? `${bubble.height}px` : 'auto'
              }}
            >
              {bubble.keyword && <div className="bubble-keyword-tag">{bubble.keyword}</div>}
              <div className="bubble-content">{bubble.content}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ImageBubbles;

// 顶层辅助函数（放在现有辅助函数附近）
function regionToContainerRect(
  r: Region,
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number
) {
  let rx = r.x;
  let ry = r.y;
  let rw = r.width ?? 0;
  let rh = r.height ?? 0;

  if (isNormalizedRect(r)) {
    rx = r.x * imageWidth;
    ry = r.y * imageHeight;
    rw = (r.width ?? 0) * imageWidth;
    rh = (r.height ?? 0) * imageHeight;
  }

  const scaleX = containerWidth / imageWidth;
  const scaleY = containerHeight / imageHeight;

  const rect = {
    x: rx * scaleX,
    y: ry * scaleY,
    width: rw * scaleX,
    height: rh * scaleY
  };

  // 兼容仅有点（无宽高）的情况：给一个小盒子以便避让
  if (!r.width || !r.height) {
    const w = Math.max(rect.width, 20);
    const h = Math.max(rect.height, 20);
    return {
      x: rect.x - w / 2,
      y: rect.y - h / 2,
      width: w,
      height: h
    };
  }

  return rect;
}

function computeEmptinessScoreForRect(
  rect: { x: number; y: number; width: number; height: number },
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
  ctx: CanvasRenderingContext2D | null
) {
  if (!ctx || imageWidth <= 0 || imageHeight <= 0) return 0;

  const scaleX = imageWidth / containerWidth;
  const scaleY = imageHeight / containerHeight;

  const ix = Math.max(0, Math.floor(rect.x * scaleX));
  const iy = Math.max(0, Math.floor(rect.y * scaleY));
  const iw = Math.max(1, Math.floor(rect.width * scaleX));
  const ih = Math.max(1, Math.floor(rect.height * scaleY));

  try {
    const imageData = ctx.getImageData(ix, iy, iw, ih);
    const data = imageData.data;

    let sum = 0;
    let sumSq = 0;
    const stride = 16; // 降采样，减少开销

    for (let i = 0; i < data.length; i += 4 * stride) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += lum;
      sumSq += lum * lum;
    }

    const n = Math.floor(data.length / (4 * stride)) || 1;
    const mean = sum / n;
    const variance = Math.max(0, sumSq / n - mean * mean);

    // 方差越小表示越“平坦”，认为更空白；返回正值用于加分
    return 1 / (variance + 1);
  } catch {
    // 可能跨域导致 tainted canvas，失败则不给加分
    return 0;
  }
}