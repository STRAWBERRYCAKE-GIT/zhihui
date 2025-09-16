# 项目介绍

# 环境依赖

# 目录结构

```
zhihui
├─ backend
│  ├─ app.py
│  ├─ requirement.txt
│  └─ zhihui
│     ├─ models
│     ├─ views
│     │  └─ user.py
│     └─ __init__.py
├─ checkdb.py
├─ frontend
│  ├─ css
│  │  └─ style.css
│  ├─ images
│  ├─ index.html
│  └─ js
│     └─ auth.js
└─ ReadMe.md
```



# 使用说明

- python虚拟环境（不用也行，但感觉用会方便一些），参考链接如下<https://blog.csdn.net/weixin_38256474/article/details/81289702?fromshare=blogdetail&sharetype=blogdetail&sharerId=81289702&sharerefer=PC&sharesource=2303_80145979&sharefrom=from_link>
  1. cmd进入当前目录
  2. ``python -m venv venv`` ，venv是虚拟环境，python环境依赖的包都会保存在该文件夹中
  3. ``cd venv/Scripts`` 
  4. ``activate`` ,激活虚拟环境
  5. ``pip install -r requirement.txt`` ，安装所有依赖

 - 目前实现的api
   1. 注册：register
   2. 登录：login
   3. 获取用户信息：me

- MySQL

  1. 创建MySQL数据库和表（后续应该是要改）

     ```
      CREATE DATABASE zhihui_db;
      USE zhihui_db;
      CREATE TABLE users(
         -> id INT AUTO_INCREMENT PRIMARY KEY,
         -> username VARCHAR(50) UNIQUE NOT NULL,
         -> password VARCHAR(120) NOT NULL,
         -> created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
     ```

     

  2. \_\_init\_\_.py中的MySQL配置要改成本地的