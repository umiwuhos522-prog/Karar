FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# تثبيت ffmpeg و ffprobe داخل الحاوية
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "pay.js"]
