// 文本筛选工具函数 - 基于CLIP匹配度选择气泡内容
export const filterEvaluationText = (evaluation: any): string[] => {
  if (!evaluation) return [];
  
  // 检查是否有CLIP文本区域映射数据
  if (evaluation.text_region_mapping && Array.isArray(evaluation.text_region_mapping)) {
    // 基于CLIP匹配度选择气泡内容（使用后端t_dyn + 上限3）
    return selectBubblesByCLIPMatch(evaluation.text_region_mapping, evaluation.cnclip_stats);
  }
  
  // 如果没有CLIP数据，回退到原始逻辑
  return fallbackTextSelection(evaluation);
};

// 基于CLIP匹配度选择气泡内容（精准显示）
// 方法：selectBubblesByCLIPMatch（上限调到4，使用后端t_dyn）
const selectBubblesByCLIPMatch = (textRegionMapping: any[], cnclipStats?: any): string[] => {
  // 从后端动态阈值读取（允许轻微容差-0.02）；无t_dyn时默认0.4
  const tDyn = typeof cnclipStats?.t_dyn === 'number' ? cnclipStats.t_dyn : undefined;
  const MIN_CONFIDENCE = typeof tDyn === 'number' ? Math.max(tDyn - 0.02, 0.35) : 0.4;
  const MAX_BUBBLES = 4; // 从3增加到4

  const passed = textRegionMapping
    .filter(m => typeof m?.confidence === 'number' && m.confidence >= MIN_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence);

  let selected = passed.slice(0, Math.min(MAX_BUBBLES, passed.length));

  // 回退：如果一个都不过阈值，至少显示最高的1个以避免0气泡
  if (selected.length === 0 && textRegionMapping.length > 0) {
    const sortedAll = [...textRegionMapping].sort((a, b) => b.confidence - a.confidence);
    selected = sortedAll.slice(0, 1);
  }

  // 直接使用后端返回的短句，不再按标点二次拆分
  const selectedTexts = Array.from(new Set(
    selected
      .map(m => (typeof m?.text === 'string' ? m.text.trim() : ''))
      .filter(t => t.length > 0)
  ));

  console.log(`CLIP匹配选择(精准): 候选=${textRegionMapping.length}，通过阈值=${passed.length}，最终文本=${selectedTexts.length}，t_dyn=${tDyn}，阈值=${MIN_CONFIDENCE}，上限=${MAX_BUBBLES}`);

  return selectedTexts;
};

// 回退逻辑：当无CLIP数据时，从评价数据中提取文本
const fallbackTextSelection = (evaluation: any): string[] => {
  const strengths = evaluation.strengths || [];
  const suggestions = evaluation.suggestions || [];
  const dimensions = evaluation.dimensions || [];

  // 合并所有文本来源
  const allTexts = [
    ...strengths.filter((s: any) => typeof s === 'string'),
    ...suggestions.filter((s: any) => typeof s === 'string'),
    ...dimensions
      .filter((d: any) => d && typeof d.comment === 'string')
      .map((d: any) => d.comment)
  ];

  // 去重并截取前3个
  return Array.from(new Set(allTexts.map(t => t.trim()).filter(t => t.length > 0))).slice(0, 3);
};