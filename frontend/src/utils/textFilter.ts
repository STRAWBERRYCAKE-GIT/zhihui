// 文本筛选工具函数
export const filterEvaluationText = (evaluation: any): string[] => {
  if (!evaluation) return [];
  
  const sentences: string[] = [];
  
  // 从strengths中提取句子
  if (evaluation.strengths && Array.isArray(evaluation.strengths)) {
    evaluation.strengths.forEach((strength: any) => {
      if (typeof strength === 'string' && strength.trim()) {
        sentences.push(strength.trim());
      }
    });
  }
  
  // 从suggestions中提取句子
  if (evaluation.suggestions && Array.isArray(evaluation.suggestions)) {
    evaluation.suggestions.forEach((suggestion: any) => {
      if (typeof suggestion === 'string' && suggestion.trim()) {
        sentences.push(suggestion.trim());
      }
    });
  }
  
  // 从dimensions的comment中提取句子
  if (evaluation.dimensions && Array.isArray(evaluation.dimensions)) {
    evaluation.dimensions.forEach((dim: any) => {
      if (dim && typeof dim.comment === 'string' && dim.comment.trim()) {
        sentences.push(dim.comment.trim());
      }
    });
  }
  
  // 去重并筛选长度合适的句子
  const uniqueSentences = Array.from(new Set(sentences));
  
  // 对句子进行概括化处理
  const processedSentences = uniqueSentences.map(sentence => {
    return summarizeSentence(sentence);
  }).filter(sentence => sentence.length > 0);
  
  // 随机选择3-5个句子
  const count = Math.min(Math.max(3, processedSentences.length), 5);
  const shuffled = [...processedSentences].sort(() => Math.random() - 0.5);
  
  return shuffled.slice(0, count);
};

// 句子概括化函数
const summarizeSentence = (sentence: string): string => {
  // 移除标点符号和多余空格
  let cleaned = sentence.replace(/[，。！？；：]/g, '').trim();
  
  // 如果句子很短（小于15字符），直接返回
  if (cleaned.length <= 15) {
    return cleaned;
  }
  
  // 如果句子很长（大于50字符），进行概括
  if (cleaned.length > 50) {
    return summarizeLongSentence(cleaned);
  }
  
  // 中等长度句子，尝试提取关键信息
  return extractKeyInfo(cleaned);
};

// 概括长句子
const summarizeLongSentence = (sentence: string): string => {
  // 提取关键词和短语
  const keywords = extractKeywords(sentence);
  
  // 如果有关键词，组合成简短描述
  if (keywords.length > 0) {
    return keywords.slice(0, 3).join('，') + '。';
  }
  
  // 否则截取前30个字符
  return sentence.substring(0, 30) + '...';
};

// 提取关键信息
const extractKeyInfo = (sentence: string): string => {
  // 移除常见的修饰词和连接词
  const cleaned = sentence
    .replace(/[，。！？；：]/g, '')
    .replace(/的|了|着|过|在|是|有|和|与|及|或|但|然而|不过|因此|所以|因为|如果|虽然|尽管/g, '')
    .trim();
  
  // 如果清理后仍然很长，进一步处理
  if (cleaned.length > 25) {
    return cleaned.substring(0, 25) + '...';
  }
  
  return cleaned;
};

// 提取关键词
const extractKeywords = (sentence: string): string[] => {
  const keywords: string[] = [];
  
  // 常见的评价关键词
  const keyPatterns = [
    /构图[^，。！？；：]*/g,
    /线条[^，。！？；：]*/g,
    /光影[^，。！？；：]*/g,
    /细节[^，。！？；：]*/g,
    /比例[^，。！？；：]*/g,
    /透视[^，。！？；：]*/g,
    /色彩[^，。！？；：]*/g,
    /质感[^，。！？；：]*/g,
    /结构[^，。！？；：]*/g,
    /表现[^，。！？；：]*/g,
    /需要[^，。！？；：]*/g,
    /建议[^，。！？；：]*/g,
    /改进[^，。！？；：]*/g,
    /加强[^，。！？；：]*/g,
    /注意[^，。！？；：]*/g
  ];
  
  keyPatterns.forEach(pattern => {
    const matches = sentence.match(pattern);
    if (matches) {
      matches.forEach(match => {
        if (match.length <= 20 && match.length >= 4) {
          keywords.push(match.trim());
        }
      });
    }
  });
  
  return keywords;
};

export default filterEvaluationText;
