import base64
import hashlib
import hmac
import json
import time
from urllib.parse import urlencode
from datetime import datetime
from time import mktime
from urllib.parse import urljoin, urlparse
from wsgiref.handlers import format_date_time
import websocket
from flask import current_app

class XFImageAPI:
    def __init__(self):
        self.app_id = 'd2bc282d'
        self.api_key = 'efb578c068d715a29ebe7aafc392b7a5'
        self.api_secret = 'ZTNjMTg0NDhjZDU2ZmUzZjhkZGM2NGRl'
        self.host = "spark-api.cn-huabei-1.xf-yun.com"
        self.path = "/v2.1/image"
        self.url = f"wss://{self.host}{self.path}"

    def _get_auth_url(self):
        """生成鉴权URL"""
        # 生成RFC1123格式的时间戳
        now = datetime.now()
        date = format_date_time(mktime(now.timetuple()))
        
        # 拼接签名原文
        signature_origin = f"host: {self.host}\ndate: {date}\nGET {self.path} HTTP/1.1"
        
        # 进行hmac-sha256加密
        signature_sha = hmac.new(
            self.api_secret.encode('utf-8'), 
            signature_origin.encode('utf-8'), 
            hashlib.sha256
        ).digest()
        
        # base64编码
        signature_sha_base64 = base64.b64encode(signature_sha).decode(encoding='utf-8')
        
        # 拼接authorization
        authorization_origin = f'api_key="{self.api_key}", algorithm="hmac-sha256", headers="host date request-line", signature="{signature_sha_base64}"'
        authorization = base64.b64encode(authorization_origin.encode('utf-8')).decode(encoding='utf-8')
        
        # 生成鉴权URL
        v = {
            "authorization": authorization,
            "date": date,
            "host": self.host
        }
        return self.url + '?' + urlencode(v)

    def analyze_image(self, image_path, prompt):
        """分析图片并返回结果"""
        # 读取图片并转换为base64
        with open(image_path, "rb") as image_file:
            base64_image = base64.b64encode(image_file.read()).decode('utf-8')
        
        # 构建请求数据
        request_data = {
            "header": {
                "app_id": self.app_id,
                "uid": "1234567890"  # 随机用户ID，可以固定或随机生成
            },
            "parameter": {
                "chat": {
                    "domain": "imagev3",  # 使用高级版
                    "temperature": 0.5,
                    "top_k": 4,
                    "max_tokens": 2028,
                    "chat_id": "123"  # 会话ID，可选
                }
            },
            "payload": {
                "message": {
                    "text": [
                        {
                            "role": "user",
                            "content": base64_image,
                            "content_type": "image"
                        },
                        {
                            "role": "user",
                            "content": prompt,
                            "content_type": "text"
                        }
                    ]
                }
            }
        }
        
        # 获取鉴权URL
        auth_url = self._get_auth_url()
        
        # 创建WebSocket连接
        ws = websocket.WebSocketApp(
            auth_url,
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close
        )
        
        # 存储请求数据和响应
        ws.request_data = request_data
        ws.full_response = ""
        ws.is_finished = False
        
        # 运行WebSocket
        ws.run_forever()
        
        # 等待响应完成
        start_time = time.time()
        while not ws.is_finished and time.time() - start_time < 30:  # 30秒超时
            time.sleep(0.1)
        
        return ws.full_response

    def on_open(self, ws):
        """WebSocket连接打开时的回调"""
        print("WebSocket连接已打开")
        # 发送请求数据
        ws.send(json.dumps(ws.request_data))

    def on_message(self, ws, message):
        """收到消息时的回调"""
        data = json.loads(message)
        
        # 检查状态码
        if data['header']['code'] != 0:
            print(f"API返回错误: {data['header']['message']}")
            ws.close()
            return
        
        # 提取文本内容
        if 'payload' in data and 'choices' in data['payload']:
            text = data['payload']['choices']['text']
            for t in text:
                ws.full_response += t['content']
        
        # 检查是否结束
        if data['header']['status'] == 2:
            ws.is_finished = True
            ws.close()

    def on_error(self, ws, error):
        """发生错误时的回调"""
        print(f"WebSocket错误: {error}")
        ws.is_finished = True

    def on_close(self, ws, close_status_code, close_msg):
        """连接关闭时的回调"""
        print("WebSocket连接已关闭")
        ws.is_finished = True

# 创建全局实例
xf_image_api = None

def init_xf_image_api(app):
    """初始化讯飞图片API"""
    global xf_image_api
    xf_image_api = XFImageAPI()

def get_xf_image_api():
    """获取讯飞图片API实例"""
    global xf_image_api
    return xf_image_api