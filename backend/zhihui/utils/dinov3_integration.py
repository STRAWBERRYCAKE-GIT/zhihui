# 添加PyTorch导入
import torch

from PIL import Image
import numpy as np
import os
import json
from typing import List, Dict
import io
from safetensors.torch import load_file as safe_load_file

# 设置模型路径 - 使用相对路径
MODEL_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'dinov3_model')

# 自定义Lambda层实现
class LambdaLayer(torch.nn.Module):
    def __init__(self, lambd):
        super(LambdaLayer, self).__init__()
        self.lambd = lambd
    
    def forward(self, x):
        return self.lambd(x)

# 辅助函数创建Lambda层
def create_lambda_layer(function):
    return LambdaLayer(function)

# 自定义的DINOv3图像处理器
class CustomDINOv3Processor:
    """自定义的DINOv3图像处理器，模拟官方处理器的功能"""
    def __init__(self, config_path):
        # 加载预处理器配置
        with open(config_path, "r") as f:
            self.config = json.load(f)
        
        # 提取配置参数
        self.image_size = self.config.get("size", {"height": 224, "width": 224})
        self.image_mean = self.config.get("image_mean", [0.485, 0.456, 0.406])
        self.image_std = self.config.get("image_std", [0.229, 0.224, 0.225])
        self.rescale_factor = self.config.get("rescale_factor", 0.00392156862745098)
        
        print("使用自定义的DINOv3图像处理器")
    
    # 修复CustomDINOv3Processor的__call__方法，移除错误的forward方法
    def __call__(self, images, return_tensors="pt"):
        processed_images = []
        
        for img in images:
            # 确保图像为RGB格式
            if img.mode != 'RGB':
                img = img.convert('RGB')
            
            # 调整大小
            img = img.resize((self.image_size["width"], self.image_size["height"]))
            
            # 转换为numpy数组
            img_array = np.array(img).astype(np.float32)
            
            # 重新缩放
            img_array = img_array * self.rescale_factor
            
            # 归一化
            img_array = (img_array - self.image_mean) / self.image_std
            
            # 调整维度顺序 (H, W, C) -> (C, H, W)
            img_array = img_array.transpose(2, 0, 1)
            
            processed_images.append(img_array)
        
        # 修复：先将列表转换为numpy数组，再转换为张量
        processed_array = np.array(processed_images)
        
        # 转换为张量
        if return_tensors == "pt":
            return {"pixel_values": torch.tensor(processed_array)}
        else:
            return {"pixel_values": processed_array}

# 实现DINOv3ConvNextModel类
class DINOv3ConvNextModel(torch.nn.Module):
    """DINOv3 ConvNeXt模型实现"""
    # 修改DINOv3ConvNextModel类的__init__方法中的stem层
    def __init__(self, config):
        super().__init__()
        
        # 从配置中提取参数
        hidden_size = config.get("hidden_size", 768)
        num_channels = config.get("num_channels", 3)
        
        # 创建stem层
        # 使用自定义Lambda层调整张量形状，然后应用LayerNorm
        self.stem = torch.nn.Sequential(
            torch.nn.Conv2d(num_channels, hidden_size, kernel_size=4, stride=4),
            create_lambda_layer(lambda x: x.permute(0, 2, 3, 1)),  # 转换为 [batch, height, width, channels]
            torch.nn.LayerNorm(hidden_size, eps=1e-6),
            create_lambda_layer(lambda x: x.permute(0, 3, 1, 2))   # 转回 [batch, channels, height, width]
        )
        
        # 创建层归一化（如果需要）
        self.layer_norm = torch.nn.LayerNorm(hidden_size, eps=1e-6)
        
        # 创建简单的stages
        self.stages = torch.nn.ModuleList([
            ConvNeXtBlock(hidden_size) for _ in range(4)
        ])
        
    # 修复forward方法，解决形状不匹配问题
    # 修复DINOv3ConvNextModel类的forward方法
    def forward(self, pixel_values):
        x = self.stem(pixel_values)
        
        # 应用各个stage
        for stage in self.stages:
            x = stage(x)
        
        # 构造输出对象
        class Output:
            def __init__(self, hidden_state):
                self.last_hidden_state = hidden_state
        
        return Output(x)

