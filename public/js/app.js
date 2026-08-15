/**
 * منطق فرانت‌اند داشبورد مدیریت «دیزاینو وی پی ان» (Dizyno VPN Panel)
 */

let globalUsersList = [];
let globalSettings = {};

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initApp();

  // فرم راه‌اندازی اولیه
  document.getElementById('setupForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('setupUsername').value;
    const password = document.getElementById('setupPassword').value;
    const cleanIp = document.getElementById('setupCleanIp').value;
    await setupInitial(username, password, cleanIp);
  });

  // فرم ورود
  document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    await login(username, password);
  });

  // فرم ساخت کاربر جدید
  document.getElementById('createUserForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await createUser();
  });

  // فرم ویرایش کاربر
  document.getElementById('editUserForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await updateUser();
  });

  // فرم تغییر تنظیمات عمومی
  document.getElementById('settingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await changeSettings();
  });

  // فرم تنظیمات تلگرام
  document.getElementById('telegramForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveTelegramSettings();
  });

  // رویدادهای جستجو و فیلتر کاربران
  document.getElementById('userSearchInput')?.addEventListener('input', renderUsersTable);
  document.getElementById('userFilterSelect')?.addEventListener('change', renderUsersTable);
});

// توابع مدیریت پیام‌ها
function showToast(message, type = 'success') {
  const toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) return;

  const toastId = 'toast-' + Math.random().toString(36).substring(2);
  const bgClass = type === 'success' ? 'bg-success text-white' : 'bg-danger text-white';
  
  const toastHtml = `
    <div id="${toastId}" class="toast align-items-center ${bgClass} border-0 show" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="d-flex">
        <div class="toast-body">
          <i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'} me-2"></i>
          ${message}
        </div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    </div>
  `;
  
  toastContainer.insertAdjacentHTML('beforeend', toastHtml);
  setTimeout(() => {
    document.getElementById(toastId)?.remove();
  }, 4000);
}

// بررسی راه‌اندازی اولیه و احراز هویت
async function initApp() {
  try {
    const setupRes = await fetch('/api/setup-status');
    const setupData = await setupRes.json();

    if (!setupData.isConfigured) {
      // اگر پنل راه‌اندازی اولیه نشده است
      document.getElementById('setupSection').classList.remove('d-none');
      document.getElementById('loginSection').classList.add('d-none');
      document.getElementById('dashboardSection').classList.add('d-none');
      return;
    } else {
      document.getElementById('setupSection').classList.add('d-none');
    }

    // بررسی ورود ادمین
    const authRes = await fetch('/api/check-auth');
    const authData = await authRes.json();

    if (authData.success) {
      globalSettings = authData.settings || {};
      document.getElementById('loginSection').classList.add('d-none');
      document.getElementById('dashboardSection').classList.remove('d-none');
      document.getElementById('adminNameDisplay').innerText = authData.username;
      
      populateSettingsModal();
      await loadDashboardData();
      await loadCleanIpsModal();
    } else {
      document.getElementById('loginSection').classList.remove('d-none');
      document.getElementById('dashboardSection').classList.add('d-none');
    }
  } catch (err) {
    document.getElementById('loginSection').classList.remove('d-none');
    document.getElementById('dashboardSection').classList.add('d-none');
  }
}

// راه‌اندازی اولیه سرور
async function setupInitial(username, password, cleanIp) {
  try {
    const res = await fetch('/api/setup-initial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, cleanIp })
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, 'success');
      await initApp();
    } else {
      showToast(data.message, 'error');
    }
  } catch (e) {
    showToast('خطا در ثبت اطلاعات راه‌اندازی اولیه.', 'error');
  }
}

// ورود به سیستم
async function login(username, password) {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, 'success');
      await initApp();
    } else {
      showToast(data.message, 'error');
    }
  } catch (err) {
    showToast('خطا در برقراری ارتباط با سرور.', 'error');
  }
}

// خروج از حساب
async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST' });
    showToast('از سیستم خارج شدید.', 'success');
    initApp();
  } catch (e) {
    location.reload();
  }
}

// بارگذاری داده‌های داشبورد
async function loadDashboardData() {
  await Promise.all([loadStats(), loadUsers()]);
}

