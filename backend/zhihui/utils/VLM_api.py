import base64
from openai import OpenAI
from config import config

client = OpenAI(
    base_url=config.openai.base_url,
    api_key=config.openai.api_key
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
                    "name": {
                        "type": "string"},
                    "raw_score": {
                        "type": "number",
                        "minimum": 0, 
                        "maximum": 100},
                    "weighted_score": {
                        "type": "number"},
                    "comment": {
                        "type": "string"}
                },
                "required": ["name", "raw_score", "weighted_score", "comment"]
            }
        },
        "summary": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "strengths": {
                    "type": "array",
                    "items": {"type": "string"}},
                "suggestions": {
                    "type": "array",
                    "items": {"type": "string"}}
            },
            "required": ["strengths", "suggestions"]
        },
        "keyword_mentions": {
            "type": "array",
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
    "required": ["dimensions","summary", "keyword_mentions"]
}

# 根据不同类型素描生成提示词
# 这里不知道为什么，换了一个平台之后JSON scheme好像无效了，只能在提示词中限制
def get_prompt(sketch_type="portrait"):
    # if sketch_type == "portrait":
    return """你是一位专业的美术学院素描评审专家，请对提供的素描作品进行专业评价，不同类型素描作品评分标准如下。

人像素描评分维度及权重：
1. 构图透视（15%）：画面布局、透视准确度、空间感表现
2. 人像塑造（20%）：身体比例、五官刻画、骨骼肌肉准确性
3. 表情神态（15%）：表情真实性、情感传达、神态自然度
4. 皮肤头发质感（15%）：皮肤和头发的质感表现
5. 明暗光影（15%）：明暗对比、光影分布、立体感塑造
6. 细节刻画（10%）：服饰纹理、配饰等细节处理
7. 艺术表现力（10%）：艺术感染力、个人风格、主题表达
        
静物素描评分维度及权重：
1. 构图透视（15%）：画面布局、物体与背景关系、透视准确度、空间感表现
2. 物体塑造（20%）：物体比例、形态结构、明暗对比、细节表现
3. 光影表现（15%）：光源位置、光影分布、立体感塑造
4. 材料质感（15%）：静物材质的表现（如玻璃、金属、木材等）
5. 细节刻画（15%）：表面质感、纹理、细部处理
6. 明暗过渡（10%）：明暗渐变的柔和度与自然度
7. 艺术表现力（10%）：艺术感、创意性、静物的主题表达
        
风景素描评分维度及权重：
1. 构图透视（15%）：画面布局、远近关系、透视准确度、空间感表现
2. 远景塑造（20%）：背景山川、天际线表现、气氛渲染
3. 中景塑造（20%）：树木、建筑、自然景物的表现、明暗处理
4. 光影表现（15%）：光源方向、光影层次、立体感表现
5. 细节刻画（10%）：细节丰富度、表现细腻度
6. 大气效果（10%）：雾气、光影变化、氛围表现
7. 艺术表现力（10%）：艺术感染力、风景的表现力、情感传达
        
石膏评分维度及权重：
1. 构图透视（15%）：画面布局、石膏像与背景的透视关系、空间感表现
2. 石膏像塑造（25%）：石膏像的结构、比例、细节表现、形态准确性
3. 明暗光影（20%）：光源方向、明暗对比、光影塑造
4. 立体感（15%）：通过明暗与透视表现石膏像的三维效果
5. 细节刻画（10%）：细部处理、质感表现（如纹理、表面光滑度等）
6. 结构描绘（10%）：骨骼与肌肉的结构准确性
7. 艺术表现力（5%）：石膏像的表现力与艺术感染力

评分标准参考：
- 优秀（90-100分）：各项表现完美，技术精湛
- 良好（80-90分）：表现良好，有少量可改进之处
- 中等（70-80分）：基本达标，有明显提升空间
- 合格（60-70分）：未达到基本要求，需要较多改进
- 不合格（60分以下）：完全不符合要求

首先请为每个维度提供：
1. 原始分数
2. 加权分数
3. 评语

然后给出总结：
1. 优点
2. 建议

最后给出适合批注在画面上的中文评语和对应的英文关键词

【keyword_mentions 提取规则】
- 仅选择可以定位到画面具体区域的评语
- 每个 keyword 必须是英文，且对应一个局部（如 eyes / nose / mouth）
- 数量不超过 6 个

输出 JSON 时必须严格使用以下字段名（完全一致）：

- dimensions
- summary
- keyword_mentions

dimensions 内字段：
- name
- raw_score
- weighted_score
- comment

summary 内字段：
- strengths
- suggestions

keyword_mentions 内字段：
- keyword
- sentences"""


# 调用GPT-5并进行评分
def gpt_api(image_stream, sketch_type="portrait"):
    import json
    try:
        # 获取指定的素描评分提示词
        prompt = get_prompt(sketch_type)
        image_data = image_stream.read()
        image_base64 = base64.b64encode(image_data).decode('utf-8')

        # 检测真实图片格式，构造正确的 MIME
        from io import BytesIO
        try:
            from PIL import Image
            pil_img = Image.open(BytesIO(image_data))
            fmt = (pil_img.format or "").lower()  # 'jpeg'/'png'/'webp'/...
        except Exception:
            fmt = "jpeg"
        mime = {"jpeg": "jpeg", "jpg": "jpeg", "png": "png", "webp": "webp", "bmp": "bmp"}.get(fmt, "jpeg")

        response = client.responses.create(
            model="gpt-5.4",
            input=[{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": f"data:image/{mime};base64,{image_base64}","detail": "original"}
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
        print(response.output)
        # 获取评分结果
        output = response.output_text
        #print(output)

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

            # 创建一个包含原始评分、分类关键词、关键词命中句子的综合结果
            combined_result = {
                "evaluation": output_dict,
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
