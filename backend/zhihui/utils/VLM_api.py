import base64
from openai import OpenAI
from dotenv import load_dotenv
import os

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
            "required": ["name", "raw_score", "weighted_score","comment"]
            }
        },
        "summary": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "strengths": {"type": "array", "items": {"type": "string"}},
                "suggestions": {"type": "array", "items": {"type": "string"}}
            },
            "required": [ "strengths", "suggestions"]
        }
    },
    "required": ["dimensions", "summary"]
}

#根据不同类型素描生成提示词
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
7. 艺术表现力（10%）：艺术感染力、个人风格、主题表达""" + base_prompt

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
7. 艺术表现力（10%）：艺术感染力、风景的表现力、情感传达"""+ base_prompt
    
    elif sketch_type == "bust":
        return """你是一位专业的美术学院素描评审专家，请严格按照中国素描石膏素描等级考试评分标准对提供的素描作品进行专业评价。
        
评分维度及权重：
1. 构图透视（15%）：画面布局、石膏像与背景的透视关系、空间感表现
2. 石膏像塑造（25%）：石膏像的结构、比例、细节表现、形态准确性
3. 明暗光影（20%）：光源方向、明暗对比、光影塑造
4. 立体感（15%）：通过明暗与透视表现石膏像的三维效果
5. 细节刻画（10%）：细部处理、质感表现（如纹理、表面光滑度等）
6. 结构描绘（10%）：骨骼与肌肉的结构准确性
7. 艺术表现力（5%）：石膏像的表现力与艺术感染力"""+ base_prompt


# 调用GPT-5并进行评分
def gpt_api(image_stream, sketch_type="portrait"):
    try:
        # 获取指定的素描评分提示词
        prompt = get_prompt(sketch_type)

        image_data = image_stream.read()
        image_base64 = base64.b64encode(image_data).decode('utf-8')

        response = client.responses.create(
            model="gpt-5",
            input=[{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": f"data:image/jpeg;base64,{image_base64}"}
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
        return output 

    except Exception as e:
        print(f"gpt_api 调用错误: {e}")
        return None
