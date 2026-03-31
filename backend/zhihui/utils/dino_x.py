import base64
import json
import time
import requests
from typing import List, Dict, Optional
from config import config
from io import BytesIO
from PIL import Image
from .dino_x_utils import decode_rle

class GroundingDINOClient:
    def __init__(self, url: str, token: str, bbox_threshold: float = 0.25, iou_threshold: float = 0.8):
        self.url = url
        self.bbox_threshold = bbox_threshold
        self.iou_threshold = iou_threshold
        self.headers = {
            "Content-Type": "application/json",
            "Token": token
        }

    def _submit_task(self, image_stream, prompt: str) -> str:
        """提交检测任务，返回 task_uuid"""
        image_data = image_stream.read()
        image_base64 = base64.b64encode(image_data).decode('utf-8')

        # 检测真实图片格式，构造正确的 MIM
        try:
            pil_img = Image.open(BytesIO(image_data))
            fmt = (pil_img.format or "").lower()  # 'jpeg'/'png'/'webp'/...
        except Exception:
            fmt = "jpeg"
        mime = {"jpeg": "jpeg", "jpg": "jpeg", "png": "png", "webp": "webp", "bmp": "bmp"}.get(fmt, "jpeg")

        payload = {
            "model": "DINO-X-1.0",
            "image": f"data:image/{mime};base64,{image_base64}",
            "prompt": {
                "type":"text",
                "text":prompt
            },
            "targets": ["mask"],
            "mask_format": "coco_rle",
            "bbox_threshold": self.bbox_threshold,
            "iou_threshold": self.iou_threshold
        }
        resp = requests.post(self.url, json=payload, headers=self.headers)
        resp.raise_for_status()
        data = resp.json()
        if data.get('code') != 0:
            raise Exception(f"Task submission failed: {data}")
        return data['data']['task_uuid']

    def _wait_for_result(self, task_uuid: str) -> Dict:
        """轮询直到任务完成，返回结果字典"""
        status_url = f"https://api.deepdataspace.com/v2/task_status/{task_uuid}"
        while True:
            resp = requests.get(status_url, headers=self.headers)
            resp.raise_for_status()
            data = resp.json()
            status = data['data'].get('status')
            if status == 'success':
                return data['data'].get('result', {})
            elif status == 'failed':
                raise Exception(f"Task failed: {data}")
            time.sleep(1)

    def detect(self, image_stream, prompt: str) -> List[Dict]:
        """
        检测图片中的目标
        :param image_stream: 图片文件流
        :param prompt: 文本提示，多个目标用 '.' 分隔
        :return: 检测结果列表
        """
        task_uuid = self._submit_task(image_stream, prompt)
        result = self._wait_for_result(task_uuid)
        print(f"Grounding DINO detection result: {json.dumps(result, indent=2)}")  # 调试输出
        # 提取 objects 列表
        objects = result.get('objects', [])
        detections = []
        for obj in objects:
            rle_mask = obj.get('mask')
            mask = None
            if rle_mask and rle_mask.get('format') == 'coco_rle':
                try:
                    mask = decode_rle(rle_mask)   # 解码得到 0/1 数组
                except Exception as e:
                    print(f"解码 RLE 失败: {e}")
            detections.append({
                'bbox': obj.get('bbox', []),
                'mask': mask,
                'score': obj.get('score', 0.0),
                'category': obj.get('category', '')
            })
        return detections

# 全局客户端实例（在应用启动时初始化）
grounding_client = GroundingDINOClient(
    url=config.groundingdino.url,
    token=config.groundingdino.token,
    bbox_threshold=config.groundingdino.bbox_threshold,
    iou_threshold=config.groundingdino.iou_threshold
)