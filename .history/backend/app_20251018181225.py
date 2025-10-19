from flask_cors import CORS
from zhihui import create_app

app = create_app()
CORS(app)

app.config['CNCLIP_MIN_CONF_STRICT'] = 0.4
app.config['CNCLIP_TOP_K_STRICT'] = 5
app.config['CNCLIP_NMS_IOU'] = 0.25
    
if __name__=='__main__':
    app.run(debug=True,port=5000)
