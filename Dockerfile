FROM node:22-slim

# Install TeX Live (XeLaTeX + Hebrew support + extras) and cleanup
RUN apt-get update && apt-get install -y --no-install-recommends \
  texlive-xetex \
  texlive-lang-other \
  texlive-latex-extra \
  texlive-fonts-extra \
  texlive-fonts-recommended \
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

# Pass NEXT_PUBLIC vars as build args so Next.js can inline them for client-side code
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

EXPOSE 8080
CMD ["npx", "next", "start", "-p", "8080"]
