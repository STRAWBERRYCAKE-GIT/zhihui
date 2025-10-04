// 测试文本概括化功能
export const testTextSummarization = () => {
  const testSentences = [
    "构图整体较为稳定，线条关系清晰，但作为食物照片，线条轮廓占的比例不符合考试要求，缺乏明确的前景和背景构成。",
    "未检测到人体结构，无法评估人体比例和肌肉准确性，未考虑考试要求。",
    "光影效果较好，明暗对比适中，但照片效果缺乏层次感，无法体现光影的立体表现。",
    "食物细节表现较为丰富，线条处理得当，细节标准，但整体组织结构和质感表现有待提升。",
    "建议提交符合要求的作品（人体、头部等），以便按标准评分。"
  ];

  console.log("原始句子：");
  testSentences.forEach((sentence, index) => {
    console.log(`${index + 1}. ${sentence} (${sentence.length}字符)`);
  });

  console.log("\n概括化后：");
  testSentences.forEach((sentence, index) => {
    const summarized = summarizeSentence(sentence);
    console.log(`${index + 1}. ${summarized} (${summarized.length}字符)`);
  });
};

// 导出测试函数供调试使用
export { summarizeSentence, extractKeyInfo, extractKeywords };

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
