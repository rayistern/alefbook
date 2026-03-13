FROM node:20-slim

# Install Puppeteer dependencies + Chromium + XeLaTeX for LaTeX book rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
  chromium \
  fonts-liberation \
  libatk-bridge2.0-0 \
  libgtk-3-0 \
  libnss3 \
  libxss1 \
  ca-certificates \
  texlive-xetex \
  texlive-latex-extra \
  texlive-fonts-recommended \
  texlive-lang-hebrew \
  texlive-lang-other \
  poppler-utils \
  && rm -rf /var/lib/apt/lists/*

# Install custom fonts so Puppeteer renders them correctly
COPY templates/fonts/ /usr/local/share/fonts/
RUN fc-cache -fv

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# Make fonts and images available as static assets via Next.js public/
# (thumbnails are already in public/thumbnails/ from the repo)
RUN mkdir -p public/fonts public/images \
    && cp -r templates/fonts/* public/fonts/ \
    && cp -r images/* public/images/

RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
