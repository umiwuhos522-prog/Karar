# استخدام صورة Playwright الجاهزة التي تحتوي على المتصفحات
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# إعداد العمل
WORKDIR /app

# نسخ ملفات المشروع
COPY package*.json ./
RUN npm install

COPY . .

# تشغيل البوت
CMD ["node", "netflix.js"]
