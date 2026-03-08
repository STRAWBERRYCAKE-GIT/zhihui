from zhihui import create_app

app = create_app()
# CORS配置已在create_app()中设置，这里不需要重复配置


import logging

# 静默 werkzeug 请求日志
logging.getLogger('werkzeug').setLevel(logging.ERROR)

# 健康检查，避免 OPTIONS / 404 噪音
@app.route('/', methods=['GET', 'OPTIONS'])
def health():
    return 'ok', 200

if __name__=='__main__':
    app.run(debug=False, port=5000, use_reloader=False)
