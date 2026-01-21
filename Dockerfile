# Base Image
FROM node:18-alpine

# Working Directory
WORKDIR /app

# Install Dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy Source Code
COPY . .

# Set Environment Protocol
ENV NODE_ENV=production

# The command to run (mapped to "node scripts/sync-realtime.js")
CMD ["npm", "start"]
