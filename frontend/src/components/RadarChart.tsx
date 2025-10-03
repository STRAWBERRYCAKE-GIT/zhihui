import React from 'react';
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { Radar } from 'react-chartjs-2';

// 注册 Chart.js 组件
ChartJS.register(
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend
);

// 定义维度数据的类型
export interface Dimension {
  name: string;
  comment: string;
  raw_score: number;
  weighted_score: number;
}

interface RadarChartProps {
  dimensions: Dimension[];
  onDimensionClick: (dimension: Dimension) => void;
}

const RadarChart: React.FC<RadarChartProps> = ({ dimensions, onDimensionClick }) => {
  // 准备雷达图数据
  const data = {
    labels: dimensions.map((dim) => dim.name),
    datasets: [
      {
        label: '得分',
        data: dimensions.map((dim) => dim.raw_score),
        backgroundColor: 'rgba(255, 122, 69, 0.2)',
        borderColor: 'rgba(255, 122, 69, 1)',
        borderWidth: 2,
        pointBackgroundColor: 'rgba(255, 122, 69, 1)',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: 'rgba(255, 122, 69, 1)',
      },
    ],
  };

  // 雷达图配置选项
  const options = {
    scales: {
      r: {
        angleLines: {
          display: true,
        },
        suggestedMin: 0,
        suggestedMax: 100,
        ticks: {
          stepSize: 20,
        },
      },
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: function(context: any) {
            return `${context.label}: ${context.raw}分`;
          }
        }
      }
    },
    // 添加点击事件
    onClick: (evt: any, elements: any) => {
      if (elements.length > 0) {
        const index = elements[0].index;
        onDimensionClick(dimensions[index]);
      }
    },
    // 自定义悬停效果
    onHover: (event: any, chartElement: any) => {
      event.native.target.style.cursor = chartElement[0] ? 'pointer' : 'default';
    },
  };

  return (
    <div className="radar-container">
      <div className="radar-chart">
        <Radar data={data} options={options} />
      </div>
      <p className="radar-hint">点击雷达图上的点查看详细评价</p>
    </div>
  );
};

export default RadarChart;