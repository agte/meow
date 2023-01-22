FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
ARG NODE_ENV=test
RUN npm install
COPY . .
ENV TZ=Europe/Moscow
ENV PORT=3000
CMD ["npm", "start"]