document.addEventListener('DOMContentLoaded', function() {
    // 获取DOM元素
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const loginFormContainer = document.getElementById('loginFormContainer');
    const registerFormContainer = document.getElementById('registerFormContainer');
    const authContainer = document.getElementById('authContainer');
    const userPanel = document.getElementById('userPanel');
    const messageEl = document.getElementById('message');
    const showRegisterLink = document.getElementById('showRegister');
    const showLoginLink = document.getElementById('showLogin');
    const logoutBtn = document.getElementById('logoutBtn');
    const userUsernameEl = document.getElementById('userUsername');
    const userCreatedAtEl = document.getElementById('userCreatedAt');
    
    const API_BASE_URL = 'http://localhost:5000';
    
    // 检查是否已登录
    checkAuthStatus();
    
    // 显示注册表单
    showRegisterLink.addEventListener('click', function(e) {
        e.preventDefault();
        loginFormContainer.style.display = 'none';
        registerFormContainer.style.display = 'block';
        clearMessage();
    });
    
    // 显示登录表单
    showLoginLink.addEventListener('click', function(e) {
        e.preventDefault();
        registerFormContainer.style.display = 'none';
        loginFormContainer.style.display = 'block';
        clearMessage();
    });
    
    // 登录表单提交
    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const username = document.getElementById('loginUsername').value;
        const password = document.getElementById('loginPassword').value;
        
        try {
            const response = await fetch(`${API_BASE_URL}/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                // 登录成功，保存token和用户信息
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                showMessage('登录成功！', 'success');
                showUserPanel();
                loadUserInfo();
            } else {
                showMessage(data.message, 'error');
            }
        } catch (error) {
            showMessage('网络错误，请稍后再试', 'error');
        }
    });
    
    // 注册表单提交
    registerForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const username = document.getElementById('regUsername').value;
        const password = document.getElementById('regPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        
        // 客户端验证
        if (password !== confirmPassword) {
            showMessage('两次输入的密码不一致', 'error');
            return;
        }
        
        if (password.length < 6) {
            showMessage('密码长度至少6位', 'error');
            return;
        }
        
        if (username.length < 3 || username.length > 20) {
            showMessage('用户名长度需在3-20个字符之间', 'error');
            return;
        }
        
        try {
            const response = await fetch(`${API_BASE_URL}/signin`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password, confirm_password: confirmPassword })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                showMessage(data.message, 'success');
                // 自动切换到登录表单
                setTimeout(() => {
                    showLoginLink.click();
                    document.getElementById('loginUsername').value = username;
                    document.getElementById('loginPassword').value = '';
                }, 1500);
            } else {
                showMessage(data.message, 'error');
            }
        } catch (error) {
            showMessage('网络错误，请稍后再试', 'error');
        }
    });
    
    
    // 退出登录
    logoutBtn.addEventListener('click', function() {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        authContainer.style.display = 'block';
        userPanel.style.display = 'none';
        showMessage('已退出登录', 'success');
    });
    
    // 检查认证状态
    async function checkAuthStatus() {
        const token = localStorage.getItem('token');
        const user = localStorage.getItem('user');
        
        if (token && user) {
            // 验证token是否有效
            try {
                const response = await fetch(`${API_BASE_URL}/me`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    showUserPanel();
                    displayUserInfo(data.user);
                } else {
                    // token无效或过期
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                    showAuthForm();
                }
            } catch (error) {
                console.error('验证token失败:', error);
                showAuthForm();
            }
        } else {
            showAuthForm();
        }
    }
    
    // 加载用户信息
    async function loadUserInfo() {
        const token = localStorage.getItem('token');
        
        if (!token) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/me`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                displayUserInfo(data.user);
            }
        } catch (error) {
            console.error('加载用户信息失败:', error);
        }
    }
    
    // 显示用户信息
    function displayUserInfo(user) {
        userUsernameEl.textContent = user.username;
        userCreatedAtEl.textContent = new Date(user.created_at+'Z').toLocaleString();
        console.log(userUsernameEl.textContent);
    }
    
    // 显示用户面板
    function showUserPanel() {
        authContainer.style.display = 'none';
        userPanel.style.display = 'block';
    }
    
    // 显示认证表单
    function showAuthForm() {
        authContainer.style.display = 'block';
        userPanel.style.display = 'none';
        loginFormContainer.style.display = 'block';
        registerFormContainer.style.display = 'none';
    }
    
    // 显示消息
    function showMessage(message, type) {
        messageEl.textContent = message;
        messageEl.className = `message ${type}`;
        
        // 5秒后自动消失
        setTimeout(() => {
            clearMessage();
        }, 5000);
    }
    
    // 清除消息
    function clearMessage() {
        messageEl.textContent = '';
        messageEl.className = 'message';
    }
});