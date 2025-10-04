import React from 'react';
import { Dimension } from './RadarChart';
import ScoreRing from './ScoreRing';

interface DimensionDetailProps {
  dimension: Dimension;
  onBack: () => void;
}

const DimensionDetail: React.FC<DimensionDetailProps> = ({ dimension, onBack }) => {
  return (
    <div className="dimension-detail">
      <div className="dimension-header">
        <button className="back-button" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          返回总览
        </button>
      </div>
      <ScoreRing initialScore={dimension.raw_score} maxScore={100} scoreLabel={dimension.name} />
      
      <div className="dimension-description">
        <h4>详细评价：</h4>
        <p>{dimension.comment}</p>
      </div>
    </div>
  );
};

export default DimensionDetail;