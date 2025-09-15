from flask import Flask

def create_app():
    app=Flask(__name__)
    from .views import user
    app.register_blueprint(user.user_bp)

    return app
