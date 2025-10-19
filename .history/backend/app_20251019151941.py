from flask_cors import CORS
from zhihui import create_app

app = create_app()
CORS(app)

app.config['CNCLIP_MIN_CONF_STRICT'] = 0.4
app.config['CNCLIP_TOP_K_STRICT'] = 5
app.config['CNCLIP_NMS_IOU'] = 0.25
import logging

# 静默 werkzeug 请求日志
logging.getLogger('werkzeug').setLevel(logging.ERROR)

# 健康检查，避免 OPTIONS / 404 噪音
@app.route('/', methods=['GET', 'OPTIONS'])
def health():
    return 'ok', 200

if __name__=='__main__':
    app.run(debug=False, port=5000, use_reloader=False)
