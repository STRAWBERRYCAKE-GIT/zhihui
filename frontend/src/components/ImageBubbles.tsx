import React, { useEffect, useRef, useState } from 'react';
import './ImageBubbles.css';

interface Bubble {
  id: string;
  position: Position;
  content: string;
  keyword?: string;
  text?: string;
  delay?: number;
  width?: number;
  height?: number;
}

interface Position {
  x: number;
  y: number;
  dotX?: number;
  dotY?: number;
  bubbleX?: number;
  bubbleY?: number;
}

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
  contentRegions?: Region[];
  emptyRegions?: Region[];
  textRegionMapping?: {
    text?: string;
    keyword?: string;
    confidence?: number;
    region?: Region;
    empty_region?: Region;
  }[];
  viewportOffset?: number;
}

const FRAME_PAD = 2;
const CONTENT_AVOID_MARGIN = 48; // 作为兜底值，实际使用自适应 avoidMargin
const MIN_EMPTY_SCORE = 0.36;
const EDGE_SCAN_STEP = 14;

const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(val, max));

// 计算气泡到矩形边缘的最近连接点 - 确保虚线不穿透气泡
function findNearestEdgePoint(
  bubbleRect: { x: number; y: number; width: number; height: number },
  dotX: number,
  dotY: number
): { x: number; y: number } {
  // 计算点到气泡四条边的最近点
  const left = bubbleRect.x;
  const right = bubbleRect.x + bubbleRect.width;
  const top = bubbleRect.y;
  const bottom = bubbleRect.y + bubbleRect.height;
  
  // 如果点在气泡内部，返回最近的边缘点
  if (dotX >= left && dotX <= right && dotY >= top && dotY <= bottom) {
    const distToLeft = dotX - left;
    const distToRight = right - dotX;
    const distToTop = dotY - top;
    const distToBottom = bottom - dotY;
    
    const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);
    
    if (minDist === distToLeft) return { x: left, y: dotY };
    if (minDist === distToRight) return { x: right, y: dotY };
    if (minDist === distToTop) return { x: dotX, y: top };
    return { x: dotX, y: bottom };
  }
  
  // 计算点到气泡各边的最近点，选择距离最短的
  let closestPoint = { x: dotX, y: dotY };
  let minDistance = Infinity;
  
  // 检查左边
  if (dotY >= top && dotY <= bottom) {
    const distance = Math.abs(dotX - left);
    if (distance < minDistance) {
      minDistance = distance;
      closestPoint = { x: left, y: dotY };
    }
  }
  
  // 检查右边
  if (dotY >= top && dotY <= bottom) {
    const distance = Math.abs(dotX - right);
    if (distance < minDistance) {
      minDistance = distance;
      closestPoint = { x: right, y: dotY };
    }
  }
  
  // 检查上边
  if (dotX >= left && dotX <= right) {
    const distance = Math.abs(dotY - top);
    if (distance < minDistance) {
      minDistance = distance;
      closestPoint = { x: dotX, y: top };
    }
  }
  
  // 检查下边
  if (dotX >= left && dotX <= right) {
    const distance = Math.abs(dotY - bottom);
    if (distance < minDistance) {
      minDistance = distance;
      closestPoint = { x: dotX, y: bottom };
    }
  }
  
  // 如果点不在任何边的投影范围内，检查四个角点
  if (minDistance === Infinity) {
    const corners = [
      { x: left, y: top },
      { x: right, y: top },
      { x: left, y: bottom },
      { x: right, y: bottom }
    ];
    
    for (const corner of corners) {
      const distance = Math.hypot(dotX - corner.x, dotY - corner.y);
      if (distance < minDistance) {
        minDistance = distance;
        closestPoint = corner;
      }
    }
  }
  
  return { x: Math.round(closestPoint.x), y: Math.round(closestPoint.y) };
}

const clampRectToContainer = (
  rect: { x: number; y: number; width: number; height: number },
  containerWidth: number,
  containerHeight: number
) => {
  const x = clamp(rect.x, FRAME_PAD, containerWidth - FRAME_PAD - rect.width);
  const y = clamp(rect.y, FRAME_PAD, containerHeight - FRAME_PAD - rect.height);
  return { x, y, width: rect.width, height: rect.height };
};

const inflateRect = (
  rect: { x: number; y: number; width: number; height: number },
  margin: number
) => ({
  x: rect.x - margin,
  y: rect.y - margin,
  width: rect.width + margin * 2,
  height: rect.height + margin * 2
});

const rectsOverlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
) => {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
};

// 保留函数定义，可能在未来使用
// const rectContainsRect = (
//   outer: { x: number; y: number; width: number; height: number },
//   inner: { x: number; y: number; width: number; height: number }
// ) => {
//   return (
//     inner.x >= outer.x &&
//     inner.y >= outer.y &&
//     inner.x + inner.width <= outer.x + outer.width &&
//     inner.y + inner.height <= outer.y + outer.height
//   );
// };

const overlapsWithContent = (
  candidate: { x: number; y: number; width: number; height: number },
  contentBoxes: { x: number; y: number; width: number; height: number }[],
  margin: number
) => {
  const inflatedCandidate = inflateRect(candidate, margin);
  return contentBoxes.some((c) => rectsOverlap(inflatedCandidate, c));
};

const isNormalizedRect = (r: Region | undefined) => {
  if (!r) return false;
  const vals = [r.x, r.y, r.width ?? 1, r.height ?? 1];
  return vals.every((v) => v >= 0 && v <= 1);
};

// 坐标模式检测：仅保留 normalized / pixel，避免误判百分比
function detectCoordMode(
  r: Region | undefined,
  _imageWidth: number,
  _imageHeight: number
): 'normalized' | 'pixel' {
  if (!r) return 'pixel';
  if (isNormalizedRect(r)) return 'normalized';
  return 'pixel';
}

