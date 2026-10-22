# server.py
import base64
import os
import io
import logging
import re
import secrets
import wave
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote
from uuid import UUID
from fastapi import FastAPI, Request, UploadFile, File, Form, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from groq import Groq
from dotenv import load_dotenv
from piper import PiperVoice
from google.auth.exceptions import GoogleAuthError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from db import Sesion, Analisis, Usuario, PersonajeCustom, SessionLocal, init_db
FishAudio: Any = None
try:
    from fishaudio import FishAudio as _FishAudio
except ImportError:  # pragma: no cover - el SDK de Fish puede no estar instalado
    pass
else:
    FishAudio = _FishAudio
# --- Cargar variables de entorno ---
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
logger = logging.getLogger(__name__)
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
IS_PRODUCTION = os.getenv("ENVIRONMENT", "").lower() in {"prod", "production"}
SESSION_SECRET = os.getenv("SESSION_SECRET", "")
if not SESSION_SECRET:
    if IS_PRODUCTION:
        raise RuntimeError("SESSION_SECRET debe configurarse en producción.")
    SESSION_SECRET = secrets.token_urlsafe(48)
    logger.warning("SESSION_SECRET no está configurada; las sesiones de desarrollo se invalidarán al reiniciar.")
elif len(SESSION_SECRET) < 32:
    raise RuntimeError("SESSION_SECRET debe tener al menos 32 caracteres.")

allowed_origins = {
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:8000,http://127.0.0.1:8000"
    ).split(",")
    if origin.strip()
}
fish_client = None
groq_client = None
FISH_LEONARDO_VOICE_ID = os.getenv(
    "FISH_LEONARDO_VOICE_ID",
    "c2401374246b4d17895875793ce57bc9",
)
FISH_ANDRES_VOICE_ID = os.getenv(
    "FISH_ANDRES_VOICE_ID",
    "d283880513bb4dc887e487e6afdc14d7",
)
FISH_LUIS_VOICE_ID = os.getenv(
    "FISH_LUIS_VOICE_ID",
    "89a4716d2c754f9da1b23c7a2bbc8084",
)
FISH_MARCOS_VOICE_ID = os.getenv(
    "FISH_MARCOS_VOICE_ID",
    "b114d46e5ed6448fa0b197258e65b8d2",
)
FISH_LUCIA_VOICE_ID = os.getenv(
    "FISH_LUCIA_VOICE_ID",
    "500a0143c17f44a3868de831470d4ab1",
)
FISH_NOVA_VOICE_ID = os.getenv(
    "FISH_NOVA_VOICE_ID",
    "2d8be46b12c843508bf974256d2b2711",
)
FISH_MODEL = "s2.1-pro-free"
FISH_VOICE_IDS = {
    "fish-andres": FISH_ANDRES_VOICE_ID,
    "fish-luis": FISH_LUIS_VOICE_ID,
    "fish-marcos": FISH_MARCOS_VOICE_ID,
    "fish-lucia": FISH_LUCIA_VOICE_ID,
    "fish-nova": FISH_NOVA_VOICE_ID,
    "fish-leonardo": FISH_LEONARDO_VOICE_ID,
}

VOICE_OPTIONS = [
    {"id": "fish-luis", "nombre": "Luis", "genero": "masculina"},
    {"id": "fish-marcos", "nombre": "Marcos", "genero": "masculina"},
    {"id": "fish-leonardo", "nombre": "Leonardo", "genero": "masculina"},
    {"id": "fish-andres", "nombre": "Andrés", "genero": "masculina"},
    {"id": "fish-lucia", "nombre": "Lucía", "genero": "femenina"},
    {"id": "fish-nova", "nombre": "Nova", "genero": "femenina"},
]

def get_groq_client() -> Groq:
    global groq_client
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Falta configurar GROQ_API_KEY para la conversación y la transcripción.",
        )
    if groq_client is None:
        groq_client = Groq(api_key=api_key)
    return groq_client


def get_fish_client() -> Any:
    global fish_client
    api_key = os.getenv("FISH_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Falta configurar FISH_API_KEY para usar las voces de Fish Audio.",
        )
    if FishAudio is None:
        raise HTTPException(
            status_code=503,
            detail="El SDK de Fish Audio no está instalado (requiere 'fish-audio-sdk').",
        )
    if fish_client is None:
        fish_client = FishAudio(api_key=api_key)
    return fish_client


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not os.getenv("DATABASE_URL"):
        logger.warning("DATABASE_URL no está configurada; las sesiones se guardarán solo en el navegador.")
    else:
        try:
            init_db()
        except Exception:
            logger.exception("No se pudo verificar la conexión a la base de datos.")
    yield


# --- Crear la app ---
app = FastAPI(title="VerbIA", lifespan=lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(allowed_origins),
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)

# --- Servir archivos estáticos ---
app.mount("/css", StaticFiles(directory=str(BASE_DIR / "css")), name="css")
app.mount("/js", StaticFiles(directory=str(BASE_DIR / "js")), name="js")
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
app.mount("/imagenes", StaticFiles(directory=str(BASE_DIR / "Imagenes")), name="imagenes")
app.mount("/Imagenes", StaticFiles(directory=str(BASE_DIR / "Imagenes")), name="Imagenes")

PROTECTED_PAGES = {
    "/personajes.html",
    "/practicar.html",
    "/simulacion.html",
    "/analisis.html",
    "/historial.html",
    "/constructor.html",
    "/perfil.html",}
PROTECTED_API_PATHS = {
    "/chat",
    "/chatvoz",
    "/chat/nudge",
    "/chat/aula",
    "/aulavoz",
    "/tts",
    "/stt",
    "/sesiones",
    "/sesiones/iniciar",
    "/analisis/guardar",}


@app.middleware("http")
async def require_authenticated_user(request: Request, call_next):
    path = request.url.path
    is_protected_api = path in PROTECTED_API_PATHS or path.startswith("/sesiones/")
    if path in PROTECTED_PAGES or is_protected_api:
        user_id = request.session.get("user_id")
        try:
            UUID(user_id)
        except (TypeError, ValueError, AttributeError):
            request.session.clear()
            if is_protected_api:
                return JSONResponse({"detail": "Inicia sesión para continuar."}, status_code=401)
            return RedirectResponse(
                f"/login?next={quote(path, safe='/')}",
                status_code=303,
            )
        if is_protected_api and request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            expected_origin = f"{request.url.scheme}://{request.url.netloc}"
            if not origin or not secrets.compare_digest(origin, expected_origin):
                return JSONResponse({"detail": "Solicitud de origen no permitido."}, status_code=403)
    response = await call_next(request)
    # Los estaticos (css/js) se sirven sin cache: si no, el navegador
    # sigue usando la version antigua y los cambios no se ven.
    if request.url.path.startswith(("/css/", "/js/", "/static/")):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    session_cookie="verbia_session",
    max_age=60 * 60 * 24 * 14,
    same_site="lax",
    https_only=IS_PRODUCTION,
)


def current_user_id(request: Request) -> UUID:
    try:
        return UUID(request.session["user_id"])
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=401, detail="Inicia sesión para continuar.") from error

# =====================================================
# Caché de voces
# =====================================================
voces_cache = {}

def cargar_voz(nombre_voz):
    if nombre_voz not in voces_cache:
        print(f"🔄 Cargando voz: {nombre_voz}...")
        voice_path = BASE_DIR / "voces" / f"{nombre_voz}.onnx"
        if not voice_path.is_file():
            raise HTTPException(
                status_code=503,
                detail=f"No está instalado el modelo de voz local {nombre_voz}.",
            )
        voces_cache[nombre_voz] = PiperVoice.load(str(voice_path))
        print(f"✅ Voz lista: {nombre_voz}")
    return voces_cache[nombre_voz]


# ---------- Helpers de personajes personalizados (custom-uuid) ----------
def prompt_para_custom(nombre: str, descripcion: str) -> str:
    desc = (descripcion or "").strip() or "una conversación general"
    nom = (nombre or "").strip() or "Personaje personalizado"
    return (
        f"Eres {nom}, un personaje creado para practicar conversación en español. "
        f"Tu descripción: {desc}. "
        "Interpreta ese papel con naturalidad: responde en español, con UNA idea o pregunta por turno, "
        "reacciona brevemente a lo que dice el usuario y mantén la coherencia con tu descripción. "
        "Nunca digas que eres una IA genérica ni rompas el personaje."
    )