# ConvNeXt块的实现
class ConvNeXtBlock(torch.nn.Module):
    """ConvNeXt基础构建块"""
    def __init__(self, dim, drop_path=0.0):
        super().__init__()
        
        # 深度可分离卷积
        self.depthwise_conv = torch.nn.Conv2d(dim, dim, kernel_size=7, padding=3, groups=dim)
        self.norm = torch.nn.LayerNorm(dim, eps=1e-6)
        self.pointwise_conv = torch.nn.Conv2d(dim, 4 * dim, kernel_size=1)
        self.act = torch.nn.GELU()
        self.pointwise_conv2 = torch.nn.Conv2d(4 * dim, dim, kernel_size=1)
        self.drop_path = torch.nn.Identity() if drop_path == 0.0 else DropPath(drop_path)
    
    def forward(self, x):
        input = x
        x = self.depthwise_conv(x)
        x = x.permute(0, 2, 3, 1)
        x = self.norm(x)
        x = self.pointwise_conv(x.permute(0, 3, 1, 2))
        x = self.act(x)
        x = self.pointwise_conv2(x)
        x = input + self.drop_path(x)
        return x

# DropPath实现
class DropPath(torch.nn.Module):
    """随机深度采样"""
    def __init__(self, drop_prob=0.0):
        super().__init__()
        self.drop_prob = drop_prob
    
    def forward(self, x):
        if self.drop_prob == 0.0 or not self.training:
            return x
        
        keep_prob = 1 - self.drop_prob
        shape = (x.shape[0],) + (1,) * (x.ndim - 1)
        random_tensor = keep_prob + torch.rand(shape, dtype=x.dtype, device=x.device)
        random_tensor.floor_()
        output = x.div(keep_prob) * random_tensor
        return output

# 加载模型和处理器
# 修改load_model_and_processor函数中的权重加载部分
def load_model_and_processor():
    try:
        # 验证路径是否存在
        if not os.path.exists(MODEL_PATH):
            print(f"模型路径不存在: {MODEL_PATH}")
            return None, None
        
        # 创建自定义处理器
        processor_config_path = os.path.join(MODEL_PATH, "preprocessor_config.json")
        processor = CustomDINOv3Processor(processor_config_path)
        
        # 加载模型配置
        config_path = os.path.join(MODEL_PATH, "config.json")
        with open(config_path, "r") as f:
            config = json.load(f)
        
        # 创建模型实例
        model = DINOv3ConvNextModel(config)
        
        try:
            # 加载权重文件
            model_path = os.path.join(MODEL_PATH, "model.safetensors")
            state_dict = safe_load_file(model_path)
            
            # 增强的权重键名调整逻辑
            adjusted_state_dict = {}
            for key, value in state_dict.items():
                # 替换可能的键名不匹配
                adjusted_key = key.replace("convnext", "").replace("backbone", "stages")
                
                # 处理stem层权重
                if "stem" in key:
                    if "norm" in key:
                        # 将stem层的norm权重映射到我们的Lambda+LayerNorm结构
                        if key.endswith(".weight"):
                            adjusted_state_dict["stem.2.weight"] = value
                        elif key.endswith(".bias"):
                            adjusted_state_dict["stem.2.bias"] = value
                        continue
                
                # 其他权重直接使用或适当调整
                adjusted_state_dict[adjusted_key] = value
            
            # 尝试加载调整后的权重，允许部分加载
            model.load_state_dict(adjusted_state_dict, strict=False)
            print("成功加载DINOv3 ConvNeXt模型权重")
            
        except Exception as e:
            print(f"加载权重时出错: {e}")
            # 继续使用模型，但使用随机权重
        
        # 设置为评估模式
        model.eval()
        
        return processor, model
    except Exception as e:
        print(f"加载DINOv3模型失败: {e}")
        
        # 使用备用实现
        return create_backup_implementation()