function toImagePixels(val: number, mode: 'normalized' | 'percent' | 'pixel', axisSize: number) {
  if (mode === 'normalized') return val * axisSize;
  if (mode === 'percent') return (val / 100) * axisSize;
  return val;
}

// objectFit: contain 实际显示尺寸与偏移
function getDisplayedImageMetrics(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number
) {
  if (!containerWidth || !containerHeight || !imageWidth || !imageHeight) {
    return { displayedWidth: 0, displayedHeight: 0, offsetX: 0, offsetY: 0 };
  }
  const imgAspect = imageWidth / imageHeight;
  let displayedWidth = containerWidth;
  let displayedHeight = Math.round(containerWidth / imgAspect);
  if (displayedHeight > containerHeight) {
    displayedHeight = containerHeight;
    displayedWidth = Math.round(containerHeight * imgAspect);
  }
  const offsetX = Math.round((containerWidth - displayedWidth) / 2);
  const offsetY = Math.round((containerHeight - displayedHeight) / 2);
  return { displayedWidth, displayedHeight, offsetX, offsetY };
}

function regionToContainerRect(
  r: Region,
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number
) {
  const mode = detectCoordMode(r, imageWidth, imageHeight);
  const rx = toImagePixels(r.x, mode, imageWidth);
  const ry = toImagePixels(r.y, mode, imageHeight);
  const rw = toImagePixels(r.width || 0, mode, imageWidth);
  const rh = toImagePixels(r.height || 0, mode, imageHeight);

  const { displayedWidth, displayedHeight, offsetX, offsetY } =
    getDisplayedImageMetrics(containerWidth, containerHeight, imageWidth, imageHeight);
  const scaleX = displayedWidth / imageWidth;
  const scaleY = displayedHeight / imageHeight;

  const x = Math.round(offsetX + rx * scaleX);
  const y = Math.round(offsetY + ry * scaleY);
  const width = Math.round(rw * scaleX);
  const height = Math.round(rh * scaleY);
  return { x, y, width, height };
}

function centerToContainerPixels(
  r: Region,
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number
) {
  const mode = detectCoordMode(r, imageWidth, imageHeight);
  const rx = toImagePixels(r.x, mode, imageWidth);
  const ry = toImagePixels(r.y, mode, imageHeight);

  const { displayedWidth, displayedHeight, offsetX, offsetY } = getDisplayedImageMetrics(
    containerWidth, containerHeight, imageWidth, imageHeight
  );
  const scaleX = displayedWidth / imageWidth;
  const scaleY = displayedHeight / imageHeight;

  const hasW = (r.width ?? 0) > 0;
  const hasH = (r.height ?? 0) > 0;
  const halfW = hasW ? (toImagePixels(r.width!, mode, imageWidth) * scaleX) / 2 : 0;
  const halfH = hasH ? (toImagePixels(r.height!, mode, imageHeight) * scaleY) / 2 : 0;

  const cx = offsetX + rx * scaleX + halfW;
  const cy = offsetY + ry * scaleY + halfH;
  return { x: cx, y: cy };
}

// 自适应主体避让边距：按显示尺寸动态计算

function computeBubbleSize(content: string, currentCount: number) {
  const baseW = 140;  // 减小基础宽度
  const baseH = 60;   // 减小基础高度
  const len = content.length;
  const w = clamp(baseW + Math.floor(len * 1.5), 120, 220);  // 减小尺寸范围
  const lines = Math.ceil(len / 24);  // 每行字符数稍微减少
  const h = clamp(baseH + lines * 12, 50, 100);  // 减小高度范围和行高
  const scale = currentCount > 6 ? 0.8 : currentCount > 3 ? 0.9 : 1.0;  // 进一步缩小
  return { bubbleWidth: Math.round(w * scale), bubbleHeight: Math.round(h * scale) };
}


const segmentIntersectsRect = (
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number }
) => {
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);
  if (maxX < rect.x || minX > rect.x + rect.width || maxY < rect.y || minY > rect.y + rect.height) return false;

  const sides = [
    [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y }],
    [{ x: rect.x, y: rect.y + rect.height }, { x: rect.x + rect.width, y: rect.y + rect.height }],
    [{ x: rect.x, y: rect.y }, { x: rect.x, y: rect.y + rect.height }],
    [{ x: rect.x + rect.width, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height }]
  ];

  const cross = (a: any, b: any, c: any, d: any) => {
    const det = (p: any, q: any, r: any) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const d1 = det(a, b, c);
    const d2 = det(a, b, d);
    const d3 = det(c, d, a);
    const d4 = det(c, d, b);
    const onSeg = (p: any, q: any, r: any) =>
      Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x) && Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    return d1 === 0 && onSeg(a, c, b) || d2 === 0 && onSeg(a, d, b) || d3 === 0 && onSeg(c, a, d) || d4 === 0 && onSeg(c, b, d);
  };

  return sides.some(([s1, s2]) => cross(p1, p2, s1, s2));
};

function computeEmptinessScoreForRect(
  rect: { x: number; y: number; width: number; height: number },
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
  ctx: CanvasRenderingContext2D | null
) {
  if (!ctx) return 0.5; // 无画布时估个中性值
  const { displayedWidth, displayedHeight, offsetX, offsetY } =
    getDisplayedImageMetrics(containerWidth, containerHeight, imageWidth, imageHeight);
  const x = clamp(rect.x, offsetX, offsetX + displayedWidth);
  const y = clamp(rect.y, offsetY, offsetY + displayedHeight);
  const w = clamp(rect.width, 0, displayedWidth);
  const h = clamp(rect.height, 0, displayedHeight);
  const imageData = ctx.getImageData(x, y, w, h);
  let sum = 0;
  for (let i = 0; i < imageData.data.length; i += 20) {
    const r = imageData.data[i], g = imageData.data[i + 1], b = imageData.data[i + 2];
    const bright = (r + g + b) / 765;
    sum += bright;
  }
  const avg = sum / (imageData.data.length / 20);
  // 越接近“空白”（亮度更高）得分越高
  return avg;
}

