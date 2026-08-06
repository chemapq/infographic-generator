# Imagen oficial de Playwright: trae Chromium y todas sus dependencias de
# sistema ya instaladas. El tag de versión debe coincidir con la de
# "playwright" en package.json — si se actualiza esa dependencia, actualiza
# también este tag (https://mcr.microsoft.com/en-us/product/playwright/about).
FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

# Capa cacheable: solo se reinstala si cambian package*.json.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# Estado de cada job (imagen original, HTML/capturas de cada pasada,
# usage.json). Sin un volumen persistente montado aquí, se pierde en cada
# despliegue: ver DEPLOY.md.
RUN mkdir -p output

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
