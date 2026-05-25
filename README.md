# CropLab

Simulador agrícola interactivo con escena 3D, sistema de eventos y partículas.

## Estructura

```
croplab/
├── src/                 # Backend Spring Boot + JPA + MariaDB
├── frontend/            # Frontend Vite + React 19 + Three.js
├── Dockerfile           # Build de producción para Render
├── pom.xml              # Configuración Maven
└── BBDD CropLab.txt     # Script SQL inicial
```

## Desarrollo local

### Backend

Requisitos: Java 17, una BBDD MariaDB/MySQL en `localhost:1111` (o ajusta la URL).

```bash
./mvnw spring-boot:run
```

API expuesta en `http://localhost:8080/api`.

### Frontend

Requisitos: Node 20+.

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

## Despliegue

- **Frontend** → Netlify (`croplab/frontend` como base directory, build `npm run build`, publish `build`).
- **Backend** → Render.com Web Service usando el Dockerfile de este repo.
- **BBDD** → TiDB Cloud Serverless (MySQL-compatible) o cualquier MariaDB/MySQL gestionada.

Variables de entorno del backend en producción:

| Variable | Ejemplo | Descripción |
|----------|---------|-------------|
| `DB_URL` | `jdbc:mariadb://gateway01.tidbcloud.com:4000/croplab?useSSL=true&requireSSL=true` | JDBC URL |
| `DB_USERNAME` | `xxxxx.root` | Usuario |
| `DB_PASSWORD` | `********` | Contraseña |
| `JWT_SECRET` | (string aleatorio largo) | Clave de firma JWT |
| `CORS_ALLOWED_ORIGINS` | `https://croplab.netlify.app` | Origen permitido (Netlify) |

Variable del frontend en Netlify:

| Variable | Ejemplo |
|----------|---------|
| `VITE_API_URL` | `https://croplab-api.onrender.com/api` |