function nearestPointInRectToPoint(
  rect: { x: number; y: number; width: number; height: number },
  p: { x: number; y: number }
) {
  const x = clamp(p.x, rect.x, rect.x + rect.width);
  const y = clamp(p.y, rect.y, rect.y + rect.height);
  return { x, y };
}





function adjustBubbleToAvoidLineCrossing(
  initialRect: { x: number; y: number; width: number; height: number },
  dotX: number,
  dotY: number,
  contentBoxes: { x: number; y: number; width: number; height: number }[],
  usedBubbleRects: { x: number; y: number; width: number; height: number }[],
  containerWidth: number,
  containerHeight: number,
  ctx: CanvasRenderingContext2D | null,
  imageWidth: number,
  imageHeight: number
) {
  const deltas = [
    { dx: 16, dy: 0 }, { dx: -16, dy: 0 },
    { dx: 0, dy: 16 }, { dx: 0, dy: -16 },
    { dx: 16, dy: 16 }, { dx: -16, dy: 16 },
    { dx: 16, dy: -16 }, { dx: -16, dy: -16 }
  ];
  const minAnchorDistPx = 48;

  for (const d of deltas) {
    const rect = clampRectToContainer({
      x: initialRect.x + d.dx,
      y: initialRect.y + d.dy,
      width: initialRect.width,
      height: initialRect.height
    }, containerWidth, containerHeight);

    let overlapBubble = false;
    for (const u of usedBubbleRects) {
      if (rectsOverlap(rect, u)) { overlapBubble = true; break; }
    }
    if (overlapBubble) continue;

    const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const dist = Math.hypot(center.x - dotX, center.y - dotY);
    if (dist < minAnchorDistPx) continue;

    let crosses = false;
    for (const c of contentBoxes) {
      if (segmentIntersectsRect({ x: dotX, y: dotY }, center, c)) { crosses = true; break; }
    }
    if (crosses) continue;

    const emptyScore = computeEmptinessScoreForRect(rect, containerWidth, containerHeight, imageWidth, imageHeight, ctx);
    if (emptyScore < MIN_EMPTY_SCORE * 0.8) continue;

    return rect;
  }
  return initialRect;
}

function findEdgeSlotNearDot(
  dotX: number,
  dotY: number,
  bubbleWidth: number,
  bubbleHeight: number,
  usedBubbleRects: { x: number; y: number; width: number; height: number }[],
  contentBoxes: { x: number; y: number; width: number; height: number }[],
  containerWidth: number,
  containerHeight: number,
  ctx: CanvasRenderingContext2D | null,
  imageWidth: number,
  imageHeight: number
) {
  const edges = [
    { gen: (x: number) => ({ x: x, y: FRAME_PAD }), range: { from: FRAME_PAD, to: containerWidth - FRAME_PAD - bubbleWidth } },
    { gen: (x: number) => ({ x: x, y: containerHeight - FRAME_PAD - bubbleHeight }), range: { from: FRAME_PAD, to: containerWidth - FRAME_PAD - bubbleWidth } },
    { gen: (y: number) => ({ x: FRAME_PAD, y: y }), range: { from: FRAME_PAD, to: containerHeight - FRAME_PAD - bubbleHeight } },
    { gen: (y: number) => ({ x: containerWidth - FRAME_PAD - bubbleWidth, y: y }), range: { from: FRAME_PAD, to: containerHeight - FRAME_PAD - bubbleHeight } }
  ] as const;

  let best: { x: number; y: number } | null = null;
  let bestDist = Infinity;

  const minAnchorDistPx = 48;

  for (const e of edges) {
    for (let t = e.range.from; t <= e.range.to; t += EDGE_SCAN_STEP) {
      const pos = e.gen(t as any);
      const rect = { x: pos.x, y: pos.y, width: bubbleWidth, height: bubbleHeight };
      if (overlapsWithContent(rect, contentBoxes, CONTENT_AVOID_MARGIN)) continue;
      let overlapBubble = false;
      for (const u of usedBubbleRects) {
        if (rectsOverlap(rect, u)) { overlapBubble = true; break; }
      }
      if (overlapBubble) continue;

      const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      const dist = Math.hypot(center.x - dotX, center.y - dotY);
      if (dist < minAnchorDistPx) continue;

      const emptyScore = computeEmptinessScoreForRect(rect, containerWidth, containerHeight, imageWidth, imageHeight, ctx);
      if (emptyScore < MIN_EMPTY_SCORE * 0.8) continue;

      const np = nearestPointInRectToPoint(rect, { x: dotX, y: dotY });
      const candidate = { x: np.x - bubbleWidth / 2, y: np.y - bubbleHeight / 2 };
      const cDist = Math.hypot(candidate.x + bubbleWidth / 2 - dotX, candidate.y + bubbleHeight / 2 - dotY);
      if (cDist < bestDist) {
        best = candidate;
        bestDist = cDist;
      }
    }
  }

  return best;
}

