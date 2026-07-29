# تحديث صورة Playwright للإصدار المطلوب
FROM mcr.microsoft.com/playwright:v1.62.0-jammy

WORKDIR /app

# نسخ ملفات التعاريف وتثبيت الحزم
COPY package*.json ./
RUN npm install

# تثبيت متصفح Chromium الخاص بـ Playwright وتجهيز البيئة
RUN npx playwright install chromium --with-deps

# نسخ بقية الملفات
COPY . .

# تشغيل ملف pay.js
CMD ["node", "pay.js"]
