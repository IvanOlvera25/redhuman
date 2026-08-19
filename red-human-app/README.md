# Red Human AI — Plataforma (Frontend · Fase 1)

Frontend profesional de la plataforma **Red Human AI**: agente integral de RH con IA para todo el
ciclo de vida del colaborador. Esta entrega cubre la **Fase 1 (Reclutamiento + Atención al
colaborador)** con la identidad de marca (teal petróleo + ámbar), estilos dinámicos, 3D y animaciones.

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4** (tokens de diseño, tema claro/oscuro)
- **Three.js** + **@react-three/fiber** + **drei** (hero 3D: red de nodos animada)
- **Framer Motion** (animaciones y transiciones)
- **Recharts** (gráficas del tablero)
- **lucide-react** (iconos) · tipografías Bricolage Grotesque / Manrope / JetBrains Mono

## Cómo correr

```bash
cd red-human-app
npm install --legacy-peer-deps   # ya instalado
npm run dev                      # http://localhost:3000
```

Producción:

```bash
npm run build && npm start
```

> En el login las credenciales ya vienen precargadas: solo da clic en **Entrar**.

## Pantallas incluidas

**Fase 1 — Reclutamiento y atención**

| Ruta | Descripción |
|------|-------------|
| `/` | Landing con hero 3D (Three.js), áreas, capacidades, flujo y CTA |
| `/login` | Inicio de sesión (pantalla dividida con panel de marca) |
| `/dashboard` | **Tablero de control**: KPIs, actividad, fuentes, embudo, tiempo de contratación, insight de IA |
| `/dashboard/vacantes` | Lista de vacantes + panel **Crear vacante con IA** (distribuidor de vacantes) |
| `/dashboard/candidatos` | **Pipeline** tipo kanban por etapa + detalle con evidencia y *human-in-the-loop* |
| `/dashboard/entrevistas` | **Motor de entrevistas**: sala con avatar, transcripción en vivo, consentimiento |
| `/dashboard/conocimiento` | **Base de conocimiento** + chat de atención al colaborador (RAG con citación) |
| `/aplicar/[slug]` | **Portal del candidato**: flujo de aplicación (datos → CV → preguntas → prefiltro) |

**Fase 2 — Ciclo de vida del colaborador**

| Ruta | Descripción |
|------|-------------|
| `/dashboard/onboarding` | **Onboarding e integración**: expediente, checklist de documentos y proceso |
| `/dashboard/capacitacion` | **Capacitación**: catálogo de cursos + **generador de cursos con IA** |
| `/dashboard/desempeno` | **Desempeño**: radar de competencias, KPIs vs. metas, brechas y desarrollo |
| `/dashboard/clima` | **Clima y experiencia**: índice (gauge), tendencia, dimensiones y señales tempranas |

## Diseño

- **Marca:** teal petróleo `#0B6E75` + acento ámbar `#B4711E` (el lado *Human*).
- **Tema claro/oscuro** con toggle (persistente en `localStorage`), oscuro por defecto.
- **Accesibilidad:** foco visible, `prefers-reduced-motion` respetado, contraste cuidado.

## Datos

Todo usa datos de ejemplo en `lib/data.ts` (realistas para México). En producción se
sustituyen por la API real (FastAPI + agentes) descrita en el plan técnico.

## Notas

- Cumplimiento integrado en la UX: consentimiento en la aplicación, aviso de *human-in-the-loop*
  en las decisiones, y consentimiento de grabación en entrevistas (LFPDPPP 2025).
- Es un frontend con lógica de UI simulada (mock). La lógica del agente, voz, avatar y WhatsApp
  se conectan en las siguientes fases.