// 新增：在空白区域中寻找最佳位置的优化算法
function findOptimalPositionInEmptyRegions(
  dotX: number,
  dotY: number,
  bubbleWidth: number,
  bubbleHeight: number,
  emptyRects: { x: number; y: number; width: number; height: number }[],
  contentBoxes: { x: number; y: number; width: number; height: number }[],
  usedBubbleRects: { x: number; y: number; width: number; height: number }[],
  containerWidth: number,
  containerHeight: number,
  ctx: CanvasRenderingContext2D | null
) {
  const candidates: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    score: number;
    distance: number;
  }> = [];

  for (const emptyRect of emptyRects) {
    // 在每个空白区域内尝试多个位置
    const positions = generateCandidatePositions(emptyRect, bubbleWidth, bubbleHeight, dotX, dotY);
    
    for (const pos of positions) {
      // 检查是否与已有气泡重叠
      const overlapsExisting = usedBubbleRects.some(used => rectsOverlap(pos, used));
      if (overlapsExisting) continue;

      // 检查是否与内容区域重叠
      const overlapsContent = contentBoxes.some(content => rectsOverlap(pos, content));
      if (overlapsContent) continue;

      // 计算到锚点的距离
      const centerX = pos.x + pos.width / 2;
      const centerY = pos.y + pos.height / 2;
      const distance = Math.hypot(centerX - dotX, centerY - dotY);

      // 计算空白度评分（如果有画布上下文）
      let emptyScore = 0.8; // 默认评分
      if (ctx) {
        emptyScore = computeEmptinessScoreForRect(pos, containerWidth, containerHeight, 0, 0, ctx);
      }

      // 综合评分：距离越近越好，空白度越高越好
      const distanceScore = 1 / (1 + distance / 100); // 距离评分
      const totalScore = emptyScore * 0.6 + distanceScore * 0.4;

      candidates.push({
        ...pos,
        score: totalScore,
        distance: distance
      });
    }
  }

  // 按评分排序，选择最佳位置
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length > 0 ? candidates[0] : null;
}

// 生成候选位置
function generateCandidatePositions(
  emptyRect: { x: number; y: number; width: number; height: number },
  bubbleWidth: number,
  bubbleHeight: number,
  dotX: number,
  dotY: number
): Array<{ x: number; y: number; width: number; height: number }> {
  const positions: Array<{ x: number; y: number; width: number; height: number }> = [];
  
  // 确保气泡能完全放入空白区域
  if (emptyRect.width < bubbleWidth || emptyRect.height < bubbleHeight) {
    return positions;
  }

  const maxX = emptyRect.x + emptyRect.width - bubbleWidth;
  const maxY = emptyRect.y + emptyRect.height - bubbleHeight;

  // 生成网格候选位置
  const stepX = Math.max(20, (maxX - emptyRect.x) / 4);
  const stepY = Math.max(20, (maxY - emptyRect.y) / 4);

  for (let x = emptyRect.x; x <= maxX; x += stepX) {
    for (let y = emptyRect.y; y <= maxY; y += stepY) {
      positions.push({
        x: Math.round(x),
        y: Math.round(y),
        width: bubbleWidth,
        height: bubbleHeight
      });
    }
  }

  // 添加一些特殊位置：最接近锚点的位置
  const closestX = clamp(dotX - bubbleWidth / 2, emptyRect.x, maxX);
  const closestY = clamp(dotY - bubbleHeight / 2, emptyRect.y, maxY);
  positions.push({
    x: Math.round(closestX),
    y: Math.round(closestY),
    width: bubbleWidth,
    height: bubbleHeight
  });

  return positions;
}

// 智能径向搜索：优先寻找低兴趣值区域
function intelligentRadialSearch(
  dotX: number,
  dotY: number,
  bubbleWidth: number,
  bubbleHeight: number,
  contentBoxes: { x: number; y: number; width: number; height: number }[],
  usedBubbleRects: { x: number; y: number; width: number; height: number }[],
  containerWidth: number,
  containerHeight: number,
  ctx: CanvasRenderingContext2D | null,
  imageWidth: number,
  imageHeight: number
): { x: number; y: number; width: number; height: number; score: number } | null {
  const { displayedWidth, displayedHeight, offsetX, offsetY } =
    getDisplayedImageMetrics(containerWidth, containerHeight, imageWidth, imageHeight);

  // 定义搜索参数
  const maxRadius = Math.min(displayedWidth, displayedHeight) * 0.4;
  const radiusStep = 30;
  // const angleStep = Math.PI / 8; // 22.5度步长（保留用于未来优化）

  let bestCandidate: { x: number; y: number; width: number; height: number; score: number } | null = null;

  for (let radius = radiusStep; radius <= maxRadius; radius += radiusStep) {
    const anglesCount = Math.max(8, Math.floor((2 * Math.PI * radius) / 60)); // 根据半径调整角度数量
    
    for (let i = 0; i < anglesCount; i++) {
      const angle = (i / anglesCount) * 2 * Math.PI;
      const candidateX = dotX + Math.cos(angle) * radius - bubbleWidth / 2;
      const candidateY = dotY + Math.sin(angle) * radius - bubbleHeight / 2;

      const candidate = clampRectToContainer(
        { x: candidateX, y: candidateY, width: bubbleWidth, height: bubbleHeight },
        containerWidth, containerHeight
      );

      // 确保在图像显示区域内
      if (candidate.x < offsetX || candidate.y < offsetY ||
          candidate.x + candidate.width > offsetX + displayedWidth ||
          candidate.y + candidate.height > offsetY + displayedHeight) {
        continue;
      }

      // 检查重叠
      const overlapsExisting = usedBubbleRects.some(used => rectsOverlap(candidate, used));
      if (overlapsExisting) continue;

      const overlapsContent = contentBoxes.some(content => rectsOverlap(candidate, content));
      if (overlapsContent) continue;

      // 计算空白度评分
      let emptyScore = MIN_EMPTY_SCORE;
      if (ctx) {
        emptyScore = computeEmptinessScoreForRect(candidate, containerWidth, containerHeight, imageWidth, imageHeight, ctx);
      }

      // 只考虑空白度足够高的区域
      if (emptyScore >= MIN_EMPTY_SCORE) {
        const score = emptyScore - (radius / maxRadius) * 0.2; // 距离越近评分越高
        
        if (!bestCandidate || score > bestCandidate.score) {
          bestCandidate = { ...candidate, score };
        }
      }
    }

    // 如果在当前半径找到了好的候选，可以提前返回
    if (bestCandidate && bestCandidate.score > 0.7) {
      break;
    }
  }

  return bestCandidate;
}