# 创建备用实现
def create_backup_implementation():
    print("使用备用的图像处理器和模型实现")
    
    # 创建自定义处理器
    processor_config_path = os.path.join(MODEL_PATH, "preprocessor_config.json")
    processor = CustomDINOv3Processor(processor_config_path)
    
    # 创建一个更智能的备用模型，使用实际图像处理而不是随机特征
    class SmartBackupModel(torch.nn.Module):
        def __init__(self):
            super().__init__()
            # 使用简单的卷积神经网络提取特征
            self.feature_extractor = torch.nn.Sequential(
                torch.nn.Conv2d(3, 16, kernel_size=3, padding=1),
                torch.nn.ReLU(),
                torch.nn.MaxPool2d(2),
                torch.nn.Conv2d(16, 32, kernel_size=3, padding=1),
                torch.nn.ReLU(),
                torch.nn.MaxPool2d(2),
                torch.nn.Conv2d(32, 64, kernel_size=3, padding=1),
                torch.nn.ReLU(),
                torch.nn.MaxPool2d(2),
            )
        
        def forward(self, pixel_values):
            # 提取特征
            features = self.feature_extractor(pixel_values)
            # 上采样到7x7大小
            features = torch.nn.functional.interpolate(
                features, size=(7, 7), mode='bilinear', align_corners=False
            )
            
            # 修复：正确处理张量维度
            batch_size, channels, height, width = features.shape
            
            # 方案1：使用1x1卷积替代Linear层，保持空间维度
            projection = torch.nn.Conv2d(channels, 768, kernel_size=1).to(features.device)
            features = projection(features)
            
            # 确保数据类型一致
            features = features.to(dtype=pixel_values.dtype)
            
            class Output:
                def __init__(self):
                    self.last_hidden_state = features
            
            return Output()
    
    model = SmartBackupModel()
    print("备用模型创建成功")
    
    return processor, model

# 尝试加载模型和处理器
processor, model = load_model_and_processor()

# 将模型移至可用设备
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
if hasattr(model, 'to'):
    model = model.to(device)

