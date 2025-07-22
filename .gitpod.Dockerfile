FROM node:18-slim

# Sakinisha git na packages nyingine muhimu
RUN apt-get update && apt-get install -y git curl nano && apt-get clean
