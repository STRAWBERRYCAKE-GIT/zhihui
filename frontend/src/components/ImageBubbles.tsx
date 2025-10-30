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

const rectContainsRect = (
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number }
) => {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
};

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
  imageWidth: number,
  imageHeight: number
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
function subtractContentFromEmptyRect(
  emptyRect: { x: number; y: number; width: number; height: number },
  contentRects: Array<{ x: number; y: number; width: number; height: number }>,
  avoidMargin: number
) {
  const result: Array<{ x: number; y: number; width: number; height: number }> = [emptyRect];

  const intersect = (a: any, b: any) => {
    const ix = Math.max(a.x, b.x);
    const iy = Math.max(a.y, b.y);
    const ax = Math.min(a.x + a.width, b.x + b.width);
    const ay = Math.min(a.y + a.height, b.y + b.height);
    if (ax <= ix || ay <= iy) return null;
    return { x: ix, y: iy, width: ax - ix, height: ay - iy };
  };

  const subtractOnce = (src: any, sub: any) => {
    const inter = intersect(src, sub);
    if (!inter) return [src];
    const out: any[] = [];
    // 上
    if (inter.y > src.y) {
      out.push({ x: src.x, y: src.y, width: src.width, height: inter.y - src.y });
    }
    // 下
    if (inter.y + inter.height < src.y + src.height) {
      out.push({
        x: src.x,
        y: inter.y + inter.height,
        width: src.width,
        height: src.y + src.height - (inter.y + inter.height)
      });
    }
    // 左
    if (inter.x > src.x) {
      out.push({
        x: src.x,
        y: inter.y,
        width: inter.x - src.x,
        height: inter.height
      });
    }
    // 右
    if (inter.x + inter.width < src.x + src.width) {
      out.push({
        x: inter.x + inter.width,
        y: inter.y,
        width: src.x + src.width - (inter.x + inter.width),
        height: inter.height
      });
    }
    return out;
  };

  let working = result;
  for (const c of contentRects) {
    const inflated = inflateRect(c, avoidMargin);
    const next: any[] = [];
    for (const r of working) {
      const parts = subtractOnce(r, inflated);
      next.push(...parts);
    }
    working = next.filter((p) => p.width >= 8 && p.height >= 8);
  }

  return working;
}

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

function pointInRect(p: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }) {
  return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
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

function allowedCenterBounds(
  subRect: { x: number; y: number; width: number; height: number },
  bubbleWidth: number,
  bubbleHeight: number
) {
  const minCx = subRect.x + bubbleWidth / 2;
  const minCy = subRect.y + bubbleHeight / 2;
  const maxCx = subRect.x + subRect.width - bubbleWidth / 2;
  const maxCy = subRect.y + subRect.height - bubbleHeight / 2;
  return { minCx, maxCx, minCy, maxCy };
}

function farthestCenterFromDotInBounds(
  dotX: number,
  dotY: number,
  bounds: { minCx: number; maxCx: number; minCy: number; maxCy: number }
) {
  const candidates = [
    { x: bounds.minCx, y: bounds.minCy },
    { x: bounds.minCx, y: bounds.maxCy },
    { x: bounds.maxCx, y: bounds.minCy },
    { x: bounds.maxCx, y: bounds.maxCy }
  ];
  let best = candidates[0];
  let bestDist = -Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.x - dotX, c.y - dotY);
    if (d > bestDist) { bestDist = d; best = c; }
  }
  return best;
}

