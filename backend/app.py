from zhihui import create_app
import os
app = create_app()

import logging

# 静默 werkzeug 请求日志
logging.getLogger('werkzeug').setLevel(logging.ERROR)

# 健康检查，避免 OPTIONS / 404 噪音
@app.route('/', methods=['GET', 'OPTIONS'])
def health():
    return 'ok', 200

if __name__=='__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=app.config['DEBUG'], use_reloader=False)
