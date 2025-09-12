# 项目介绍

# 环境依赖

# 目录结构

```
zhihui
├─ ReadMe.md				//帮助文档
├─ backend
│  ├─ app.py				//目前只实现了注册登录
│  └─ requirement.txt		//python依赖包
├─ checkdb.py				//检查数据库的内容（目前只有用户信息）
└─ frontend					//ai写的前端，主要测试注册登录功能的，无需在意
   ├─ css
   │  └─ style.css
   ├─ index.html
   └─ js
      └─ auth.js
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