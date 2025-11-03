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

// 在气泡内部找到最佳连接点，避免虚线相交
function findOptimalBubbleConnectionPoint(
  bubbleRect: { x: number; y: number; width: number; height: number },
  externalDotX: number,
  externalDotY: number,
  allBubbles: Array<{ rect: { x: number; y: number; width: number; height: number }, dotX: number, dotY: number }>,
  currentBubbleIndex: number
): { x: number; y: number } {
  const margin = 8; // 距离边缘的最小距离
  const candidates: Array<{ x: number; y: number; score: number }> = [];
  
  // 在气泡内部生成候选连接点
  for (let offsetX = margin; offsetX <= bubbleRect.width - margin; offsetX += 10) {
    for (let offsetY = margin; offsetY <= bubbleRect.height - margin; offsetY += 10) {
      const candidateX = bubbleRect.x + offsetX;
      const candidateY = bubbleRect.y + offsetY;
      
      // 计算与外部点的距离（越近越好）
      const distanceScore = 1 / (1 + Math.hypot(candidateX - externalDotX, candidateY - externalDotY) / 100);
      
      // 检查是否与其他连线相交
      let intersectionPenalty = 0;
      for (let i = 0; i < allBubbles.length; i++) {
        if (i === currentBubbleIndex) continue;
        
        const otherBubble = allBubbles[i];
        if (linesIntersect(
          { x: externalDotX, y: externalDotY },
          { x: candidateX, y: candidateY },
          { x: otherBubble.dotX, y: otherBubble.dotY },
          { x: otherBubble.rect.x + otherBubble.rect.width / 2, y: otherBubble.rect.y + otherBubble.rect.height / 2 }
        )) {
          intersectionPenalty += 0.5;
        }
      }
      
      const totalScore = distanceScore - intersectionPenalty;
      candidates.push({ x: candidateX, y: candidateY, score: totalScore });
    }
  }
  
  // 选择评分最高的候选点
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length > 0 ? candidates[0] : { 
    x: bubbleRect.x + bubbleRect.width / 2, 
    y: bubbleRect.y + bubbleRect.height / 2 
  };
}

// 检查两条线段是否相交
function linesIntersect(
  line1Start: { x: number; y: number },
  line1End: { x: number; y: number },
  line2Start: { x: number; y: number },
  line2End: { x: number; y: number }
): boolean {
  const det = (line1End.x - line1Start.x) * (line2End.y - line2Start.y) - (line2End.x - line2Start.x) * (line1End.y - line1Start.y);
  if (det === 0) return false; // 平行线
  
  const lambda = ((line2End.y - line2Start.y) * (line2End.x - line1Start.x) + (line2Start.x - line2End.x) * (line2End.y - line1Start.y)) / det;
  const gamma = ((line1Start.y - line1End.y) * (line2End.x - line1Start.x) + (line1End.x - line1Start.x) * (line2End.y - line1Start.y)) / det;
  
  return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);
}

// 注释：findNearestEdgePoint 函数已被 findOptimalBubbleConnectionPoint 替代

// 生成分段虚线，隐藏气泡内部的部分
function generateSegmentedLine(
  startPoint: { x: number; y: number },
  endPoint: { x: number; y: number },
  bubbleRect: { x: number; y: number; width: number; height: number }
): Array<{ start: { x: number; y: number }, end: { x: number; y: number } }> {
  const segments: Array<{ start: { x: number; y: number }, end: { x: number; y: number } }> = [];
  
  // 检查线段是否与气泡相交
  const intersections = findLineRectIntersections(startPoint, endPoint, bubbleRect);
  
  if (intersections.length === 0) {
    // 没有相交，返回完整线段
    return [{ start: startPoint, end: endPoint }];
  }
  
  // 按距离起点的远近排序交点
  intersections.sort((a, b) => {
    const distA = Math.hypot(a.x - startPoint.x, a.y - startPoint.y);
    const distB = Math.hypot(b.x - startPoint.x, b.y - startPoint.y);
    return distA - distB;
  });
  
  // 生成线段：从起点到第一个交点
  if (intersections.length > 0) {
    const firstIntersection = intersections[0];
    const distToFirst = Math.hypot(firstIntersection.x - startPoint.x, firstIntersection.y - startPoint.y);
    if (distToFirst > 2) { // 只有距离足够远才添加线段
      segments.push({ start: startPoint, end: firstIntersection });
    }
  }
  
  // 生成线段：从最后一个交点到终点
  if (intersections.length > 1) {
    const lastIntersection = intersections[intersections.length - 1];
    const distToLast = Math.hypot(endPoint.x - lastIntersection.x, endPoint.y - lastIntersection.y);
    if (distToLast > 2) { // 只有距离足够远才添加线段
      segments.push({ start: lastIntersection, end: endPoint });
    }
  }
  
  return segments;
}