function calculateOptimalBubblePosition(
  dotX: number,
  dotY: number,
  containerWidth: number,
  containerHeight: number,
  usedBubblePositions: { x: number; y: number; width: number; height: number }[],
  content: string,
  contentBoxes: { x: number; y: number; width: number; height: number }[],
  preferredEmptyRects: { x: number; y: number; width: number; height: number }[],
  fallbackEmptyRects: { x: number; y: number; width: number; height: number }[],
  ctx: CanvasRenderingContext2D | null,
  imageWidth: number,
  imageHeight: number
) {
  const { bubbleWidth, bubbleHeight } = computeBubbleSize(content, usedBubblePositions.length);

  // 1. 优先级：在指定的空白区域中寻找最佳位置
  if (preferredEmptyRects.length > 0) {
    const placed = findOptimalPositionInEmptyRegions(
      dotX, dotY, bubbleWidth, bubbleHeight, preferredEmptyRects,
      contentBoxes, usedBubblePositions, containerWidth, containerHeight, ctx
    );
    if (placed) {
      return {
        bubbleX: placed.x,
        bubbleY: placed.y,
        width: bubbleWidth,
        height: bubbleHeight
      };
    }
  }

  // 2. 次优先级：在全局空白区域中寻找
  if (fallbackEmptyRects.length > 0) {
    const placed = findOptimalPositionInEmptyRegions(
      dotX, dotY, bubbleWidth, bubbleHeight, fallbackEmptyRects,
      contentBoxes, usedBubblePositions, containerWidth, containerHeight, ctx
    );
    if (placed) {
      return {
        bubbleX: placed.x,
        bubbleY: placed.y,
        width: bubbleWidth,
        height: bubbleHeight
      };
    }
  }

  // 3. 智能径向搜索：在低兴趣值区域中寻找
  const radialPlaced = intelligentRadialSearch(
    dotX, dotY, bubbleWidth, bubbleHeight, 
    contentBoxes, usedBubblePositions, containerWidth, containerHeight, ctx, imageWidth, imageHeight
  );
  if (radialPlaced && radialPlaced.x !== undefined && radialPlaced.y !== undefined) {
    return {
      bubbleX: radialPlaced.x,
      bubbleY: radialPlaced.y,
      width: bubbleWidth,
      height: bubbleHeight
    };
  }

  // 4. 边缘兜底
  const edgeSlot = findEdgeSlotNearDot(
    dotX, dotY, bubbleWidth, bubbleHeight, usedBubblePositions,
    contentBoxes, containerWidth, containerHeight, ctx, imageWidth, imageHeight
  );
  if (edgeSlot) {
    return {
      bubbleX: edgeSlot.x,
      bubbleY: edgeSlot.y,
      width: bubbleWidth,
      height: bubbleHeight
    };
  }

  // 5. 最终兜底：确保在图像区域内，尽量靠近指向点且避开内容区域
  const { displayedWidth, displayedHeight, offsetX, offsetY } =
    getDisplayedImageMetrics(containerWidth, containerHeight, imageWidth, imageHeight);
  const minX = offsetX + FRAME_PAD;
  const minY = offsetY + FRAME_PAD;
  const maxX = offsetX + displayedWidth - FRAME_PAD - bubbleWidth;
  const maxY = offsetY + displayedHeight - FRAME_PAD - bubbleHeight;

  // 尝试在点的四个方向寻找最佳位置，优先选择距离最近且不与内容重叠的位置
  const directions = [
    { x: dotX + 60, y: dotY - bubbleHeight / 2, priority: 1 }, // 右侧
    { x: dotX - 60 - bubbleWidth, y: dotY - bubbleHeight / 2, priority: 1 }, // 左侧
    { x: dotX - bubbleWidth / 2, y: dotY - 60 - bubbleHeight, priority: 2 }, // 上方
    { x: dotX - bubbleWidth / 2, y: dotY + 60, priority: 2 } // 下方
  ].sort((a, b) => a.priority - b.priority);

  for (const pos of directions) {
    const clampedX = clamp(pos.x, minX, maxX);
    const clampedY = clamp(pos.y, minY, maxY);
    const testRect = { x: clampedX, y: clampedY, width: bubbleWidth, height: bubbleHeight };
    
    // 检查是否与内容区域重叠，使用较小的避让边距
    if (!overlapsWithContent(testRect, contentBoxes, 15)) {
      // 检查是否与已有气泡重叠
      let overlapsWithBubbles = false;
      for (const used of usedBubblePositions) {
        if (rectsOverlap(testRect, used)) {
          overlapsWithBubbles = true;
          break;
        }
      }
      
      if (!overlapsWithBubbles) {
        return {
          bubbleX: clampedX,
          bubbleY: clampedY,
          width: bubbleWidth,
          height: bubbleHeight
        };
      }
    }
  }

  // 如果所有方向都不可用，则使用默认位置但尽量避开内容
  let finalX = clamp(dotX - Math.round(bubbleWidth / 2), minX, maxX);
  let finalY = clamp(dotY - Math.round(bubbleHeight / 2), minY, maxY);
  
  // 微调位置以避开内容区域
  const testRect = { x: finalX, y: finalY, width: bubbleWidth, height: bubbleHeight };
  if (overlapsWithContent(testRect, contentBoxes, 10)) {
    // 尝试向上移动
    const upY = clamp(dotY - bubbleHeight - 20, minY, maxY);
    const upRect = { x: finalX, y: upY, width: bubbleWidth, height: bubbleHeight };
    if (!overlapsWithContent(upRect, contentBoxes, 10)) {
      finalY = upY;
    } else {
      // 尝试向右移动
      const rightX = clamp(dotX + 20, minX, maxX);
      const rightRect = { x: rightX, y: finalY, width: bubbleWidth, height: bubbleHeight };
      if (!overlapsWithContent(rightRect, contentBoxes, 10)) {
        finalX = rightX;
      }
    }
  }

  return {
    bubbleX: finalX,
    bubbleY: finalY,
    width: bubbleWidth,
    height: bubbleHeight
  };
}

