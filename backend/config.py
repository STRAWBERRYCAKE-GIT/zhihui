import os
from dataclasses import dataclass,field
from typing import Dict, List
from dotenv import load_dotenv
import torch

load_dotenv()

@dataclass
class DatabaseConfig:
    """数据库配置"""
    host: str = "localhost"
    user: str = "root"
    password: str = "123456"
    database: str = "zhihui_db"
    port: int = 3306

@dataclass
class OpenAIConfig:
    """OpenAI API配置"""
    # base_url: str = "https://api.getgoapi.com/v1/"
    # api_key: str = os.getenv("GETGO_API_KEY", "")
    base_url:str="https://api.openai-proxy.org/v1"
    api_key:str=os.getenv("OPENAI_API_KEY","")

# @dataclass
# class DINOv3Config:
#     """DINOv3模型配置"""
#     backbone_path: str = "E:/zhihui_to-c/dinov3-vitb16-pretrain-lvd1689m"
#     head_path: str = "E:/zhihui_to-c/seghead_vitb16.pth"                        # 训练好的分割头权重

#     # 设备
#     device: str = "cuda" if torch.cuda.is_available() else "cpu"

#     # 模型参数
#     image_size: int = 224
#     num_classes: int = 2          # 前景/背景
#     register_tokens: int = 4      # DINOv3 的 register token 数量（一般配置为4）

@dataclass
class GroundingDINOConfig:
    """Grounding DINO模型配置"""
    url:str = "https://api.deepdataspace.com/v2/task/dinox/detection"
    token:str = os.getenv("GroudingDINO_API_KEY","")
    bbox_threshold:float = 0.25
    iou_threshold:float = 0.8

@dataclass
class FileUploadConfig:
    """文件上传配置"""
    allowed_extensions: List[str] = None
    max_file_size: int = 16 * 1024 * 1024  # 16MB
    upload_folder: str = "uploads"
    
    def __post_init__(self):
        if self.allowed_extensions is None:
            self.allowed_extensions = ['png', 'jpg', 'jpeg', 'webp']

@dataclass
class FileResultConfig:
    """生成文件配置"""
    result_folder: str = "results"
    
@dataclass
class AppConfig:
    """主应用配置"""
    debug: bool = True # 开发模式
    secret_key: str = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
    jwt_secret_key: str = os.getenv("JWT_SECRET_KEY", "dev-jwt-secret-change-in-production")
    
    # 子配置
    database: DatabaseConfig = field(default_factory=DatabaseConfig)
    openai: OpenAIConfig = field(default_factory=OpenAIConfig)
    groundingdino: GroundingDINOConfig = field(default_factory=GroundingDINOConfig)
    file_upload: FileUploadConfig = field(default_factory=FileUploadConfig)
    file_result: FileResultConfig = field(default_factory=FileResultConfig)
    
# 配置实例
config = AppConfig()