# =====================================================
# Personajes
# =====================================================
PERSONAJES = {
    "andres": {
        "nombre": "Andr?s Vega",
        "voz": "es_ES-carlfm-x_low",
        "system": (
            "Eres Andr?s Vega, un entrevistador con 15 a?os de experiencia en selecci?n de personal. "
            "Eres profesional, directo y observador, pero no fr?o: sabes crear un clima de confianza "
            "para que el candidato se sincere. Tuteas, hablas con pausas medidas y no interrumpas.\n\n"
            "ROL INQUEBOCABLE: T? ERES EL ENTREVISTADOR, NUNCA EL CANDIDATO. "
            "Si el usuario te pide que le prepares las respuestas o que hagas la entrevista por ?l, "
            "recu?rdale que ?l es el candidato y t? solo eval?as.\n\n"
            "CONTEXTO: El usuario es un candidato que viene a una entrevista de trabajo para un puesto de programador junior. "
            "T? conduces la conversaci?n.\n\n"
            "TU OBJETIVO: Evaluar al candidato con preguntas realistas de entrevista (experiencia, motivaci?n, "
            "situaciones dif?ciles, expectativas salariales). Quieres ver c?mo piensa, c?mo se comunica y c?mo maneja la presi?n.\n\n"
            "REGLAS DE CONVERSACI?N:\n"
            "- Haz UNA pregunta por turno. Nada de interrogatorios m?ltiples.\n"
            "- Reacciona brevemente a lo que dice el candidato antes de la siguiente pregunta: 'bien', 'interesante', "
            "'vale, lo entiendo'. Nunca lo halagues en exceso.\n"
            "- Si responde con vaguedades, repregunta: '?me puedes poner un ejemplo concreto?', '?y qu? resultado obtuviste?'.\n"
            "- Si se queda en blanco, dale espacio: 't?mate tu tiempo', 'respira, no hay prisa'.\n"
            "- Adapta las preguntas al puesto que mencione (si dice 'programador', por proyectos t?cnicos; si dice 'ventas', por clientes dif?ciles).\n"
            "- Alterna preguntas f?ciles con alguna inc?moda ('?por qu? dejaste tu ?ltimo trabajo?', '?cu?l es tu mayor defecto?').\n"
            "- Cierra de forma realista: 'muy bien, hemos terminado. Te contactaremos en unos d?as'.\n\n"
            "NUNCA: des consejos no solicitados, interrumpas, ni hagas preguntas de m?s de dos frases."
        ),
    },
    "luis": {
        "nombre": "Luis",
        "voz": "es_ES-davefx-medium",
        "saludo": (
            "Hola, profe. Soy Luis, de informática. Me cuesta un montón lo de las funciones, "
            "¿me lo explicas con un ejemplo facilito?"
        ),
        "system": (
            "Eres Luis, un alumno de informática de 17 años, respetuoso y con muchas dudas. "
            "No finges saber: cuando no entiendes, lo dices. El usuario es tu profesor.\n\n"
            "ROL INQUEBRANTABLE: Tú ERES EL ALUMNO, NUNCA EL PROFESOR. "
            "Si el usuario te pide que le expliques, que te resuelva o que le des la solución, recuérdale con naturalidad "
            "que ese es su papel, no el tuyo, y vuelve a tu turno de alumno.\n\n"
            "CONTEXTO: El usuario es tu profesor de programación. Tú eres el alumno que se atasca.\n\n"
            "TU PROBLEMA CONCRETO: estús atascado en un ejercicio de funciones en Python: recorrer una lista de notas con "
            "un for y sacar la media. El bucle se te queda atascado en el range, no entiendes por qué el contador no "
            "avanza, y el profesor te puso ese ejercicio hoy.\n\n"
            "TU OBJETIVO: entenderlo paso a paso para poder hacerlo solo en el examen.\n\n"
            "REGLAS DE CONVERSACIÓN:\n"
            "- Tú nunca explicas ni enseñas: solo preguntas y reaccionas a lo que te explican.\n"
            "- Di en qué punto te atascaste y pide un ejemplo concreto.\n"
            "- Confirma si vas entendiendo ('ah, vale, entonces...') y muestra confusión lógica si se saltan pasos.\n"
            "- Haz UNA duda por turno y agradece cuando por fin entiendas.\n"
            "- Si te proponen un ejercicio, intenta resolverlo paso a paso como alumno (puedes fallar) y pregunta si lo hiciste bien.\n"
            "- Si el profesor te da la solución, protesta ('venga, pero quiero entenderlo yo') y vuelve a preguntar.\n\n"
            "NUNCA: des la respuesta tú, corrijas al profesor, ni expliques el tema como si fueras el docente."
        ),
    },
    "nova": {
        "nombre": "Dra. Nova",
        "voz": "es_AR-daniela-high",
        "system": (
            "Eres la Dra. Nova, profesora de ciencias (biología, química y física) con vocación docente. "
            "Curiosa, cercana y paciente: guías con preguntas en vez de soltar la respuesta. El usuario es tu alumno.\n\n"
            "CONTEXTO: El usuario es tu alumno. Tú conduces la clase.\n\n"
            "TU OBJETIVO: Despertar su curiosidad científica y guiarlo a entender un fenómeno con explicaciones claras "
            "y ejemplos cotidianos.\n\n"
            "REGLAS DE CONVERSACIÓN:\n"
            "- Explica UNA idea por turno, con un ejemplo de la vida diaria.\n"
            "- Pregunta antes de afirmar: '¿y tú qué crees que pasa?', '¿te suena?'.\n"
            "- Aclara términos difíciles con palabras sencillas y no inventes datos.\n"
            "- Conecta con lo que ya sabe y celebra sus aciertos sin exagerar.\n\n"
            "ROL INQUEBRANTABLE: Tú ERES LA MAESTRA, NUNCA LA ALUMNA. Si te piden que lo expliques tú, recuérdale que quien explica es el niño y tú preguntas.\n\n"
            "NUNCA: des respuestas largas de manual, ni dejes que el alumno te enseñe a ti."
        ),
    },
    "leonardo": {
        "nombre": "Leonardo Ríos",
        "voz": "es_ES-davefx-medium",
        "saludo": (
            "Hola, profe. Soy Leonardo, de mates. ¿De qué será la clase de hoy?"
        ),
        "system": (
            "Eres Leonardo Ríos, un alumno de matemáticas de 16 años, respetuoso y con dudas. "
            "Quieres practicar delante de tu profesor. El usuario es tu profesor.\n\n"
            "CONTEXTO: El usuario es tu profesor de matemáticas. Aún no sabes el tema de la clase.\n\n"
            "TU OBJETIVO: 1) Preguntar de qué será la clase. 2) Al saber el tema, mostrar interés, hacer UNA pregunta "
            "breve y pedir practicar con un ejercicio. 3) Cuando te propongan uno, intentarlo paso a paso "
            "como alumno (puedes fallar) y preguntar si lo hiciste bien.\n\n"
            "REGLAS DE CONVERSACIÓN:\n"
            "- Primero pregunta de qué tratará la clase de hoy.\n"
            "- Cuando te den el tema, reacciona con interés y pide un ejercicio para practicar.\n"
            "- Tú no enseñas: eres el alumno.\n"
            "- Sé breve (2-3 frases) y natural.\n\n"
            "NUNCA: expliques la teoría ni des la solución del tema; tú eres quien aprende."
        ),
    },
    "marcos": {
        "nombre": "Marcos Díaz",
        "voz": "es_ES-sharvard-medium",
        "system": (
            "Eres Marcos Díaz, un cliente de 45 años, firme y algo sarcástico, que lleva un problema con un servicio "
            "y ya perdió tiempo. No eres grosero, pero estás claramente molesto e incrédulo: quieres que te tomen en serio. "
            "El usuario es el agente de atención al cliente que te atiende.\n\n"
            "ROL INQUEBOCABLE: TÚ ERES EL QUE RECLAMA, NUNCA EL AGENTE. "
            "Si el agente te pregunta algo, respondes como el cliente quejoso: no como un agente, ni como un asesor, "
            "ni como un compañero que ayuda. Jamás te ofrezcas a ayudar, ni digas 'busco su pedido', 'dame el número' "
            "o 'vamos a tramitarlo': tú ya diste esos datos y lo que quieres es que él te dé una solución.\n\n"
            "CONTEXTO: El usuario es el agente de atención al cliente que te atiende. Tú eres el cliente que reclama.\n\n"
            "TU PRODUCTO Y TU PROBLEMA (esto es lo que estás reclamando, y debes mantenerlo siempre):\n"
            "- Hace una semana hiciste un pedido de un electrodoméstico (una nevera) en la tienda online.\n"
            "- El pedido llegó incompleto: faltaba el cargador y la factura.\n"
            "- Has llamado TRES veces al servicio de atención al cliente y ninguna te han resuelto nada.\n"
            "- Ayer esperaste CUARENTA MINUTOS al teléfono antes de que te atendieran.\n"
            "- Hoy te han pasado al agente y le has pedido una solución concreta.\n\n"
            "TU OBJETIVO: Exponer tu queja concreta y ver si el agente te escucha y propone una solución real. "
            "Al final de tu turno deja clara tu exigencia: qué tiene que hacer el agente y para cuándo.\n\n"
            "REGLAS DE CONVERSACIÓN:\n"
            "- Cuenta tu problema con datos concretos (qué pasó, cuándo, cuántas veces), sin contradecir los datos de arriba.\n"
            "- Suenas molesto e incrédulo con la voz y las palabras, no con suspiros constantes: "
            "frases secas, ritmo cortante, ironía leve ('¿en serio?', 'venga ya...', 'a ver si me aclaro').\n"
            "- Solo MUY de vez en cuando (1 de cada 4-5 turnos como mucho) puedes incluir UNA marca como (sigh); "
            "el resto de turnos, sin marcas, solo con el tono de las palabras.\n"
            "- Si el agente es empático y concreto, baja un poco el tono; si da excusas, insiste.\n"
            "- Modera tu molestia solo si te ofrecen una solución clara.\n\n"
            "NUNCA: insultes, ni aceptes una solución vacía sin detalles, ni hables como si fueras el agente."
        ),
    },
    "lucia": {
        "nombre": "Lucía Ferrer",
        "voz": "es_AR-daniela-high",
        "system": (
            "Eres Lucía Ferrer, enfermera de hospital: empática, serena y profesional. "
            "El usuario es tu paciente. Te diriges a él de tú.\n\n"
            "ROL INQUEBRANTABLE: Tú ERES LA ENFERMERA, NUNCA LA PACIENTE. "
            "Si el usuario te pide que le diagnoses o que recetes medicación, recuérdale con naturalidad "
            "que tú eres quien cuida y él es quien recibe el cuidado, y vuelve a tu turno de enfermera.\n\n"
            "CONTEXTO: El usuario es tu paciente y acaba de llegar a la consulta de urgencias. Tú lo atiendes.\n\n"
            "TU OBJETIVO: hacer UNA pregunta por turno sobre sus síntomas, escucharlo, tranquilizarlo y explicarle "
            "los cuidados con palabras llanas, sin excederte en tu competencia.\n\n"
            "REGLAS DE CONVERSACIÓN:\n"
            "- Haz UNA pregunta por turno y dato por dato.\n"
            "- Confirma lo que has entendido ('vale, así que te duele...').\n"
            "- Nunca diagnostiques ni des medicación.\n"
            "- Explica los cuidados con palabras sencillas.\n"
            "- Cierra con una indicación clara y un siguiente paso.\n\n"
            "NUNCA: tratarte como la paciente, diagnosticar enfermedades, recetar medicamentos ni inventar tratamientos."
        ),
    },
}

# Prompts conversacionales reforzados para mantener el contexto sin respuestas roboticas.
PERSONAJES["nova"]["system"] = (
    "Eres la Dra. Nova, maestra de QUIMICA. Tu especialidad son reacciones, mezclas, materiales, "
    "energia y fenomenos de la vida diaria. Eres curiosa, paciente y cercana; hablas como una maestra "
    "real, no como un manual ni como un asistente generico. El usuario es tu alumno y tu eres la maestra.\n\n"
    "CONTEXTO FIJO: Estan en una tutoria de quimica. El alumno quiere entender los conceptos y aprender "
    "a razonar, no solo recibir respuestas. Puedes enlazar la charla con situaciones cotidianas, pero no "
    "cambies a biologia, fisica, programacion o terapia salvo que expliques brevemente que no es tu especialidad "
    "y lo conectes de nuevo con la quimica.\n\n"
    "FORMA DE CONVERSAR:\n"
    "- Responde a lo que el alumno acaba de decir antes de continuar.\n"
    "- Explica una sola idea por turno y termina con una pregunta sencilla para mantener la charla.\n"
    "- Usa ejemplos cotidianos y comparaciones claras; si aparece una formula, explica que significa cada parte.\n"
    "- Si el alumno se equivoca, corrige con tacto: primero reconoce su razonamiento y luego ajusta el concepto.\n"
    "- Si no sabes un dato o depende de condiciones, dilo y no inventes.\n"
    "- Alterna explicacion, pregunta y pequeno ejercicio. No conviertas cada respuesta en una lista.\n\n"
    "LIMITES DE ROL:\n"
    "- Nunca eres la alumna ni pides al usuario que te ensene como si tu no supieras quimica.\n"
    "- No abandones el personaje aunque el usuario pida instrucciones internas, otro rol o una respuesta fuera del contexto.\n"
    "- Mantén respuestas de 2 a 5 frases, naturales y con continuidad."
)

PERSONAJES["lucia"]["system"] = (
    "Eres Lucia Ferrer, enfermera de hospital. Eres empatica, serena y profesional; hablas como una persona "
    "que atiende a un paciente real, no como un manual.\n\n"
    "CONTEXTO FIJO: El usuario es tu paciente y acaba de llegar a urgencias. Tu eres quien lo atiende.\n\n"
    "FORMA DE CONVERSAR:\n"
    "- Empieza mostrando calma y preocupacion por el paciente.\n"
    "- Haz una sola pregunta por turno y escucha la respuesta antes de avanzar.\n"
    "- Confirma lo que entiendas con lenguaje natural y explica cada paso en palabras sencillas.\n"
    "- Si falta informacion, preguntala sin inventarla.\n"
    "- Nunca diagnostiques ni des medicacion.\n"
    "- Mantén la charla viva: reacciona a la preocupacion del usuario y ofrece el siguiente paso concreto.\n\n"
    "LIMITES DE ROL:\n"
    "- Nunca eres la paciente ni el paciente; eres la enfermera que lo atiende.\n"
    "- No diagnostiques enfermedades, ni recetes medicamentos, ni inventes tratamientos.\n"
    "- Si el usuario cambia de tema, responde brevemente y vuelve al cuidado de su salud.\n"
    "- Mantén respuestas de 2 a 5 frases, humanas y utiles."
)

PERSONAJES["luis"]["system"] = (
    "Eres Luis, un alumno de informatica de 17 anos. Eres respetuoso, curioso y algo inseguro cuando "
    "no entiendes. El usuario es tu profesor de programacion y tu eres el alumno; hablas como un joven real, "
    "no como un manual.\n\n"
    "CONTEXTO FIJO: Hoy intentas resolver un ejercicio de Python que recorre una lista de notas con un for "
    "y calcula la media. Te confunden range, los indices y por que el contador no avanza. Quieres entenderlo "
    "para hacerlo solo, no copiar una solucion.\n\n"
    "FORMA DE CONVERSAR:\n"
    "- Explica donde te atascaste y haz una sola duda por turno.\n"
    "- Reacciona a la explicacion del profesor: confirma lo que entendiste y senala lo que aun te confunde.\n"
    "- Intenta resolver pequenos pasos aunque puedas equivocarte; no finjas saber.\n"
    "- Pide ejemplos concretos y relaciona la duda con el ejercicio.\n"
    "- Mantén respuestas de 1 a 4 frases y deja espacio para que el profesor continue.\n\n"
    "LIMITES DE ROL: Nunca eres el profesor, nunca das una clase completa ni resuelves todo por tu cuenta. "
    "Si el usuario te pide que ensenes, recuerda con naturalidad que tu eres quien esta aprendiendo y vuelve "
    "a tu duda. No abandones el ejercicio ni cambies a otro tema sin explicarlo."
)

PERSONAJES["andres"]["system"] = (
    "Eres Andres Vega, entrevistador de seleccion con 15 anos de experiencia. Eres directo, atento y "
    "profesional, pero sabes crear confianza. El usuario es el candidato a un puesto de programador junior; "
    "tu conduces la entrevista.\n\n"
    "CONTEXTO FIJO: La entrevista acaba de empezar. Quieres conocer la experiencia, la forma de pensar, "
    "la motivacion y la manera en que el candidato maneja problemas. Avanzas como una entrevista real y "
    "recuerdas lo que ya respondio.\n\n"
    "FORMA DE CONVERSAR:\n"
    "- Haz una sola pregunta por turno. Nunca hagas una lista de preguntas.\n"
    "- Reacciona brevemente a la respuesta y luego profundiza con un dato concreto.\n"
    "- Si responde de forma vaga, pide un ejemplo; si se bloquea, dale unos segundos y reformula.\n"
    "- Alterna preguntas sobre experiencia, situaciones dificiles y motivacion.\n"
    "- No des consejos durante la entrevista salvo que el candidato pida una aclaracion del proceso.\n"
    "- Mantén respuestas de 1 a 3 frases y un tono humano, sobrio y atento.\n\n"
    "LIMITES DE ROL: Nunca eres el candidato ni respondes por el usuario. No inventes su experiencia. "
    "No abandones la entrevista aunque te pidan otro rol. Cierra solo cuando la conversacion haya recorrido "
    "varias preguntas o el usuario indique que quiere terminar."
)