// دریافت آمار
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    if (data.success) {
      document.getElementById('statTotalUsers').innerText = data.stats.totalUsers;
      document.getElementById('statActiveUsers').innerText = data.stats.activeUsers;
      
      const totalGB = (data.stats.totalLimitBytes / (1024 * 1024 * 1024)).toFixed(1);
      const usedGB = (data.stats.totalUsedBytes / (1024 * 1024 * 1024)).toFixed(2);

      document.getElementById('statTotalLimit').innerText = totalGB > 0 ? `${totalGB} گیگابایت` : 'نامحدود';
      document.getElementById('statTotalUsed').innerText = `${usedGB} گیگابایت`;
    }
  } catch (e) {}
}

// دریافت کاربران
async function loadUsers() {
  try {
    const res = await fetch('/api/users');
    const data = await res.json();
    if (data.success) {
      globalUsersList = data.users || [];
      renderUsersTable();
    }
  } catch (e) {
    showToast('خطا در بارگذاری لیست کاربران.', 'error');
  }
}

// رندر جدول کاربران با قابلیت جستجو و فیلتر
function renderUsersTable() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  const searchQuery = (document.getElementById('userSearchInput')?.value || '').toLowerCase().trim();
  const filterStatus = document.getElementById('userFilterSelect')?.value || 'all';

  const host = window.location.host;
  const protocol = window.location.protocol;
  const today = new Date().toISOString().split('T')[0];

  let filteredUsers = globalUsersList.filter(u => {
    // فیلتر متنی
    const matchSearch = u.name.toLowerCase().includes(searchQuery) || u.uuid.toLowerCase().includes(searchQuery);
    
    // فیلتر وضعیت
    let isExpiredOrLimit = (u.expireDate && u.expireDate < today) || (u.limitBytes > 0 && u.usedBytes >= u.limitBytes);
    let userStatus = u.status;
    if (userStatus === 'active' && isExpiredOrLimit) userStatus = 'expired';

    if (filterStatus === 'all') return matchSearch;
    if (filterStatus === 'active') return matchSearch && userStatus === 'active';
    if (filterStatus === 'expired') return matchSearch && userStatus === 'expired';
    if (filterStatus === 'disabled') return matchSearch && userStatus === 'disabled';
    return matchSearch;
  });

  tbody.innerHTML = '';

  if (filteredUsers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-5" style="background: var(--bg-card) !important;">
          <div class="p-4 rounded-4 d-inline-block" style="background: rgba(56, 189, 248, 0.05); border: 1px dashed rgba(56, 189, 248, 0.25);">
            <i class="fa-solid fa-folder-open fs-1 text-info d-block mb-3 opacity-75"></i>
            <span class="fw-bold text-white fs-6">هیچ کاربری یافت نشد.</span>
            <p class="text-slate-300 small mb-0 mt-1">برای اضافه کردن کاربر جدید روی دکمه "ایجاد کاربر جدید" کلیک کنید.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  filteredUsers.forEach((u, index) => {
    const usedGB = (u.usedBytes / (1024 * 1024 * 1024)).toFixed(2);
    const limitGB = u.limitBytes > 0 ? (u.limitBytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB' : 'نامحدود';
    
    let statusBadge = `<span class="badge-status badge-active"><i class="fa-solid fa-check me-1"></i> فعال</span>`;
    if (u.status === 'disabled') {
      statusBadge = `<span class="badge-status badge-disabled"><i class="fa-solid fa-ban me-1"></i> غیرفعال</span>`;
    } else if (u.expireDate && u.expireDate < today) {
      statusBadge = `<span class="badge-status badge-expired"><i class="fa-solid fa-clock me-1"></i> منقضی</span>`;
    } else if (u.limitBytes > 0 && u.usedBytes >= u.limitBytes) {
      statusBadge = `<span class="badge-status badge-expired"><i class="fa-solid fa-database me-1"></i> حجم تمام‌شده</span>`;
    }

    let expireText = 'نامحدود';
    if (u.expireDate) {
      const diffDays = Math.ceil((new Date(u.expireDate) - new Date()) / (1024 * 60 * 60 * 24));
      expireText = diffDays > 0 ? `${diffDays} روز باقی‌مانده` : 'منقضی شده';
    }

    let percent = 0;
    if (u.limitBytes > 0) {
      percent = Math.min(100, Math.round((u.usedBytes / u.limitBytes) * 100));
    }

    const subUrl = `${protocol}//${host}/sub/${u.uuid}`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="fw-bold">${index + 1}</td>
      <td>
        <div class="fw-bold text-white">${u.name}</div>
        <div class="small text-muted font-monospace" style="font-size: 0.75rem">${u.uuid.substring(0, 13)}...</div>
      </td>
      <td>${statusBadge}</td>
      <td>
        <div><strong class="text-info">${usedGB} GB</strong> / <span class="text-muted">${limitGB}</span></div>
        ${u.limitBytes > 0 ? `<div class="progress mt-1" style="height: 6px;"><div class="progress-bar bg-info" style="width: ${percent}%"></div></div>` : ''}
      </td>
      <td>
        <div class="small fw-bold ${expireText === 'منقضی شده' ? 'text-danger' : 'text-warning'}">${expireText}</div>
        ${u.expireDate ? `<div class="small text-muted" style="font-size: 0.75rem">تا ${u.expireDate}</div>` : ''}
      </td>
      <td>
        <div class="d-flex gap-1 justify-content-center">
          <button class="btn btn-sm btn-outline-info btn-action" onclick="copyToClipboard('${subUrl}', 'لینک ساب کپی شد!')" title="کپی لینک ساب (Subscription)">
            <i class="fa-solid fa-link"></i>
          </button>
          <button class="btn btn-sm btn-outline-success btn-action" onclick="openUserSubPage('${subUrl}')" title="مشاهده صفحه ساب کاربر">
            <i class="fa-solid fa-eye"></i>
          </button>
          <button class="btn btn-sm btn-outline-warning btn-action" onclick="resetUserTraffic('${u.id}')" title="صفر کردن ترافیک مصرفی">
            <i class="fa-solid fa-rotate"></i>
          </button>
          <button class="btn btn-sm btn-outline-primary btn-action" onclick="openEditUserModal('${u.id}', '${u.name}', '${u.limitBytes ? u.limitBytes / (1024*1024*1024) : 0}', '${u.expireDate || ''}', '${u.status}')" title="ویرایش">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger btn-action" onclick="deleteUser('${u.id}', '${u.name}')" title="حذف">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ساخت کاربر جدید
async function createUser() {
  const name = document.getElementById('newUserName').value;
  const limitGB = document.getElementById('newUserLimitGB').value;
  const expireDays = document.getElementById('newUserExpireDays').value;

  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, limitGB, expireDays })
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, 'success');
      bootstrap.Modal.getInstance(document.getElementById('createUserModal'))?.hide();
      document.getElementById('createUserForm').reset();
      loadDashboardData();
    } else {
      showToast(data.message, 'error');
    }
  } catch (e) {
    showToast('خطا در ثبت کاربر جدید.', 'error');
  }
}

