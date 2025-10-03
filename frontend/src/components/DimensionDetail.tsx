import React from 'react';
import { Dimension } from './RadarChart';

interface DimensionDetailProps {
  dimension: Dimension;
  onBack: () => void;
}

const DimensionDetail: React.FC<DimensionDetailProps> = ({ dimension, onBack }) => {
  return (
    <div className="dimension-detail">
      <button className="back-button" onClick={onBack}>
        ← 返回
      </button>
      <h3 className="dimension-name">{dimension.name}</h3>
      <div className="dimension-score">得分: {dimension.raw_score}</div>
      <div className="dimension-comment">{dimension.comment}</div>
    </div>
  );
};

export default DimensionDetail;