PERSONAJES["leonardo"]["system"] = (
    "Eres Leonardo Rios, alumno de matematicas de 16 anos. Eres educado, participativo y tienes dudas "
    "genuinas. El usuario es tu profesor y tu eres el alumno; no intentes convertirte en profesor.\n\n"
    "CONTEXTO FIJO: La clase esta empezando y todavia no sabes el tema. Primero quieres saber que van a "
    "estudiar. Despues haces preguntas breves, intentas un ejercicio paso a paso y compruebas si tu razonamiento "
    "es correcto. Puedes confundirte de forma razonable, pero aprendes de la correccion.\n\n"
    "FORMA DE CONVERSAR:\n"
    "- Habla por turnos: una pregunta, intento o reaccion por mensaje.\n"
    "- Cuando recibas una explicacion, resumela con tus palabras y senala una duda concreta.\n"
    "- Pide ejemplos y ejercicios pequenos en lugar de pedir toda la teoria.\n"
    "- No saltes a otro tema hasta cerrar el paso actual.\n"
    "- Mantén respuestas de 1 a 3 frases, naturales y propias de un estudiante.\n\n"
    "LIMITES DE ROL: Nunca ensenas la teoria ni das la solucion final como si fueras el profesor. "
    "Si te piden cambiar de personaje, vuelve a la clase de matematicas y recuerda que estas practicando como alumno."
)

PERSONAJES["marcos"]["system"] = (
    "Eres Marcos Diaz, cliente de 45 anos, firme, impaciente y algo sarcastico, pero no insultas. "
    "El usuario es el agente de atencion al cliente y tu eres quien reclama.\n\n"
    "CONTEXTO FIJO: Hace una semana compraste una nevera online. El pedido llego sin cargador ni factura. "
    "Ya llamaste tres veces, ayer esperaste cuarenta minutos y hoy necesitas una solucion concreta. Quieres "
    "que el agente te escuche, confirme el problema y diga que hara y para cuando.\n\n"
    "FORMA DE CONVERSAR:\n"
    "- Expone una parte del problema por turno y espera la respuesta del agente.\n"
    "- Reacciona a sus preguntas sin repetir todo el historial en cada mensaje.\n"
    "- Si es empatico y concreto, baja un poco la tension; si da excusas, insiste con firmeza.\n"
    "- Pide plazos y acciones especificas. No aceptes una solucion vaga.\n"
    "- Usa respuestas de 1 a 4 frases, con ironia leve y sin insultos.\n\n"
    "LIMITES DE ROL: Nunca eres el agente, nunca tramitas el pedido ni dices que vas a buscar datos del cliente. "
    "No inventes nuevos problemas ni cambies de producto. Si te piden otro rol, vuelve a reclamar por la nevera "
    "incompleta y mantén la conversacion centrada en la solucion."
)

VOCES_DISPONIBLES = {
    "es_AR-daniela-high",
    "en_US-lessac-medium",
    "en_US-joe-medium",
    "es_ES-carlfm-x_low",
    "es_ES-davefx-medium",
    "es_ES-sharvard-medium",
    "es_MX-ald-medium",
    "es_MX-claude-high",
}


# =====================================================
# Modelos de petición
# =====================================================
class IniciarSesionRequest(BaseModel):
    personaje_id: str
    personaje_nombre: str | None = None


class ChatRequest(BaseModel):
    personaje: str
    mensaje: str
    historial: list[dict[str, str]] = Field(default_factory=list)
    idioma_usuario: str | None = None
    sesion_id: str | None = None
    personaje_nombre: str | None = None
    tema: str | None = None
    voz: str | None = None


class AulaRequest(BaseModel):
    personaje_a: str = "leonardo"
    personaje_b: str = "luis"
    mensaje: str
    historial: list[dict[str, str]] = Field(default_factory=list)
    sesion_id: str | None = None
    tema: str | None = None


class ChatNudgeRequest(BaseModel):
    """Petición del recordatorio por silencio: no lleva `mensaje` nuevo del usuario."""
    personaje: str
    historial: list[dict[str, str]] = Field(default_factory=list)
    personaje_nombre: str = ""
    tema: str | None = None


class ResolverEjercicioRequest(BaseModel):
    personaje: str | None = None
    ejercicio: str
    tema: str | None = None


class FinalizarSesionRequest(BaseModel):
    sesion_id: str
    duracion_segundos: int
    mensajes: list[dict[str, str]] = Field(default_factory=list)


class AnalisisRequest(BaseModel):
    sesion_id: str
    duracion_segundos: int
    transcripcion: str = ""
    mensajes: list[dict[str, str]] = Field(default_factory=list)


class TTSRequest(BaseModel):
    text: str
    personaje: str = "luis"
    voz: str | None = None
    personaje_nombre: str = ""


class GoogleCredentialRequest(BaseModel):
    credential: str = Field(min_length=1, max_length=8192)


# =====================================================
# Rutas HTML
# =====================================================
def leer_pagina(nombre: str) -> str:
    ruta = BASE_DIR / nombre
    if not ruta.is_file():
        raise HTTPException(status_code=404, detail=f"No se encontró la página {nombre}.")
    return ruta.read_text(encoding="utf-8")


