# CN-CLIP更新
1.库安装
1.1 CLIP库（可能没用到 因为真正集成的是CN-CLIP）
```
git clone https://github.com/openai/CLIP.git
cd CLIP
pip install .
```
1.2 CN-CLIP库
```
set LMDB_PURE=1
pip install cn_clip
```
权重文件打包发群里（有四个大的压缩包，其中CLIP就是1.1安装下来的）

2.数据库更新
images表
```
ALTER TABLE images ADD COLUMN text_region_mapping JSON NULL;
```

# 10.6更新
 1.images表
 ```
  ALTER TABLE zhihui_db.images ADD COLUMN empty_regions JSON;
  ALTER TABLE zhihui_db.images ADD COLUMN content_regions JSON;
  ALTER TABLE zhihui_db.images ADD COLUMN categorized_keywords LONGTEXT NULL AFTER empty_regions;
  ALTER TABLE zhihui_db.images ADD COLUMN keyword_matches LONGTEXT NULL AFTER content_regions;
 ```
 更新之后长这样：
 mysql> describe images;
+----------------------+--------------+------+-----+---------+----------------+
| Field                | Type         | Null | Key | Default | Extra          |
+----------------------+--------------+------+-----+---------+----------------+
| id                   | int          | NO   | PRI | NULL    | auto_increment |
| user_id              | int          | NO   | MUL | NULL    |                |
| filename             | varchar(255) | NO   |     | NULL    |                |
| original_name        | varchar(255) | NO   |     | NULL    |                |
| score                | int          | YES  |     | NULL    |                |
| upload_time          | datetime     | NO   |     | NULL    |                |
| strengths            | text         | YES  |     | NULL    |                |
| image_url            | varchar(500) | NO   |     | NULL    |                |
| suggestions          | text         | YES  |     | NULL    |                |
| dimensions           | json         | YES  |     | NULL    |                |
| empty_regions        | json         | YES  |     | NULL    |                |
| categorized_keywords | longtext     | YES  |     | NULL    |                |
| content_regions      | json         | YES  |     | NULL    |                |
| keyword_matches      | longtext     | YES  |     | NULL    |                |
+----------------------+--------------+------+-----+---------+----------------+

 2.后端库更新

 ```
pip install packaging
pip install transformers
pip install torch pillow numpy safetensors
pip install openai
pip install python-dotenv
```

# 更新

images表有修改

```
ALTER TABLE zhihui_db.images ADD image_url varchar(500) NOT NULL;
ALTER TABLE zhihui_db.images DROP COLUMN evaluation;
ALTER TABLE zhihui_db.images DROP COLUMN improvements;
ALTER TABLE zhihui_db.images ADD suggestions TEXT NULL;
ALTER TABLE zhihui_db.images ADD dimensions json NULL;
```

增加雷达图

```
npm install chart.js react-chartjs-2
```

# 项目介绍

# 环境依赖

# 目录结构

```
zhihui
├─ backend
│  ├─ app.py
│  ├─ requirement.txt
│  └─ zhihui
│     ├─ api
│     │  ├─ image.py
│     │  └─ user.py
│     ├─ models
│     ├─ utils
│     │  ├─ database.py
│     │  ├─ VLM_api.py
│     │  └─ __init__.py
│     └─ __init__.py
├─ frontend
│  ├─ .eslintrc.cjs
│  ├─ index.html
│  ├─ package-lock.json
│  ├─ package.json
│  ├─ public
│  ├─ src
│  │  ├─ App.css
│  │  ├─ App.tsx
│  │  ├─ auth
│  │  │  ├─ AuthProvider.tsx
│  │  │  ├─ Login.tsx
│  │  │  └─ Register.tsx
│  │  ├─ index.css
│  │  └─ main.tsx
│  ├─ tsconfig.json
│  └─ tsconfig.node.json
└─ ReadMe.md
```



# 使用说明

- 前端环境配置
  1. 如果没有安装Node.js：https://nodejs.org/下载和安装
  2. 打开命令行工具，输入node -v和npm -v确认安装成功
  3. 在命令行工具中，进入frontend所在文件夹，输入``npm install``

- 后端环境配置（虚拟环境）
  1. 打开命令行工具，进入backend所在文件夹
  2. ``python -m venv venv`` ，venv是虚拟环境，python环境依赖的包都会保存在该文件夹中
  3. ``cd venv/Scripts`` 
  4. ``activate`` ,激活虚拟环境（``deactivate``可以退出虚拟环境）
  5. ``pip install -r requirement.txt`` ，安装所有依赖，如果不成功可以接入镜像源，``pip install -r server\zhihui\backend\requirement.txt -i https://pypi.tuna.tsinghua.edu.cn/simple``

- 数据库MySQL

  1. 下载安装MySQL，https://dev.mysql.com/downloads/mysql/（选中间的那个下载）

  2. 解压之后把bin所在的文件路径添加到环境变量里

     ![image-20250920181843013](C:\Users\lenovo\AppData\Roaming\Typora\typora-user-images\image-20250920181843013.png)

  3. 新建一个my.ini文件

     ![image-20250920181902658](C:\Users\lenovo\AppData\Roaming\Typora\typora-user-images\image-20250920181902658.png)

  4. ```
     [mysqld]
     basedir=D:\MySQL\mysql-9.4.0-winx64\
     datadir=D:\MySQL\mysql-9.4.0-winx64\data\
     port=3306
     ```

     编辑my.ini文件，其中路径换成自己的（basedir和datadir）

  5. 以管理员身份运行cmd，先切换到bin目录，输入``mysqld -install``

  6. ``mysqld --initialize-insecure --user=mysql``

  7. ``net start mysql``

  8. ``mysql -u root -p``，让输入密码直接回车

  9. ``ALTER USER 'root'@'localhost' IDENTIFIED WITH caching_sha2_password BY '你的密码';``设置你的密码

  10. 重启一下：``exit``

      ``net stop mysql``

      ``net start mysql``

  11. ``mysql -u root -p``，然后输入刚刚设置的密码
  12. 创建MySQL数据库和表

  ```
   CREATE DATABASE zhihui_db;
   USE zhihui_db;
   CREATE TABLE users(
      -> id INT AUTO_INCREMENT PRIMARY KEY,
      -> username VARCHAR(50) UNIQUE NOT NULL,
      -> password VARCHAR(255) NOT NULL,
      -> created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );
   CREATE TABLE images (
    -> id INT AUTO_INCREMENT PRIMARY KEY,
      -> user_id INT NOT NULL,
    -> filename VARCHAR(255) NOT NULL,
      -> original_name VARCHAR(255) NOT NULL,
      -> score INT,
      -> evaluation TEXT,
      ->strengths TEXT,
      ->improvements TEXT,
      -> upload_time DATETIME NOT NULL,
      -> FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  ```

  ``describe users``,``describe images``，两张表的结构如下所示

  ![image-20250917154249499](C:\Users\lenovo\AppData\Roaming\Typora\typora-user-images\image-20250917154249499.png)

  ![image-20250917170125091](C:\Users\lenovo\AppData\Roaming\Typora\typora-user-images\image-20250917170125091.png)

  

- 运行
  1. \_\_init\_\_.py中的MySQL的配置密码记得改成自己设置的密码
  2. 运行app.py
  3. 在命令提示符中，进入frontend文件夹，输入``npm run dev``,就可以运行了