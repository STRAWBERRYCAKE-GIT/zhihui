import sqlite3

# 连接到数据库
conn = sqlite3.connect('database.db')
cursor = conn.cursor()

# 获取所有表名
cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = cursor.fetchall()
print("表列表:", tables)

# 遍历每个表并显示内容
for table_name in tables:
    print(f"\n表: {table_name[0]}")
    cursor.execute(f"SELECT * FROM {table_name[0]}")
    rows = cursor.fetchall()
    for row in rows:
        print(row)

# 关闭连接
conn.close()