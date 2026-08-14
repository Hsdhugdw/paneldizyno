/**
 * منطق فرانت‌اند داشبورد مدیریت Sing-box
 */

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();

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

  // فرم تغییر کلمه عبور
  document.getElementById('settingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await changePassword();
  });
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

// بررسی وضعیت ورود
async function checkAuth() {
  try {
    const res = await fetch('/api/check-auth');
    const data = await res.json();

    if (data.success) {
      document.getElementById('loginSection').classList.add('d-none');
      document.getElementById('dashboardSection').classList.remove('d-none');
      document.getElementById('adminNameDisplay').innerText = data.username;
      
      await loadDashboardData();

      // اگر ادمین برای بار اول وارد شده، تور آموزش نشان داده شود
      if (!localStorage.getItem('singbox_tour_seen')) {
        setTimeout(startOnboardingTour, 1000);
      }
    } else {
      document.getElementById('loginSection').classList.remove('d-none');
      document.getElementById('dashboardSection').classList.add('d-none');
    }
  } catch (err) {
    document.getElementById('loginSection').classList.remove('d-none');
    document.getElementById('dashboardSection').classList.add('d-none');
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
      await checkAuth();
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
    checkAuth();
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

// دریافت و نمایش کاربران
async function loadUsers() {
  try {
    const res = await fetch('/api/users');
    const data = await res.json();
    if (!data.success) return;

    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';

    if (data.users.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center text-muted py-4">
            هیچ کاربری ثبت نشده است. روی دکمه "ایجاد کاربر جدید" کلیک کنید.
          </td>
        </tr>
      `;
      return;
    }

    const host = window.location.host;
    const protocol = window.location.protocol;
    const today = new Date().toISOString().split('T')[0];

    data.users.forEach((u, index) => {
      const usedGB = (u.usedBytes / (1024 * 1024 * 1024)).toFixed(2);
      const limitGB = u.limitBytes > 0 ? (u.limitBytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB' : 'نامحدود';
      
      let statusBadge = `<span class="badge-status badge-active"><i class="fa-solid fa-check me-1"></i> فعال</span>`;
      if (u.status === 'disabled') {
        statusBadge = `<span class="badge-status badge-disabled"><i class="fa-solid fa-ban me-1"></i> غیرفعال</span>`;
      } else if (u.expireDate && u.expireDate < today) {
        statusBadge = `<span class="badge-status badge-expired"><i class="fa-solid fa-clock me-1"></i> منقضی</span>`;
      } else if (u.limitBytes > 0 && u.usedBytes >= u.limitBytes) {
        statusBadge = `<span class="badge-status badge-expired"><i class="fa-solid fa-database me-1"></i> حجم تمام شده</span>`;
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
          <div class="small">${usedGB} / ${limitGB}</div>
        </td>
        <td>
          <div class="small text-slate-300">${u.expireDate || 'نامحدود'}</div>
        </td>
        <td>
          <div class="d-flex gap-1 justify-content-center">
            <button class="btn btn-sm btn-outline-info btn-action" onclick="copyToClipboard('${subUrl}', 'لینک ساب کپی شد!')" title="کپی لینک ساب (Subscription)">
              <i class="fa-solid fa-link"></i>
            </button>
            <button class="btn btn-sm btn-outline-success btn-action" onclick="openUserSubPage('${subUrl}')" title="مشاهده صفحه وب کاربر">
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
  } catch (e) {
    showToast('خطا در بارگذاری لیست کاربران.', 'error');
  }
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

// تغییر تنظیمات و کلمه عبور ادمین
async function changePassword() {
  const newUsername = document.getElementById('settingUsername').value;
  const newPassword = document.getElementById('settingPassword').value;
  const vlessPort = document.getElementById('settingVlessPort').value;
  const serviceName = document.getElementById('settingServiceName').value;

  try {
    const res = await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newUsername, newPassword, vlessPort, serviceName })
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, 'success');
      bootstrap.Modal.getInstance(document.getElementById('settingsModal'))?.hide();
      checkAuth();
    } else {
      showToast(data.message, 'error');
    }
  } catch (e) {
    showToast('خطا در تغییر تنظیمات.', 'error');
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
  window.open(url, '_blank');
}

// تور آموزش تعاملی (Intro.js)
function startOnboardingTour() {
  localStorage.setItem('singbox_tour_seen', 'true');
  
  introJs().setOptions({
    nextLabel: 'بعدی',
    prevLabel: 'قبلی',
    doneLabel: 'متوجه شدم!',
    skipLabel: 'بستن',
    showProgress: true,
    steps: [
      {
        title: 'به پنل Sing-box خوش آمدید! 👋',
        intro: 'این تور کوتاه به شما کمک می‌کند بخش‌های مختلف پنل مدیریت جدید خود را بشناسید.'
      },
      {
        element: document.querySelector('#tourStats'),
        title: 'کارت‌های آمار 📊',
        intro: 'در این بخش می‌توانید آمار کلی کاربران، تعداد کاربران فعال، ترافیک تخصیص داده شده و مصرفی را مشاهده کنید.'
      },
      {
        element: document.querySelector('#tourAddUserBtn'),
        title: 'ساخت کاربر جدید ➕',
        intro: 'با کلیک روی این دکمه می‌توانید کاربر جدید با نام، حجم مجاز (GB) و تعداد روز اعتبار ایجاد کنید.'
      },
      {
        element: document.querySelector('#tourUsersTable'),
        title: 'جدول مدیریت کاربران 👥',
        intro: 'در این جدول تمامی کاربران نمایش داده می‌شوند و می‌توانید لینک ساب (Subscription) آن‌ها را کپی کنید یا ترافیک آن‌ها را صفر کنید.'
      },
      {
        element: document.querySelector('#tourGuideLink'),
        title: 'راهنمای نصب و دپلوی 📚',
        intro: 'اگر نیاز به راهنمای کامل استقرار پروژه روی پلتفرم Railway داشتید، روی این لینک کلیک کنید.'
      }
    ]
  }).start();
}
