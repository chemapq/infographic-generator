# Infographic Generator

API en **TypeScript + Node** para generar imágenes (infografías) a partir de datos, con una **interfaz web** para configurarlas y previsualizarlas.

> ⚠️ Este repositorio está **inicializado** (andamiaje, configuración y estructura). Todavía no contiene el código de la aplicación.

## Stack

- **Runtime:** Node.js (ver `.nvmrc`)
- **Lenguaje:** TypeScript (ESM, `NodeNext`)
- **API:** [Express](https://expressjs.com/)
- **Generación de imágenes:** [sharp](https://sharp.pixelplumbing.com/)
- **Tooling:** ESLint + Prettier, `tsx` para desarrollo

> Las dependencias de runtime (Express, sharp) son un punto de partida razonable y se pueden cambiar según el enfoque final de renderizado.

## Estructura

```
.
├── src/
│   ├── api/         # rutas y controladores de la API (vacío)
│   ├── services/    # lógica de generación de imágenes (vacío)
│   └── config/      # configuración de la app (vacío)
├── public/          # interfaz web estática (vacío)
├── output/          # imágenes generadas (ignorado por git)
├── package.json
├── tsconfig.json
├── eslint.config.js
├── .prettierrc.json
├── .env.example
└── .nvmrc
```

> El punto de entrada previsto es `src/index.ts` (referenciado en los scripts). Aún no existe.

## Puesta en marcha

```bash
# 1. Usar la versión de Node del proyecto
nvm use

# 2. Instalar dependencias
npm install

# 3. Crear el archivo de entorno
cp .env.example .env
```

## Scripts

| Script              | Descripción                                   |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Ejecuta en modo desarrollo con recarga (`tsx`) |
| `npm run build`     | Compila TypeScript a `dist/`                  |
| `npm start`         | Ejecuta la build compilada                     |
| `npm run typecheck` | Verifica tipos sin emitir archivos             |
| `npm run lint`      | Analiza el código con ESLint                    |
| `npm run format`    | Formatea el código con Prettier                 |

## Licencia

MIT