export default function ImageBubbles({
  imageUrl,
  sentences,
  isVisible,
  contentRegions = [],
  emptyRegions = [],
  textRegionMapping = [],
  viewportOffset = 0
}: ImageBubblesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [bubbles, setBubbles] = useState<Bubble[]>([]);

  const layoutKeyRef = useRef<string | null>(null);

  // 设备像素栅格对齐
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const snap = (v: number) => Math.round(v * dpr) / dpr;

  // 挂载后立即设置容器尺寸，避免仅缩放时才更新
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      setContainerSize({ width: container.clientWidth, height: container.clientHeight });
    }
  }, []);

  // 初始化：加载图片尺寸与画布
  useEffect(() => {
    const img = imageRef.current;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!img || !container || !canvas) return;

    const handleLoad = () => {
      setContainerSize({ width: container.clientWidth, height: container.clientHeight });
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      const ctx = canvas.getContext('2d');
      ctxRef.current = ctx;
      if (ctx) {
        const { displayedWidth, displayedHeight, offsetX, offsetY } =
          getDisplayedImageMetrics(container.clientWidth, container.clientHeight, img.naturalWidth, img.naturalHeight);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, offsetX, offsetY, displayedWidth, displayedHeight);
      }
    };

    if (img.complete) {
      handleLoad();
    } else {
      img.onload = handleLoad;
    }

    return () => { img.onload = null; };
  }, [imageUrl]);

  // 主布局计算：使用 DINO 空白与主体区域
  useEffect(() => {
    try {
      console.log('ImageBubbles useEffect triggered:', {
        isVisible,
        textRegionMapping,
        containerSize,
        imageSize
      });
      
      if (!isVisible) { 
        console.log('Not visible, clearing bubbles');
        setBubbles([]); 
        return; 
      }
      const container = containerRef.current;
      const img = imageRef.current;
      const ctx = ctxRef.current;
      if (!container || !img) {
        console.log('Container or image not ready');
        return;
      }

      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      const imageWidth = img.naturalWidth;
      const imageHeight = img.naturalHeight;

      // 验证图像尺寸
      if (!imageWidth || !imageHeight || imageWidth <= 0 || imageHeight <= 0) {
        console.error('Invalid image dimensions:', { imageWidth, imageHeight });
        setBubbles([]);
        return;
      }

      // 验证容器尺寸
      if (!containerWidth || !containerHeight || containerWidth <= 0 || containerHeight <= 0) {
        console.error('Invalid container dimensions:', { containerWidth, containerHeight });
        setBubbles([]);
        return;
      }

      // 安全地处理textRegionMapping数据
      const items = [];
      if (textRegionMapping && Array.isArray(textRegionMapping) && textRegionMapping.length > 0) {
        for (const m of textRegionMapping) {
          try {
            if (m && typeof m === 'object') {
              items.push({ 
                text: m.text || '', 
                keyword: m.keyword || '', 
                region: m.region || null, 
                empty_region: m.empty_region || null 
              });
            }
          } catch (err) {
            console.warn('Error processing textRegionMapping item:', err, m);
          }
        }
      }

      console.log('Processing items for bubbles:', {
        textRegionMapping,
        items,
        itemsLength: items.length
      });

      const contentBoxes: { x: number; y: number; width: number; height: number }[] = [];
      const globalEmptyBoxes: { x: number; y: number; width: number; height: number }[] = [];

      // 安全地处理items
      if (items.length > 0) {
        for (const m of items) {
          try {
            if (m.region && typeof m.region === 'object') {
              const rect = regionToContainerRect(m.region, containerWidth, containerHeight, imageWidth, imageHeight);
              if (rect && typeof rect === 'object' && !isNaN(rect.x) && !isNaN(rect.y)) {
                contentBoxes.push(rect);
              }
            }
            if (m.empty_region && typeof m.empty_region === 'object') {
              const rect = regionToContainerRect(m.empty_region, containerWidth, containerHeight, imageWidth, imageHeight);
              if (rect && typeof rect === 'object' && !isNaN(rect.x) && !isNaN(rect.y) && rect.width > 8 && rect.height > 8) {
                globalEmptyBoxes.push(rect);
              }
            }
          } catch (err) {
            console.warn('Error processing item regions:', err, m);
          }
        }
      }

      // 安全地处理contentRegions
      if (contentRegions && Array.isArray(contentRegions)) {
        for (const r of contentRegions) {
          try {
            if (r && typeof r === 'object') {
              const rect = regionToContainerRect(r, containerWidth, containerHeight, imageWidth, imageHeight);
              if (rect && typeof rect === 'object' && !isNaN(rect.x) && !isNaN(rect.y)) {
                contentBoxes.push(rect);
              }
            }
          } catch (err) {
            console.warn('Error processing contentRegions:', err, r);
          }
        }
      }

      // 安全地处理emptyRegions
      if (emptyRegions && Array.isArray(emptyRegions)) {
        for (const r of emptyRegions) {
          try {
            if (r && typeof r === 'object') {
              const rect = regionToContainerRect(r, containerWidth, containerHeight, imageWidth, imageHeight);
              if (rect && typeof rect === 'object' && !isNaN(rect.x) && !isNaN(rect.y) && rect.width > 8 && rect.height > 8) {
                globalEmptyBoxes.push(rect);
              }
            }
          } catch (err) {
            console.warn('Error processing emptyRegions:', err, r);
          }
        }
      }

      const placedRects: { x: number; y: number; width: number; height: number }[] = [];
      const newBubbles: Bubble[] = [];

      // 安全地处理每个气泡项目
      items.forEach((item, idx) => {
        try {
          const contentText = (item.text || item.keyword || '').trim();
          if (!contentText) return;
          if (!item.region) return;

          const centerResult = centerToContainerPixels(item.region, containerWidth, containerHeight, imageWidth, imageHeight);
          if (!centerResult || isNaN(centerResult.x) || isNaN(centerResult.y)) {
            console.warn('Invalid center calculation for item:', item);
            return;
          }
          const { x: dotX, y: dotY } = centerResult;

          const preferredEmptyRects: { x: number; y: number; width: number; height: number }[] = [];
          if (item.empty_region) {
            try {
              const er = regionToContainerRect(item.empty_region, containerWidth, containerHeight, imageWidth, imageHeight);
              if (er && !isNaN(er.x) && !isNaN(er.y) && er.width > 8 && er.height > 8) {
                preferredEmptyRects.push(er);
              }
            } catch (err) {
              console.warn('Error processing empty_region:', err, item.empty_region);
            }
          }

          const placed = calculateOptimalBubblePosition(
            dotX, dotY, containerWidth, containerHeight, placedRects,
            contentText, contentBoxes, preferredEmptyRects, globalEmptyBoxes, ctx, imageWidth, imageHeight
          );

          // 验证气泡位置计算结果
          if (!placed || isNaN(placed.bubbleX) || isNaN(placed.bubbleY) || isNaN(placed.width) || isNaN(placed.height)) {
            console.warn('Invalid bubble position calculated for item:', item, placed);
            return;
          }

          const center = { x: placed.bubbleX + placed.width / 2, y: placed.bubbleY + placed.height / 2 };
          let crosses = false;
          try {
            for (const c of contentBoxes) {
              if (segmentIntersectsRect({ x: dotX, y: dotY }, center, c)) { crosses = true; break; }
            }
          } catch (err) {
            console.warn('Error checking line crossing:', err);
            crosses = false;
          }

          let finalRect = { x: placed.bubbleX, y: placed.bubbleY, width: placed.width, height: placed.height };
          if (crosses) {
            try {
              finalRect = adjustBubbleToAvoidLineCrossing(
                finalRect, dotX, dotY, contentBoxes, placedRects,
                containerWidth, containerHeight, ctx, imageWidth, imageHeight
              );
            } catch (err) {
              console.warn('Error adjusting bubble position:', err);
              // 使用原始位置作为后备
            }
          }

          // 写入"膨胀后的占位"，为后续气泡留安全边距，避免重叠
          try {
            const inflatedRect = inflateRect(finalRect, 6);
            if (inflatedRect && !isNaN(inflatedRect.x) && !isNaN(inflatedRect.y)) {
              placedRects.push(inflatedRect);
            }
          } catch (err) {
            console.warn('Error inflating rect:', err);
          }

          // 使用百分比存储，渲染时转换像素
          const bubbleXPercent = ((finalRect.x + finalRect.width / 2) / containerWidth) * 100;
          const bubbleYPercent = ((finalRect.y + finalRect.height / 2) / containerHeight) * 100;
          const dotXPercent = (dotX / containerWidth) * 100;
          const dotYPercent = (dotY / containerHeight) * 100;

          // 验证百分比计算结果
          if (isNaN(bubbleXPercent) || isNaN(bubbleYPercent) || isNaN(dotXPercent) || isNaN(dotYPercent)) {
            console.warn('Invalid percentage calculation for item:', item, {
              bubbleXPercent, bubbleYPercent, dotXPercent, dotYPercent
            });
            return;
          }

          newBubbles.push({
            id: `bubble-${idx}`,
            content: contentText,
            position: {
              x: finalRect.x,
              y: finalRect.y,
              bubbleX: bubbleXPercent,
              bubbleY: bubbleYPercent,
              dotX: dotXPercent,
              dotY: dotYPercent
            },
            width: finalRect.width,
            height: finalRect.height
          });
        } catch (err) {
          console.error('Error processing bubble item:', err, item);
        }
      });

      console.log('Setting bubbles:', {
        newBubbles,
        bubblesCount: newBubbles.length,
        bubbles: newBubbles.map(b => ({ id: b.id, content: b.content, position: b.position }))
      });
      
      setBubbles(newBubbles);
      layoutKeyRef.current = `${imageUrl}-${containerWidth}x${containerHeight}`;
    } catch (error) {
      console.error('Critical error in ImageBubbles useEffect:', error);
      // 设置空气泡数组，防止白屏
      setBubbles([]);
    }
  }, [isVisible, imageUrl, textRegionMapping, sentences, contentRegions, emptyRegions, containerSize, imageSize]);

  // 容器尺寸变化：重绘画布为显示尺寸 + 偏移
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      setContainerSize({ width: container.clientWidth, height: container.clientHeight });
      const img = imageRef.current;
      const canvas = canvasRef.current;
      const ctx = ctxRef.current;
      if (img && canvas && ctx) {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        canvas.width = cw;
        canvas.height = ch;
        const { displayedWidth, displayedHeight, offsetX, offsetY } =
          getDisplayedImageMetrics(cw, ch, img.naturalWidth, img.naturalHeight);
        ctx.clearRect(0, 0, cw, ch);
        ctx.drawImage(img, offsetX, offsetY, displayedWidth, displayedHeight);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const containerStyle: React.CSSProperties = { position: 'relative', width: '100%', height: `calc(100vh - ${viewportOffset}px)` };
  const imageStyle: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'contain', display: 'block' };

  // 计算当前图片显示比例（用于线条/圆点按比例缩放）
  const { displayedWidth } = getDisplayedImageMetrics(
    containerSize.width, containerSize.height, imageSize.width, imageSize.height
  );
  const imageScale = imageSize.width && imageSize.height
    ? displayedWidth / imageSize.width
    : 1;

  // 线条与圆点的比例与像素夹取，避免亚像素被吞
  const scaledStroke = Math.max(1, Math.round(1.6 * imageScale * dpr) / dpr);
  const dashA = Math.max(3, Math.round(6 * imageScale));
  const dashB = Math.max(2, Math.round(4 * imageScale));
  const scaledRadius = Math.max(2.5, Math.round(3.4 * imageScale * dpr) / dpr);

  return (
    <div ref={containerRef} style={containerStyle}>
      <img ref={imageRef} src={imageUrl} alt="target" style={imageStyle} />
      <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, opacity: 0, pointerEvents: 'none' }} />

      {/* 优化的批注视觉元素：点、虚线、文字 */}
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${containerSize.width} ${containerSize.height}`}
        preserveAspectRatio="none"
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 4 }}
      >
          <defs>
            {/* 定义渐变和阴影效果 - 橙色主题 */}
            <radialGradient id="dotGradient" cx="30%" cy="30%">
              <stop offset="0%" stopColor="#ffb366" />
              <stop offset="70%" stopColor="#ff8c42" />
              <stop offset="100%" stopColor="#e67a3a" />
            </radialGradient>
          <filter id="dotShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="1" dy="1" stdDeviation="1" floodColor="rgba(0,0,0,0.3)" />
          </filter>
          <filter id="lineShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0.5" dy="0.5" stdDeviation="0.5" floodColor="rgba(0,0,0,0.2)" />
          </filter>
        </defs>
        
        {bubbles.map((b) => {
          try {
            const isFiniteNumber = (v: number | undefined) => typeof v === 'number' && Number.isFinite(v);
            const { dotX, dotY, bubbleX, bubbleY } = b.position || {};
            const hasCoords = isFiniteNumber(dotX) && isFiniteNumber(dotY) && isFiniteNumber(bubbleX) && isFiniteNumber(bubbleY);
            if (!hasCoords) {
              console.warn('Invalid bubble coordinates:', b);
              return null;
            }

          const x1 = ((dotX || 0) / 100) * containerSize.width;
          const y1 = ((dotY || 0) / 100) * containerSize.height;
          const x2 = ((bubbleX || 0) / 100) * containerSize.width;
          const y2 = ((bubbleY || 0) / 100) * containerSize.height;

          // 像素栅格对齐，减少抗锯齿模糊
          const sx1 = snap(x1), sy1 = snap(y1);

          // 计算气泡矩形（用于精确连线）- 与HTML元素位置保持一致
          const bubbleWidth = b.width || 160;
          const bubbleHeight = b.height || 80;
          const bubbleRect = {
            x: x2 - bubbleWidth / 2,
            y: y2 - bubbleHeight / 2,
            width: bubbleWidth,
            height: bubbleHeight
          };

          // 计算虚线连接到气泡边缘的精确点
          const edgePoint = findNearestEdgePoint(bubbleRect, sx1, sy1);
          const sx2Edge = snap(edgePoint.x);
          const sy2Edge = snap(edgePoint.y);
          
          // 调试信息（开发时可用）
          if (true) { // 开发环境调试
            console.log(`气泡 ${b.id} 连线调试:`, {
              点位置: { x: sx1, y: sy1 },
              气泡中心: { x: x2, y: y2 },
              气泡矩形: bubbleRect,
              边缘连接点: { x: sx2Edge, y: sy2Edge }
            });
          }

          return (
            <g key={`annotation-${b.id}`}>
              {/* 连接虚线 - 精确连接到气泡边缘 */}
              <line
                x1={sx1}
                y1={sy1}
                x2={sx2Edge}
                y2={sy2Edge}
                stroke="#ff8c42"
                strokeWidth={scaledStroke}
                strokeDasharray={`${dashA} ${dashB}`}
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#lineShadow)"
                opacity="0.9"
              />
              
              {/* 指向点 - 带渐变和阴影 */}
              <circle 
                cx={sx1} 
                cy={sy1} 
                r={scaledRadius} 
                fill="url(#dotGradient)"
                filter="url(#dotShadow)"
                stroke="#ffffff"
                strokeWidth="0.5"
              />
              
              {/* 内部高亮点 */}
              <circle 
                cx={sx1} 
                cy={sy1} 
                r={scaledRadius * 0.4} 
                fill="#ffb366"
                opacity="0.9"
              />
            </g>
          );
          } catch (err) {
            console.error('Error rendering SVG bubble:', err, b);
            return null;
          }
        })}
      </svg>

      {bubbles.map((b) => {
        try {
          const bubbleWidth = b.width || 160;
          const bubbleHeight = b.height || 80;
          const centerX = ((b.position?.bubbleX || 0) / 100) * containerSize.width;
          const centerY = ((b.position?.bubbleY || 0) / 100) * containerSize.height;
          
          if (isNaN(centerX) || isNaN(centerY)) {
            console.warn('Invalid bubble center coordinates:', b);
            return null;
          }
          
          const left = centerX - bubbleWidth / 2;
          const top = centerY - bubbleHeight / 2;
          const leftPx = Math.round(left);
          const topPx = Math.round(top);
        return (
          <div
            key={b.id}
            className="bubble"
            style={{
              position: 'absolute',
              left: `${leftPx}px`,
              top: `${topPx}px`,
              width: `${bubbleWidth}px`,
              height: `${bubbleHeight}px`,
              maxWidth: '280px',
              pointerEvents: 'auto',
              color: '#d60000',
              zIndex: 3,
              willChange: 'transform'
            }}
          >
            <span className="bubble-text" data-text={b.content || ''}>{b.content || ''}</span>
          </div>
        );
        } catch (err) {
          console.error('Error rendering HTML bubble:', err, b);
          return null;
        }
      })}
    </div>
  );
}