function placeBubbleInLargestNearestEmpty(
  dotX: number,
  dotY: number,
  bubbleWidth: number,
  bubbleHeight: number,
  emptyRects: { x: number; y: number; width: number; height: number }[],
  contentRects: { x: number; y: number; width: number; height: number }[],
  usedBubbleRects: { x: number; y: number; width: number; height: number }[],
  containerWidth: number,
  containerHeight: number,
  ctx: CanvasRenderingContext2D | null,
  imageWidth: number,
  imageHeight: number
) {
  const avoidMargin = Math.round(Math.min(containerWidth, containerHeight) * 0.018);
  const candidates: { x: number; y: number; width: number; height: number }[] = [];
  for (const r of emptyRects) {
    const subRects = subtractContentFromEmptyRect(r, contentRects, avoidMargin);
    for (const s of subRects) {
      if (s.width < bubbleWidth || s.height < bubbleHeight) continue;
      const bounds = allowedCenterBounds(s, bubbleWidth, bubbleHeight);
      const center = farthestCenterFromDotInBounds(dotX, dotY, bounds);
      const rect = { x: Math.round(center.x - bubbleWidth / 2), y: Math.round(center.y - bubbleHeight / 2), width: bubbleWidth, height: bubbleHeight };
      candidates.push(rect);
    }
  }

  candidates.sort((a, b) => (b.width * b.height) - (a.width * a.height));
  // 先尝试不与已放置气泡重叠的候选
  for (const rect of candidates) {
    let overlapBubble = false;
    for (const u of usedBubbleRects) {
      if (rectsOverlap(rect, u)) { overlapBubble = true; break; }
    }
    if (overlapBubble) continue;

    if (!overlapsWithContent(rect, contentRects, CONTENT_AVOID_MARGIN)) {
      return rect;
    }
  }

  // 无法避开已放气泡，则选一个面积最大且离 anchor 更远的
  let best: { x: number; y: number; width: number; height: number } | null = null;
  let bestDist = -Infinity;
  for (const rect of candidates) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const dist = Math.hypot(cx - dotX, cy - dotY);
    if (dist > bestDist) {
      best = rect;
      bestDist = dist;
    }
  }
  return best || null;
}

function radialSearchInEmptyRects(
  dotX: number,
  dotY: number,
  bubbleWidth: number,
  bubbleHeight: number,
  emptyRects: { x: number; y: number; width: number; height: number }[],
  contentRects: { x: number; y: number; width: number; height: number }[],
  usedBubbleRects: { x: number; y: number; width: number; height: number }[],
  containerWidth: number,
  containerHeight: number,
  ctx: CanvasRenderingContext2D | null,
  imageWidth: number,
  imageHeight: number
) {
  const avoidMargin = Math.round(Math.min(containerWidth, containerHeight) * 0.016);
  const steps = 8;
  const radiusInc = Math.round(Math.min(containerWidth, containerHeight) * 0.04);

  for (let r = radiusInc; r <= radiusInc * 3; r += radiusInc) {
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      const cx = dotX + Math.round(Math.cos(angle) * r);
      const cy = dotY + Math.round(Math.sin(angle) * r);
      const rect = clampRectToContainer(
        { x: Math.round(cx - bubbleWidth / 2), y: Math.round(cy - bubbleHeight / 2), width: bubbleWidth, height: bubbleHeight },
        containerWidth, containerHeight
      );

      // 避免与已放置气泡重叠
      let overlapBubble = false;
      for (const u of usedBubbleRects) {
        if (rectsOverlap(rect, u)) { overlapBubble = true; break; }
      }
      if (overlapBubble) continue;

      // 避免连接线穿过主体内容
      const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      let crosses = false;
      for (const c of contentRects) {
        if (segmentIntersectsRect({ x: dotX, y: dotY }, center, c)) { crosses = true; break; }
      }
      if (crosses) continue;

      // 避免靠近主体：用空白度评分兜底
      const emptyScore = computeEmptinessScoreForRect(rect, containerWidth, containerHeight, imageWidth, imageHeight, ctx);
      if (emptyScore < MIN_EMPTY_SCORE) continue;

      return rect;
    }
  }

  return null;
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

