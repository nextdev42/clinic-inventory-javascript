FROM node:18-slim

# Optional: install nano, curl etc.
RUN apt-get update && apt-get install -y nano curl
