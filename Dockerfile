FROM node:20-alpine

WORKDIR /app

# Install dependencies first for layer caching
COPY package*.json ./
RUN npm ci --only=production

# Copy application source
COPY . .

# Expose default port
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Start command
CMD ["npm", "start"]
