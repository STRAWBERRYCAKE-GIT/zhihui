import React, { useRef } from 'react';
import './ImageBubbles.css';

interface ImageBubblesProps {
  imageUrl: string;
  viewportOffset?: number; // 用于动态计算容器高度
}

export default function ImageBubbles({
  imageUrl,
  viewportOffset = 0,
}: ImageBubblesProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: `calc(100vh - ${viewportOffset}px)`, // 保证与之前一致的铺满逻辑
  };

  const imageStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
  };

  return (
    <div ref={containerRef} style={containerStyle}>
      <img src={imageUrl} alt="target" style={imageStyle} />
    </div>
  );
}