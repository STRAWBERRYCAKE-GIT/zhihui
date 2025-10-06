from .database import get_db_connection
from .VLM_api import gpt_api
from .dinov3_integration import detect_blank_spaces, calculate_bubble_positions, detect_keyword_regions  # 添加detect_keyword_regions
__all__ = ['get_db_connection', 'gpt_api', 'detect_blank_spaces', 'calculate_bubble_positions', 'detect_keyword_regions']  # 更新__all__列表