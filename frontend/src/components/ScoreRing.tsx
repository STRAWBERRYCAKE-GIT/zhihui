import React from 'react';
import './ScoreRing.css';

// 定义组件属性类型
interface ScoreRingProps {
  initialScore?: number; // 初始分数（可选，默认 0）
  maxScore?: number;     // 满分（可选，默认 100）
  scoreLabel?: string;      // 自定义标签文字（可选，默认“综合评分”）
}

// 声明为 React 函数组件，并关联 Props 类型
const ScoreRing: React.FC<ScoreRingProps> = ({ 
  initialScore = 0, 
  maxScore = 100,
  scoreLabel = '综合评分'
}) => {
  const circleCircumference = 2 * Math.PI * 45; // 圆周长
  const validScore = Math.max(0, Math.min(initialScore, maxScore)); // 边界处理
  const strokeDashoffset = circleCircumference - (circleCircumference * (validScore / maxScore));

  return (
    <div className="overall-score">
      <div className="score-ring-container">
        <svg className="score-ring" viewBox="0 0 100 100">
          {/* 背景环 */}
          <circle
            className="ring-background"
            cx="50"
            cy="50"
            r="45"
            fill="none"
            strokeWidth="8"
          />
          {/* 进度环（动态计算偏移量） */}
          <circle
            className="ring-progress"
            cx="50"
            cy="50"
            r="45"
            fill="none"
            strokeWidth="8"
            strokeDasharray={circleCircumference.toString()}
            strokeDashoffset={strokeDashoffset}
            transform="rotate(-90 50 50)"
            strokeLinecap="round"
          />
        </svg>
        {/* 分数显示 */}
        <div className="score-display">
          <span className="score-number">{validScore.toFixed(1)}</span>
          <span className="score-label">{scoreLabel}</span>
        </div>
      </div>
    </div>
  );
};

export default ScoreRing;