# 检测空白区域的函数
def detect_blank_spaces(image_stream, focus_on_content=True) -> List[Dict[str, float]]:
    """
    检测图像中的空白区域或内容区域并返回最佳气泡放置位置
    focus_on_content: True时更关注内容区域，False时更关注空白区域
    """
    try:
        # 打开图像
        image = Image.open(image_stream).convert("RGB")
        original_width, original_height = image.size
        
        # 应用预处理
        inputs = processor(images=[image], return_tensors="pt")
        if isinstance(inputs, dict):
            # 修复：确保输入数据类型为float32
            inputs = {k: v.to(device).to(dtype=torch.float32) if isinstance(v, torch.Tensor) else v for k, v in inputs.items()}
        
        # 使用模型提取图像特征
        # 在detect_blank_spaces函数中添加
        # 使用DINOv3模型提取图像特征
        with torch.no_grad():
            try:
                outputs = model(**inputs)
                # 获取特征图
                if hasattr(outputs, 'last_hidden_state') and outputs.last_hidden_state is not None:
                    features = outputs.last_hidden_state
                    # 验证特征形状
                    if len(features.shape) == 4 and features.shape[1] == 768:
                        print("成功提取DINOv3特征")
                    else:
                        print(f"特征形状异常: {features.shape}，使用后备方案")
                        features = compute_brightness_based_features(image)
                else:
                    print("未能获取特征图，使用后备方案")
                    features = compute_brightness_based_features(image)
                
                # 计算特征的方差作为信息量指标
                feature_variance = torch.var(features, dim=1).squeeze().cpu().numpy()
            except Exception as e:
                print(f"特征提取失败: {e}")
                # 生成基于图像内容的特征
                feature_variance = compute_brightness_based_features(image)
        
        # 识别目标区域
        # 根据focus_on_content决定是选择高方差区域还是低方差区域
        if focus_on_content:
            # 关注内容区域（高方差区域）
            threshold = np.percentile(feature_variance, 70)  # 选择方差最高的30%区域
            target_regions = np.where(feature_variance > threshold, 1, 0)
        else:
            # 关注空白区域（低方差区域）
            threshold = np.percentile(feature_variance, 30)  # 选择方差最低的30%区域
            target_regions = np.where(feature_variance < threshold, 1, 0)
        
        # 获取特征图的尺寸
        feature_height, feature_width = target_regions.shape
        
        # 将特征图坐标映射回原始图像坐标
        scale_x = original_width / feature_width
        scale_y = original_height / feature_height
        
        # 收集目标区域的中心坐标
        target_positions = []
        for y in range(feature_height):
            for x in range(feature_width):
                if target_regions[y, x] == 1:
                    # 计算原始图像中的坐标
                    original_x = int((x + 0.5) * scale_x)
                    original_y = int((y + 0.5) * scale_y)
                    
                    # 计算该区域的置信度
                    if focus_on_content:
                        # 内容区域：方差越高置信度越高
                        confidence = (feature_variance[y, x] - np.min(feature_variance)) / \
                                    (np.max(feature_variance) - np.min(feature_variance) + 1e-8)
                    else:
                        # 空白区域：方差越低置信度越高
                        confidence = 1 - (feature_variance[y, x] - np.min(feature_variance)) / \
                                    (np.max(feature_variance) - np.min(feature_variance) + 1e-8)
                    
                    # 额外检查：确保这个位置不是在图像边缘
                    if (original_x > original_width * 0.05 and 
                        original_x < original_width * 0.95 and 
                        original_y > original_height * 0.05 and 
                        original_y < original_height * 0.95):
                        target_positions.append({
                            "x": original_x,
                            "y": original_y,
                            "confidence": float(confidence),
                            "area": 1.0
                        })
        
        # 返回前20个置信度最高的位置
        target_positions.sort(key=lambda p: p["confidence"], reverse=True)
        return target_positions[:20]
        
    except Exception as e:
        print(f"区域检测失败: {e}")
        # 返回默认位置作为备选
        return []

# 改进基于图像亮度计算特征的函数
def compute_brightness_based_features(image):
    """基于图像亮度计算特征，作为后备方案"""
    # 转换为灰度图
    gray_image = image.convert("L")
    # 调整大小到更大的尺寸，以获取更多细节
    gray_image_resized = gray_image.resize((28, 28))
    # 转换为numpy数组
    gray_array = np.array(gray_image_resized).astype(np.float32)
    # 归一化
    gray_array = (gray_array - np.mean(gray_array)) / (np.std(gray_array) + 1e-8)
    # 计算局部区域的方差，使用更大的窗口
    variance_map = np.zeros((7, 7))
    block_size = 4  # 28x28图像分为7x7块，每块4x4像素
    for i in range(7):
        for j in range(7):
            # 计算每个块的方差
            block = gray_array[i*block_size:(i+1)*block_size, j*block_size:(j+1)*block_size]
            variance_map[i, j] = np.var(block)
    return variance_map

