FROM node:20-slim

# Install TeX Live (XeLaTeX + Hebrew support + extras) and cleanup
RUN apt-get update && apt-get install -y --no-install-recommends \
  texlive-xetex \
  texlive-lang-hebrew \
  texlive-latex-extra \
  texlive-fonts-extra \
  texlive-latex-recommended \
  texlive-plain-generic \
  texlive-pictures \
  latexmk \
  fonts-freefont-ttf \
  fontconfig \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install custom fonts if any
COPY templates/fonts/ /usr/local/share/fonts/
RUN fc-cache -fv

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