// 找到线段与矩形的所有交点
function findLineRectIntersections(
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number }
): Array<{ x: number; y: number }> {
  const intersections: Array<{ x: number; y: number }> = [];
  
  // 矩形的四条边
  const edges = [
    { start: { x: rect.x, y: rect.y }, end: { x: rect.x + rect.width, y: rect.y } }, // 上边
    { start: { x: rect.x + rect.width, y: rect.y }, end: { x: rect.x + rect.width, y: rect.y + rect.height } }, // 右边
    { start: { x: rect.x + rect.width, y: rect.y + rect.height }, end: { x: rect.x, y: rect.y + rect.height } }, // 下边
    { start: { x: rect.x, y: rect.y + rect.height }, end: { x: rect.x, y: rect.y } } // 左边
  ];
  
  for (const edge of edges) {
    const intersection = findLineIntersection(lineStart, lineEnd, edge.start, edge.end);
    if (intersection) {
      intersections.push(intersection);
    }
  }
  
  return intersections;
}

// 找到两条线段的交点
function findLineIntersection(
  line1Start: { x: number; y: number },
  line1End: { x: number; y: number },
  line2Start: { x: number; y: number },
  line2End: { x: number; y: number }
): { x: number; y: number } | null {
  const x1 = line1Start.x, y1 = line1Start.y;
  const x2 = line1End.x, y2 = line1End.y;
  const x3 = line2Start.x, y3 = line2Start.y;
  const x4 = line2End.x, y4 = line2End.y;
  
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) return null; // 平行线
  
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1)
    };
  }
  
  return null;
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
  r: Region | undefined
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
  const mode = detectCoordMode(r);
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
  const mode = detectCoordMode(r);
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

// 注释：subtractContentFromEmptyRect 函数已被新的气泡定位算法替代

function computeBubbleSize(content: string, currentCount: number) {
  const baseW = 180;
  const baseH = 84;
  const len = content.length;
  const w = clamp(baseW + Math.floor(len * 2), 160, 280);
  const lines = Math.ceil(len / 28);
  const h = clamp(baseH + lines * 16, 72, 140);
  const scale = currentCount > 6 ? 0.85 : currentCount > 3 ? 0.92 : 1.0;
  return { bubbleWidth: Math.round(w * scale), bubbleHeight: Math.round(h * scale) };
}

// 注释：pointInRect 函数已被内联使用

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

// 注释：allowedCenterBounds 和 farthestCenterFromDotInBounds 函数已被新的气泡定位算法替代

// 注释：placeBubbleInLargestNearestEmpty 函数已被 findOptimalPositionInEmptyRegions 替代

