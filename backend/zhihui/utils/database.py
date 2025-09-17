from flask import current_app
import pymysql

#获取数据库连接
def get_db_connection():
    return pymysql.connect(
        host=current_app.config['MYSQL_HOST'],
        user=current_app.config['MYSQL_USER'],
        password=current_app.config['MYSQL_PASSWORD'],
        database=current_app.config['MYSQL_DB'],
        cursorclass=pymysql.cursors.DictCursor
    )