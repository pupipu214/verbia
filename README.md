# VerbIA

Entrena tu voz con confianza. Practica conversaciones con personajes de IA en español y descubre cómo mejorar tu claridad, ritmo y pausas.

## Características

- Conversaciones con personajes de IA (Andrés, Luis, Nova, Leonardo y más)
- Constructor de personajes personalizados
- Simulación de aula doble (Leonardo y Luis)
- Análisis de sesiones con métricas y retroalimentación
- Historial de prácticas
- Autenticación con Google

## Requisitos previos

- Python 3.11 o superior
- Base de datos PostgreSQL (Supabase o local)
- Claves de API: Groq, Fish Audio, Google OAuth

## Instalación

1. Crea un entorno virtual e instala las dependencias:

   ```bash
   python -m venv .venv
   .venv\Scripts\activate          # Windows
   # o: source .venv/bin/activate  # Linux/Mac

   pip install -r requirements.txt
   ```

2. Copia el archivo de ejemplo de variables de entorno:

   ```bash
   copy .env.example .env          # Windows
   # o: cp .env.example .env        # Linux/Mac
   ```

3. Edita el archivo `.env` y rellena todos los valores con tus claves reales.

   Al mínimo necesitas configurar: `GROQ_API_KEY`, `DATABASE_URL`, `FISH_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` (mínimo 32 caracteres).

4. Inicia el servidor:

   ```bash
   python server.py
   ```

   El servidor estará disponible en `http://127.0.0.1:8000`.

## Estructura del proyecto

```
Verbia2 s/
├── server.py              # Servidor FastAPI (API y rutas HTML)
├── db.py                  # Modelos SQLAlchemy y conexión a BD
├── requirements.txt       # Dependencias de Python
├── .env.example           # Ejemplo de variables de entorno
├── .env                   # Variables de entorno (no se sube al repositorio)
├── README.md              # Este archivo
├── index.html             # Página de inicio
├── practicar.html         # Práctica con un personaje
├── simulacion.html        # Simulación de aula doble
├── analisis.html          # Análisis de sesiones
├── historial.html         # Historial de prácticas
├── personajes.html        # Galería de personajes
├── constructor.html       # Constructor de personajes personalizados
├── perfil.html            # Perfil de usuario
├── login.html             # Inicio de sesión con Google
├── verbo-compartir.html   # Página de compartir
├── css/                   # Hojas de estilo
├── js/                    # Lógica de frontend
├── static/                # Imágenes estáticas
└── Imagenes/              # Retratos de personajes
```

## Variables de entorno principales

| Variable | Descripción | Obligatoria |
|----------|-------------|-------------|
| `GROQ_API_KEY` | Clave de Groq para conversación y transcripción | Sí |
| `DATABASE_URL` | URL de PostgreSQL (Supabase o local) | Sí |
| `FISH_API_KEY` | Clave de Fish Audio para voces | Sí |
| `GOOGLE_CLIENT_ID` | ID de cliente de Google OAuth | Sí |
| `GOOGLE_CLIENT_SECRET` | Secreto de cliente de Google OAuth | Sí |
| `SESSION_SECRET` | Secreto para firmar sesiones (mínimo 32 caracteres) | Sí |
| `CORS_ORIGINS` | Orígenes permitidos para CORS | No |
| `ENVIRONMENT` | `development` o `production` | No |

## Endpoints principales de la API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Estado del servidor y servicios |
| GET | `/sesiones?page=1&limit=20` | Lista paginada de sesiones |
| GET | `/sesiones/{id}` | Detalle de una sesión con análisis |
| POST | `/sesiones/iniciar` | Crea una nueva sesión |
| POST | `/sesiones/{id}/finalizar` | Finaliza sesión y genera análisis |
| DELETE | `/sesiones/{id}` | Elimina una sesión y su análisis |
| POST | `/analisis/guardar` | Calcula y guarda el análisis |
| GET | `/api/personajes` | Lista de personajes |
| POST | `/api/personajes` | Crea personaje personalizado |
| DELETE | `/api/personajes/{id}` | Elimina personaje personalizado |
| POST | `/chat` | Envía mensaje a un personaje |
| POST | `/tts` | Genera audio desde texto |
| POST | `/stt` | Transcribe audio a texto |