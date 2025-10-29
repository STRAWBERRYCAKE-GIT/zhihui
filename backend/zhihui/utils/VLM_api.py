# 顶层变量 sketch_schema 以及函数 gpt_api（包含“同义词归一规则”）
import base64
from openai import OpenAI
from dotenv import load_dotenv
import os
import re

load_dotenv()  # 自动加载 .env 文件
client = OpenAI(
    base_url='https://api.openai-proxy.org/v1',
    api_key=os.getenv("OPENAI_API_KEY")
)

# 定义 JSON Schema(为了结构化输出)
sketch_schema = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "dimensions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string"},
                    "raw_score": {"type": "number", "minimum": 0, "maximum": 100},
                    "weighted_score": {"type": "number"},
                    "comment": {"type": "string"}
                },
                "required": ["name", "raw_score", "weighted_score", "comment"]
            }
        },
        "summary": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "strengths": {"type": "array", "items": {"type": "string"}},
                "suggestions": {"type": "array", "items": {"type": "string"}}
            },
            "required": ["strengths", "suggestions"]
        },
        "keyword_mentions": {
            "type": "array",
            "description": "命中词库标准词的完整评价句子条目列表（每条句子仅归入一个最佳标准词）",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "keyword": {"type": "string"},
                    "sentences": {"type": "array", "items": {"type": "string"}}
                },
                "required": ["keyword", "sentences"]
            }
        }
    },
    "required": ["dimensions", "summary", "keyword_mentions"]
}

# 根据不同类型素描生成提示词
def get_prompt(sketch_type="portrait"):
    # 基础提示词部分
    base_prompt = """
评分标准参考：
- 优秀（90-100分）：各项表现完美，技术精湛
- 良好（80-90分）：表现良好，有少量可改进之处
- 中等（70-80分）：基本达标，有明显提升空间
- 合格（60-70分）：未达到基本要求，需要较多改进
- 不合格（60分以下）：完全不符合要求

请为每个维度提供：
1. 原始分数（0-100）
2. 加权分数（根据权重计算）
3. 评语

最后给出综合评价：
1. 主要优点
2. 改进建议

请严格按照我提供的 JSON Schema 输出结果，不要输出任何额外的文字或解释。
"""
    
    if sketch_type == "portrait":
        return """你是一位专业的美术学院素描评审专家，请严格按照中国素描人像等级考试评分标准对提供的素描作品进行专业评价。
        
评分维度及权重：
1. 构图透视（15%）：画面布局、透视准确度、空间感表现
2. 人像塑造（20%）：身体比例、五官形态、骨骼肌肉准确性
3. 表情神态（15%）：表情真实性、情感传达、神态自然度
4. 皮肤头发质感（15%）：皮肤和头发层次感
5. 明暗光影（15%）：明暗对比、光影分布、立体感塑造
6. 细节刻画（10%）：服饰纹理、配饰等细节处理
7. 艺术表现力（10%）：艺术感染力、个人风格、主题表达

【图像类型与识别原则】
- 本作品为“黑白素描/线稿人像”。请基于“轮廓线、结构线、明暗块与交界线”的结构理解进行识别与评价。
- 不得因为缺少照片的颜色/真实质感而判定“无法识别五官”。除非出现遮挡或绘制缺失严重（>50%区域缺失），才可使用“不可识别”表述，并需指出具体证据与部位区域。
- 即使线条简约，也应依据结构线条与明暗关系给出五官形态的判断与建议：从眼睛、鼻子、嘴巴、眉毛、耳朵的形状、比例、位置、结构关系、线条与明暗表达进行评价。

【具体输出要求（加强细化与避免回避）】
- 禁止使用“无法识别到面部五官”“无法分析”等笼统否定性总结；如刻画极简，使用“线条过简导致形态信息不足”并指出具体部位与原因（如结构线缺失、明暗交界不清）。
- 保持术语专业、表达简洁，避免重复与无效修饰词。""" + base_prompt
    elif sketch_type == "still_life":
        return """你是一位专业的美术学院素描评审专家，请严格按照中国素描静物素描等级考试评分标准对提供的素描作品进行专业评价。
        
评分维度及权重：
1. 构图透视（15%）：画面布局、物体与背景关系、透视准确度、空间感表现
2. 物体塑造（20%）：物体比例、形态结构、明暗对比、细节表现
3. 光影表现（15%）：光源位置、光影分布、立体感塑造
4. 材料质感（15%）：静物材质的表现（如玻璃、金属、木材等）
5. 细节刻画（15%）：表面质感、纹理、细部处理
6. 明暗过渡（10%）：明暗渐变的柔和度与自然度
7. 艺术表现力（10%）：艺术感、创意性、静物的主题表达""" + base_prompt
    elif sketch_type == "landscape":
        return """你是一位专业的美术学院素描评审专家，请严格按照中国素描风景素描等级考试评分标准对提供的素描作品进行专业评价。
        
评分维度及权重：
1. 构图透视（15%）：画面布局、远近关系、透视准确度、空间感表现
2. 远景塑造（20%）：背景山川、天际线表现、气氛渲染
3. 中景塑造（20%）：树木、建筑、自然景物的表现、明暗处理
4. 光影表现（15%）：光源方向、光影层次、立体感表现
5. 细节刻画（10%）：细节丰富度、表现细腻度
6. 大气效果（10%）：雾气、光影变化、氛围表现
7. 艺术表现力（10%）：艺术感染力、风景的表现力、情感传达""" + base_prompt
    elif sketch_type == "bust":
        return """你是一位专业的美术学院素描评审专家，请严格按照中国素描石膏素描等级考试评分标准对提供的素描作品进行专业评价。
        
评分维度及权重：
1. 构图透视（15%）：画面布局、石膏像与背景的透视关系、空间感表现
2. 石膏像塑造（25%）：石膏像的结构、比例、细节表现、形态准确性
3. 明暗光影（20%）：光源方向、明暗对比、光影塑造
4. 立体感（15%）：通过明暗与透视表现石膏像的三维效果
5. 细节刻画（10%）：细部处理、质感表现（如纹理、表面光滑度等）
6. 结构描绘（10%）：骨骼与肌肉的结构准确性
7. 艺术表现力（5%）：石膏像的表现力与艺术感染力""" + base_prompt


