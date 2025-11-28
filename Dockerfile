FROM node:20
WORKDIR /app
COPY package*.json ./
RUN rm -rf node_modules package-lock.json
RUN npm install
COPY . .
CMD ["node", "src/index.js"]