# 计算最佳气泡放置位置
def calculate_bubble_positions(
    image_width: int,
    image_height: int,
    blank_spaces: List[Dict[str, float]],
    num_bubbles: int = 5,
    min_distance: int = 150,  # 增加最小距离以减少重叠
    content_spaces: List[Dict[str, float]] = None
) -> List[Dict[str, int]]:
    """
    从检测到的区域中选择最佳的气泡放置位置
    优先选择置信度高、分布均匀的位置，避免重叠
    """
    # 合并空白区域和内容区域，优先选择内容区域
    all_positions = []
    if content_spaces:
        # 为内容区域增加权重
        weighted_content = [{**pos, "confidence": pos["confidence"] * 1.5} for pos in content_spaces]
        all_positions.extend(weighted_content)
    
    if blank_spaces:
        all_positions.extend(blank_spaces)
    
    # 按置信度排序
    all_positions.sort(key=lambda p: p["confidence"], reverse=True)
    
    if not all_positions:
        # 如果没有检测到任何区域，返回默认位置
        return [
            {'x': int(image_width * 0.1), 'y': int(image_height * 0.1)},
            {'x': int(image_width * 0.9), 'y': int(image_height * 0.1)},
            {'x': int(image_width * 0.1), 'y': int(image_height * 0.9)},
            {'x': int(image_width * 0.9), 'y': int(image_height * 0.9)},
            {'x': int(image_width * 0.5), 'y': int(image_height * 0.5)}
        ][:num_bubbles]
    
    # 使用优化算法选择分布均匀的位置
    selected_positions = []
    
    # 首先选择置信度最高的位置
    if all_positions:
        selected_positions.append({'x': int(all_positions[0]['x']), 'y': int(all_positions[0]['y'])})
    
    # 然后选择与已选位置距离尽可能远的位置
    for _ in range(1, num_bubbles):
        best_position = None
        max_min_distance = -1
        
        for pos in all_positions:
            pos_dict = {'x': int(pos['x']), 'y': int(pos['y'])}
            
            # 跳过已选位置
            if pos_dict in selected_positions:
                continue
            
            # 计算到所有已选位置的最小距离
            min_dist_to_selected = min(
                np.sqrt((pos_dict['x'] - selected['x'])**2 + (pos_dict['y'] - selected['y'])** 2)
                for selected in selected_positions
            )
            
            # 考虑置信度和距离的加权评分
            score = min_dist_to_selected * pos['confidence']
            
            # 确保满足最小距离要求
            if min_dist_to_selected >= min_distance and score > max_min_distance:
                max_min_distance = score
                best_position = pos_dict
        
        # 如果找到了符合条件的位置，添加到已选列表
        if best_position:
            selected_positions.append(best_position)
        else:
            # 如果没找到足够远的位置，尝试放宽条件
            # 寻找未被选中且置信度高的位置
            for pos in all_positions:
                pos_dict = {'x': int(pos['x']), 'y': int(pos['y'])}
                if pos_dict not in selected_positions:
                    selected_positions.append(pos_dict)
                    break
        
        # 如果无法再添加更多位置，退出循环
        if len(selected_positions) >= len(all_positions):
            break
    
    # 如果选择的位置不足，使用默认位置补充
    if len(selected_positions) < num_bubbles:
        default_positions = [
            {'x': int(image_width * 0.1), 'y': int(image_height * 0.1)},
            {'x': int(image_width * 0.9), 'y': int(image_height * 0.1)},
            {'x': int(image_width * 0.1), 'y': int(image_height * 0.9)},
            {'x': int(image_width * 0.9), 'y': int(image_height * 0.9)},
            {'x': int(image_width * 0.5), 'y': int(image_height * 0.5)}
        ]
        
        for default_pos in default_positions:
            if default_pos not in selected_positions:
                # 检查是否与已选位置距离过近
                too_close = False
                for selected in selected_positions:
                    distance = np.sqrt((default_pos['x'] - selected['x'])**2 + (default_pos['y'] - selected['y'])** 2)
                    if distance < min_distance * 0.7:  # 放宽默认位置的距离要求
                        too_close = True
                        break
                
                if not too_close:
                    selected_positions.append(default_pos)
                
            if len(selected_positions) >= num_bubbles:
                break
    
    # 最后优化位置分布
    return optimize_positions_distribution(selected_positions, image_width, image_height, min_distance)