# 调用GPT-5并进行评分（新增：同义词归一规则 + 词库使用 + keyword_mentions 返回）
def gpt_api(image_stream, sketch_type="portrait"):
    import json
    try:
        # 获取指定的素描评分提示词
        prompt = get_prompt(sketch_type)

        # 载入关键词词库（标准词 -> 同义词）
        lexicon_path = os.path.join(os.path.dirname(__file__), 'keyword_lexicon.json')
        try:
            with open(lexicon_path, 'r', encoding='utf-8') as f:
                keyword_lexicon = json.load(f)
        except Exception:
            keyword_lexicon = {}

        # 在提示词中加入“关键词归一与句子抽取”的要求
        # 规则：
        # - 将同义词、近义词、常见变体统一归入“标准词”下；
        # - 收集完整句子（不做标点拆分）；允许同一条句子归入多个“相关标准词”（如句子同时评价“眼睛”和“鼻子”）；
        # - 命中判定以语义为准，允许词形变化（如“眼神”归入“眼睛”）；
        # - 将归类结果写入 keyword_mentions（数组），每项形如 {keyword: 标准词, sentences: [完整句子...]}；无匹配返回空数组；
        # - 不要输出任何除 Schema 以外的字段。
        lexicon_instruction = (
            "你要完成两个任务：\n"
            "1) 生成针对该素描作品的评价维度（dimensions）与总结（summary）。\n"
            "2) 按词库进行关键词归一，并从评价文本中为每个命中的“标准词”抽取与其直接相关的“短子句/短语”，写入 keyword_mentions：\n"
            "【抽取与归类规则】\n"
            "- 归一：将同义词、近义词、常见变体统一归入“标准词”下；\n"
            "- 粒度：对子句定义为短小且可独立表达的片段，建议长度 6–26 个中文字符；过长时截取最相关片段；过短可接受常用短语（如“线条流畅”）；\n"
            "- 唯一焦点：每条子句仅围绕一个标准词，剔除与其他标准词相关的信息；若原句涉及多个标准词，请分别产出不同子句；\n"
            "- 覆盖：尽可能覆盖评价中与该标准词相关的所有短子句/短语（去重后保留全部）；\n"
            "- 标点与格式：去除冗余标点（保留必要的中文逗号/顿号），避免尾部重复标点；不使用引号、序号、括号等包装；\n"
            "- 去重与净化：对子句进行去重与精简，避免同义重复、填充词（如“比较”“非常”“很”等）和无关修饰；\n"
            "- 示例：\n"
            "  输入评价可能包含“头颅比例到位，颈部线条较硬；耳廓刻画欠细致，面部阴影过重且层次不清。”\n"
            "  期望输出：\n"
            "  {\"keyword\":\"头颅\",\"sentences\":[\"头颅比例到位\"]},\n"
            "  {\"keyword\":\"颈部\",\"sentences\":[\"颈部线条较硬\"]},\n"
            "  {\"keyword\":\"耳廓\",\"sentences\":[\"耳廓刻画欠细致\"]},\n"
            "  {\"keyword\":\"面部\",\"sentences\":[\"面部阴影过重\",\"层次不清\"]}\n"
            "【输出要求】\n"
            "- 严格写入 keyword_mentions（数组），结构为 [{\"keyword\": 标准词, \"sentences\": [子句或短语...]}]；无匹配返回空数组；\n"
            "- 允许同一句被拆成多条子句分别归入不同标准词项；同一标准词命中多条子句时全部收录（已精简与去重）。\n"
            "词库如下：\n"
            + json.dumps(keyword_lexicon, ensure_ascii=False)
        )
        prompt = prompt + "\n\n" + lexicon_instruction

        image_data = image_stream.read()
        image_base64 = base64.b64encode(image_data).decode('utf-8')

        # 新增：检测真实图片格式，构造正确的 MIME
        from io import BytesIO
        try:
            from PIL import Image
            pil_img = Image.open(BytesIO(image_data))
            fmt = (pil_img.format or "").lower()  # 'jpeg'/'png'/'webp'/...
        except Exception:
            fmt = "jpeg"
        mime = {"jpeg": "jpeg", "jpg": "jpeg", "png": "png", "webp": "webp", "bmp": "bmp"}.get(fmt, "jpeg")

        response = client.responses.create(
            model="gpt-5",
            input=[{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": f"data:image/{mime};base64,{image_base64}"}  # 使用真实 MIME
                ],
            }],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "evaluate_response",
                    "schema": sketch_schema,
                    "strict": True
                }
            },
        )

        # 获取评分结果
        output = response.output_text
        print(output)

        # 提取语义分类关键词 + 关键词命中句子
        try:
            # 先解析输出结果，确保传递给extract_keywords_from_gpt_response的是dict
            if isinstance(output, str):
                try:
                    output_dict = json.loads(output)
                except json.JSONDecodeError:
                    output_dict = {}
            else:
                output_dict = output

            # 提取分类关键词（基于固定类别词表）
            categorized_keywords = extract_keywords_from_gpt_response(output_dict)

            # 创建一个包含原始评分、分类关键词、关键词命中句子的综合结果
            combined_result = {
                "evaluation": output_dict,
                "categorized_keywords": categorized_keywords,
                "keyword_mentions": output_dict.get("keyword_mentions", [])
            }

            return combined_result
        except Exception as e:
            print(f"提取关键词失败: {e}")
            # 如果提取关键词失败，返回原始结果
            return output

    except Exception as e:
        print(f"gpt_api 调用错误: {e}")
        return None


