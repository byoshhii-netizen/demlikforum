// ===== TOAST =====
function toast(msg, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; t.style.transition = '0.3s'; setTimeout(() => t.remove(), 300); }, 3500);
}

// ===== API HELPER =====
async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
    body: options.body && typeof options.body === 'object' && !(options.body instanceof FormData)
      ? JSON.stringify(options.body)
      : options.body
  });
  if (options.body instanceof FormData) {
    delete options.headers?.['Content-Type'];
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Hata oluştu');
  return data;
}

// ===== SESSION =====
let currentUser = null;

async function loadSession() {
  try {
    currentUser = await (await fetch('/api/ben')).json();
  } catch { currentUser = { loggedIn: false }; }
  return currentUser;
}

// ===== SIDEBAR RENDER =====
async function renderSidebar(activePage = '') {
  const user = await loadSession();

  const sidebarEl = document.getElementById('sidebar');
  if (!sidebarEl) return;

  const navItems = [
    { href: '/', icon: '🏠', label: 'Ana Sayfa', key: 'anasayfa' },
    { href: '/magazin', icon: '🛒', label: 'Store', key: 'magazin' },
    { href: '/kutuphane', icon: '📚', label: 'Kütüphane', key: 'kutuphane', authRequired: true },
    { href: '/arkadaslar', icon: '👥', label: 'Arkadaşlar', key: 'arkadaslar', authRequired: true },
  ];

  let navHTML = navItems.map(item => {
    if (item.authRequired && !user.loggedIn) return '';
    return `<a href="${item.href}" class="nav-item ${activePage === item.key ? 'active' : ''}">
      <span class="nav-icon">${item.icon}</span>${item.label}
    </a>`;
  }).join('');

  // Geliştirici paneli
  let devSection = '';
  if (user.loggedIn && user.role === 'developer') {
    devSection = `
      <div class="nav-section-title">Geliştirici</div>
      <a href="/gelistirici/dashboard" class="nav-item ${activePage === 'dev-dashboard' ? 'active' : ''}">
        <span class="nav-icon">📊</span>Dashboard
      </a>
      <a href="/gelistirici/oyun-yukle" class="nav-item ${activePage === 'dev-upload' ? 'active' : ''}">
        <span class="nav-icon">⬆️</span>Oyun Yükle
      </a>
    `;
  }

  // Admin paneli
  let adminSection = '';
  if (user.loggedIn && user.role === 'admin') {
    adminSection = `
      <div class="nav-section-title">Admin</div>
      <a href="/admin" class="nav-item ${activePage === 'admin' ? 'active' : ''}">
        <span class="nav-icon">⚙️</span>Admin Panel
      </a>
    `;
  }

  // Kullanıcı bilgisi altbölüm
  let userSection = '';
  if (user.loggedIn) {
    const initial = user.username?.[0]?.toUpperCase() || '?';
    const avatarHtml = user.avatar_url
      ? `<img src="${user.avatar_url}" alt="">`
      : initial;
    const roleLabel = user.role === 'admin' ? 'Admin' : user.role === 'developer' ? 'Geliştirici' : 'Kullanıcı';
    const pendingBadge = user.devApplicationStatus === 'pending'
      ? '<span class="dev-pending-badge">İncelemede</span>' : '';
    userSection = `
      <a href="/profil/${user.username}" class="sidebar-user">
        <div class="user-avatar">${avatarHtml}</div>
        <div class="user-info">
          <div class="user-name">${user.username}</div>
          <div class="user-role">${roleLabel}</div>
        </div>
        ${pendingBadge}
      </a>
      <a href="/ayarlar" class="nav-item"><span class="nav-icon">⚙️</span>Ayarlar</a>
      <div class="nav-item" onclick="cikisYap()"><span class="nav-icon">🚪</span>Çıkış Yap</div>
    `;
  } else {
    userSection = `
      <a href="/giris" class="btn btn-primary btn-full" style="margin-bottom:8px">Giriş Yap</a>
      <a href="/kayit" class="btn btn-secondary btn-full">Kayıt Ol</a>
    `;
  }

  sidebarEl.innerHTML = `
    <div class="sidebar-logo">
      <div>
        <div class="logo-text">Demlik</div>
        <div class="logo-sub">Platform</div>
      </div>
    </div>
    <nav class="sidebar-nav">
      <div class="nav-section-title">Menü</div>
      ${navHTML}
      ${devSection}
      ${adminSection}
    </nav>
    <div class="sidebar-bottom">${userSection}</div>
  `;
}

async function cikisYap() {
  await fetch('/api/auth/cikis', { method: 'POST' });
  window.location.href = '/';
}

// ===== FORMAT =====
function formatPrice(price, isFree) {
  if (isFree || !price || price == 0) return '<span style="color:#27ae60;font-weight:700">Ücretsiz</span>';
  return `<span style="color:var(--red-primary);font-weight:700">₺${parseFloat(price).toFixed(2)}</span>`;
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Az önce';
  if (mins < 60) return `${mins} dakika önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} saat önce`;
  const days = Math.floor(hours / 24);
  return `${days} gün önce`;
}
