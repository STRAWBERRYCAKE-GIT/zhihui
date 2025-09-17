from flask_cors import CORS
from zhihui import create_app
from zhihui.utils import init_xf_image_api

app = create_app()
CORS(app)

    
if __name__=='__main__':
    app.run(debug=True,port=5000)
    init_xf_image_api(app)