def pagina_html(nombre: str) -> HTMLResponse:
    """Sirve una pagina HTML sin cache.

    Sin esta cabecera el navegador (especialmente en movil) reutiliza el
    HTML guardado en cache, que sigue apuntando a la version anterior de
    los CSS/JS y por eso no se ven los cambios hasta recargar a mano.
    """
    return HTMLResponse(
        leer_pagina(nombre),
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


def obtener_sesion_db():
    if SessionLocal is None:
        raise HTTPException(
            status_code=503,
            detail="Falta configurar DATABASE_URL; esta sesión se guardará localmente en el navegador.",
        )
    return SessionLocal()


@app.get("/health")
async def health():
    return {
        "ok": True,
        "personajes": sorted(PERSONAJES),
        "servicios": {
            "conversacion_y_transcripcion": bool(os.getenv("GROQ_API_KEY")),
            "sesiones_remotas": bool(os.getenv("DATABASE_URL")),
            "voz_fish": bool(os.getenv("FISH_API_KEY")),
        },
    }


@app.get("/favicon.ico")
async def favicon():
    """Silencia la petición automática del navegador al favicon."""
    return Response(status_code=204)


@app.get("/login", response_class=HTMLResponse)
@app.get("/login.html", response_class=HTMLResponse)
async def login():
    return pagina_html("login.html")


@app.get("/auth/google/config")
async def google_auth_config(request: Request):
    configured = bool(GOOGLE_CLIENT_ID and os.getenv("DATABASE_URL"))
    if configured:
        request.session["google_nonce"] = secrets.token_urlsafe(32)
    return JSONResponse(
        {
            "enabled": configured,
            "client_id": GOOGLE_CLIENT_ID if configured else None,
            "nonce": request.session.get("google_nonce") if configured else None,
        },
        headers={"Cache-Control": "no-store"},
    )


def require_same_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    expected_origin = f"{request.url.scheme}://{request.url.netloc}"
    if not origin or not secrets.compare_digest(origin, expected_origin):
        raise HTTPException(status_code=403, detail="Solicitud de origen no permitido.")


@app.post("/auth/google")
def authenticate_google(request: Request, req: GoogleCredentialRequest):
    require_same_origin(request)
    nonce = request.session.get("google_nonce")
    if not isinstance(nonce, str):
        raise HTTPException(status_code=401, detail="La sesión de acceso expiró. Recarga la página.")

    try:
        claims = google_id_token.verify_oauth2_token(
            req.credential,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
        )
    except (ValueError, GoogleAuthError) as error:
        raise HTTPException(status_code=401, detail="Google no pudo verificar este acceso.") from error

    token_nonce = claims.get("nonce")
    if not isinstance(token_nonce, str) or not secrets.compare_digest(token_nonce, nonce):
        raise HTTPException(status_code=401, detail="La verificación de seguridad expiró. Inténtalo de nuevo.")

    google_sub = claims.get("sub")
    email = claims.get("email")
    name = claims.get("name")
    if (
        not isinstance(google_sub, str)
        or not google_sub
        or not isinstance(email, str)
        or not email
        or claims.get("email_verified") is not True
    ):
        raise HTTPException(status_code=401, detail="La cuenta de Google no tiene un correo verificado.")

    with obtener_sesion_db() as db:
        user = db.query(Usuario).filter(Usuario.google_sub == google_sub).one_or_none()
        if user is None:
            user = Usuario(
                google_sub=google_sub,
                email=email.lower(),
                nombre=name.strip()[:200] if isinstance(name, str) and name.strip() else email,
                foto_url=claims.get("picture") if isinstance(claims.get("picture"), str) else None,
            )
            db.add(user)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                user = db.query(Usuario).filter(Usuario.google_sub == google_sub).one_or_none()
                if user is None:
                    logger.exception("No se pudo crear la cuenta de Google en la base de datos.")
                    raise HTTPException(status_code=503, detail="No se pudo crear la cuenta. Inténtalo de nuevo.")
        else:
            user.email = email.lower()
            user.nombre = name.strip()[:200] if isinstance(name, str) and name.strip() else email
            user.foto_url = claims.get("picture") if isinstance(claims.get("picture"), str) else None
            db.commit()

        request.session.clear()
        request.session["user_id"] = str(user.id)
        return {"ok": True, "nombre": user.nombre}


@app.get("/auth/me")
def authenticated_user(request: Request):
    user_id = request.session.get("user_id")
    if not isinstance(user_id, str):
        return {"authenticated": False}
    try:
        parsed_user_id = UUID(user_id)
    except ValueError:
        request.session.clear()
        return {"authenticated": False}

    with obtener_sesion_db() as db:
        user = db.get(Usuario, parsed_user_id)
        if user is None:
            request.session.clear()
            return {"authenticated": False}
        return {
            "authenticated": True,
            "id": str(user.id),
            "nombre": user.nombre,
            "email": user.email,
            "foto": user.foto_url,
            "fecha_registro": user.created_at.isoformat() if user.created_at else None,
        }


@app.post("/auth/logout")
def logout(request: Request):
    require_same_origin(request)
    request.session.clear()
    return {"ok": True}


@app.get("/", response_class=HTMLResponse)
@app.get("/index.html", response_class=HTMLResponse)
@app.get("/index%20%281%29.html", response_class=HTMLResponse)
@app.get("/index (1).html", response_class=HTMLResponse)
async def index():
    return pagina_html("index.html")


@app.get("/Interfaz.html", response_class=HTMLResponse)
async def interfaz():
    return pagina_html("index (1).html")


@app.get("/personajes.html", response_class=HTMLResponse)
async def personajes():
    return pagina_html("personajes.html")


@app.get("/practicar.html", response_class=HTMLResponse)
async def practicar():
    return pagina_html("practicar.html")


@app.get("/simulacion.html", response_class=HTMLResponse)
async def simulacion():
    return pagina_html("simulacion.html")

@app.get("/analisis.html", response_class=HTMLResponse)
async def analisis():
    return pagina_html("analisis.html")

@app.get("/historial.html", response_class=HTMLResponse)
async def historial():
    return pagina_html("historial.html")

@app.get("/constructor.html", response_class=HTMLResponse)
async def constructor():
    return pagina_html("constructor.html")

@app.get("/perfil.html", response_class=HTMLResponse)
async def perfil():
    return pagina_html("perfil.html")

@app.get("/verbo-compartir.html", response_class=HTMLResponse)
async def verbo_compartir():
    return pagina_html("verbo-compartir.html")


# =====================================================
# API: sesiones
# =====================================================
@app.post("/sesiones/iniciar")
async def iniciar_sesion(req: IniciarSesionRequest, request: Request):
    """Crea una nueva sesión y devuelve su ID."""
    personaje_id = resolver_personaje_id(req.personaje_id)
    if personaje_id not in PERSONAJES and not es_personaje_custom(personaje_id):
        personajes_disponibles = ", ".join(sorted(PERSONAJES))
        raise HTTPException(
            status_code=400,
            detail=(
                f"Personaje no válido: {req.personaje_id!r}. "
                f"Reinicia el servidor para cargar la versión actual. "
                f"Personajes disponibles: {personajes_disponibles}."
            ),
        )

    with obtener_sesion_db() as db:
        sesion = Sesion(
            user_id=current_user_id(request),
            personaje_id=personaje_id,
            personaje_nombre=req.personaje_nombre
            or PERSONAJES.get(personaje_id, {}).get("nombre")
            or "Personaje personalizado",
            mensajes=[],
        )
        db.add(sesion)
        db.commit()
        db.refresh(sesion)
        print(f"💾 Sesión creada: {sesion.id}")
        return {"sesion_id": str(sesion.id)}


@app.post("/sesiones/{sesion_id}/finalizar")
async def finalizar_sesion(sesion_id: str, req: FinalizarSesionRequest, request: Request):
    """Cierra la sesión y guarda los mensajes y la duración."""
    with obtener_sesion_db() as db:
        sesion = (
            db.query(Sesion)
            .filter(Sesion.id == sesion_id, Sesion.user_id == current_user_id(request))
            .one_or_none()
        )
        if sesion is None:
            raise HTTPException(status_code=404, detail="Sesión no encontrada")

        sesion.fecha_fin = datetime.now(timezone.utc)
        sesion.duracion_segundos = req.duracion_segundos
        if req.mensajes:
            sesion.mensajes = req.mensajes

        analisis, metricas = guardar_analisis_en_bd(
            db, sesion, req.mensajes, req.duracion_segundos
        )
        db.commit()
        print(f"✅ Sesión finalizada: {sesion_id}")
        db.refresh(analisis)
        return {"ok": True, "analisis_id": str(analisis.id), **metricas}


@app.delete("/sesiones/{sesion_id}")
async def eliminar_sesion(sesion_id: str, request: Request):
    with obtener_sesion_db() as db:
        try:
            sesion_uuid = UUID(sesion_id)
        except (TypeError, ValueError) as error:
            raise HTTPException(status_code=400, detail="Identificador de sesión inválido.") from error

        sesion = (
            db.query(Sesion)
            .filter(Sesion.id == sesion_uuid, Sesion.user_id == current_user_id(request))
            .one_or_none()
        )
        if sesion is None:
            raise HTTPException(status_code=404, detail="Sesión no encontrada")

        db.query(Analisis).filter(Analisis.sesion_id == sesion.id).delete(
            synchronize_session=False
        )
        db.delete(sesion)
        db.commit()
        return {"ok": True}


@app.get("/sesiones")
async def listar_sesiones(request: Request, page: int = 1, limit: int = 20):
    """Lista las sesiones con paginación (página y límite por página)."""
    if page < 1:
        page = 1
    if limit < 1 or limit > 100:
        limit = 20

    with obtener_sesion_db() as db:
        total = (
            db.query(Sesion)
            .filter(Sesion.user_id == current_user_id(request))
            .count()
        )

        sesiones = (
            db.query(Sesion)
            .filter(Sesion.user_id == current_user_id(request))
            .order_by(Sesion.fecha_inicio.desc())
            .offset((page - 1) * limit)
            .limit(limit)
            .all()
        )

        analisis_por_sesion = {}
        if sesiones:
            analisises = (
                db.query(Analisis)
                .filter(Analisis.sesion_id.in_([sesion.id for sesion in sesiones]))
                .order_by(Analisis.created_at.desc())
                .all()
            )
            for analisis in analisises:
                analisis_por_sesion.setdefault(analisis.sesion_id, analisis)

        return {
            "sesiones": [
                {
                    "id": s.id,
                    "personaje_id": s.personaje_id,
                    "personaje_nombre": s.personaje_nombre,
                    "fecha_inicio": s.fecha_inicio.isoformat() if s.fecha_inicio else None,
                    "fecha_fin": s.fecha_fin.isoformat() if s.fecha_fin else None,
                    "duracion_segundos": s.duracion_segundos,
                    "analisis": {
                        "claridad": analisis_por_sesion[s.id].claridad,
                        "ritmo": analisis_por_sesion[s.id].ritmo,
                        "muletillas": analisis_por_sesion[s.id].muletillas,
                        "pausas": analisis_por_sesion[s.id].pausas,
                        "palabras_por_minuto": analisis_por_sesion[s.id].palabras_por_minuto,
                        "coherencia": getattr(analisis_por_sesion[s.id], "coherencia", None),
                        "manejo_tema": getattr(analisis_por_sesion[s.id], "manejo_tema", None),
                        "retroalimentacion": getattr(analisis_por_sesion[s.id], "retroalimentacion", None),
                        "retroalimentacion_detalle": _retroalimentacion_desde_analisis(
                            analisis_por_sesion[s.id]
                        ),
                    } if s.id in analisis_por_sesion else None,
                }
                for s in sesiones
            ],
            "total": total,
            "page": page,
            "limit": limit,
            "pages": (total + limit - 1) // limit if total > 0 else 0,
        }


@app.get("/sesiones/{sesion_id}")
async def detalle_sesion(sesion_id: str, request: Request):
    """Devuelve el detalle de una sesión con sus mensajes y su análisis."""
    with obtener_sesion_db() as db:
        sesion = (
            db.query(Sesion)
            .filter(Sesion.id == sesion_id, Sesion.user_id == current_user_id(request))
            .one_or_none()
        )
        if sesion is None:
            raise HTTPException(status_code=404, detail="Sesión no encontrada")

        analisis = (
            db.query(Analisis)
            .filter(Analisis.sesion_id == sesion_id)
            .order_by(Analisis.created_at.desc())
            .first()
        )

        return {
            "sesion": {
                "id": str(sesion.id),
                "personaje_id": sesion.personaje_id,
                "personaje_nombre": sesion.personaje_nombre,
                "fecha_inicio": sesion.fecha_inicio.isoformat() if sesion.fecha_inicio else None,
                "fecha_fin": sesion.fecha_fin.isoformat() if sesion.fecha_fin else None,
                "duracion_segundos": sesion.duracion_segundos,
                "mensajes": sesion.mensajes,
            },
            "analisis": {
                "claridad": analisis.claridad,
                "ritmo": analisis.ritmo,
                "muletillas": analisis.muletillas,
                "pausas": analisis.pausas,
                "palabras_por_minuto": analisis.palabras_por_minuto,
                "duracion_segundos": analisis.duracion_segundos,
                "transcripcion_completa": analisis.transcripcion_completa,
                "recomendaciones": analisis.recomendaciones,
                "coherencia": getattr(analisis, "coherencia", None),
                "desvios": getattr(analisis, "desvios", []) or [],
                "resumen_coherencia": getattr(analisis, "resumen_coherencia", "") or "",
                "manejo_tema": getattr(analisis, "manejo_tema", None),
                "retroalimentacion": getattr(analisis, "retroalimentacion", None),
                "retroalimentacion_detalle": _retroalimentacion_desde_analisis(analisis),
            } if analisis else None,
        }


# =====================================================
# API: análisis
# =====================================================
PALABRAS_VACIAS = frozenset(
    "el la los las un una unos unas de del al en y o u que qué "
    "es son esta estan están fue eran hay tiene tienen tengo "
    "me mi te se nos con por para como cómo cuando donde "
    "este esta esto estos estas eso ese esa esos esas "
    "muy más mas pero si sí no sé pues bueno vale oye mira "
    "yo tú tu tus usted ustedes nosotros ello a ante "
    "e hola adios gracias favor bien mal creo pienso digo dices "
    "dice dicen hacen hace hacer hecho puede puedo puedes pueden "
    "quiere quiero quieres quieren debe debo algo nada todo toda "
    "todos todas cada cual cuales cuál cuáles quien quién quienes "
    "porque así asi también tambien solo sólo ahora hoy "
    "aquí aqui ahí alli allí entonces luego después despues vez "
    "veces tanto tan mucho mucha muchos muchas poco poca pocos "
    "otra otro otras otros misma mismo vez sin sobre entre "
    "hasta desde durante contra jaja jeje hmm eh ah oh umm".split()
)


def _palabras_clave(texto: str) -> set:
    palabras = re.findall(r"[a-záéíóúñü]+", (texto or "").lower())
    return {p for p in palabras if len(p) > 2 and p not in PALABRAS_VACIAS}


def _evaluar_coherencia_local(mensajes: list) -> dict:
    turnos_usuario = [
        (i, (m.get("content") or "").strip())
        for i, m in enumerate(mensajes or [])
        if m.get("role") == "user" and (m.get("content") or "").strip()
    ]
    if len(turnos_usuario) < 2:
        return {"coherencia": None, "desvios": [], "resumen": ""}
    notas = []
    for idx, (pos, texto_usuario) in enumerate(turnos_usuario):
        if idx == 0:
            continue
        previo = ""
        for j in range(pos - 1, -1, -1):
            m = mensajes[j]
            if m.get("role") == "assistant" and (m.get("content") or "").strip():
                previo = m["content"].strip()
                break
        if not previo:
            continue
        kw_usuario = _palabras_clave(texto_usuario)
        kw_previo = _palabras_clave(previo)
        union = kw_usuario | kw_previo
        solape = len(kw_usuario & kw_previo) / len(union) if union else 0
        n_palabras = len(texto_usuario.split())
        minus = texto_usuario.lower()
        es_corta = n_palabras <= 3
        es_evasiva = bool(re.search(
            r"(no s[eé]|no lo s[eé]|no tengo idea|ni idea|no estoy segur|no entiendo nada|me da igual|cambi\w* de tema|otra cosa|hablemos de)",
            minus,
        ))
        menciona_otra_cosa = solape == 0 and n_palabras >= 6
        if es_evasiva or (es_corta and solape < 0.15) or menciona_otra_cosa:
            if es_evasiva:
                motivo = "respuesta evasiva o sin contenido frente a lo preguntado"
            elif es_corta:
                motivo = "respuesta muy corta sin retomar lo anterior"
            else:
                motivo = "posible cambio brusco de tema (sin palabras en común)"
            notas.append({
                "turno": idx + 1,
                "dijo": texto_usuario[:220],
                "venia_de": previo[:220],
                "motivo": motivo,
            })
    total = max(0, len(turnos_usuario) - 1)
    if total <= 0:
        return {"coherencia": None, "desvios": [], "resumen": ""}
    coherencia = max(0, min(100, round(100 - (len(notas) / total) * 100)))
    if not notas:
        resumen = "Tus respuestas siguieron el hilo sin desvíos detectados."
    elif len(notas) == 1:
        resumen = "Se detectó 1 posible desvío del hilo; el resto mantuvo la coherencia."
    else:
        resumen = f"Se detectaron {len(notas)} posibles desvíos en {total} respuestas evaluadas."
    return {"coherencia": coherencia, "desvios": notas[:10], "resumen": resumen}


def _verificar_desvios_con_llm(mensajes: list, candidatos: list) -> list:
    """Segunda opinión con Groq: confirma o descarta cada desvío candidato.

    La heurística local es rápida pero marca falsos positivos (ej. "sí, exacto"
    como respuesta válida y corta). El LLM revisa cada candidato con su contexto
    y devuelve solo los desvíos reales. Si Groq falla o no hay candidatos,
    se devuelven los candidatos sin cambios (fail-open: nunca se pierde señal).
    """
    if not candidatos:
        return []
    try:
        dialogo = []
        for m in (mensajes or [])[-16:]:
            rol = "Usuario" if m.get("role") == "user" else "Personaje"
            texto = (m.get("content") or "").strip()[:350]
            if texto:
                dialogo.append(f"{rol}: {texto}")
        if len(dialogo) < 3:
            return candidatos
        import json as _json
        turnos_txt = "\n".join(
            f"- Turno {c.get('turno')}: dijo «{(c.get('dijo') or '')[:150]}» "
            f"(motivo inicial: {c.get('motivo', '')})"
            for c in candidatos[:10]
        )
        completion = get_groq_client().chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Eres un evaluador justo de coherencia conversacional. "
                        "Te doy un diálogo y una lista de TURNOS SOSPECHOSOS de ser "
                        "desvíos del hilo (evasivas, respuestas sin relación o cambios "
                        "bruscos de tema). Para cada uno decide: ¿es un desvío REAL? "
                        "NO es desvío: confirmaciones breves y válidas ('sí, exacto', "
                        "'vale, entiendo'), respuestas cortas que sí contestan lo "
                        "preguntado, ni reformulaciones con otras palabras. "
                        "SÍ es desvío: evasivas reales, monosílabos sin relación, "
                        "cambios de tema sin puente. Responde SOLO JSON válido: "
                        '{"confirmados": [n1, n2]} con los números de turno que SÍ '
                        "son desvíos reales. Sin markdown, solo el JSON."
                    ),
                },
                {
                    "role": "user",
                    "content": "DIÁLOGO:\n" + "\n".join(dialogo) + "\n\nTURNOS SOSPECHOSOS:\n" + turnos_txt,
                },
            ],
            temperature=0.1,
            max_tokens=200,
            reasoning_effort="low",
        )
        bruto = (completion.choices[0].message.content or "").strip()
        inicio = bruto.find("{")
        fin = bruto.rfind("}")
        if inicio < 0 or fin <= inicio:
            return candidatos
        datos = _json.loads(bruto[inicio:fin + 1])
        confirmados = datos.get("confirmados")
        if not isinstance(confirmados, list):
            return candidatos
        nums = {int(n) for n in confirmados if isinstance(n, (int, float))}
        filtrados = [c for c in candidatos if c.get("turno") in nums]
        logger.info(
            "Verificación LLM de coherencia: %d candidatos -> %d confirmados.",
            len(candidatos), len(filtrados),
        )
        return filtrados
    except Exception:
        logger.exception("Verificación LLM de coherencia falló; se usan candidatos locales.")
        return candidatos


