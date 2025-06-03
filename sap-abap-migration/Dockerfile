FROM node:18-slim
WORKDIR /usr/src/app
COPY package.json ./
COPY package-lock.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8080
CMD ["npx", "functions-framework", "--target=main", "--port=8080"]