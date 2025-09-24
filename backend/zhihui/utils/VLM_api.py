import base64
from openai import OpenAI

client = OpenAI(
    base_url='https://api.openai-proxy.org/v1',
    api_key='sk-QNQJP1VvngCWO1Ajv98J1KTWVAKInB79GvV08YtlVDwaR0ia',
)

# 定义 JSON Schema(为了结构化输出)
sketch_schema = {
        "type": "object",
        "properties": {
            "composition": {"type": "string"},
            "line_quality": {"type": "string"},
            "shading": {"type": "string"},
            "creativity": {"type": "string"},
            "overall_score": {"type": "number", "minimum": 0, "maximum": 100},
            "strengths": { "type": "array", "items": {"type": "string"} },
            "suggestions": {"type": "array", "items": {"type": "string"}}
        },
        "required": ["composition","line_quality","shading","creativity","overall_score","strengths","suggestions"],
        "additionalProperties": False
}

# 定义提示词
prompt = """你是一位专业的美术学院素描评审老师。  
请根据用户提供的素描作品，给出详细的评价。  
评价必须覆盖以下维度：  
- 构图（composition）：画面平衡、透视准确度、空间感  
- 线条（line_quality）：流畅度、力度控制、细节刻画  
- 光影（shading）：明暗对比、过渡自然度、体积感  
- 创意（creativity）：独特性、风格与表现力  
- 综合评分（overall_score）：0–100 分  
- 优点总结（strengths）：至少两条  
- 改进建议（suggestions）：至少两条  

请严格按照我提供的 JSON Schema 输出结果，不要输出任何额外的文字或解释。
"""

# 调用GPT-5
def gpt_api(image_stream):
    try:
        image_data = image_stream.read()
        image_base64 = base64.b64encode(image_data).decode('utf-8')

        response = client.responses.create(
            model="gpt-5",
            input= [
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
        print(response)
        return response.output_text
    except Exception as e:
        print(f"gpt_api 调用错误: {e}")
        return None