// باز کردن مودال ویرایش کاربر
function openEditUserModal(id, name, limitGB, expireDate, status) {
  document.getElementById('editUserId').value = id;
  document.getElementById('editUserName').value = name;
  document.getElementById('editUserLimitGB').value = limitGB;
  document.getElementById('editUserExpireDate').value = expireDate;
  document.getElementById('editUserStatus').value = status;

  new bootstrap.Modal(document.getElementById('editUserModal')).show();
}

// ویرایش کاربر
async function updateUser() {
  const id = document.getElementById('editUserId').value;
  const name = document.getElementById('editUserName').value;
  const limitGB = document.getElementById('editUserLimitGB').value;
  const expireDate = document.getElementById('editUserExpireDate').value;
  const status = document.getElementById('editUserStatus').value;

  try {
    const res = await fetch(`/api/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, limitGB, expireDate, status })
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, 'success');
      bootstrap.Modal.getInstance(document.getElementById('editUserModal'))?.hide();
      loadDashboardData();
    } else {
      showToast(data.message, 'error');
    }
  } catch (e) {
    showToast('خطا در ویرایش کاربر.', 'error');
  }
}

// صفر کردن ترافیک
async function resetUserTraffic(id) {
  if (!confirm('آیا از صفر کردن ترافیک مصرفی این کاربر اطمینان دارید؟')) return;

  try {
    const res = await fetch(`/api/users/${id}/reset-traffic`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      loadDashboardData();
    } else {
      showToast(data.message, 'error');
    }
  } catch (e) {
    showToast('خطا در ریست ترافیک.', 'error');
  }
}

function loadSettingsModal() {
  document.getElementById('settingUsername').value = globalSettings.username || 'admin';
  document.getElementById('settingPassword').value = '';
  document.getElementById('settingEnableVlessWs').checked = globalSettings.enableVlessWs !== false;
  document.getElementById('settingEnableVlessGrpc').checked = globalSettings.enableVlessGrpc !== false;
  document.getElementById('settingEnableTrojanWs').checked = globalSettings.enableTrojanWs !== false;

  const tok = globalSettings.telegramBotToken || '';
  const adm = globalSettings.telegramAdminId || '';

  if (document.getElementById('telegramTokenInput')) document.getElementById('telegramTokenInput').value = tok;
  if (document.getElementById('telegramAdminIdInput')) document.getElementById('telegramAdminIdInput').value = adm;
  if (document.getElementById('settingTelegramToken')) document.getElementById('settingTelegramToken').value = tok;
  if (document.getElementById('settingTelegramAdminId')) document.getElementById('settingTelegramAdminId').value = adm;
}

// فعال‌سازی اتوماتیک و تست ربات تلگرام از فرانت‌اند
async function triggerRailwaySetWebhook() {
  const token = (document.getElementById('telegramTokenInput')?.value || '').trim();
  const adminId = (document.getElementById('telegramAdminIdInput')?.value || '').trim();

  if (!token) {
    showToast('لطفاً ابتدا توکن ربات تلگرام را وارد کنید.', 'error');
    alert('لطفاً ابتدا توکن ربات تلگرام را در کادر مربوطه وارد کنید.');
    return;
  }

  try {
    const res = await fetch('/api/set-telegram-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, adminId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      alert(data.message);
    } else {
      showToast(data.message, 'error');
      alert(data.message);
    }
  } catch (e) {
    showToast('خطا در اتصال به ربات تلگرام.', 'error');
  }
}

async function triggerRailwaySetWebhookFromSettings() {
  const token = (document.getElementById('settingTelegramToken')?.value || '').trim();
  const adminId = (document.getElementById('settingTelegramAdminId')?.value || '').trim();

  if (!token) {
    showToast('لطفاً ابتدا توکن ربات تلگرام را وارد کنید.', 'error');
    alert('لطفاً ابتدا توکن ربات تلگرام را در کادر مربوطه وارد کنید.');
    return;
  }

  try {
    const res = await fetch('/api/set-telegram-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, adminId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      alert(data.message);
    } else {
      showToast(data.message, 'error');
      alert(data.message);
    }
  } catch (e) {
    showToast('خطا در اتصال به ربات تلگرام.', 'error');
  }
}

// حذف کاربر
async function deleteUser(id, name) {
  if (!confirm(`آیا از حذف کاربر "${name}" اطمینان دارید؟`)) return;

  try {
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      loadDashboardData();
    } else {
      showToast(data.message, 'error');
    }
  } catch (e) {
    showToast('خطا در حذف کاربر.', 'error');
  }
}

// پر کردن اطلاعات تنظیمات در مودال
function populateSettingsModal() {
  document.getElementById('settingUsername').value = globalSettings.username || '';
  document.getElementById('settingEnableVlessWs').checked = globalSettings.enableVlessWs !== false;
  document.getElementById('settingEnableVlessGrpc').checked = globalSettings.enableVlessGrpc !== false;
  document.getElementById('settingEnableTrojanWs').checked = globalSettings.enableTrojanWs !== false;

  document.getElementById('telegramTokenInput').value = globalSettings.telegramBotToken || '';
  document.getElementById('telegramAdminIdInput').value = globalSettings.telegramAdminId || '';
}


// ذخیره تنظیمات عمومی پنل
async function changeSettings() {
  const newUsername = document.getElementById('settingUsername').value;
  const newPassword = document.getElementById('settingPassword').value;

  const enableVlessWs = document.getElementById('settingEnableVlessWs').checked;
  const enableVlessGrpc = document.getElementById('settingEnableVlessGrpc').checked;
  const enableTrojanWs = document.getElementById('settingEnableTrojanWs').checked;

  try {
    const res = await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newUsername, newPassword, enableVlessWs, enableVlessGrpc, enableTrojanWs })
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, 'success');
      bootstrap.Modal.getInstance(document.getElementById('settingsModal'))?.hide();
      initApp();
    } else {
      showToast(data.message, 'error');
    }
  } catch (e) {
    showToast('خطا در تغییر تنظیمات.', 'error');
  }
}

// ذخیره تنظیمات ربات تلگرام
async function saveTelegramSettings() {
  const telegramBotToken = document.getElementById('telegramTokenInput').value;
  const telegramAdminId = document.getElementById('telegramAdminIdInput').value;

  try {
    const res = await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramBotToken, telegramAdminId })
    });
    const data = await res.json();

    if (data.success) {
      showToast('تنظیمات ربات تلگرام با موفقیت ثبت گردید.', 'success');
      bootstrap.Modal.getInstance(document.getElementById('telegramModal'))?.hide();
    } else {
      showToast(data.message, 'error');
    }
  } catch (e) {
    showToast('خطا در ثبت تنظیمات تلگرام.', 'error');
  }
}

// بارگذاری مودال آی‌پی تمیز
async function loadCleanIpsModal() {
  try {
    const res = await fetch('/api/clean-ips');
    const data = await res.json();

    if (data.success) {
      document.getElementById('currentCleanIpInput').value = data.currentCleanIp || '';
      
      const container = document.getElementById('cleanIpsContainer');
      if (!container) return;

      container.innerHTML = '';
      data.presetIps.forEach(item => {
        const col = document.createElement('div');
        col.className = 'col-12 col-md-6';
        col.innerHTML = `
          <div class="clean-ip-card d-flex justify-content-between align-items-center">
            <div>
              <div class="fw-bold text-white small">${item.name}</div>
              <code class="text-info small">${item.ip}</code>
              <div class="text-muted extra-small" style="font-size: 0.75rem;">${item.latency}</div>
            </div>
            <button class="btn btn-sm btn-outline-info rounded-3" onclick="applyPresetCleanIp('${item.ip}')">
              انتخاب
            </button>
          </div>
        `;
        container.appendChild(col);
      });
    }
  } catch (e) {}
}

function applyPresetCleanIp(ip) {
  document.getElementById('currentCleanIpInput').value = ip;
  saveCleanIpFromModal();
}

async function saveCleanIpFromModal() {
  const cleanIp = document.getElementById('currentCleanIpInput').value;

  try {
    const res = await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cleanIp })
    });
    const data = await res.json();

    if (data.success) {
      showToast('آی‌پی تمیز با موفقیت روی تمامی کانفیگ‌ها اعمال شد.', 'success');
      bootstrap.Modal.getInstance(document.getElementById('cleanIpModal'))?.hide();
    } else {
      showToast(data.message, 'error');
    }
  } catch (e) {
    showToast('خطا در ثبت آی‌پی تمیز.', 'error');
  }
}

// کپی متون در حافظه موقت
function copyToClipboard(text, successMsg) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(successMsg, 'success');
  }).catch(() => {
    showToast('خطا در کپی لینک.', 'error');
  });
}

function openUserSubPage(url) {
  window.open(url + '?html=true', '_blank');
}

// مدیریت تم روشن و تیره (Light / Dark Mode)
function initTheme() {
  const savedTheme = localStorage.getItem('dizyno_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('dizyno_theme', newTheme);
  updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById('themeToggleIcon');
  if (!icon) return;
  if (theme === 'light') {
    icon.className = 'fa-solid fa-moon';
  } else {
    icon.className = 'fa-solid fa-sun';
  }
}

// تور آموزش تعاملی (Intro.js)
function startOnboardingTour() {
  introJs().setOptions({
    nextLabel: 'بعدی',
    prevLabel: 'قبلی',
    doneLabel: 'متوجه شدم!',
    skipLabel: 'بستن',
    showProgress: true,
    steps: [
      {
        title: 'به پنل دیزاینو وی پی ان خوش آمدید! 👋',
        intro: 'این پنل برای ایجاد کاربران، تنظیم پروتکل‌های VLESS و Trojan و مدیریت آی‌پی‌های تمیز طراحی شده است.'
      },
      {
        element: document.querySelector('#tourStats'),
        title: 'کارت‌های آمار 📊',
        intro: 'نمایش تعداد کل کاربران، کاربران فعال، ترافیک تخصیصی و ترافیک کل مصرفی.'
      },
      {
        element: document.querySelector('#tourAddUserBtn'),
        title: 'ساخت کاربر جدید ➕',
        intro: 'ایجاد کاربر جدید با نام، حجم مجاز (GB) و مدت زمان اعتبار به روز.'
      },
      {
        element: document.querySelector('#tourUsersTable'),
        title: 'لیست کاربران و ابزارها 👥',
        intro: 'امکان جستجوی آنی، فیلتر وضعیت، کپی لینک سابسکریپشن و مشاهده صفحه گرافیکی کاربر.'
      }
    ]
  }).start();
}