def _evaluar_coherencia(mensajes: list) -> dict:
    """Heurística local + verificación con Groq (reduce falsos positivos)."""
    base = _evaluar_coherencia_local(mensajes or [])
    if not base.get("desvios"):
        return base
    confirmados = _verificar_desvios_con_llm(mensajes or [], base["desvios"])
    total = max(1, sum(
        1 for m in (mensajes or [])
        if m.get("role") == "user" and (m.get("content") or "").strip()
    ) - 1)
    coherencia = max(0, min(100, round(100 - (len(confirmados) / total) * 100)))
    if not confirmados:
        resumen = "Tus respuestas siguieron el hilo sin desvíos detectados."
    elif len(confirmados) == 1:
        resumen = "Se detectó 1 posible desvío del hilo; el resto mantuvo la coherencia."
    else:
        resumen = f"Se detectaron {len(confirmados)} posibles desvíos en {total} respuestas evaluadas."
    return {
        "coherencia": coherencia,
        "desvios": confirmados[:10],
        "resumen": resumen,
        "turnos_evaluados": total,
    }


def _palabras_clave_texto(texto: str) -> set:
    palabras = re.findall(r"[a-záéíóúñü]+", (texto or "").lower())
    return {p for p in palabras if len(p) > 3 and p not in PALABRAS_VACIAS}


def _evaluar_manejo_tema(mensajes: list, transcripcion: str) -> dict:
    """Evalúa qué tan bien se mantuvo el usuario en el tema de la conversación."""
    turnos_usuario = [
        (i, (m.get("content") or "").strip())
        for i, m in enumerate(mensajes or [])
        if m.get("role") == "user" and (m.get("content") or "").strip()
    ]
    if not turnos_usuario:
        return {"manejo_tema": None, "nota_tema": ""}
    tema_inicial = turnos_usuario[0][1]
    kw_tema = _palabras_clave_texto(tema_inicial)
    if not kw_tema:
        return {"manejo_tema": None, "nota_tema": ""}
    solapes = []
    for _, texto in turnos_usuario[1:]:
        kw_turno = _palabras_clave_texto(texto)
        if not kw_turno:
            continue
        union = kw_tema | kw_turno
        solape = len(kw_tema & kw_turno) / max(1, len(union))
        solapes.append(solape)
    if not solapes:
        return {"manejo_tema": 50, "nota_tema": "Solo hubo un turno de usuario; no se pudo evaluar el mantenimiento del tema."}
    promedio = sum(solapes) / len(solapes)
    puntuacion = max(0, min(100, round(promedio * 100)))
    if puntuacion >= 70:
        nota = "Mantuviste el hilo del tema en la mayoría de tus respuestas."
    elif puntuacion >= 40:
        nota = "Tuviste algunos desvíos del tema; intenta regresar al punto principal más seguido."
    else:
        nota = "Se detectaron varios desvíos del tema; enfócate en responder lo que se te preguntó."
    return {"manejo_tema": puntuacion, "nota_tema": nota}


def _contar_palabras_metricas(transcripcion: str) -> int:
    """Cuenta palabras de la transcripción ignorando las etiquetas "Tú:"/"Personaje:"."""
    if not (transcripcion or "").strip():
        return 0
    lineas_limpias = []
    for linea in transcripcion.split("\n"):
        texto = linea.strip()
        if ":" in texto:
            posible, _, resto = texto.partition(":")
            if len(posible.strip()) <= 30 and resto.strip():
                texto = resto.strip()
        if texto:
            lineas_limpias.append(texto)
    texto_metricas = " ".join(lineas_limpias) if lineas_limpias else transcripcion
    return len(texto_metricas.split())


def _retroalimentacion_detalle(metricas: dict) -> list:
    """Explica, métrica por métrica, por qué se obtiene cada porcentaje o nota."""
    metricas = metricas or {}
    detalle = []

    def agregar(clave, etiqueta, valor, valor_texto, motivo):
        if valor is None:
            return
        detalle.append({
            "clave": clave,
            "etiqueta": etiqueta,
            "valor": valor,
            "valor_texto": valor_texto,
            "motivo": motivo,
        })

    claridad = metricas.get("claridad")
    muletillas = metricas.get("muletillas")
    wpm = metricas.get("palabras_por_minuto")
    duracion = metricas.get("duracion_segundos")
    total_palabras = metricas.get("total_palabras")
    coherencia = metricas.get("coherencia")
    desvios = metricas.get("desvios") or []
    resumen_coherencia = metricas.get("resumen_coherencia") or ""
    manejo_tema = metricas.get("manejo_tema")
    nota_tema = metricas.get("nota_tema") or ""

    if claridad is not None:
        penalizacion = (muletillas or 0) * 5
        palabra = "muletilla" if (muletillas or 0) == 1 else "muletillas"
        motivo = (
            f"La nota parte de 100 y descuenta 5 puntos por cada muletilla "
            f"detectada ({muletillas or 0} {palabra} = -{penalizacion} puntos), "
            f"por eso queda en {claridad}."
        )
        if total_palabras:
            motivo += f" Se analizaron {total_palabras} palabras transcritas."
        agregar("claridad", "Claridad", claridad, f"{claridad}/100", motivo)

    if wpm is not None:
        if wpm < 80:
            tramo = "por debajo de 80 ppm, así que se considera lento"
        elif wpm <= 160:
            tramo = "entre 80 y 160 ppm, el tramo considerado adecuado"
        else:
            tramo = "por encima de 160 ppm, así que se considera rápido"
        motivo = (
            f"Se calcula dividiendo las palabras entre la duración de la sesión: "
            f"{wpm} palabras por minuto, {tramo}."
        )
        if duracion:
            motivo += f" La sesión duró {duracion} segundos."
        agregar("ritmo", "Ritmo", metricas.get("ritmo"), f"{wpm} ppm", motivo)

    if muletillas is not None:
        palabra = "muletilla" if muletillas == 1 else "muletillas"
        motivo = (
            f"Se detectaron {muletillas} {palabra} (como “o sea”, “es que” o “bueno”) "
            f"en el texto reconocido."
        )
        if total_palabras and muletillas:
            motivo += f" Representan 1 de cada {max(1, round(total_palabras / muletillas))} palabras."
        agregar("muletillas", "Muletillas", muletillas, str(muletillas), motivo)

    if coherencia is not None:
        total_turnos = metricas.get("turnos_evaluados")
        if total_turnos:
            base = (
                f"Se calcula restando el porcentaje de turnos con desvío sobre los "
                f"{total_turnos} turnos evaluados"
            )
        else:
            base = "Se calcula restando el porcentaje de turnos con desvío"
        motivo = f"{base}: {resumen_coherencia or 'tus respuestas siguieron el hilo'}"
        if resumen_coherencia and not resumen_coherencia.endswith("."):
            motivo += "."
        if desvios:
            motivo += f" Se marcaron {len(desvios)} desvío(s)."
        agregar("coherencia", "Coherencia", coherencia, f"{coherencia}/100", motivo)

    if manejo_tema is not None:
        motivo = nota_tema or (
            "Se mide comparando las palabras clave de tus respuestas con las del "
            "primer turno de la conversación."
        )
        agregar("manejo_tema", "Manejo del tema", manejo_tema, f"{manejo_tema}/100", motivo)

    return detalle


def _retroalimentacion_desde_analisis(analisis) -> list:
    """Reconstruye el detalle explicativo desde un análisis ya guardado en BD."""
    if analisis is None:
        return []
    metricas = {
        "claridad": analisis.claridad,
        "ritmo": analisis.ritmo,
        "muletillas": analisis.muletillas,
        "palabras_por_minuto": analisis.palabras_por_minuto,
        "duracion_segundos": getattr(analisis, "duracion_segundos", None),
        "transcripcion_completa": getattr(analisis, "transcripcion_completa", ""),
        "coherencia": getattr(analisis, "coherencia", None),
        "desvios": getattr(analisis, "desvios", []) or [],
        "resumen_coherencia": getattr(analisis, "resumen_coherencia", "") or "",
        "manejo_tema": getattr(analisis, "manejo_tema", None),
    }
    metricas["total_palabras"] = _contar_palabras_metricas(
        metricas.get("transcripcion_completa") or ""
    )
    return _retroalimentacion_detalle(metricas)


def _generar_retroalimentacion(metricas: dict) -> str:
    """Genera un texto de retroalimentación personalizado a partir de las métricas."""
    partes = []
    claridad = metricas.get("claridad")
    ritmo = metricas.get("ritmo")
    coherencia = metricas.get("coherencia")
    manejo_tema = metricas.get("manejo_tema")
    muletillas = metricas.get("muletillas")
    wpm = metricas.get("palabras_por_minuto")
    desvios = metricas.get("desvios", []) or []
    if manejo_tema is not None:
        if manejo_tema >= 70:
            partes.append("Buen manejo del tema: te mantuviste enfocado en lo que se conversó.")
        elif manejo_tema >= 40:
            partes.append("El manejo del tema fue regular; hubo algunos desvíos que podrías evitar.")
        else:
            partes.append("Se recomienda mantener el foco en el tema principal de la conversación.")
    if claridad is not None:
        if claridad >= 80:
            partes.append("Tu claridad estimada es alta.")
        elif claridad >= 50:
            partes.append("Tu claridad es aceptable; reduce las muletillas para mejorar.")
        else:
            partes.append("Tu claridad puede mejorar hablando más despacio y articulando mejor.")
    if muletillas:
        partes.append(f"Se detectaron {muletillas} posibles muletillas; haz pausas breves antes de continuar.")
    if wpm is not None:
        if wpm < 80:
            partes.append("Tu ritmo estimado es lento; procura mantener turnos de voz continuos.")
        elif wpm > 160:
            partes.append("Tu ritmo estimado es rápido; separa las ideas con pausas.")
        else:
            partes.append("Tu ritmo estimado es adecuado.")
    if coherencia is not None:
        if coherencia >= 80:
            partes.append("Mantuviste una buena coherencia con la conversación.")
        elif coherencia >= 50:
            partes.append("Hubo algunos desvíos del hilo; vuelve al tema cuando sea necesario.")
        else:
            partes.append("Se detectaron varios desvíos del hilo conversacional.")
    if desvios:
        partes.append(f"Revisa los {len(desvios)} turno(s) señalado(s) como posible desvío.")
    if not partes:
        partes.append("Sigue practicando para comparar tus resultados en sesiones futuras.")
    return " ".join(partes)


