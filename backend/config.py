import os
from dataclasses import dataclass,field
from typing import Dict, List
from dotenv import load_dotenv

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
    base_url: str = "https://api.getgoapi.com/v1/"
    api_key: str = os.getenv("GETGO_API_KEY", "")
    # base_url='https://api.openai-proxy.org/v1',
    # api_key=os.getenv("OPENAI_API_KEY")

@dataclass
class DINOv3Config:
    """DINOv3模型配置"""
    model_path: str = "E:/zhihui_to-c/dinov3-vitb16-pretrain-lvd1689m"
    device: str = "cuda"  # 或 "cpu"
    image_size: Dict[str, int] = None
    
    def __post_init__(self):
        if self.image_size is None:
            self.image_size = {"height": 224, "width": 224}

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
class AppConfig:
    """主应用配置"""
    debug: bool = True # 开发模式
    secret_key: str = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
    jwt_secret_key: str = os.getenv("JWT_SECRET_KEY", "dev-jwt-secret-change-in-production")
    
    # 子配置
    database: DatabaseConfig = field(default_factory=DatabaseConfig)
    openai: OpenAIConfig = field(default_factory=OpenAIConfig)
    dinov3: DINOv3Config = field(default_factory=DINOv3Config)
    file_upload: FileUploadConfig = field(default_factory=FileUploadConfig)

# 配置实例
config = AppConfig()