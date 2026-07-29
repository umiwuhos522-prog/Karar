FROM node:20-slim

# تثبيت الحزم المطلوبة مع الشاشة الوهمية Xvfb و FFmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    vlc \
    xvfb \
    procps \
    fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "pay.js"]