function calculateBubblePosition(
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

  // 优先：用户/模型提供的 empty_region
  if (preferredEmptyRects.length > 0) {
    const placed = placeBubbleInLargestNearestEmpty(
      dotX, dotY, bubbleWidth, bubbleHeight, preferredEmptyRects,
      contentBoxes, usedBubblePositions, containerWidth, containerHeight, ctx, imageWidth, imageHeight
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

  // 其次：全局空白区
  if (fallbackEmptyRects.length > 0) {
    const placed = placeBubbleInLargestNearestEmpty(
      dotX, dotY, bubbleWidth, bubbleHeight, fallbackEmptyRects,
      contentBoxes, usedBubblePositions, containerWidth, containerHeight, ctx, imageWidth, imageHeight
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

  // 再次：从 anchor 点做径向搜索
  const radialPlaced = radialSearchInEmptyRects(
    dotX, dotY, bubbleWidth, bubbleHeight, fallbackEmptyRects,
    contentBoxes, usedBubblePositions, containerWidth, containerHeight, ctx, imageWidth, imageHeight
  );
  if (radialPlaced) {
    return {
      bubbleX: radialPlaced.x,
      bubbleY: radialPlaced.y,
      width: bubbleWidth,
      height: bubbleHeight
    };
  }

  // 边缘兜底（最后考虑）
  let placed: { x: number; y: number; width: number; height: number } | null = null;
  const edgeSlot = findEdgeSlotNearDot(
    dotX, dotY, bubbleWidth, bubbleHeight, usedBubblePositions,
    contentBoxes, containerWidth, containerHeight, ctx, imageWidth, imageHeight
  );
  if (edgeSlot) {
    placed = { x: edgeSlot.x, y: edgeSlot.y, width: bubbleWidth, height: bubbleHeight };
  }

  // 最终兜底：限制在图像显示区域内
  if (!placed) {
    const { displayedWidth, displayedHeight, offsetX, offsetY } =
      getDisplayedImageMetrics(containerWidth, containerHeight, imageWidth, imageHeight);
    const minX = offsetX + FRAME_PAD;
    const minY = offsetY + FRAME_PAD;
    const maxX = offsetX + displayedWidth - FRAME_PAD - bubbleWidth;
    const maxY = offsetY + displayedHeight - FRAME_PAD - bubbleHeight;

    placed = {
      x: clamp(dotX - Math.round(bubbleWidth / 2), minX, maxX),
      y: clamp(dotY - Math.round(bubbleHeight / 2), minY, maxY),
      width: bubbleWidth,
      height: bubbleHeight
    };
  }

  return {
    bubbleX: placed.x,
    bubbleY: placed.y,
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

      const placed = calculateBubblePosition(
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
  const { displayedWidth, displayedHeight } = getDisplayedImageMetrics(
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

      {/* 虚线使用像素坐标 + viewBox，配合像素对齐与比例缩放 */}
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${containerSize.width} ${containerSize.height}`}
        preserveAspectRatio="none"
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 4 }}
      >
        {bubbles.map((b) => {
          const isFiniteNumber = (v: number | undefined) => typeof v === 'number' && Number.isFinite(v);
          const { dotX, dotY, bubbleX, bubbleY } = b.position;
          const hasCoords = isFiniteNumber(dotX) && isFiniteNumber(dotY) && isFiniteNumber(bubbleX) && isFiniteNumber(bubbleY);
          if (!hasCoords) return null;

          const x1 = ((dotX || 0) / 100) * containerSize.width;
          const y1 = ((dotY || 0) / 100) * containerSize.height;
          const x2 = ((bubbleX || 0) / 100) * containerSize.width;
          const y2 = ((bubbleY || 0) / 100) * containerSize.height;

          // 像素栅格对齐，减少抗锯齿模糊
          const sx1 = snap(x1), sy1 = snap(y1);
          const sx2 = snap(x2), sy2 = snap(y2);

          return (
            <g key={`line-${b.id}`} shapeRendering="crispEdges">
              <line
                x1={sx1}
                y1={sy1}
                x2={sx2}
                y2={sy2}
                stroke="#d60000"
                strokeWidth={scaledStroke}
                strokeDasharray={`${dashA} ${dashB}`}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx={sx1} cy={sy1} r={scaledRadius} fill="#d60000" />
            </g>
          );
        })}
      </svg>

      {bubbles.map((b) => {
        const left = ((b.position.bubbleX || 0) / 100) * containerSize.width - (b.width || 0) / 2;
        const top = ((b.position.bubbleY || 0) / 100) * containerSize.height - (b.height || 0) / 2;
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
              width: `${b.width || 160}px`,
              height: `${b.height || 80}px`,
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
      })}
    </div>
  );
}