// 注释：radialSearchInEmptyRects 函数已被 intelligentRadialSearch 替代

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

    const items = (textRegionMapping && textRegionMapping.length > 0)
      ? textRegionMapping.map((m) => ({ text: m.text, keyword: m.keyword, region: m.region, empty_region: m.empty_region }))
      : [];

    console.log('Processing items for bubbles:', {
      textRegionMapping,
      items,
      itemsLength: items.length
    });

    const contentBoxes: { x: number; y: number; width: number; height: number }[] = [];
    const globalEmptyBoxes: { x: number; y: number; width: number; height: number }[] = [];

    if (items.length > 0) {
      for (const m of items) {
        if (m.region) {
          const rect = regionToContainerRect(m.region, containerWidth, containerHeight, imageWidth, imageHeight);
          contentBoxes.push(rect);
        }
        if (m.empty_region) {
          const rect = regionToContainerRect(m.empty_region, containerWidth, containerHeight, imageWidth, imageHeight);
          if (rect.width > 8 && rect.height > 8) globalEmptyBoxes.push(rect);
        }
      }
    }
    for (const r of contentRegions || []) {
      const rect = regionToContainerRect(r, containerWidth, containerHeight, imageWidth, imageHeight);
      contentBoxes.push(rect);
    }
    for (const r of emptyRegions || []) {
      const rect = regionToContainerRect(r, containerWidth, containerHeight, imageWidth, imageHeight);
      if (rect.width > 8 && rect.height > 8) globalEmptyBoxes.push(rect);
    }

    const placedRects: { x: number; y: number; width: number; height: number }[] = [];
    const newBubbles: Bubble[] = [];

    items.forEach((item, idx) => {
      const contentText = (item.text || item.keyword || '').trim();
      if (!contentText) return;
      if (!item.region) return;

      const { x: dotX, y: dotY } = centerToContainerPixels(item.region, containerWidth, containerHeight, imageWidth, imageHeight);

      const preferredEmptyRects: { x: number; y: number; width: number; height: number }[] = [];
      if (item.empty_region) {
        const er = regionToContainerRect(item.empty_region, containerWidth, containerHeight, imageWidth, imageHeight);
        if (er.width > 8 && er.height > 8) preferredEmptyRects.push(er);
      }

      const placed = calculateOptimalBubblePosition(
        dotX, dotY, containerWidth, containerHeight, placedRects,
        contentText, contentBoxes, preferredEmptyRects, globalEmptyBoxes, ctx, imageWidth, imageHeight
      );

      const center = { x: placed.bubbleX + placed.width / 2, y: placed.bubbleY + placed.height / 2 };
      let crosses = false;
      for (const c of contentBoxes) {
        if (segmentIntersectsRect({ x: dotX, y: dotY }, center, c)) { crosses = true; break; }
      }
      let finalRect = { x: placed.bubbleX, y: placed.bubbleY, width: placed.width, height: placed.height };
      if (crosses) {
        finalRect = adjustBubbleToAvoidLineCrossing(
          finalRect, dotX, dotY, contentBoxes, placedRects,
          containerWidth, containerHeight, ctx, imageWidth, imageHeight
        );
      }

      // 写入“膨胀后的占位”，为后续气泡留安全边距，避免重叠
      placedRects.push(inflateRect(finalRect, 6));

      // 使用百分比存储，渲染时转换像素
      const bubbleXPercent = ((finalRect.x + finalRect.width / 2) / containerWidth) * 100;
      const bubbleYPercent = ((finalRect.y + finalRect.height / 2) / containerHeight) * 100;
      const dotXPercent = (dotX / containerWidth) * 100;
      const dotYPercent = (dotY / containerHeight) * 100;

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
    });

    console.log('Setting bubbles:', {
      newBubbles,
      bubblesCount: newBubbles.length,
      bubbles: newBubbles.map(b => ({ id: b.id, content: b.content, position: b.position }))
    });
    
    setBubbles(newBubbles);
    layoutKeyRef.current = `${imageUrl}-${containerWidth}x${containerHeight}`;
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
        
        {(() => {
          // 预处理所有气泡信息，用于优化连接点选择
          console.log('🔍 虚线连接数量检查:', {
            原始气泡数量: bubbles.length,
            容器尺寸: containerSize
          });
          
          const bubbleInfos = bubbles.map((b, index) => {
            const { dotX, dotY, bubbleX, bubbleY } = b.position;
            const x1 = ((dotX || 0) / 100) * containerSize.width;
            const y1 = ((dotY || 0) / 100) * containerSize.height;
            const x2 = ((bubbleX || 0) / 100) * containerSize.width;
            const y2 = ((bubbleY || 0) / 100) * containerSize.height;
            
            const bubbleWidth = b.width || 160;
            const bubbleHeight = b.height || 80;
            const bubbleRect = {
              x: x2 - bubbleWidth / 2,
              y: y2 - bubbleHeight / 2,
              width: bubbleWidth,
              height: bubbleHeight
            };
            
            return {
              bubble: b,
              index,
              externalDot: { x: snap(x1), y: snap(y1) },
              bubbleCenter: { x: x2, y: y2 },
              rect: bubbleRect
            };
          }).filter(info => {
            const { dotX, dotY, bubbleX, bubbleY } = info.bubble.position;
            const isFiniteNumber = (v: number | undefined) => typeof v === 'number' && Number.isFinite(v);
            const isValid = isFiniteNumber(dotX) && isFiniteNumber(dotY) && isFiniteNumber(bubbleX) && isFiniteNumber(bubbleY);
            
            if (!isValid) {
              console.warn('❌ 发现无效气泡坐标:', {
                气泡ID: info.bubble.id,
                位置: { dotX, dotY, bubbleX, bubbleY }
              });
            }
            
            return isValid;
          });

          // 验证连接完整性的函数
          const validateConnections = (bubbleInfos: any[]) => {
            const validConnections: any[] = [];
            const invalidBubbles: any[] = [];

            bubbleInfos.forEach((info) => {
              const { bubble: b, index, externalDot, rect } = info;
              
              // 检查是否能找到有效的内部连接点
              const bubbleConnectionPoint = findOptimalBubbleConnectionPoint(
                rect,
                externalDot.x,
                externalDot.y,
                bubbleInfos.map(bi => ({ rect: bi.rect, dotX: bi.externalDot.x, dotY: bi.externalDot.y })),
                index
              );
              
              // 生成虚线段
              const lineSegments = generateSegmentedLine(
                externalDot,
                bubbleConnectionPoint,
                rect
              );
              
              // 验证连接有效性
              const hasValidConnection = lineSegments.length > 0 && 
                lineSegments.some(segment => {
                  const segmentLength = Math.hypot(
                    segment.end.x - segment.start.x, 
                    segment.end.y - segment.start.y
                  );
                  return segmentLength > 2; // 至少有2像素长的可见线段
                });
              
              if (hasValidConnection) {
                validConnections.push({
                  ...info,
                  bubbleConnectionPoint,
                  lineSegments
                });
              } else {
                invalidBubbles.push(info);
                console.warn('❌ 气泡连接验证失败:', {
                  气泡ID: b.id,
                  内容: b.content,
                  外部点: externalDot,
                  内部连接点: bubbleConnectionPoint,
                  线段数量: lineSegments.length,
                  原因: lineSegments.length === 0 ? '无法生成虚线段' : '虚线段过短'
                });
              }
            });

            console.log('🔍 连接验证结果:', {
              总气泡数: bubbleInfos.length,
              有效连接数: validConnections.length,
              无效连接数: invalidBubbles.length,
              连接成功率: `${((validConnections.length / bubbleInfos.length) * 100).toFixed(1)}%`,
              无效气泡详情: invalidBubbles.map(info => ({
                ID: info.bubble.id,
                内容: info.bubble.content
              }))
            });

            return validConnections;
          };

          // 执行连接验证，只渲染有效连接的气泡
          const validBubbleInfos = validateConnections(bubbleInfos);
          
          // 将验证结果存储到全局变量，供HTML渲染使用
          (window as any).__validBubbleInfos = validBubbleInfos;
          
          console.log('📊 连接验证后的结果:', {
            原始气泡数量: bubbles.length,
            坐标有效气泡数量: bubbleInfos.length,
            连接有效气泡数量: validBubbleInfos.length,
            被过滤的气泡数量: bubbles.length - validBubbleInfos.length,
            连接有效气泡详情: validBubbleInfos.map(info => ({
              ID: info.bubble.id,
              内容: info.bubble.content,
              外部点: info.externalDot,
              气泡中心: info.bubbleCenter,
              虚线段数: info.lineSegments.length
            }))
          });

          // 使用已验证的连接信息直接渲染
          const renderedConnections = validBubbleInfos.map((info) => {
            const { bubble: b, externalDot, bubbleConnectionPoint, lineSegments } = info;
            
            // 统计每个气泡的连接信息
            console.log(`🔗 气泡 ${b.id} 连接统计:`, {
              外部点坐标: externalDot,
              内部连接点: bubbleConnectionPoint,
              虚线段数: lineSegments.length,
              线段详情: lineSegments.map((seg: any, i: number) => ({
                段号: i + 1,
                起点: seg.start,
                终点: seg.end,
                长度: Math.hypot(seg.end.x - seg.start.x, seg.end.y - seg.start.y).toFixed(2) + 'px'
              }))
            });
            
            // 调试信息（开发时可用）
            if (typeof window !== 'undefined' && (window as any).__DEV__) {
              console.log(`气泡 ${b.id} 连线调试:`, {
                外部点: externalDot,
                气泡中心: info.bubbleCenter,
                气泡矩形: info.rect,
                内部连接点: bubbleConnectionPoint,
                线段数量: lineSegments.length
              });
            }

            return (
              <g key={`annotation-${b.id}`}>
                {/* 分段虚线 - 隐藏气泡内部部分 */}
                {lineSegments.map((segment: any, segIndex: number) => (
                  <line
                    key={`line-${b.id}-${segIndex}`}
                    x1={snap(segment.start.x)}
                    y1={snap(segment.start.y)}
                    x2={snap(segment.end.x)}
                    y2={snap(segment.end.y)}
                    stroke="#ff8c42"
                    strokeWidth={scaledStroke}
                    strokeDasharray={`${dashA} ${dashB}`}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter="url(#lineShadow)"
                    opacity="0.9"
                  />
                ))}
                
                {/* 指向点 - 带渐变和阴影 */}
                <circle 
                  cx={externalDot.x} 
                  cy={externalDot.y} 
                  r={scaledRadius} 
                  fill="url(#dotGradient)"
                  filter="url(#dotShadow)"
                  stroke="#ffffff"
                  strokeWidth="0.5"
                />
                
                {/* 内部高亮点 */}
                <circle 
                  cx={externalDot.x} 
                  cy={externalDot.y} 
                  r={scaledRadius * 0.4} 
                  fill="#ffb366"
                  opacity="0.9"
                />
                
                {/* 气泡内部连接点（可选，用于调试） */}
                {typeof window !== 'undefined' && (window as any).__DEV__ && (
                  <circle 
                    cx={snap(bubbleConnectionPoint.x)} 
                    cy={snap(bubbleConnectionPoint.y)} 
                    r={2} 
                    fill="#ff0000"
                    opacity="0.7"
                  />
                )}
              </g>
            );
          });
          
          // 最终统计汇总
          console.log('📈 最终连接统计汇总:', {
            原始气泡总数: bubbles.length,
            坐标有效气泡数量: bubbleInfos.length,
            连接有效气泡数量: validBubbleInfos.length,
            渲染的连接数: renderedConnections.length,
            连接完整性: renderedConnections.length === validBubbleInfos.length ? '✅ 完整' : '❌ 不完整',
            数量匹配检查: {
              '原始气泡 → 坐标有效': bubbleInfos.length === bubbles.length ? '✅ 全部有效' : `⚠️ 有${bubbles.length - bubbleInfos.length}个坐标无效气泡被过滤`,
              '坐标有效 → 连接有效': validBubbleInfos.length === bubbleInfos.length ? '✅ 全部连接有效' : `⚠️ 有${bubbleInfos.length - validBubbleInfos.length}个连接无效气泡被过滤`,
              '连接有效 → 渲染连接': renderedConnections.length === validBubbleInfos.length ? '✅ 一一对应' : `❌ 不匹配 (${renderedConnections.length}/${validBubbleInfos.length})`,
              '每个显示的气泡都有虚线': renderedConnections.length > 0 ? '✅ 是' : '❌ 否'
            },
            详细信息: {
              坐标无效原因: bubbles.length !== bubbleInfos.length ? '存在无效坐标的气泡' : '无',
              连接无效原因: bubbleInfos.length !== validBubbleInfos.length ? '存在无法生成有效虚线的气泡' : '无',
              预期虚线数量: validBubbleInfos.length,
              实际虚线数量: renderedConnections.length
            }
          });
          
          return renderedConnections;
        })()}
      </svg>

      {(() => {
        // 重用SVG验证的结果，确保一致性
        const validBubbleInfos = (window as any).__validBubbleInfos || [];
        const validBubbles = validBubbleInfos.map((info: any) => info.bubble);

        console.log('🎨 气泡HTML渲染统计:', {
          原始气泡数量: bubbles.length,
          连接有效气泡数量: validBubbles.length,
          被过滤的气泡数量: bubbles.length - validBubbles.length,
          SVG和HTML一致性检查: '✅ 重用SVG验证结果'
        });

        // 只渲染通过连接验证的气泡
        return validBubbles.map((b: any) => {
          const bubbleWidth = b.width || 160;
          const bubbleHeight = b.height || 80;
          const centerX = ((b.position.bubbleX || 0) / 100) * containerSize.width;
          const centerY = ((b.position.bubbleY || 0) / 100) * containerSize.height;
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
              <span className="bubble-text" data-text={b.content}>{b.content}</span>
            </div>
          );
        });
      })()}
    </div>
  );
}