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
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');

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
    const initialUser = [
      {
        id: uuidv4(),
        name: 'کاربر نمونه',
        uuid: uuidv4(),
        limitBytes: 50 * 1024 * 1024 * 1024, // 50 گیگابایت
        usedBytes: 1.5 * 1024 * 1024 * 1024, // 1.5 گیگابایت
        expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
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

  const today = new Date().toISOString().split('T')[0];
  const activeUsers = users.filter(u => {
    if (u.status !== 'active') return false;
    if (u.expireDate && u.expireDate < today) return false;
    if (u.limitBytes > 0 && u.usedBytes >= u.limitBytes) return false;
    return true;
  });

  const serviceName = settings.serviceName || "vless-grpc";

  const singboxConfig = {
    log: {
      level: "info",
      timestamp: true
    },
    inbounds: [
      {
        type: "vless",
        tag: "vless-ws-inbound",
        listen: "127.0.0.1",
        listen_port: 2083,
        users: activeUsers.map(u => ({
          name: u.name,
          uuid: u.uuid
        })),
        transport: {
          type: "ws",
          path: "/vless"
        }
      },
      {
        type: "vless",
        tag: "vless-grpc-inbound",
        listen: "127.0.0.1",
        listen_port: 2084,
        users: activeUsers.map(u => ({
          name: u.name,
          uuid: u.uuid
        })),
        transport: {
          type: "grpc",
          service_name: serviceName
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
  if (singboxProcess) {
    try {
      singboxProcess.kill('SIGKILL');
    } catch (e) {}
    singboxProcess = null;
  }

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

// میدل‌ورهای پایه Express
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors());

// میدل‌ور پراکسی برای درخوایت‌های gRPC
app.use((req, res, next) => {
  const settings = getSettings();
  const isGrpc = (req.headers['content-type'] && req.headers['content-type'].includes('application/grpc')) || 
                 req.url.includes('vless-grpc') || 
                 req.url.includes(settings.serviceName || 'vless-grpc');

  if (isGrpc) {
    const connector = http.request({
      hostname: '127.0.0.1',
      port: 2084,
      path: req.url,
      method: req.method,
      headers: req.headers
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    connector.on('error', () => {
      if (!res.headersSent) res.status(502).end();
    });

    req.pipe(connector);
  } else {
    next();
  }
});

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

  // ساخت کانفیگ‌های بهینه‌شده VLESS با TLS روی پورت 443
  const vlessWs = `vless://${user.uuid}@${domainOnly}:443?type=ws&path=%2Fvless&security=tls&encryption=none&fp=chrome&sni=${domainOnly}#${encodeURIComponent(user.name + ' | VLESS-WS')}`;
  const vlessGrpc = `vless://${user.uuid}@${domainOnly}:443?mode=gun&security=tls&encryption=none&type=grpc&serviceName=${encodeURIComponent(settings.serviceName || 'vless-grpc')}&fp=chrome&sni=${domainOnly}#${encodeURIComponent(user.name + ' | VLESS-gRPC')}`;
  const combinedConfigs = `${vlessWs}\n${vlessGrpc}`;
  const base64Config = Buffer.from(combinedConfigs).toString('base64');

  // تشخیص هوشمند مرورگر در برابر کلاینت VPN
  const userAgent = (req.headers['user-agent'] || '').toLowerCase();
  const acceptHeader = (req.headers['accept'] || '').toLowerCase();
  
  const isVpnClient = /v2ray|shadowrocket|nekobox|sing-box|clash|stash|quantumult|streisand|passwall|sagernet|xray|surfboard|hiddify|flclash|matsuri|v2fly|go-http-client|axios|fetch/i.test(userAgent);
  const forceHtml = req.query.html === 'true' || req.query.format === 'html';
  const forceRaw = req.query.raw === 'true' || req.query.config === 'true' || req.query.format === 'base64';

  const shouldRenderHtml = (forceHtml || (acceptHeader.includes('text/html') && userAgent.includes('mozilla') && !isVpnClient)) && !forceRaw;

  // اگر مرورگر باشد، صفحه وب زیبا رندر می‌شود
  if (shouldRenderHtml) {
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
          background: #090d16;
          color: #f8fafc;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .user-card {
          background: rgba(22, 30, 46, 0.85);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 24px;
          padding: 32px;
          max-width: 480px;
          width: 100%;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
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
          background: #1e293b;
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
        .action-btn {
          border-radius: 12px;
          padding: 12px;
          font-weight: 600;
          transition: all 0.2s ease;
        }
        .action-btn:hover {
          transform: translateY(-2px);
        }
        .qr-container {
          background: #ffffff;
          padding: 12px;
          border-radius: 16px;
          display: inline-block;
        }
      </style>
    </head>
    <body>
      <div class="user-card">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <div>
            <h4 class="mb-1 text-white fw-bold">${user.name}</h4>
            <span class="text-muted small"><i class="fa-solid fa-shield-halved me-1 text-info"></i> Sing-box VLESS</span>
          </div>
          <span class="status-badge ${isExpired ? 'bg-danger text-white' : 'bg-success text-white'}">
            ${isExpired ? 'غیرفعال / منقضی' : 'فعال و متصل'}
          </span>
        </div>

        <div class="mb-4">
          <div class="d-flex justify-content-between mb-2 small">
            <span class="text-slate-300">حجم مصرفی: <strong class="text-white">${usedGB} GB</strong></span>
            <span class="text-slate-300">حجم کل: <strong class="text-white">${limitGB} ${limitGB !== 'نامحدود' ? 'GB' : ''}</strong></span>
          </div>
          <div class="progress-bar-custom">
            <div class="progress-fill ${percentUsed > 85 ? 'warning' : ''}" style="width: ${percentUsed}%"></div>
          </div>
        </div>

        <div class="row g-3 mb-4 text-center">
          <div class="col-6">
            <div class="p-3 rounded-4" style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.05);">
              <div class="text-muted small mb-1">اعتبار زمانی</div>
              <div class="fw-bold text-info">${daysRemainingText}</div>
            </div>
          </div>
          <div class="col-6">
            <div class="p-3 rounded-4" style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.05);">
              <div class="text-muted small mb-1">درصد مصرف</div>
              <div class="fw-bold text-warning">${user.limitBytes > 0 ? percentUsed + '%' : '0%'}</div>
            </div>
          </div>
        </div>

        <div class="text-center mb-4">
          <div class="qr-container shadow-sm mb-2">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(currentSubUrl)}" alt="QR Code Subscription" width="160" height="160">
          </div>
          <div class="text-muted small" style="font-size: 0.8rem;">اسکن بارکد جهت وارد کردن مستقیم به نرم‌افزار</div>
        </div>

        <div class="d-grid gap-2 mb-3">
          <button class="btn btn-primary action-btn" onclick="copyText('${currentSubUrl}', 'لینک اشتراک با موفقیت کپی شد!')">
            <i class="fa-solid fa-link me-2"></i> کپی لینک ساب (Subscription)
          </button>
          <button class="btn btn-outline-light action-btn" onclick="copyText(\`${combinedConfigs}\`, 'کانفیگ‌های VLESS با موفقیت کپی شدند!')">
            <i class="fa-solid fa-copy me-2"></i> کپی مستقیم کانفیگ‌ها
          </button>
        </div>

        <div id="toast" class="alert alert-success text-center d-none p-2 small rounded-3"></div>
      </div>

      <script>
        function copyText(text, msg) {
          navigator.clipboard.writeText(text).then(() => {
            const toast = document.getElementById('toast');
            toast.innerText = msg;
            toast.classList.remove('d-none');
            setTimeout(() => toast.classList.add('d-none'), 3000);
          }).catch(() => {
            alert('خطا در کپی. متن: ' + text);
          });
        }
      </script>
    </body>
    </html>
    `;
    return res.send(htmlPage);
  }

  // خروجی استاندارد Base64 برای کلاینت‌های v2ray و هدرهای Subscription-Userinfo
  const expireTimestamp = user.expireDate ? Math.floor(new Date(user.expireDate).getTime() / 1000) : 0;
  res.setHeader('Subscription-Userinfo', `upload=0; download=${user.usedBytes}; total=${user.limitBytes || 0}; expire=${expireTimestamp}`);
  res.setHeader('profile-title', `base64:${Buffer.from(user.name).toString('base64')}`);
  res.setHeader('profile-update-interval', '24');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.send(base64Config);
});

// مسیر پیش‌فرض برای دریافت راهنمای نصب
app.get('/guide', (req, res) => {
  res.sendFile(path.join(__dirname, 'guide.html'));
});

// ایجاد سرور HTTP و مدیریت ارتقا (Upgrade) به WebSocket
const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  const isWs = url.startsWith('/vless') || url.startsWith('/ws') || req.headers['sec-websocket-protocol'] === 'vless' || req.headers['upgrade'] === 'websocket';

  if (isWs) {
    const targetSocket = net.connect({ port: 2083, host: '127.0.0.1' }, () => {
      let rawRequest = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        rawRequest += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
      }
      rawRequest += '\r\n';

      targetSocket.write(rawRequest);
      if (head && head.length > 0) {
        targetSocket.write(head);
      }

      socket.pipe(targetSocket);
      targetSocket.pipe(socket);
    });

    targetSocket.on('error', () => {
      socket.destroy();
    });

    socket.on('error', () => {
      targetSocket.destroy();
    });
  } else {
    socket.destroy();
  }
});

// راه اندازی Sing-box و اجرای سرور
rebuildSingboxConfig();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 پنل مدیریت VPN با هسته Sing-box اجرا شد.`);
  console.log(`🌐 پورت سرور: ${PORT}`);
  console.log(`📁 مسیر ذخیره‌سازی داده‌ها: ${DATA_DIR}`);
  console.log(`====================================================`);
});

