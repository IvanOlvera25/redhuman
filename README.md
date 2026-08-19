# Red Human AI

Plataforma SaaS de agente de IA de Recursos Humanos para México.

## Estructura

| Carpeta | Descripción |
|---|---|
| [`red-human-app/`](red-human-app) | Frontend en Next.js 15 (App Router, TypeScript, Tailwind) |
| [`red-human-api/`](red-human-api) | Backend en FastAPI (SQLAlchemy, OpenAI, avatar Anam) |

Cada carpeta tiene su propio `README.md` con instrucciones de instalación y ejecución.

## Puesta en marcha rápida

```bash
# API
cd red-human-api
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
cp .env.example .env          # llena tus llaves
./.venv/bin/uvicorn app.main:app --reload --port 8000

# App
cd red-human-app
npm install
cp .env.local.example .env.local
npm run dev
```

## Configuración y llaves

Las credenciales viven únicamente en `red-human-api/.env` (ignorado por git). Usa
`red-human-api/.env.example` como plantilla. La llave de Anam nunca se expone al
navegador: los session tokens se generan en el servidor.

## Notas legales (México)

- **LFPDPPP 2025** — la IA solo recomienda; avanzar, descartar o dar de alta a un
  candidato siempre lo decide una persona de RH, registrada en bitácora
  (*human-in-the-loop*).
- Se requiere consentimiento explícito del candidato antes de cualquier entrevista
  o tratamiento de datos.
- No se solicitan ni infieren datos sensibles (salud, embarazo, religión, estado
  civil, orientación).

La base de datos local (`*.db`) y los archivos de candidatos (`uploads/`) contienen
datos personales y están excluidos del repositorio de forma deliberada.
