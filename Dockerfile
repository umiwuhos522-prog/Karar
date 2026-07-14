# تحديث الصورة لتطابق النسخة التي يطلبها البوت
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

# إعداد مسار العمل
WORKDIR /app

# نسخ ملفات تعريف المشروع وتثبيت المكتبات
COPY package*.json ./
RUN npm install

# نسخ باقي ملفات البوت
COPY . .

# أمر تشغيل البوت
CMD ["node", "netflix.js"]
