# استخدام صورة Playwright الجاهزة التي تحتوي على المتصفح
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# إعداد مسار العمل داخل السيرفر
WORKDIR /app

# نسخ ملفات تعريف المشروع وتثبيت المكتبات
COPY package*.json ./
RUN npm install

# نسخ باقي ملفات البوت
COPY . .

# أمر تشغيل البوت
CMD ["node", "netflix.js"]
