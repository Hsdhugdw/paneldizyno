# پایه ایمیج سبک لینوکس آلپاین به همراه Node.js 18
FROM node:18-alpine

# نصب ابزارهای دانلود و شبکه
RUN apk update && apk add --no-cache wget tar bash ca-certificates

# تنظیم پوشه کاری
WORKDIR /app

# دانلود و نصب آخرین نسخه هسته Sing-box برای معماری linux-amd64
ARG SINGBOX_VERSION=1.8.10
RUN wget https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}/sing-box-${SINGBOX_VERSION}-linux-amd64.tar.gz \
    && tar -xzf sing-box-${SINGBOX_VERSION}-linux-amd64.tar.gz \
    && mv sing-box-${SINGBOX_VERSION}-linux-amd64/sing-box /app/sing-box \
    && chmod +x /app/sing-box \
    && rm -rf sing-box-${SINGBOX_VERSION}-linux-amd64*

# کپی فایل وابستگی‌ها و نصب ماژول‌های Node.js
COPY package.json package-lock.json* ./
RUN npm install --production

# ایجاد پوشه داده‌ها
RUN mkdir -p /app/data

# کپی تمامی فایل‌های سورس پروژه
COPY . .

# تعریف پورت عمومی
EXPOSE 8080

# متغیر محیطی مسیر داده‌ها
ENV DATA_DIR=/app/data
ENV SINGBOX_BIN=/app/sing-box

# فرمان اجرای سرور
CMD ["npm", "start"]