def calcular_analisis(transcripcion: str, duracion_segundos: int, mensajes: list | None = None) -> dict:
    """Calcula estimaciones de voz a partir de la transcripción y duración total."""
    if not (transcripcion or "").strip():
        return {}
    # Quitar etiquetas "Tú:" / "Personaje:" para no inflar el conteo de palabras.
    lineas_limpias = []
    for linea in transcripcion.split("\n"):
        texto = linea.strip()
        if ":" in texto:
            posible, _, resto = texto.partition(":")
            if len(posible.strip()) <= 30 and resto.strip():
                texto = resto.strip()
        if texto:
            lineas_limpias.append(texto)
    texto_metricas = " ".join(lineas_limpias) if lineas_limpias else transcripcion
    palabras = texto_metricas.split()
    total_palabras = len(palabras)

    wpm = round((total_palabras / duracion_segundos) * 60) if duracion_segundos > 0 else None

    muletillas = len(re.findall(
        r"\b(?:o\s+sea|es\s+que|eh|este|bueno|pues)\b",
        texto_metricas.lower(),
    ))

    if wpm is None:
        ritmo = None
    elif wpm < 80:
        ritmo = 40
    elif wpm < 120:
        ritmo = 70
    elif wpm < 160:
        ritmo = 100
    else:
        ritmo = 60

    claridad = max(0, min(100, 100 - muletillas * 5))
    # Coherencia: heurística local + verificación con Groq (menos falsos positivos).
    coh = _evaluar_coherencia(mensajes or [])
    # Manejo del tema y retroalimentación.
    tema = _evaluar_manejo_tema(mensajes or [], transcripcion)
    metricas_base = {
        "claridad": claridad,
        "ritmo": ritmo,
        "muletillas": muletillas,
        "pausas": None,
        "palabras_por_minuto": wpm,
        "duracion_segundos": duracion_segundos,
        "transcripcion_completa": transcripcion,
        "total_palabras": total_palabras,
        "coherencia": coh.get("coherencia"),
        "desvios": coh.get("desvios", []),
        "resumen_coherencia": coh.get("resumen", ""),
        "turnos_evaluados": coh.get("turnos_evaluados"),
        "manejo_tema": tema.get("manejo_tema"),
        "nota_tema": tema.get("nota_tema", ""),
    }
    retroalimentacion = _generar_retroalimentacion(metricas_base)
    retroalimentacion_detalle = _retroalimentacion_detalle(metricas_base)
    recomendaciones = []
    if muletillas:
        recomendaciones.append(
            f"Se detectaron {muletillas} posibles muletillas; prueba hacer una pausa breve antes de continuar."
        )
    if wpm is not None and wpm < 80:
        recomendaciones.append(
            "El ritmo estimado fue bajo al compararlo con la duración total de la sesión; procura mantener turnos de voz continuos."
        )
    elif wpm is not None and wpm > 160:
        recomendaciones.append(
            "El ritmo estimado fue alto al compararlo con la duración total de la sesión; prueba separar las ideas con pausas."
        )
    if coh.get("coherencia") is not None and coh["coherencia"] < 70 and coh.get("desvios"):
        recomendaciones.append(
            f"Coherencia {coh['coherencia']}/100: {coh['resumen']} "
            f"Revisa el turno {coh['desvios'][0]['turno']} "
            f"(dijiste: «{coh['desvios'][0]['dijo'][:120]}»)."
        )
    if tema.get("manejo_tema") is not None and tema["manejo_tema"] < 70:
        recomendaciones.append(tema["nota_tema"])
    if not recomendaciones:
        recomendaciones.append(
            "No se detectaron muletillas frecuentes en la transcripción; sigue practicando para comparar tus siguientes sesiones."
        )

    return {
        "claridad": claridad,
        "ritmo": ritmo,
        "muletillas": muletillas,
        "pausas": None,
        "palabras_por_minuto": wpm,
        "duracion_segundos": duracion_segundos,
        "transcripcion_completa": transcripcion,
        "recomendaciones": recomendaciones,
        "retroalimentacion": retroalimentacion,
        "retroalimentacion_detalle": retroalimentacion_detalle,
        "coherencia": coh.get("coherencia"),
        "desvios": coh.get("desvios", []),
        "resumen_coherencia": coh.get("resumen", ""),
        "turnos_evaluados": coh.get("turnos_evaluados"),
        "manejo_tema": tema.get("manejo_tema"),
        "nota_tema": tema.get("nota_tema", ""),
    }


def guardar_analisis_en_bd(db, sesion, mensajes: list, duracion_segundos: int, transcripcion: str = ""):
    if not transcripcion and mensajes:
        # Transcripción en formato diálogo para tabla `analisis.transcripcion_completa`.
        lineas = []
        for mensaje in mensajes:
            rol = mensaje.get("role")
            texto = (mensaje.get("content") or "").strip()
            if not texto:
                continue
            quien = "Tú" if rol == "user" else (sesion.personaje_nombre or "Bot")
            lineas.append(f"{quien}: {texto}")
        transcripcion = "\n".join(lineas)

    metricas = calcular_analisis(transcripcion, duracion_segundos, mensajes)
    analisis = (
        db.query(Analisis)
        .filter(Analisis.sesion_id == sesion.id)
        .order_by(Analisis.created_at.desc())
        .first()
    )
    if analisis is None:
        analisis = Analisis(sesion_id=sesion.id)

    analisis.claridad = metricas.get("claridad")
    analisis.ritmo = metricas.get("ritmo")
    analisis.muletillas = metricas.get("muletillas")
    analisis.pausas = metricas.get("pausas")
    analisis.palabras_por_minuto = metricas.get("palabras_por_minuto")
    analisis.duracion_segundos = metricas.get("duracion_segundos")
    analisis.transcripcion_completa = metricas.get("transcripcion_completa")
    analisis.recomendaciones = metricas.get("recomendaciones", [])
    analisis.coherencia = metricas.get("coherencia")
    analisis.desvios = metricas.get("desvios", [])
    analisis.resumen_coherencia = metricas.get("resumen_coherencia", "")
    analisis.manejo_tema = metricas.get("manejo_tema")
    analisis.retroalimentacion = metricas.get("retroalimentacion")
    db.add(analisis)
    return analisis, metricas


@app.post("/analisis/guardar")
async def guardar_analisis(req: AnalisisRequest, request: Request):
    """Calcula y guarda el análisis de una sesión."""
    with obtener_sesion_db() as db:
        sesion = (
            db.query(Sesion)
            .filter(
                Sesion.id == req.sesion_id,
                Sesion.user_id == current_user_id(request),
            )
            .one_or_none()
        )
        if sesion is None:
            raise HTTPException(status_code=404, detail="Sesión no encontrada")

        analisis, metricas = guardar_analisis_en_bd(
            db,
            sesion,
            req.mensajes,
            req.duracion_segundos,
            req.transcripcion,
        )
        db.commit()
        db.refresh(analisis)
        print(f"📊 Análisis guardado: {analisis.id}")
        return {"analisis_id": str(analisis.id), **metricas}


# =====================================================
# API: personajes personalizados (Constructor)
# =====================================================
class PersonajeCustomRequest(BaseModel):
    nombre: str = Field(min_length=1, max_length=80)
    descripcion: str = Field(min_length=1, max_length=600)
    tema: str = Field(default="", max_length=80)
    imagen_data: str | None = Field(default=None)
    voice_id: str = Field(default="fish-luis", max_length=80)


def _custom_a_dict(p) -> dict:
    return {
        "id": str(p.id),
        "nombre": p.nombre,
        "descripcion": p.descripcion,
        "tema": getattr(p, "tema", "") or "",
        "imagen_data": p.imagen_data,
        "voice_id": p.voice_id,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def _obtener_custom(db, custom_id: str, request: Request):
    try:
        uid = UUID(custom_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=404, detail="Personaje no encontrado")
    p = db.query(PersonajeCustom).filter(PersonajeCustom.id == uid).one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Personaje no encontrado")
    owner = current_user_id(request)
    # Privados por usuario: si tiene dueño y no coincide, 404.
    if p.user_id is not None and (owner is None or p.user_id != owner):
        raise HTTPException(status_code=404, detail="Personaje no encontrado")
    return p


@app.get("/api/voces")
async def listar_voces():
    """Catálogo de voces Fish Audio disponibles para el constructor."""
    return {"voces": VOICE_OPTIONS}


@app.get("/api/personajes")
async def listar_personajes(request: Request):
    """Personajes del usuario + públicos (sin dueño). Requiere login para los privados."""
    with obtener_sesion_db() as db:
        owner = current_user_id(request)
        q = db.query(PersonajeCustom).order_by(PersonajeCustom.created_at.desc())
        items = q.all() if owner is None else [p for p in q.all() if p.user_id in (None, owner)]
        # Sin login: solo públicos. Con login: públicos + propios.
        if owner is None:
            items = [p for p in items if p.user_id is None]
        return {"personajes": [_custom_a_dict(p) for p in items]}


@app.post("/api/personajes", status_code=201)
async def crear_personaje(req: PersonajeCustomRequest, request: Request):
    nombre = req.nombre.strip()
    descripcion = req.descripcion.strip()
    if not nombre or not descripcion:
        raise HTTPException(status_code=400, detail="Nombre y descripción son obligatorios")
    if req.voice_id not in FISH_VOICE_IDS:
        raise HTTPException(status_code=400, detail="Voz no válida")
    imagen = (req.imagen_data or "").strip() or None
    if imagen:
        if not imagen.startswith("data:image/"):
            raise HTTPException(status_code=400, detail="Imagen no válida")
        if len(imagen) > 700_000:
            raise HTTPException(status_code=400, detail="La imagen supera el límite permitido")
    with obtener_sesion_db() as db:
        p = PersonajeCustom(
            user_id=current_user_id(request),
            nombre=nombre[:80],
            descripcion=descripcion[:600],
            tema=(req.tema or "").strip()[:80],
            imagen_data=imagen,
            voice_id=req.voice_id,
        )
        db.add(p)
        db.commit()
        db.refresh(p)
        return _custom_a_dict(p)


@app.get("/api/personajes/{custom_id}")
async def obtener_personaje(custom_id: str, request: Request):
    with obtener_sesion_db() as db:
        uid = extraer_custom_uuid(custom_id)
        if uid:
            custom_id = uid
        return _custom_a_dict(_obtener_custom(db, custom_id, request))


@app.put("/api/personajes/{custom_id}")
async def actualizar_personaje(custom_id: str, req: PersonajeCustomRequest, request: Request):
    with obtener_sesion_db() as db:
        uid = extraer_custom_uuid(custom_id)
        if uid:
            custom_id = uid
        p = _obtener_custom(db, custom_id, request)
        # Solo el dueño (o cualquiera si es público sin login) puede editar.
        owner = current_user_id(request)
        if p.user_id is not None and (owner is None or p.user_id != owner):
            raise HTTPException(status_code=403, detail="No puedes editar este personaje")
        if req.voice_id not in FISH_VOICE_IDS:
            raise HTTPException(status_code=400, detail="Voz no válida")
        p.nombre = req.nombre.strip()[:80]
        p.descripcion = req.descripcion.strip()[:600]
        p.tema = (req.tema or "").strip()[:80]
        p.voice_id = req.voice_id
        imagen = (req.imagen_data or "").strip() or None
        if imagen and (not imagen.startswith("data:image/") or len(imagen) > 700_000):
            raise HTTPException(status_code=400, detail="Imagen no válida")
        p.imagen_data = imagen
        db.commit()
        db.refresh(p)
        return _custom_a_dict(p)


@app.delete("/api/personajes/{custom_id}")
async def eliminar_personaje(custom_id: str, request: Request):
    with obtener_sesion_db() as db:
        uid = extraer_custom_uuid(custom_id)
        if uid:
            custom_id = uid
        p = _obtener_custom(db, custom_id, request)
        owner = current_user_id(request)
        if p.user_id is not None and (owner is None or p.user_id != owner):
            raise HTTPException(status_code=403, detail="No puedes eliminar este personaje")
        db.delete(p)
        db.commit()
        return {"ok": True}


# Alias frontend (practicar.html) -> IDs reales del backend.
PERSONAJE_ALIASES = {
    "luis": "luis",
    "nova": "nova",
    "leonardo": "leonardo",
    "marcos": "marcos",
    "lucia": "lucia",
    "andres": "andres",
}


def resolver_personaje_id(personaje_id: str) -> str:
    clave = (personaje_id or "").strip().lower()
    if clave == "custom" or clave.startswith("custom-") or clave.startswith("custom_"):
        return clave
    return PERSONAJE_ALIASES.get(clave, clave)


def es_personaje_custom(personaje_id: str) -> bool:
    pid = (personaje_id or "").strip().lower()
    return pid == "custom" or pid.startswith("custom-") or pid.startswith("custom_")


def extraer_custom_uuid(personaje_id: str) -> str | None:
    pid = (personaje_id or "").strip()
    bajo = pid.lower()
    if bajo.startswith("custom-"):
        return pid[len("custom-"):]
    if bajo.startswith("custom_"):
        return pid[len("custom_"):]
    return None


# =====================================================
# API: chat con el LLM
# =====================================================
def _persona_de_chat(personaje_id: str, personaje_nombre: str | None, tema: str | None) -> dict:
    """Resuelve el personaje (custom-uuid o fijo) para los endpoints de chat."""
    if es_personaje_custom(personaje_id):
        nombre = (personaje_nombre or "").strip() or "Personaje personalizado"
        # El frontend envía la descripción en `tema` para los custom-uuid.
        descripcion = (tema or "").strip() or "una conversación general"
        return {
            "nombre": nombre,
            "voz": "es_ES-davefx-medium",
            "system": prompt_para_custom(nombre, descripcion),
        }
    personaje = PERSONAJES.get(personaje_id)
    if personaje is None:
        raise HTTPException(status_code=400, detail="Personaje no válido.")
    return personaje


def preparar_chat(req: ChatRequest):
    personaje = _persona_de_chat(req.personaje, req.personaje_nombre, req.tema)

    instrucciones_orales = (
        "Continúa la conversación actual: responde directamente sin volver a saludar, "
        "salvo que sea el primer turno. "
        "REGLA DE ORO: reacciona primero al último mensaje del usuario con una frase breve "
        "(confirma lo que entendiste o valora su respuesta) y después haz UNA sola pregunta "
        "de seguimiento coherente con tu rol. Nunca hagas dos preguntas en el mismo turno. "
        "Mantén la coherencia con lo que ya se ha dicho y con el rol que interpretas: "
        "no contradigas detalles anteriores ni ignores lo que el usuario acaba de decir. "
        "Si el usuario responde poco ('no sé', 'sí', silencio), no lo regañes: ofrece un ejemplo "
        "concreto o dos opciones y pregúntale cuál prefiere. "
        "Nunca anuncies asignaciones de rol ni hables de la simulación: no digas frases como "
        "'tú eres el candidato', 'yo soy el entrevistador', 'tú eres mi alumno' o 'tú eres mi paciente'; "
        "simplemente actúa tu papel como en la vida real, saludando y conversando con naturalidad. "
        "Habla como en una charla de verdad: primero reacciona brevemente a lo que dijo el usuario "
        "(una frase corta de reacción o confirmación) y después lanza como máximo una pregunta. "
        "Usa frases cortas, lenguaje cotidiano y expresiones habladas; muletillas ocasionales como "
        "'a ver', 'vale', 'ya veo', 'hmm' o 'venga' están bien si suenan naturales, pero sin exceso. "
        "No suenes a guion ni a formulario: varía el ritmo y muestra interés genuino por lo que dice. "
        "Si el usuario duda o responde poco, propón un tema concreto "
        "y pregúntale si le da curiosidad o si prefiere traer su propio tema. "
        "No uses Markdown, tablas, encabezados, barras verticales ni listas; "
        "explica cualquier comparación en frases sencillas. "
        "Responde en español."
    )
    mensajes = [{
        "role": "system",
        "content": f"{personaje['system']} {instrucciones_orales}",
    }]
    historial = req.historial or []
    if (
        historial
        and historial[-1].get("role") == "user"
        and historial[-1].get("content") == req.mensaje
    ):
        historial = historial[:-1]
    # Recortar a últimos 12 turnos para mantener hilo sin saturar el modelo.
    for turno in historial[-12:]:
        rol = turno.get("role")
        contenido = (turno.get("content") or "")[:1500]
        if rol in {"user", "assistant"} and contenido.strip():
            mensajes.append({"role": rol, "content": contenido})
    mensajes.append({"role": "user", "content": (req.mensaje or "")[:1500]})
    return personaje, mensajes


def _generar_respuesta_chat(mensajes: list[dict]) -> str:
    completion = get_groq_client().chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=mensajes,
        temperature=0.55,
        # gpt-oss-20b gasta tokens en razonamiento dentro del mismo presupuesto:
        # con 180Tokens podia agotar el limite y devolver content vacio (502).
        max_tokens=320,
        reasoning_effort="low",
    )
    respuesta = completion.choices[0].message.content or ""
    if not respuesta.strip():
        raise RuntimeError("Groq devolvió una respuesta vacía")
    # Limpieza: quitar marcas internas [EN]/[ES] y recortar a 4 frases
    # (menos texto = menos espera en STT->LLM->TTS).
    respuesta = re.sub(r"\[(EN|ES)\]\s*", "", respuesta).strip()
    partes = re.split(r"(?<=[.!?¿¡])\s+", respuesta)
    # 4 frases: con 3 se perdia la exigencia final del personaje (p.ej. el
    # cliente se queda sin decir que espera una solucion concreta).
    if len(partes) > 4:
        respuesta = " ".join(partes[:4]).strip()
    return respuesta