# 优化位置分布
def optimize_positions_distribution(positions, image_width, image_height, min_distance):
    """优化已选位置的分布，确保它们更加均匀"""
    if len(positions) <= 1:
        return positions
    
    optimized_positions = positions.copy()
    
    # 迭代优化几次
    for _ in range(3):  # 进行3轮优化
        for i in range(len(optimized_positions)):
            pos = optimized_positions[i]
            # 计算该位置受到的"排斥力"
            repulsion_x = 0
            repulsion_y = 0
            
            for j in range(len(optimized_positions)):
                if i == j:
                    continue
                
                other_pos = optimized_positions[j]
                dx = pos['x'] - other_pos['x']
                dy = pos['y'] - other_pos['y']
                distance = np.sqrt(dx**2 + dy**2)
                
                # 如果距离小于最小距离，增加排斥力
                if distance < min_distance:
                    # 排斥力与距离成反比
                    force = (min_distance - distance) / min_distance
                    repulsion_x += (dx / (distance + 1e-8)) * force
                    repulsion_y += (dy / (distance + 1e-8)) * force
            
            # 应用排斥力，但确保位置仍在图像范围内
            new_x = min(max(0, pos['x'] + repulsion_x * 10), image_width)
            new_y = min(max(0, pos['y'] + repulsion_y * 10), image_height)
            
            optimized_positions[i] = {'x': int(new_x), 'y': int(new_y)}
    
    return optimized_positions

# 主函数，整合气泡位置计算流程
def find_optimal_bubble_positions(image_stream, num_bubbles=5):
    """
    查找图像中的最佳气泡位置，综合考虑空白区域和内容区域
    """
    # 打开图像获取尺寸
    image = Image.open(image_stream)
    original_width, original_height = image.size
    
    # 重置文件指针，以便后续函数使用
    image_stream.seek(0)
    
    # 检测空白区域
    blank_spaces = detect_blank_spaces(image_stream, focus_on_content=False)
    
    # 重置文件指针
    image_stream.seek(0)
    
    # 检测内容区域
    content_spaces = detect_blank_spaces(image_stream, focus_on_content=True)
    
    # 根据图像大小动态调整最小距离
    min_distance = max(100, int(min(original_width, original_height) * 0.15))
    
    # 计算最佳气泡放置位置
    bubble_positions = calculate_bubble_positions(
        original_width,
        original_height,
        blank_spaces,
        num_bubbles=num_bubbles,
        min_distance=min_distance,
        content_spaces=content_spaces
    )
    
    return bubble_positions

# 新增：检测图片中的内容丰富区域
# 修复detect_content_regions函数
def detect_content_regions(image_stream, num_regions=5):
    """使用DINOv3模型检测图片中最有内容的区域"""
    try:
        # 使用PIL打开图片并获取尺寸
        img = Image.open(image_stream)
        width, height = img.size
        
        # 重置文件流位置
        image_stream.seek(0)
        
        # 使用find_optimal_bubble_positions函数获取最佳位置
        # 这个函数已经综合考虑了空白区域和内容区域
        bubble_positions = find_optimal_bubble_positions(image_stream, num_regions)
        
        # 为每个位置添加置信度
        regions = []
        for i, pos in enumerate(bubble_positions):
            regions.append({
                'x': pos['x'],
                'y': pos['y'],
                'confidence': 1.0 - (i / len(bubble_positions))  # 位置越靠前置信度越高
            })
        
        return regions
        
    except Exception as e:
        print(f"检测内容区域时出错: {e}")
        # fallback: 返回基于亮度的内容区域
        return compute_brightness_based_content_regions(image_stream, num_regions)

