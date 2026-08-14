/**
 * سرور اصلی پنل مدیریت Sing-box VPN
 * طراحی شده برای استقرار روی Railway (مبتنی بر Docker)
 * زبان: فارسی (RTL)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { spawn, exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 8080;

// مسیر ذخیره‌سازی داده‌ها برای Docker Volume
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync('/app/data') ? '/app/data' : path.join(__dirname, 'data'));
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SINGBOX_CONFIG_FILE = path.join(DATA_DIR, 'singbox_config.json');

// پیکربندی پیش‌فرض
const defaultSettings = {
  username: 'admin',
  password: 'adminpassword',
  jwtSecret: 'singbox_vpn_secret_' + Math.random().toString(36).substring(2),
  vlessPort: 8443,
  serviceName: 'vless-grpc'
};

// دریافت یا ایجاد فایل تنظیمات
function getSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2), 'utf-8');
    return defaultSettings;
  }
  try {
    const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return { ...defaultSettings, ...JSON.parse(data) };
  } catch (e) {
    return defaultSettings;
  }
}

function saveSettings(newSettings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(newSettings, null, 2), 'utf-8');
}

// دریافت یا ایجاد فایل کاربران
function getUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    // نمونه اولیه کاربر جهت شروع
    const initialUser = [
      {
        id: uuidv4(),
        name: 'کاربر نمونه',
        uuid: uuidv4(),
        limitBytes: 50 * 1024 * 1024 * 1024, // 50 گیگابایت
        usedBytes: 1.5 * 1024 * 1024 * 1024, // 1.5 گیگابایت مصرفی نمونه
        expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 روز دیگر
        status: 'active',
        createdAt: new Date().toISOString()
      }
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(initialUser, null, 2), 'utf-8');
    return initialUser;
  }
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
  rebuildSingboxConfig();
}

// مدیریت پروسه Sing-box
let singboxProcess = null;

function rebuildSingboxConfig() {
  const settings = getSettings();
  const users = getUsers();

  // فیلتر کاربران فعال که انقضا نشده و حجمشان تمام نشده است
  const today = new Date().toISOString().split('T')[0];
  const activeUsers = users.filter(u => {
    if (u.status !== 'active') return false;
    if (u.expireDate && u.expireDate < today) return false;
    if (u.limitBytes > 0 && u.usedBytes >= u.limitBytes) return false;
    return true;
  });

  const singboxConfig = {
    log: {
      level: "info",
      timestamp: true
    },
    inbounds: [
      {
        type: "vless",
        tag: "vless-inbound",
        listen: "::",
        listen_port: parseInt(settings.vlessPort) || 8443,
        users: activeUsers.map(u => ({
          name: u.name,
          uuid: u.uuid
        })),
        transport: {
          type: "grpc",
          service_name: settings.serviceName || "vless-grpc"
        }
      }
    ],
    outbounds: [
      {
        type: "direct",
        tag: "direct"
      },
      {
        type: "block",
        tag: "block"
      }
    ]
  };

  fs.writeFileSync(SINGBOX_CONFIG_FILE, JSON.stringify(singboxConfig, null, 2), 'utf-8');
  restartSingboxProcess();
}

function restartSingboxProcess() {
  // اگر سنگ‌باکس در حال اجرا باشد، ری‌استارت می‌شود
  if (singboxProcess) {
    try {
      singboxProcess.kill('SIGKILL');
    } catch (e) {}
    singboxProcess = null;
  }

  // بررسی وجود فایل اجرایی Sing-box
  const singboxBin = process.env.SINGBOX_BIN || '/app/sing-box';
  if (fs.existsSync(singboxBin)) {
    console.log('در حال راه‌اندازی هسته Sing-box...');
    singboxProcess = spawn(singboxBin, ['run', '-c', SINGBOX_CONFIG_FILE], {
      stdio: 'inherit'
    });

    singboxProcess.on('error', (err) => {
      console.error('خطا در اجرای Sing-box:', err.message);
    });

    singboxProcess.on('exit', (code) => {
      console.log(`پروسه Sing-box با کد ${code} متوقف شد.`);
    });
  } else {
    console.log('فایل اجرایی Sing-box یافت نشد (محیط توسعه محلی). کانفیگ جدید ذخیره گردید.');
  }
}

// میدل‌ورها
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors());

// فایل‌های استاتیک برای فرانت‌اند
app.use(express.static(path.join(__dirname, 'public')));

// میدل‌ور احراز هویت با JWT
function authMiddleware(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ success: false, message: 'دسترسی غیرمجاز. لطفاً وارد شوید.' });
  }

  const settings = getSettings();
  try {
    const decoded = jwt.verify(token, settings.jwtSecret);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'توکن نامعتبر است یا منقضی شده.' });
  }
}

// ---- API های سیستم ----

// ورود به پنل
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const settings = getSettings();

  if (username === settings.username && password === settings.password) {
    const token = jwt.sign({ username: settings.username }, settings.jwtSecret, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    return res.json({ success: true, message: 'ورود با موفقیت انجام شد.', token });
  }

  return res.status(400).json({ success: false, message: 'نام کاربری یا کلمه عبور اشتباه است.' });
});

// خروج از حساب
app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'از سیستم خارج شدید.' });
});

// بررسی وضعیت ورود
app.get('/api/check-auth', authMiddleware, (req, res) => {
  const settings = getSettings();
  res.json({ success: true, username: settings.username });
});

// تغییر کلمه عبور و تنظیمات ادمین
app.post('/api/change-password', authMiddleware, (req, res) => {
  const { newUsername, newPassword, vlessPort, serviceName } = req.body;
  const settings = getSettings();

  if (newUsername) settings.username = newUsername;
  if (newPassword) settings.password = newPassword;
  if (vlessPort) settings.vlessPort = parseInt(vlessPort);
  if (serviceName) settings.serviceName = serviceName;

  saveSettings(settings);
  rebuildSingboxConfig();

  res.json({ success: true, message: 'تنظیمات و اطلاعات حساب ادمین با موفقیت به‌روزرسانی شد.' });
});

// آمار کلی داشبورد
app.get('/api/stats', authMiddleware, (req, res) => {
  const users = getUsers();
  const today = new Date().toISOString().split('T')[0];

  const totalUsers = users.length;
  const activeUsers = users.filter(u => u.status === 'active' && (!u.expireDate || u.expireDate >= today) && (u.limitBytes === 0 || u.usedBytes < u.limitBytes)).length;
  const totalLimitBytes = users.reduce((acc, u) => acc + (u.limitBytes || 0), 0);
  const totalUsedBytes = users.reduce((acc, u) => acc + (u.usedBytes || 0), 0);

  res.json({
    success: true,
    stats: {
      totalUsers,
      activeUsers,
      totalLimitBytes,
      totalUsedBytes
    }
  });
});

// دریافت لیست کاربران
app.get('/api/users', authMiddleware, (req, res) => {
  const users = getUsers();
  res.json({ success: true, users });
});

// ساخت کاربر جدید
app.post('/api/users', authMiddleware, (req, res) => {
  const { name, limitGB, expireDays } = req.body;

  if (!name || name.trim() === '') {
    return res.status(400).json({ success: false, message: 'نام کاربر نمی‌تواند خالی باشد.' });
  }

  const users = getUsers();
  const limitBytes = limitGB ? parseFloat(limitGB) * 1024 * 1024 * 1024 : 0;
  
  let expireDate = null;
  if (expireDays && parseInt(expireDays) > 0) {
    const d = new Date();
    d.setDate(d.getDate() + parseInt(expireDays));
    expireDate = d.toISOString().split('T')[0];
  }

  const newUser = {
    id: uuidv4(),
    name: name.trim(),
    uuid: uuidv4(),
    limitBytes: limitBytes,
    usedBytes: 0,
    expireDate: expireDate,
    status: 'active',
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  saveUsers(users);

  res.json({ success: true, message: 'کاربر جدید با موفقیت ایجاد شد.', user: newUser });
});

// ویرایش کاربر
app.put('/api/users/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { name, limitGB, expireDate, status } = req.body;
  const users = getUsers();

  const userIndex = users.findIndex(u => u.id === id);
  if (userIndex === -1) {
    return res.status(404).json({ success: false, message: 'کاربر یافت نشد.' });
  }

  if (name) users[userIndex].name = name.trim();
  if (limitGB !== undefined) users[userIndex].limitBytes = parseFloat(limitGB) * 1024 * 1024 * 1024;
  if (expireDate !== undefined) users[userIndex].expireDate = expireDate;
  if (status) users[userIndex].status = status;

  saveUsers(users);
  res.json({ success: true, message: 'اطلاعات کاربر با موفقیت ویرایش شد.', user: users[userIndex] });
});

// صفر کردن حجم مصرفی کاربر
app.post('/api/users/:id/reset-traffic', authMiddleware, (req, res) => {
  const { id } = req.params;
  const users = getUsers();
  const user = users.find(u => u.id === id);

  if (!user) {
    return res.status(404).json({ success: false, message: 'کاربر یافت نشد.' });
  }

  user.usedBytes = 0;
  saveUsers(users);
  res.json({ success: true, message: 'ترافیک مصرفی کاربر صفر شد.' });
});

// حذف کاربر
app.delete('/api/users/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  let users = getUsers();
  const initialLength = users.length;

  users = users.filter(u => u.id !== id);

  if (users.length === initialLength) {
    return res.status(404).json({ success: false, message: 'کاربر یافت نشد.' });
  }

  saveUsers(users);
  res.json({ success: true, message: 'کاربر با موفقیت حذف شد.' });
});

// ---- سیستم اشتراک هوشمند (/sub/:uuid) ----

app.get('/sub/:uuid', (req, res) => {
  const { uuid } = req.params;
  const users = getUsers();
  const user = users.find(u => u.uuid === uuid);

  if (!user) {
    return res.status(404).send('کاربر یافت نشد / User Not Found');
  }

  const settings = getSettings();
  const host = req.get('host') || '127.0.0.1';
  const domainOnly = host.split(':')[0];

  // ساخت کانفیگ VLESS gRPC
  const vlessConfig = `vless://${user.uuid}@${domainOnly}:${settings.vlessPort}?type=grpc&serviceName=${encodeURIComponent(settings.serviceName)}&security=none#${encodeURIComponent(user.name + ' | Singbox-gRPC')}`;

  const acceptHeader = req.headers['accept'] || '';
  const userAgent = (req.headers['user-agent'] || '').toLowerCase();

  // تشخیص کلاینت اتصال (v2rayNG, NekoBox, Sing-box, etc.)
  const isV2rayClient = userAgent.includes('v2ray') || 
                        userAgent.includes('neko') || 
                        userAgent.includes('sing-box') || 
                        userAgent.includes('shadowrocket') || 
                        userAgent.includes('clash') ||
                        userAgent.includes('quantumult') ||
                        userAgent.includes('stash') ||
                        req.query.format === 'base64';

  if (!isV2rayClient && acceptHeader.includes('text/html')) {
    // محاسبه آمار حجم و روز برای صفحه وب زیبا
    const usedGB = (user.usedBytes / (1024 * 1024 * 1024)).toFixed(2);
    const limitGB = user.limitBytes > 0 ? (user.limitBytes / (1024 * 1024 * 1024)).toFixed(2) : 'نامحدود';
    let percentUsed = 0;
    if (user.limitBytes > 0) {
      percentUsed = Math.min(100, Math.round((user.usedBytes / user.limitBytes) * 100));
    }

    let daysRemainingText = 'نامحدود';
    let isExpired = false;
    const today = new Date();
    if (user.expireDate) {
      const expDate = new Date(user.expireDate);
      const diffTime = expDate - today;
      const diffDays = Math.ceil(diffTime / (1024 * 60 * 60 * 24));
      if (diffDays <= 0) {
        daysRemainingText = 'منقضی شده';
        isExpired = true;
      } else {
        daysRemainingText = `${diffDays} روز باقی‌مانده`;
      }
    }

    if (user.limitBytes > 0 && user.usedBytes >= user.limitBytes) {
      isExpired = true;
    }

    const currentSubUrl = `${req.protocol}://${host}/sub/${user.uuid}`;

    // رندر صفحه وب زیبا برای کاربر
    const htmlPage = `
    <!DOCTYPE html>
    <html lang="fa" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>وضعیت اشتراک ${user.name}</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
      <style>
        body {
          font-family: 'Vazirmatn', sans-serif;
          background: #0f172a;
          color: #f8fafc;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .user-card {
          background: rgba(30, 41, 59, 0.9);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 24px;
          padding: 30px;
          max-width: 480px;
          width: 100%;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
        }
        .status-badge {
          padding: 6px 16px;
          border-radius: 50px;
          font-size: 0.85rem;
          font-weight: 600;
        }
        .progress-bar-custom {
          height: 12px;
          border-radius: 6px;
          background: #334155;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6, #06b6d4);
          transition: width 0.5s ease;
        }
        .progress-fill.warning {
          background: linear-gradient(90deg, #f59e0b, #ef4444);
        }
        .copy-btn {
          border-radius: 12px;
          padding: 12px;
          font-weight: 600;
          transition: all 0.3s;
        }
        .copy-btn:hover {
          transform: translateY(-2px);
        }
      </style>
    </head>
    <body>
      <div class="user-card">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <div>
            <h4 class="mb-1 text-white font-weight-bold">${user.name}</h4>
            <span class="text-muted small"><i class="fa-solid me-1"></i> Sing-box VLESS gRPC</span>
          </div>
          <span class="status-badge ${isExpired ? 'bg-danger text-white' : 'bg-success text-white'}">
            ${isExpired ? 'غیرفعال / منقضی' : 'فعال و متصل'}
          </span>
        </div>

        <div class="mb-4">
          <div class="d-flex justify-content-between mb-2 small text-slate-300">
            <span>حجم مصرفی: <strong>${usedGB} GB</strong></span>
            <span>حجم کل: <strong>${limitGB} ${limitGB !== 'نامحدود' ? 'GB' : ''}</strong></span>
          </div>
          <div class="progress-bar-custom">
            <div class="progress-fill ${percentUsed > 85 ? 'warning' : ''}" style="width: ${percentUsed}%"></div>
          </div>
        </div>

        <div class="row g-3 mb-4 text-center">
          <div class="col-6">
            <div class="p-3 rounded-4 bg-slate-800 border border-slate-700" style="background: rgba(15, 23, 42, 0.6)">
              <div class="text-muted small mb-1">اعتبار زمانی</div>
              <div class="fw-bold text-info">${daysRemainingText}</div>
            </div>
          </div>
          <div class="col-6">
            <div class="p-3 rounded-4 bg-slate-800 border border-slate-700" style="background: rgba(15, 23, 42, 0.6)">
              <div class="text-muted small mb-1">درصد مصرف</div>
              <div class="fw-bold text-warning">${user.limitBytes > 0 ? percentUsed + '%' : '0%'}</div>
            </div>
          </div>
        </div>

        <div class="d-grid gap-2">
          <button class="btn btn-primary copy-btn" onclick="copyText('${vlessConfig}', 'کانفیگ VLESS با موفقیت کپی شد!')">
            <i class="fa-solid fa-copy me-2"></i> کپی لینک کانفیگ VLESS
          </button>
          <button class="btn btn-outline-light copy-btn" onclick="copyText('${currentSubUrl}', 'لینک اشتراک کپی شد!')">
            <i class="fa-solid fa-link me-2"></i> کپی لینک ساب (Subscription)
          </button>
        </div>

        <div id="toast" class="alert alert-success text-center mt-3 d-none p-2 small"></div>
      </div>

      <script>
        function copyText(text, msg) {
          navigator.clipboard.writeText(text).then(() => {
            const toast = document.getElementById('toast');
            toast.innerText = msg;
            toast.classList.remove('d-none');
            setTimeout(() => toast.classList.add('d-none'), 3000);
          });
        }
      </script>
    </body>
    </html>
    `;
    return res.send(htmlPage);
  }

  // در غیر این صورت (برای برنامه v2rayNG و کلاینت‌ها)، کانفیگ Base64 تحویل داده می‌شود
  const base64Config = Buffer.from(vlessConfig).toString('base64');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.send(base64Config);
});

// مسیر پیش‌فرض برای دریافت راهنمای نصب
app.get('/guide', (req, res) => {
  res.sendFile(path.join(__dirname, 'guide.html'));
});

// راه اندازی سرور
rebuildSingboxConfig();

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 پنل مدیریت VPN با هسته Sing-box اجرا شد.`);
  console.log(`🌐 پورت سرور: ${PORT}`);
  console.log(`📁 مسیر ذخیره‌سازی داده‌ها: ${DATA_DIR}`);
  console.log(`====================================================`);
});