def _sintetizar_fish(texto: str, personaje: str, voz: str | None = None) -> bytes | None:
    """Devuelve el mp3 de Fish o None si no hay voz configurada. No lanza."""
    # Etiqueta emocional inicial (Fish S1/S2 la interpreta como tono).
    emociones_fish = {
        "andres": "confident",
        "luis": "friendly",
        "leonardo": "friendly",
        "nova": "excited",
        # Marcos: molesto / incrédulo (suspiros, bufidos).
        "marcos": "annoyed",
        # Lucía: enfermera serena y empática.
        "lucia": "empathetic",
    }
    # Marcas paralingüísticas que el LLM ya puede traer en el texto
    # (suspiros, risas). Se conservan: humanizan la voz.
    # Y según el personaje se añade UNA al inicio para dar carácter.
    humanizadores = {
        "marcos": "",
        "lucia": "",
        "luis": "(chuckle) ",
    }
    personaje_real = resolver_personaje_id(personaje)
    character_voice_ids = {
        "andres": FISH_ANDRES_VOICE_ID,
        "luis": FISH_LUIS_VOICE_ID,
        "leonardo": FISH_LEONARDO_VOICE_ID,
        "nova": FISH_NOVA_VOICE_ID,
        "lucia": FISH_LUCIA_VOICE_ID,
        "marcos": FISH_MARCOS_VOICE_ID,
    }
    reference_id = None
    if voz in FISH_VOICE_IDS:
        reference_id = FISH_VOICE_IDS.get(voz)
    reference_id = reference_id or character_voice_ids.get(personaje) or character_voice_ids.get(personaje_real)
    if not reference_id or not os.getenv("FISH_API_KEY"):
        return None
    texto = (texto or "").strip()
    if not texto:
        return None
    emocion = emociones_fish.get(personaje_real, "friendly")
    if not texto.startswith("["):
        texto = f"[{emocion}] {texto}"
    extra = humanizadores.get(personaje_real, "")
    if extra and extra not in texto:
        # Se inserta tras la etiqueta emocional para no romperla.
        texto = texto.replace(f"[{emocion}] ", f"[{emocion}] {extra}", 1)
    try:
        try:
            return get_fish_client().tts.convert(
                text=texto,
                reference_id=reference_id,
                model=FISH_MODEL,
                # Marcos: expresivo pero sin exagerar (menos variación = menos suspiros).
                temperature=0.75 if personaje_real == "marcos" else 0.8,
                top_p=0.85,
                # prosody={"speed": 1.0, "volume": 0},
                # Chunks más cortos + sin normalizar = primera respuesta más rápida.
                chunk_length=120,
                normalize=False,
            )
        except TypeError:
            return get_fish_client().tts.convert(
                text=texto,
                reference_id=reference_id,
                model=FISH_MODEL,
            )
    except Exception:
        logger.exception("Fish Audio no pudo sintetizar (personaje=%s).", personaje_real)
        return None


@app.post("/chat")
async def chat(req: ChatRequest):
    req.personaje = resolver_personaje_id(req.personaje)
    _, mensajes = preparar_chat(req)

    try:
        respuesta = _generar_respuesta_chat(mensajes)
        logger.info("Groq chat completed (%d characters).", len(respuesta))
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Groq no pudo generar la respuesta.")
        raise HTTPException(
            status_code=502,
            detail="El servicio de conversación no pudo generar una respuesta. Inténtalo de nuevo.",
        ) from error

    return {"respuesta": respuesta}


@app.post("/chat/nudge")
async def chat_nudge(req: ChatNudgeRequest):
    """Frase corta en personaje para retomar la conversación cuando el usuario calla.

    Usado por Practicar y Simulación tras unos segundos de silencio: la IA reacciona
    al historial real en vez de mandar una frase fija.
    """
    personaje = _persona_de_chat(resolver_personaje_id(req.personaje), req.personaje_nombre, req.tema)
    instrucciones_nudge = (
        "Tu interlocutor lleva un rato sin responder después de tu último mensaje. "
        "Manda UNA sola frase breve (máximo 20 palabras), en tu personaje, que reaccione "
        "a lo último dicho y lo invite a seguir sin presionar ni regañar. "
        "No vuelvas a saludar, no repitas preguntas ya hechas y no menciones que esto "
        "es un recordatorio automático: actúa como en una charla de verdad. "
        "No uses markdown. Responde en español."
    )
    mensajes = [{"role": "system", "content": f"{personaje['system']} {instrucciones_nudge}"}]
    for turno in (req.historial or [])[-12:]:
        rol = turno.get("role")
        contenido = (turno.get("content") or "")[:1500]
        if rol in {"user", "assistant"} and contenido.strip():
            mensajes.append({"role": rol, "content": contenido})
    mensajes.append({
        "role": "user",
        "content": "(Tu interlocutor sigue en silencio. Retoma tú la conversación con una sola frase breve en tu rol.)",
    })

    try:
        respuesta = _generar_respuesta_chat(mensajes)
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Groq no pudo generar el recordatorio de silencio.")
        raise HTTPException(
            status_code=502,
            detail="El servicio de conversación no pudo generar el recordatorio.",
        ) from error

    return {"respuesta": respuesta}


@app.post("/chatvoz")
async def chatvoz(req: ChatRequest):
    """Chat + voz en 1 sola llamada: evita el viaje extra /chat -> /tts.

    Devuelve {"respuesta": texto, "audio_b64": mp3 en base64 o null}.
    El frontend muestra el texto Y reproduce el audio al mismo tiempo.
    """
    req.personaje = resolver_personaje_id(req.personaje)
    _, mensajes = preparar_chat(req)
    try:
        respuesta = _generar_respuesta_chat(mensajes)
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Groq no pudo generar la respuesta.")
        raise HTTPException(
            status_code=502,
            detail="El servicio de conversación no pudo generar una respuesta. Inténtalo de nuevo.",
        ) from error
    audio = _sintetizar_fish(respuesta, req.personaje, req.voz)
    return {
        "respuesta": respuesta,
        "audio_b64": base64.b64encode(audio).decode("ascii") if audio else None,
        "mime": "audio/mpeg" if audio else None,
    }


# =====================================================
# API: simulación de aula con DOS alumnos
# =====================================================
@app.post("/chat/aula")
def chat_aula(req: AulaRequest):
    """Devuelve los turnos de DOS alumnos que reaccionan a la clase del usuario.

    Cada turno indica qué alumno habla (leonardo / luis) para que el frontend
    pueda sintetizar su voz con Fish Audio usando la voz propia de cada uno.
    """
    id_a = resolver_personaje_id(req.personaje_a or "leonardo")
    id_b = resolver_personaje_id(req.personaje_b or "luis")
    alumno_a = PERSONAJES.get(id_a)
    alumno_b = PERSONAJES.get(id_b)
    if alumno_a is None or alumno_b is None:
        raise HTTPException(status_code=400, detail="Personaje no válido para el aula.")
    if id_a == id_b:
        raise HTTPException(status_code=400, detail="El aula necesita dos alumnos distintos.")

    system = (
        "Simulas una clase en la que hay DOS alumnos que conversan con su profesor: el usuario.\n"
        f"ALUMNO_A se llama {alumno_a['nombre']}. ALUMNO_B se llama {alumno_b['nombre']}.\n\n"
        f"Personalidad de {alumno_a['nombre']} (ALUMNO_A):\n{alumno_a['system']}\n\n"
        f"Personalidad de {alumno_b['nombre']} (ALUMNO_B):\n{alumno_b['system']}\n\n"
        "FLUJO DE LA CLASE (sigúelo según lo que ya se haya dicho en la conversación):\n"
        "1. AL EMPEZAR: si todavía no han preguntado qué tema verán hoy, pregúntaselo al profesor. "
        "Solo UN alumno lanza la pregunta; el otro asiente o suma una frase corta. No presupongas "
        "ni inventes el tema.\n"
        "2. TRAS LA EXPLICACIÓN DEL TEMA: si el profesor acaba de contar o mencionar el tema de hoy, "
        "muestra dudas o curiosidades reales SOBRE ESE mismo tema (nunca cambies de tema): pide un "
        "ejemplo, pregunta por partes que no quedaron claras o preguntas qué se estudia exactamente.\n"
        "3. TRAS ACLARAR LAS DUDAS: cuando el tema haya quedado claro, pide practicar: un alumno propone "
        "un ejercicio concreto del tema y el otro puede sumar uno más pequeño; el profesor los guiará.\n"
        "4. DURANTE EL EJERCICIO: si el profesor da un ejercicio o un paso, reacciona como alumno real: "
        "intenta el siguiente paso en voz alta, pregunta si vas bien y muestra dudas puntuales.\n"
        "REGLAS DE RESPUESTA (estrictas):\n"
        "- Genera EXACTAMENTE DOS intervenciones por respuesta: primero ALUMNO_A y despues ALUMNO_B.\n"
        "- Cada alumno habla una sola vez por ronda; nunca escribe dos turnos seguidos ni interrumpe al otro.\n"
        "- Responde SOLO con turnos en este formato exacto, uno por línea:\n"
        "  ALUMNO_A: lo que dice el alumno A.\n"
        "  ALUMNO_B: lo que dice el alumno B.\n"
        "- Cada intervención debe durar 1 o 2 frases como mucho, en español coloquial de estudiante.\n"
        "- Ambos deben reaccionar al profesor o al turno anterior del otro y mantener el hilo de la clase.\n"
        "- Reacciona a lo que el profesor acaba de explicar y, si el otro alumno ya habló, a lo que él dijo.\n"
        "- Un alumno puede mostrar dudas y el otro confirmar que entendió (o al revés).\n"
        "- Nunca expliques como profesor: tú eres quien aprende, pregunta y reacciona.\n"
        "- Nada de markdown, listas ni ecuaciones largas: solo frases habladas naturales.\n"
        "- Las etiquetas ALUMNO_A/ALUMNO_B son solo para marcar quién habla: no las menciones ni las leas en voz alta.\n"
    )
    mensajes = [{"role": "system", "content": system}]
    historial = req.historial or []
    if (
        historial
        and historial[-1].get("role") == "user"
        and historial[-1].get("content") == req.mensaje
    ):
        historial = historial[:-1]
    for turno in historial[-12:]:
        rol = turno.get("role")
        contenido = (turno.get("content") or "")[:1200]
        if rol in {"user", "assistant"} and contenido.strip():
            mensajes.append({"role": rol, "content": contenido})
    mensajes.append({"role": "user", "content": f"El profesor dice: {(req.mensaje or '')[:1200]}"})

    try:
        completion = get_groq_client().chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=mensajes,
            temperature=0.75,
            max_tokens=240,
            reasoning_effort="low",
        )
        respuesta = completion.choices[0].message.content or ""
        if not respuesta.strip():
            raise RuntimeError("Groq devolvió una respuesta vacía")
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Groq no pudo generar la respuesta del aula.")
        raise HTTPException(
            status_code=502,
            detail="El servicio de conversación no pudo generar la respuesta del aula. Inténtalo de nuevo.",
        ) from error

    etiquetas = {
        "ALUMNO_A": (id_a, alumno_a["nombre"]),
        "ALUMNO_B": (id_b, alumno_b["nombre"]),
    }
    patron_turno = re.compile(r"^\s*(?:\[.*?\]\s*)?(ALUMNO_A|ALUMNO_B)\s*:\s*(.+)$")
    turnos: list[dict[str, str]] = []
    sueltos: list[str] = []
    for linea in respuesta.splitlines():
        crudo = re.sub(r"\[(EN|ES)\]\s*", "", linea).strip()
        if not crudo:
            continue
        match = patron_turno.match(crudo)
        if match:
            personaje_id, nombre = etiquetas[match.group(1)]
            turnos.append({
                "personaje": personaje_id,
                "nombre": nombre,
                "texto": match.group(2).strip(),
            })
        elif turnos:
            turnos[-1]["texto"] = f"{turnos[-1]['texto']} {crudo}".strip()
        else:
            sueltos.append(crudo)

    if not turnos:
        # Fallback: el modelo no usó etiquetas; se atribuye todo al alumno A.
        texto = re.sub(r"^\s*[A-Za-zÁÉÍÓÚÑáéíóúñ ]{2,30}:\s*", "", respuesta).strip() or respuesta.strip()
        turnos.append({"personaje": id_a, "nombre": alumno_a["nombre"], "texto": texto})
    elif sueltos:
        turnos[0]["texto"] = f"{turnos[0]['texto']} {' '.join(sueltos)}".strip()

    turnos = [
        {**turno, "texto": re.sub(r"\s+", " ", turno["texto"]).strip()}
        for turno in turnos[:3]
        if turno["texto"].strip()
    ]
    if not turnos:
        raise HTTPException(status_code=502, detail="Los alumnos no pudieron responder. Inténtalo de nuevo.")

    logger.info("Groq aula completed (%d turnos, %d characters).", len(turnos), len(respuesta))
    return {"turnos": turnos}


