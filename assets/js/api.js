const API_BASE = 'https://webboard-project.onrender.com/api';

const api = {
  getToken: () => localStorage.getItem('token'),
  getUser: () => JSON.parse(localStorage.getItem('user') || 'null'),
  isLoggedIn: () => !!localStorage.getItem('token'),
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = 'login.html';
  },
  headers: () => ({
    'Content-Type': 'application/json',
    ...(localStorage.getItem('token') ? { 'Authorization': `Bearer ${localStorage.getItem('token')}` } : {})
  }),
  async request(method, path, body = null) {
    const opts = { method, headers: api.headers() };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(API_BASE + path, opts);
    const data = await res.json();
    if (!res.ok) throw { status: res.status, message: data.message || 'เกิดข้อผิดพลาด' };
    return data;
  },
  get: (path) => api.request('GET', path),
  post: (path, body) => api.request('POST', path, body),
  put: (path, body) => api.request('PUT', path, body),
  delete: (path) => api.request('DELETE', path),

  // Follow
  follow: (userId) => api.request('POST', `/users/${userId}/follow`),
  followStatus: (userId) => api.request('GET', `/users/${userId}/follow-status`),
  followers: (userId) => api.request('GET', `/users/${userId}/followers`),

  // Bookmark
  bookmark: (postId) => api.request('POST', `/posts/${postId}/bookmark`),
  getBookmarks: () => api.request('GET', '/bookmarks'),

  // Post with FormData (multipart)
  postForm: (path, formData) => {
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: formData
    }).then(r => r.json());
  },
  putForm: (path, formData) => {
    return fetch(API_BASE + path, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: formData
    }).then(r => r.json());
  },
};