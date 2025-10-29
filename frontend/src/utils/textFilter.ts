// 文本筛选工具函数 - 使用 GPT5 评价的完整句子作为气泡内容
// 不进行标点拆分、不做阈值或数量限制；保留原始顺序并去重

// 模块方法：filterEvaluationText 与辅助收集函数
export const filterEvaluationText = (evaluation: any): string[] => {
  if (!evaluation) return [];
  const mapped = collectMappedTexts(evaluation);
  if (mapped.length > 0) return mapped;
  return collectGPTEvaluationSentences(evaluation);
};

// 收集 GPT5 评价句子（strengths、suggestions、dimensions[].comment）
function collectGPTEvaluationSentences(evaluation: any): string[] {
  const strengths = Array.isArray(evaluation.strengths) ? evaluation.strengths : [];
  const suggestions = Array.isArray(evaluation.suggestions) ? evaluation.suggestions : [];
  const dimensions = Array.isArray(evaluation.dimensions) ? evaluation.dimensions : [];

  const textsInOrder: string[] = [];

  // strengths: 每项为一个完整句子
  for (const s of strengths) {
    if (typeof s === 'string') {
      const t = normalizeText(s);
      if (t.length > 0) textsInOrder.push(t);
    }
  }

  // suggestions: 每项为一个完整句子
  for (const s of suggestions) {
    if (typeof s === 'string') {
      const t = normalizeText(s);
      if (t.length > 0) textsInOrder.push(t);
    }
  }

  // dimensions[].comment: 每项为一个完整句子
  for (const d of dimensions) {
    const c = d && typeof d.comment === 'string' ? d.comment : '';
    const t = normalizeText(c);
    if (t.length > 0) textsInOrder.push(t);
  }

  // 去重但保留原始顺序
  const seen = new Set<string>();
  const uniqueTexts: string[] = [];
  for (const t of textsInOrder) {
    if (!seen.has(t)) {
      seen.add(t);
      uniqueTexts.push(t);
    }
  }

  return uniqueTexts;
}

// 规范化文本（去除前后空格，合并内部空白），不做标点拆分
function collectMappedTexts(evaluation: any): string[] {
  const mappings = Array.isArray(evaluation.text_region_mapping) ? evaluation.text_region_mapping : [];
  const textsInOrder: string[] = [];
  for (const m of mappings) {
    const t = typeof m?.text === 'string' ? normalizeText(m.text) : '';
    if (t.length > 0) textsInOrder.push(t);
  }
  const seen = new Set<string>();
  const uniqueTexts: string[] = [];
  for (const t of textsInOrder) {
    if (!seen.has(t)) {
      seen.add(t);
      uniqueTexts.push(t);
    }
  }
  return uniqueTexts;
}
function normalizeText(input: string): string {
  return (input || '')
    .trim()
    .replace(/\s+/g, ' ');
}