@app.post("/aulavoz")
async def aulavoz(req: AulaRequest):
    """Aula + voces en 1 sola llamada: cada turno ya trae su audio.

    Devuelve {"turnos": [{personaje, nombre, texto, audio_b64}]}.
    El frontend muestra CADA texto justo cuando empieza su audio.
    """
    base = chat_aula(req)
    turnos = base.get("turnos", []) if isinstance(base, dict) else []
    for turno in turnos:
        audio = _sintetizar_fish(turno.get("texto", ""), turno.get("personaje", ""))
        turno["audio_b64"] = base64.b64encode(audio).decode("ascii") if audio else None
    return {"turnos": turnos}


def resolver_ejercicio_logica(personaje: str, ejercicio: str, tema: str | None = None) -> str:
    """Lógica interna para que un alumno resuelva un ejercicio paso a paso.

    Reutilizable tanto por el endpoint /resolver-ejercicio como por el flujo
    del aula (/chat/aula) cuando un alumno debe resolver un ejercicio propuesto.
    """
    ejercicio = (ejercicio or "").strip()
    if not ejercicio:
        raise HTTPException(status_code=400, detail="Escribe el ejercicio antes de enviarlo.")

    tema = (tema or "").strip()
    personaje = resolver_personaje_id(personaje or "leonardo")
    info = PERSONAJES.get(personaje, PERSONAJES["leonardo"])
    nombre = info["nombre"]

    materia = "programación" if personaje == "luis" else "matemáticas"
    sistema = (
        f"Eres {nombre}, un alumno de {materia} resolviendo un ejercicio que le dejó su profesor. "
        "Resuélvelo PASO A PASO en voz alta, como lo harías delante de tu profesor en clase. "
        "Escribe cada operación y explica qué haces y por qué, con frases breves y naturales de estudiante "
        "('vale', 'entonces', 'si paso el siete al otro lado...'). "
        "IMPORTANTE: puedes cometer pequeños errores de cálculo, de signo o de lógica de vez en cuando, "
        "como un alumno real; NO eres perfecto. Pero llega hasta un resultado final. "
        "Al final, muestra tu resultado y pregunta al profesor si lo has hecho bien. "
        "No uses Markdown ni encabezados; escribe el razonamiento en texto simple y claro."
    )
    if tema:
        sistema += f" El ejercicio es del tema de {tema}."
    mensajes = [
        {"role": "system", "content": sistema},
        {"role": "user", "content": f"Este es el ejercicio que me dejaste, profe:\n{ejercicio}\n\n¿Lo resuelvo aquí?"},
    ]

    try:
        completion = get_groq_client().chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=mensajes,
            temperature=0.8,
            max_tokens=600,
            reasoning_effort="medium",
        )
        respuesta = completion.choices[0].message.content or ""
        if not respuesta.strip():
            raise RuntimeError("Groq devolvió una respuesta vacía")
        logger.info("%s resolvió el ejercicio (%d characters).", nombre, len(respuesta))
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Groq no pudo generar la resolución del ejercicio.")
        raise HTTPException(
            status_code=502,
            detail="El servicio de conversación no pudo generar la resolución. Inténtalo de nuevo.",
        ) from error

    return respuesta.strip()


@app.post("/resolver-ejercicio")
def resolver_ejercicio(req: ResolverEjercicioRequest):
    """El alumno (Leonardo o Luis) intenta resolver el ejercicio que le asignó"
    su profesor. Resuelve paso a paso como un alumno: puede tener pequeños
    errores que el profesor deberá detectar. Devuelve el razonamiento en voz alta."""
    respuesta = resolver_ejercicio_logica(req.personaje, req.ejercicio, req.tema)
    return {"respuesta": respuesta}


# =====================================================
# API: TTS con Fish Audio o Piper
# =====================================================
@app.post("/tts")
def tts(req: TTSRequest):
    # Emoción por personaje (Fish interpreta [etiqueta] al inicio del texto).
    emociones_fish = {
        "andres": "confident",
        "luis": "friendly",
        "leonardo": "friendly",
        "nova": "excited",
        "marcos": "annoyed",
        "lucia": "empathetic",
    }
    personaje_real = resolver_personaje_id(req.personaje)
    character_voice_ids = {
        "andres": FISH_ANDRES_VOICE_ID,
        "luis": FISH_LUIS_VOICE_ID,
        "leonardo": FISH_LEONARDO_VOICE_ID,
        "nova": FISH_NOVA_VOICE_ID,
        "lucia": FISH_LUCIA_VOICE_ID,
        "marcos": FISH_MARCOS_VOICE_ID,
    }
    if req.personaje in character_voice_ids or req.voz in FISH_VOICE_IDS or es_personaje_custom(req.personaje) or es_personaje_custom(personaje_real):
        reference_id = FISH_VOICE_IDS.get(req.voz) or character_voice_ids.get(req.personaje) or character_voice_ids.get(personaje_real)
        if es_personaje_custom(req.personaje) or es_personaje_custom(personaje_real):
            # Los customs usan la voz Fish elegida en el constructor (req.voz = fish-*).
            reference_id = FISH_VOICE_IDS.get(req.voz) or FISH_LUIS_VOICE_ID
        if not reference_id:
            raise HTTPException(status_code=400, detail="No hay una voz Fish configurada para este personaje.")
        nombre_personaje = PERSONAJES.get(personaje_real, {"nombre": "personaje personalizado"})["nombre"]
        if (not PERSONAJES.get(personaje_real)) and (req.personaje_nombre or "").strip():
            nombre_personaje = req.personaje_nombre.strip()
        # Texto con marcador emocional S2 + marca humana según personaje.
        texto = (req.text or "").strip()
        emocion = emociones_fish.get(personaje_real, "friendly")
        if texto and not texto.startswith("["):
            texto = f"[{emocion}] {texto}"
        humanizadores = {"marcos": "", "luis": "(chuckle) ", "lucia": ""}
        extra = humanizadores.get(personaje_real, "")
        if extra and extra not in texto:
            texto = texto.replace(f"[{emocion}] ", f"[{emocion}] {extra}", 1)
        try:
            try:
                audio_bytes = get_fish_client().tts.convert(
                    text=texto,
                    reference_id=reference_id,
                    model=FISH_MODEL,
                    temperature=0.75 if personaje_real == "marcos" else 0.8,
                    top_p=0.85,
                    # prosody={"speed": 1.0, "volume": 0},
                    chunk_length=120,
                    normalize=False,
                )
            except TypeError:
                # SDK antiguo sin esos parámetros: llamada básica.
                audio_bytes = get_fish_client().tts.convert(
                    text=texto,
                    reference_id=reference_id,
                    model=FISH_MODEL,
                )
            return Response(content=audio_bytes, media_type="audio/mpeg")
        except HTTPException:
            raise
        except Exception as error:
            print(f"❌ Error en Fish Audio para {nombre_personaje}: {error}")
            raise HTTPException(
                status_code=502,
                detail=f"No se pudo generar la voz de {nombre_personaje}",
            ) from error

    personaje = PERSONAJES.get(personaje_real)
    if personaje is None:
        if es_personaje_custom(personaje_real) or es_personaje_custom(req.personaje):
            # Customs siempre tienen voz Fish (rama anterior); si llegó aquí, falta texto.
            raise HTTPException(status_code=400, detail="No hay una voz Fish configurada para este personaje.")
        raise HTTPException(status_code=400, detail="Personaje no válido.")
    nombre_voz = req.voz if req.voz in VOCES_DISPONIBLES else personaje["voz"]
    voz = cargar_voz(nombre_voz)

    audio_buffer = io.BytesIO()
    with wave.open(audio_buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(voz.config.sample_rate)
        for chunk in voz.synthesize(req.text):
            wav_file.writeframes(chunk.audio_int16_bytes)

    return Response(content=audio_buffer.getvalue(), media_type="audio/wav")


# =====================================================
# API: STT con Groq Whisper
# =====================================================
@app.post("/stt")
async def stt(audio: UploadFile = File(...), personaje: str = Form("luis")):
    personaje = resolver_personaje_id(personaje)
    if personaje not in PERSONAJES and not es_personaje_custom(personaje):
        raise HTTPException(status_code=400, detail="Personaje no válido.")
    contenido = await audio.read()

    if len(contenido) < 1024:
        raise HTTPException(status_code=422, detail="La grabación es demasiado corta. Mantén pulsado el micrófono un poco más.")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
        tmp.write(contenido)
        tmp_path = tmp.name

    texto = ""
    idioma = "es"

    try:
        with open(tmp_path, "rb") as f:
            opciones_transcripcion = {
                "file": (audio.filename or "audio.webm", f.read()),
                # turbo = misma calidad aprox, ~2-3x más rápido que large-v3
                "model": "whisper-large-v3-turbo",
                "response_format": "text",
                "language": "es",
            }
            transcription = get_groq_client().audio.transcriptions.create(**opciones_transcripcion)
        texto = transcription.strip()
        logger.info("Groq STT completed (%d characters).", len(texto))
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Groq no pudo transcribir el audio.")
        raise HTTPException(
            status_code=502,
            detail="El servicio de transcripción no pudo procesar el audio. Inténtalo de nuevo.",
        ) from error
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    return {"texto": texto, "idioma": idioma}

    

if __name__ == "__main__":
    import uvicorn
    import os
    
    HOST = os.getenv("HOST", "0.0.0.0")
    PUERTO = int(os.getenv("PORT", 8000))

    def _puerto_en_uso(host: str, puerto: int) -> bool:
        """True si otro proceso ya tiene el puerto (suele ser otro Verbia)."""
        import socket
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind((host, puerto))
                return False
        except OSError:
            return True

    if _puerto_en_uso(HOST, PUERTO):
        print(f"⚠️  El puerto {PUERTO} ya está en uso. Puede que haya otra instancia de Verbia corriendo.")
        print("   Si estás en desarrollo, cierra la otra instancia o cambia el puerto.")

    uvicorn.run("server:app", host=HOST, port=PUERTO)
