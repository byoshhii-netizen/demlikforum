/* ===== TOAST ===== */
function toast(msg, type = 'info') {
  let c = document.querySelector('.toast-container');
  if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => {
    t.style.cssText = 'opacity:0;transform:translateX(16px);transition:0.3s';
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

/* ===== API HELPER ===== */
async function api(url, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = isFormData ? {} : { 'Content-Type': 'application/json', ...options.headers };
  const res = await fetch(url, {
    ...options,
    headers,
    body: (!isFormData && options.body && typeof options.body === 'object')
      ? JSON.stringify(options.body)
      : options.body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Bir hata oluştu');
  return data;
}

/* ===== SESSION ===== */
let currentUser = null;

async function loadSession() {
  if (currentUser) return currentUser;
  try { currentUser = await (await fetch('/api/ben')).json(); }
  catch { currentUser = { loggedIn: false }; }
  return currentUser;
}

/* ===== SIDEBAR ===== */
async function renderSidebar(activePage = '') {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const user = await loadSession();

  const navItem = (href, icon, label, key, badge = '') => {
    const isActive = activePage === key;
    return `<a href="${href}" class="nav-item ${isActive ? 'active' : ''}">
      <i class="fa-solid ${icon}"></i>
      <span>${label}</span>
      ${badge ? `<span class="nav-badge">${badge}</span>` : ''}
    </a>`;
  };

  let devSection = '';
  if (user.loggedIn && (user.role === 'developer' || user.role === 'admin')) {
    devSection = `
      <div class="nav-section">Geliştirici</div>
      ${navItem('/gelistirici/dashboard', 'fa-chart-line', 'Dashboard', 'dev-dashboard')}
      ${navItem('/gelistirici/oyun-yukle', 'fa-upload', 'Oyun Yükle', 'dev-upload')}
    `;
  }

  let adminSection = '';
  if (user.loggedIn && user.role === 'admin') {
    adminSection = `
      <div class="nav-section">Yönetim</div>
      ${navItem('/admin', 'fa-shield-halved', 'Admin Panel', 'admin')}
    `;
  }

  let bottomHtml = '';
  if (user.loggedIn) {
    const initial = (user.username || '?')[0].toUpperCase();
    const avatarHtml = user.avatar_url
      ? `<img src="${user.avatar_url}" alt="">`
      : initial;
    const roleLabel = { admin: 'Yönetici', developer: 'Geliştirici', user: 'Kullanıcı' }[user.role] || 'Kullanıcı';
    const pendingDot = user.devApplicationStatus === 'pending' ? '<span class="pending-dot"></span>' : '';

    bottomHtml = `
      <a href="/profil/${user.username}" class="sidebar-user">
        <div class="user-avatar">${avatarHtml}</div>
        <div class="user-info">
          <div class="user-name">${user.username}</div>
          <div class="user-role">${roleLabel}</div>
        </div>
        ${pendingDot}
      </a>
      ${navItem('/ayarlar', 'fa-gear', 'Ayarlar', 'settings')}
      <div class="nav-item" onclick="cikisYap()" style="cursor:pointer">
        <i class="fa-solid fa-right-from-bracket"></i>
        <span>Çıkış Yap</span>
      </div>
    `;
  } else {
    bottomHtml = `
      <a href="/giris" class="btn btn-primary btn-full" style="margin-bottom:8px;justify-content:center">
        <i class="fa-solid fa-right-to-bracket"></i> Giriş Yap
      </a>
      <a href="/kayit" class="btn btn-ghost btn-full" style="justify-content:center">
        <i class="fa-solid fa-user-plus"></i> Kayıt Ol
      </a>
    `;
  }

  sidebar.innerHTML = `
    <div class="sidebar-logo">
      <div class="logo-icon"><i class="fa-solid fa-fire"></i></div>
      <div class="logo-text-wrap">
        <div class="logo-name">Demlik</div>
        <div class="logo-sub">Platform</div>
      </div>
    </div>
    <nav class="sidebar-nav">
      <div class="nav-section">Ana Menü</div>
      ${navItem('/', 'fa-house', 'Ana Sayfa', 'anasayfa')}
      ${navItem('/magazin', 'fa-store', 'Store', 'magazin')}
      ${user.loggedIn ? navItem('/kutuphane', 'fa-book', 'Kütüphane', 'kutuphane') : ''}
      ${user.loggedIn ? navItem('/arkadaslar', 'fa-user-group', 'Arkadaşlar', 'arkadaslar') : ''}
      ${devSection}
      ${adminSection}
    </nav>
    <div class="sidebar-bottom">${bottomHtml}</div>
  `;
}

async function cikisYap() {
  await fetch('/api/auth/cikis', { method: 'POST' });
  currentUser = null;
  window.location.href = '/';
}

/* ===== HELPERS ===== */
function timeAgo(d) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Az önce';
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.floor(h / 24)} gün önce`;
}

function fmtPrice(price, isFree) {
  if (isFree || !price || price == 0) return '<span style="color:#27ae60;font-weight:700">Ücretsiz</span>';
  return `<span style="color:var(--red-bright);font-weight:700">₺${parseFloat(price).toFixed(2)}</span>`;
}

function gameCardHTML(g) {
  return `
    <div class="game-card" onclick="location.href='/oyun/${g.id}'">
      <div class="game-card-banner">
        <img src="${g.banner_urls?.[0] || ''}" alt="${g.title}" loading="lazy" onerror="this.style.display='none'">
        <div class="game-card-overlay"></div>
        ${g.logo_url ? `<div class="game-card-logo"><img src="${g.logo_url}" alt=""></div>` : ''}
      </div>
      <div class="game-card-body">
        <div class="game-card-title">${g.title}</div>
        <div class="game-card-genre">${g.genre_name || 'Genel'}</div>
        <div class="game-card-footer">
          <div class="game-card-price ${g.is_free ? 'free' : 'paid'}">${g.is_free ? 'Ücretsiz' : '₺' + parseFloat(g.price || 0).toFixed(2)}</div>
          <div class="game-card-dl"><i class="fa-solid fa-download" style="font-size:9px"></i>${g.download_count || 0}</div>
        </div>
      </div>
    </div>`;
}
