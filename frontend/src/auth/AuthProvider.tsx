// src/auth/AuthProvider.tsx
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import axios from 'axios';

interface User {
  id: string;
  username: string;
  created_at: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// 同步读取 localStorage 中的 token，立即设置 axios defaults（避免刷新时 race）
const initialToken = localStorage.getItem('token');
// axios.defaults.baseURL = 'http://localhost:5000';
if (initialToken) {
  axios.defaults.headers.common['Authorization'] = `Bearer ${initialToken}`;
} else {
  delete axios.defaults.headers.common['Authorization'];
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(initialToken);
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });
  const [isAuthenticated, setIsAuthenticated] = useState(!!initialToken);
  const [isLoading, setIsLoading] = useState(true);

  // 初始化认证状态（更宽松：只要有 token 就验证并尝试获取 user）
  useEffect(() => {
    const initializeAuth = async () => {
      const savedToken = localStorage.getItem('token');
      if (!savedToken) {
        setIsLoading(false);
        return;
      }
      try {
        // 先设置默认 header 以便后续请求使用
        axios.defaults.headers.common['Authorization'] = `Bearer ${savedToken}`;
        const isValid = await validateToken(savedToken);
        if (!isValid) {
          // token 无效 -> 清理
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setToken(null);
          setUser(null);
          setIsAuthenticated(false);
          delete axios.defaults.headers.common['Authorization'];
        } else {
          setToken(savedToken);
          setIsAuthenticated(true);
          // 若本地没有 user 信息，尝试请求 /user/me 获取并缓存
          if (!localStorage.getItem('user')) {
            try {
              const me = await axios.get('/user/me');
              setUser(me.data);
              localStorage.setItem('user', JSON.stringify(me.data));
            } catch (err) {
              // 若取 user 失败，不影响已登录状态，但清空 user
              setUser(null);
            }
          } else {
            setUser(JSON.parse(localStorage.getItem('user') as string));
          }
        }
      } catch (error) {
        console.error('initializeAuth error:', error);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        delete axios.defaults.headers.common['Authorization'];
        setToken(null);
        setUser(null);
        setIsAuthenticated(false);
      }
     }
 
     // 初始化
     initializeAuth().finally(() => setIsLoading(false));
   }, []);
 
   // 请求拦截器
   useEffect(() => {
     const requestInterceptor = axios.interceptors.request.use(
       (config) => {
        // 确保 headers 对象存在再写入
        config.headers = config.headers || {};
        const currentToken = localStorage.getItem('token');
        if (currentToken) {
          config.headers.Authorization = `Bearer ${currentToken}`;
        }
         return config;
       },
       (error) => Promise.reject(error)
     );
 
     return () => {
       axios.interceptors.request.eject(requestInterceptor);
     };
   }, []);
 
   const login = async (newToken: string, newUser: User) => {
     try {
       setToken(newToken);
       setUser(newUser);
       setIsAuthenticated(true);
       localStorage.setItem('token', newToken);
       localStorage.setItem('user', JSON.stringify(newUser));
       axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
     } catch (error) {
       console.error('Login failed:', error);
       logout();
       throw error;
     }
   };
 
   // 响应拦截器 - 处理认证错误
   useEffect(() => {
     const responseInterceptor = axios.interceptors.response.use(
       (response) => response,
       (error) => {
         if (error.response?.status === 401) {
           console.log('Token已失效，自动登出');
           logout();
         }
         return Promise.reject(error);
       }
     );
 
     return () => {
       axios.interceptors.response.eject(responseInterceptor);
     };
   }, []);
 
   const logout = () => {
     setToken(null);
     setUser(null);
     setIsAuthenticated(false);
     localStorage.removeItem('token');
     localStorage.removeItem('user');
     delete axios.defaults.headers.common['Authorization'];
   };
 
   const value = {
     user,
     token,
     isAuthenticated,
     isLoading,
     login,
     logout,
   };
 
   return (
     <AuthContext.Provider value={value}>
       {children}
     </AuthContext.Provider>
   );
 };
 
 // 辅助函数：验证token有效性
 async function validateToken(token: string): Promise<boolean> {
   try {
     const response = await axios.get('/user/me', {
       headers: { Authorization: `Bearer ${token}` }
     });
     return response.status === 200;
   } catch (error: any) {
     console.error('Token验证失败:', error.response?.data || error.message);
     return false;
   }
 }