def extract_keywords_from_gpt_response(response):
    """从GPT-5的响应中提取关键词并按语义分类"""
    import json
    
    # 定义语义类别和相关关键词
    SEMANTIC_CATEGORIES = {
        'hair': ['头发', '发丝', '发型', '发梢', '发色', '刘海', '胡须'],
        'face': ['脸部', '面部', '五官', '表情', '神态', '肤色', '脸颊', '眼睛', '眉毛', '嘴巴', '鼻子'],
        'body': ['身体', '身材', '姿态', '姿势', '比例', '结构', '骨骼', '肌肉'],
        'clothes': ['衣服', '服装', '衣领', '衣袖', '衣扣', '衣摆', '服饰', '配饰'],
        'lighting': ['光线', '光照', '亮度', '阴影', '高光', '明暗', '光影'],
        'texture': ['质感', '纹理', '细节', '刻画', '表面', '光滑度'],
        'composition': ['构图', '布局', '空间感', '透视', '远近', '层次'],
        'atmosphere': ['氛围', '气氛', '意境', '艺术感', '表现力']
    }
    
    categorized_keywords = {category: [] for category in SEMANTIC_CATEGORIES}
    all_comments = []
    
    try:
        # 解析JSON响应
        if isinstance(response, str):
            try:
                response_dict = json.loads(response)
            except json.JSONDecodeError:
                print("响应不是有效的JSON格式")
                return categorized_keywords
        else:
            response_dict = response
        
        # 收集所有评语
        if 'dimensions' in response_dict:
            for dimension in response_dict['dimensions']:
                if 'comment' in dimension and dimension['comment']:
                    all_comments.append(dimension['comment'])
        
        if 'summary' in response_dict:
            if 'strengths' in response_dict['summary']:
                all_comments.extend(response_dict['summary']['strengths'])
            if 'suggestions' in response_dict['summary']:
                all_comments.extend(response_dict['summary']['suggestions'])
        
        # 按语义类别提取关键词
        for comment in all_comments:
            for category, keywords in SEMANTIC_CATEGORIES.items():
                for keyword in keywords:
                    if keyword in comment:
                        categorized_keywords[category].append(keyword)
        
        # 去重
        for category in categorized_keywords:
            categorized_keywords[category] = list(set(categorized_keywords[category]))
            
        return categorized_keywords
    except Exception as e:
        print(f"提取关键词时出错: {e}")
        return categorized_keywords
