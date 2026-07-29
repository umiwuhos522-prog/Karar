FROM node:20-slim

# تثبيت برنامج VLC و FFMpeg وكافة الترميزات المطلوبة
RUN apt-get update && apt-get install -y \
    vlc \
    ffmpeg \
    fonts-liberation \
    procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "pay.js"]