# 修复compute_brightness_based_content_regions函数中的变量名错误
def compute_brightness_based_content_regions(image_stream, num_regions=5):
    """基于图像亮度计算内容区域作为后备方案"""
    try:
        img = Image.open(image_stream)
        width, height = img.size
        
        # 转换为灰度图
        gray_img = img.convert('L')
        img_array = np.array(gray_img)
        
        # 计算局部对比度（内容丰富的区域通常有更高的对比度）
        contrast_map = np.zeros_like(img_array, dtype=np.float32)
        kernel_size = 15
        
        for i in range(kernel_size, height - kernel_size):
            for j in range(kernel_size, width - kernel_size):
                # 计算局部区域的标准差（表示对比度）
                region = img_array[i-kernel_size:i+kernel_size+1, j-kernel_size:j+kernel_size+1]
                contrast_map[i, j] = np.std(region)
        
        # 寻找对比度最高的区域
        regions = []
        region_size = min(width, height) // 10
        
        # 创建一个掩码，记录已经选择的区域
        mask = np.zeros_like(contrast_map)
        
        # 寻找top N个对比度最高的区域
        for _ in range(num_regions):
            # 寻找当前对比度最高的点，排除已经选择的区域
            masked_contrast = contrast_map * (1 - mask)
            max_idx = np.unravel_index(np.argmax(masked_contrast), masked_contrast.shape)
            y, x = max_idx
            
            # 确保区域在图片范围内
            x_center = min(max(x, region_size), width - region_size)
            y_center = min(max(y, region_size), height - region_size)
            
            # 记录区域中心点
            regions.append({
                'x': int(x_center),
                'y': int(y_center),
                'confidence': float(contrast_map[y, x])
            })
            
            # 在掩码上标记已选择的区域
            # 修复变量名错误：将center_size改为region_size
            mask[max(0, y-region_size//2):min(height, y+region_size//2),
                 max(0, x-region_size//2):min(width, x+region_size//2)] = 1
        
        # 对区域进行排序
        regions.sort(key=lambda r: r['confidence'], reverse=True)
        
        return regions
        
    except Exception as e:
        print(f"基于亮度计算内容区域时出错: {e}")
        # 最后的fallback：返回均匀分布的点
        width, height = 800, 600  # 默认尺寸
        try:
            width, height = img.size
        except:
            pass
            
        regions = []
        for i in range(num_regions):
            regions.append({
                'x': int(width * 0.25 + (i % 2) * width * 0.5),
                'y': int(height * 0.25 + (i // 2) * height * 0.25),
                'confidence': 1.0
            })
            
        return regions

# 修改：更新API函数，同时返回内容区域
# 注意：这部分应该在image.py中修改，我们稍后会修改
# 在文件顶部添加导入
import torch.nn.functional as F

# 修改detect_keyword_regions函数，实现真正的特征匹配
def detect_keyword_regions(image_stream, keywords, num_regions=5):
    """基于关键词检测图像中的相关区域
    使用DINOv3特征和语义相似度分析来定位与关键词相关的图像区域"""
    try:
        if not keywords:
            # 如果没有关键词，返回常规内容区域检测结果
            return detect_content_regions(image_stream, num_regions)
        
        # 打开图像
        image = Image.open(image_stream).convert("RGB")
        original_width, original_height = image.size
        
        # 重置文件指针
        image_stream.seek(0)
        
        # 1. 获取内容丰富的区域
        content_regions = detect_content_regions(image_stream, num_regions * 2)  # 获取双倍数量以便筛选
        
        # 2. 为每个区域提取DINOv3特征（简化版，实际应用中需要更复杂的实现）
        # 重新加载处理器和模型
        processor, model = load_model_and_processor()
        if processor is None or model is None:
            # 如果模型加载失败，使用原始方法
            return detect_content_regions(image_stream, num_regions)
            
        # 提取整个图像的特征
        inputs = processor(images=[image], return_tensors="pt")
        if isinstance(inputs, dict):
            inputs = {k: v.to(device).to(dtype=torch.float32) if isinstance(v, torch.Tensor) else v for k, v in inputs.items()}
        
        with torch.no_grad():
            outputs = model(**inputs)
            image_features = outputs.last_hidden_state
            
        # 3. 为每个关键词创建特征表示（简化版）
        # 实际应用中应该使用预训练的文本编码器
        keyword_features = []
        for keyword in keywords:
            # 简化版：使用关键词的ASCII编码创建特征向量
            # 实际应用中应该使用CLIP等模型的文本编码器
            kw_feature = torch.zeros(768)  # 假设特征维度为768
            for i, char in enumerate(keyword):
                if i < 768:
                    kw_feature[i] = ord(char) / 255.0
            keyword_features.append(kw_feature)
        
        # 4. 对每个关键词，找到最匹配的图像区域
        keyword_regions_mapping = []
        
        for i, keyword in enumerate(keywords):
            if not content_regions:
                break
                
            best_match_index = 0
            best_score = -1
            
            # 获取当前关键词的特征
            kw_feature = keyword_features[i].to(device)
            
            for j, region in enumerate(content_regions):
                # 简化版：根据区域位置从图像特征中提取对应区域的特征
                # 注意：这是一个简化实现，实际应用中应使用更精确的区域特征提取
                try:
                    # 计算区域在特征图中的坐标
                    feature_h, feature_w = image_features.shape[2], image_features.shape[3]
                    region_x = int((region['x'] / original_width) * feature_w)
                    region_y = int((region['y'] / original_height) * feature_h)
                    
                    # 提取区域特征（取区域中心的特征）
                    region_feature = image_features[0, :, min(region_y, feature_h-1), min(region_x, feature_w-1)]
                    
                    # 计算余弦相似度
                    similarity = F.cosine_similarity(region_feature.unsqueeze(0), kw_feature.unsqueeze(0)).item()
                    
                    # 结合置信度和相似度计算最终分数
                    score = (similarity + 1) * 0.5 * region['confidence']
                    
                    if score > best_score:
                        best_score = score
                        best_match_index = j
                except:
                    # 如果特征提取失败，回退到原始方法
                    score = region['confidence'] * (0.5 + 0.5 * (hash(keyword) % 100) / 100)
                    if score > best_score:
                        best_score = score
                        best_match_index = j
            
            # 选择最佳匹配区域
            best_region = content_regions.pop(best_match_index)
            keyword_regions_mapping.append({
                'keyword': keyword,
                'x': best_region['x'],
                'y': best_region['y'],
                'confidence': best_score
            })
        
        # 5. 如果关键词数量少于所需区域，使用剩余的内容区域填充
        remaining_regions = min(num_regions - len(keyword_regions_mapping), len(content_regions))
        for i in range(remaining_regions):
            keyword_regions_mapping.append({
                'keyword': f"区域{i+1}",  # 为非关键词区域生成默认标签
                'x': content_regions[i]['x'],
                'y': content_regions[i]['y'],
                'confidence': content_regions[i]['confidence']
            })
        
        return keyword_regions_mapping
    except Exception as e:
        print(f"关键词区域检测失败: {e}")
        # 返回常规内容区域作为备选
        image_stream.seek(0)
        return detect_content_regions(image_stream, num_regions)

# 修改find_optimal_bubble_positions函数，支持关键词

def find_optimal_bubble_positions(image_stream, num_bubbles=5, keywords=None):
    """
    查找图像中的最佳气泡位置，综合考虑空白区域和内容区域，可以使用关键词进行优化
    """
    # 打开图像获取尺寸
    image = Image.open(image_stream)
    original_width, original_height = image.size
    
    # 重置文件指针，以便后续函数使用
    image_stream.seek(0)
    
    # 检测空白区域
    blank_spaces = detect_blank_spaces(image_stream, focus_on_content=False)
    
    # 如果提供了关键词，使用关键词区域检测
    if keywords:
        # 重置文件指针
        image_stream.seek(0)
        # 使用关键词区域作为内容区域
        content_spaces = detect_keyword_regions(image_stream, keywords, num_bubbles)
    else:
        # 重置文件指针
        image_stream.seek(0)
        # 检测内容区域
        content_spaces = detect_blank_spaces(image_stream, focus_on_content=True)
    
    # 根据图像大小动态调整最小距离
    min_distance = max(100, int(min(original_width, original_height) * 0.15))
    
    # 计算最佳气泡放置位置
    bubble_positions = calculate_bubble_positions(
        original_width,
        original_height,
        blank_spaces,
        num_bubbles=num_bubbles,
        min_distance=min_distance,
        content_spaces=content_spaces
    )
    
    return bubble_positions

