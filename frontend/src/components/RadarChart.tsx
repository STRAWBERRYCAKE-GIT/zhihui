import React, { useEffect, useRef, useState } from 'react';
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<ChartJS<'radar'> | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  
  // 添加调试信息
  console.log('RadarChart received dimensions:', dimensions);
  console.log('Dimensions type:', typeof dimensions);
  console.log('Is array:', Array.isArray(dimensions));
  
  // 数据验证和清理
  const validDimensions = dimensions.filter(dim => 
    dim && 
    typeof dim === 'object' && 
    typeof dim.name === 'string' && 
    typeof dim.raw_score === 'number' &&
    typeof dim.weighted_score === 'number' &&
    typeof dim.comment === 'string'
  );

  console.log('Valid dimensions:', validDimensions);

  useEffect(() => {
    if (!canvasRef.current || validDimensions.length === 0) {
      return;
    }

    // 销毁之前的图表实例
    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }

    try {
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) {
        throw new Error('无法获取canvas上下文');
      }

      // 准备雷达图数据
      const data = {
        labels: validDimensions.map((dim) => dim.name),
        datasets: [
          {
            label: '得分',
            data: validDimensions.map((dim) => dim.raw_score),
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
        responsive: true,
        maintainAspectRatio: false,
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
            pointLabels: {
              font: {
                size: 14, 
                weight: '600' 
              },
              color: '#333',
              padding: 10
            }
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
            onDimensionClick(validDimensions[index]);
          }
        },
        // 自定义悬停效果
        onHover: (event: any, chartElement: any) => {
          if (event.native && event.native.target) {
            event.native.target.style.cursor = chartElement[0] ? 'pointer' : 'default';
          }
        },
      };

      // 创建图表实例
      chartInstanceRef.current = new ChartJS(ctx, {
        type: 'radar',
        data: data,
        options: options,
      });

      setChartError(null);
    } catch (error) {
      console.error('Chart.js rendering error:', error);
      setChartError(error instanceof Error ? error.message : '图表渲染失败');
    }

    // 清理函数
    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [validDimensions, onDimensionClick]);

  // 如果没有有效数据，显示空状态
  if (validDimensions.length === 0) {
    return (
      <div className="radar-container">
        <div className="radar-chart">
          <p>暂无评价数据</p>
        </div>
      </div>
    );
  }

  // 如果有图表错误，显示错误信息和备用列表
  if (chartError) {
    return (
      <div className="radar-container">
        <div className="radar-chart">
          <p>雷达图渲染失败: {chartError}</p>
          <p>显示列表模式：</p>
          <ul>
            {validDimensions.map((dim, index) => (
              <li 
                key={index}
                onClick={() => onDimensionClick(dim)}
                style={{ cursor: 'pointer', padding: '5px', border: '1px solid #ccc', margin: '2px' }}
              >
                <strong>{dim.name}</strong>: {dim.raw_score}分
                <br />
                <small>{dim.comment}</small>
              </li>
            ))}
          </ul>
        </div>
        <p className="radar-hint">点击维度查看详细评价</p>
      </div>
    );
  }

  return (
    <div className="radar-container">
      <div className="radar-chart" style={{ height: '300px', width: '100%' }}>
        <canvas ref={canvasRef} />
      </div>
      <p className="radar-hint">点击雷达图上的点查看详细评价</p>
    </div>
  );
};

export default RadarChart;