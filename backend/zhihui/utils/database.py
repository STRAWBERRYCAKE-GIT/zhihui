import pymysql
from config import config

def get_db_connection():
    """获取数据库连接"""
    
    return pymysql.connect(
        host=config.database.host,
        user=config.database.user,
        password=config.database.password,
        database=config.database.database,
        port=config.database.port,
        cursorclass=pymysql.cursors.DictCursor
    )
