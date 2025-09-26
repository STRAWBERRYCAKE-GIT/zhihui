import base64
from openai import OpenAI
from dotenv import load_dotenv
import os

load_dotenv()  # 会自动读取 .env 文件
client = OpenAI(
    base_url='https://api.openai-proxy.org/v1',
    api_key=os.getenv("OPENAI_API_KEY")
)

# 定义 JSON Schema(为了结构化输出)
sketch_schema = {
    "type": "object",
    "properties": {
        "composition": {"type": "number", "minimum": 0, "maximum": 100},
        "human_figure": {"type": "number", "minimum": 0, "maximum": 100},
        "expression": {"type": "number", "minimum": 0, "maximum": 100},
        "skin_hair_texture": {"type": "number", "minimum": 0, "maximum": 100},
        "lighting_shading": {"type": "number", "minimum": 0, "maximum": 100},
        "details": {"type": "number", "minimum": 0, "maximum": 100},
        "artistic_expression": {"type": "number", "minimum": 0, "maximum": 100},
        "overall_score": {"type": "number", "minimum": 0, "maximum": 100},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "suggestions": {"type": "array", "items": {"type": "string"}}
    },
    "required": [
        "composition", "human_figure", "expression", "skin_hair_texture", 
        "lighting_shading", "details", "artistic_expression", "overall_score", "strengths", "suggestions"
    ],
    "additionalProperties": False
}

# 定义提示词
prompt = """你是一位专业的美术学院素描评审专家，请严格按照中国素描人像等级考试评分标准对提供的素描作品进行专业评价。

评分维度及权重：
1. 构图透视（15%）：画面布局、透视准确度、空间感表现
2. 人像塑造（20%）：身体比例、五官形态、骨骼肌肉准确性
3. 表情神态（15%）：表情真实性、情感传达、神态自然度
4. 皮肤头发质感（15%）：皮肤质感、头发层次感、细节表现
5. 明暗光影（15%）：明暗对比、光影分布、立体感塑造
6. 细节刻画（10%）：服饰纹理、配饰等细节处理
7. 艺术表现力（10%）：艺术感染力、个人风格、主题表达

评分标准参考：
- 优秀（90-100分）：各项表现完美，技术精湛
- 良好（80-90分）：表现良好，有少量可改进之处
- 中等（70-80分）：基本达标，有明显提升空间
- 合格（60-70分）：达到基本要求，需要较多改进
- 不合格（60分以下）：未达到基本标准

请为每个维度提供：
1. 具体分数（0-100）
2. 详细评语（指出具体优点和不足）
3. 等级评价（优秀/良好/中等/合格/不合格）

最后给出综合评价：
1. 加权总分（考虑各维度权重）
2. 最终等级（优秀/良好/中等/合格/不合格）
3. 主要优点（2-3条）
4. 改进建议（2-3条）

请严格遵循JSON格式输出，不要添加任何额外说明。
"""

# 调用GPT-5
def gpt_api(image_stream):
    try:
        image_data = image_stream.read()
        image_base64 = base64.b64encode(image_data).decode('utf-8')

        response = client.responses.create(
            model="gpt-5",
            input=[
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": prompt},
                        {"type": "input_image", "image_url": f"data:image/jpeg;base64,{image_base64}"},
                    ],
                }
            ],
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
        evaluation = eval(output)  # 将JSON字符串转化为字典

        # 计算加权总分
        scores = {
            "composition": evaluation["composition"],
            "human_figure": evaluation["human_figure"],
            "expression": evaluation["expression"],
            "skin_hair_texture": evaluation["skin_hair_texture"],
            "lighting_shading": evaluation["lighting_shading"],
            "details": evaluation["details"],
            "artistic_expression": evaluation["artistic_expression"]
        }

        weights = {
            "composition": 0.15,
            "human_figure": 0.20,
            "expression": 0.15,
            "skin_hair_texture": 0.15,
            "lighting_shading": 0.15,
            "details": 0.10,
            "artistic_expression": 0.10
        }

        total_score = sum(scores[dim] * weights[dim] for dim in scores)
        evaluation["overall_score"] = total_score

        # 计算最终等级
        if total_score >= 90:
            evaluation["final_grade"] = "优秀"
        elif total_score >= 80:
            evaluation["final_grade"] = "良好"
        elif total_score >= 70:
            evaluation["final_grade"] = "中等"
        elif total_score >= 60:
            evaluation["final_grade"] = "合格"
        else:
            evaluation["final_grade"] = "不合格"

        # 输出最终结果
        return evaluation

    except Exception as e:
        print(f"gpt_api 调用错误: {e}")
        return None
