"""
Extrae perfiles de cliente RICOS desde transcripciones Fathom para roleplay de ventas.

Salida (JSONL, retomable): scripts/data/profiles.jsonl

Uso:
    python scripts/extract-call-profiles.py --csv "...transcripts.csv" --limit 5
    python scripts/extract-call-profiles.py --csv "..." --limit 1000 --nicho trading
"""
from __future__ import annotations
import argparse, csv, json, os, re, sys, time, hashlib, urllib.request, urllib.error
from pathlib import Path

csv.field_size_limit(10**8)

GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

EXTRACTION_PROMPT = """Eres un analista experto en llamadas de venta. Recibes el RESUMEN y CITAS de una llamada de venta EXITOSA (cerrada) del nicho "{nicho}".

CONTEXTO CRITICO: TODAS las llamadas en el dataset cerraron. Esto significa:
- NO te interesa el resultado (siempre es "cerro").
- Te interesa el ESTADO INICIAL del cliente: como llego a la llamada (escepticismo, resistencia, dudas, presupuesto, miedos).
- Te interesa el JOURNEY: que objeciones surgieron, en que orden, cuales eran reales vs superficiales, que del closer las disolvio.
- Te interesa la RESISTENCIA REAL: algunas llamadas cierran facil, otras requieren batalla. Eso define la dificultad del roleplay.

Tu tarea: extraer un perfil RICO del CLIENTE (no del closer) que un agente de IA usara para SIMULAR el ESTADO INICIAL Y EVOLUCION de este cliente en un roleplay donde el alumno (closer en entrenamiento) debe lograr el cierre. El agente debe arrancar el roleplay con el cliente en su estado pre-llamada, no post-cierre.

Devuelve SOLO un JSON valido con este esquema EXACTO:
{{
  "demografia": {{
    "genero": "M | F | desconocido",
    "edad_aprox": "string corto o null (ej: '18-25', '40+')",
    "pais": "string o null",
    "ocupacion": "string corto o null",
    "situacion_familiar": "string corto o null (ej: 'soltero', 'casado, 2 hijos', 'apoya a madre en Espana')"
  }},
  "psicografia": {{
    "tono_inicial": "string corto (ej: 'esceptico', 'entusiasta', 'frustrado', 'cauteloso')",
    "tono_final": "string corto",
    "nivel_experiencia": "novato | principiante | intermedio | avanzado",
    "estilo_decision": "impulsivo | analitico | necesita_pensarlo | consulta_con_pareja_familia | indeterminado",
    "relacion_con_dinero": "abundante | comodo | ajustado | endeudado | sin_definir",
    "confianza_en_si_1_5": 3,
    "urgencia_dolor_1_5": 3,
    "resistencia_al_cierre_1_5": 3,
    "estilo_habla": "formal | coloquial | mixto",
    "muletillas": ["palabras o tics verbales recurrentes; vacio si no hay claros"],
    "regionalismos": ["palabras o expresiones regionales notorias; vacio si no hay"]
  }},
  "narrativa": {{
    "motivacion_principal": "1 frase",
    "dolor_principal": "1 frase",
    "que_lo_trajo_a_la_llamada": "1 frase (ej: 'vio video de Sensei en YouTube hace meses')",
    "experiencia_previa_relacionada": "1 frase o null (ej: 'ya intento otra academia y no funciono', 'ya quemo cuentas fondeadas')"
  }},
  "objeciones": [
    {{
      "objecion": "string en palabras del cliente",
      "tipo": "precio | tiempo | confianza | pareja_familia | comparacion | urgencia | tecnica | metodo_pago | otro",
      "profundidad": "superficial | real",
      "orden": 1
    }}
  ],
  "preguntas_tipicas_del_cliente": ["3-7 preguntas que el CLIENTE hizo, en su voz exacta o casi"],
  "frases_cliente": ["5-10 frases TEXTUALES que muy probablemente dijo el CLIENTE (NO el closer). Si dudas, omite. Mejor menos pero seguras."],
  "arco_llamada": [
    "1. Estado inicial (1 frase)",
    "2. Momento de inflexion (1 frase)",
    "3. Estado final / decision (1 frase)"
  ],
  "triggers_efectivos": ["frases o tecnicas del closer que MOVIERON al cliente (max 4)"],
  "casi_rompedores": ["momentos que casi rompen la llamada o casi pierden al cliente (max 3)"],
  "comercial": {{
    "presupuesto_inicial": "string corto o null (lo que el cliente dijo poder pagar al inicio)",
    "presupuesto_final_aceptado": "string corto o null (lo que termino pagando)",
    "plan_pago": "string corto o null (ej: '2 cuotas de $1500', 'deposito $300 + resto luego')",
    "razon_de_cierre": "1 frase (que termino convenciendo al cliente)"
  }},
  "arquetipo": "etiqueta corta de 3-6 palabras (ej: 'trader autodidacta frustrado, busca libertad')",
  "dificultad_roleplay_1_5": 3,
  "valor_para_entrenamiento": "string: por que esta llamada es valiosa para entrenar a un closer (1 frase, ej: 'multiples objeciones de presupuesto encadenadas, requirio fraccionar pago')"
}}

REGLAS CRITICAS:
- frases_cliente: NUNCA pongas frases que parezcan del closer (preguntas de discovery, presentacion de oferta, manejo de objeciones, llamadas a la accion, "vale?", "voy a explicarte..."). En la duda, OMITE.
- frases_cliente deben sonar como respuestas/preguntas/dudas/resistencias del cliente. Ejemplos buenos: "yo gano al mes dos mil", "tengo que consultarlo con mi esposa", "no se si esto sea para mi".
- objeciones.profundidad="superficial" si fue una objecion de fachada que se resolvio rapido; "real" si era una resistencia de fondo.
- objeciones.orden = orden cronologico aproximado (1 = primera).
- Los campos numericos 1_5: 1=muy bajo, 5=muy alto.
- Si un campo no se infiere con razonable certeza, usa null o [] o "indeterminado".
- NO inventes hechos. Si no esta en resumen ni citas, no lo pongas.
- Espanol neutro.

=== RESUMEN ===
{summary}

=== CITAS ===
{quotes}
"""

# ---------------- helpers ----------------

def clean_transcript_text(raw: str) -> tuple[str, str]:
    if not raw:
        return "", ""
    text = raw.replace("\r", "")
    lines = text.split("\n")
    start = 0
    for i, line in enumerate(lines[:30]):
        s = line.strip()
        if s.startswith("Propósito") or s.startswith("Proposito") or s.startswith("Purpose"):
            start = i
            break
        if s == "Copy Summary":
            start = i + 1
            break
    body = "\n".join(lines[start:]).strip()
    quote_pattern = re.compile(r'[“"]([^“”"]{30,}?)[”"]', re.DOTALL)
    quotes = [m.group(1).strip() for m in quote_pattern.finditer(body)]
    summary = body
    if quotes:
        first_q_marker = '"' + quotes[0]
        idx = body.find(first_q_marker)
        if idx == -1:
            idx = body.find('“' + quotes[0])
        if idx > 200:
            summary = body[:idx].strip()
    summary = summary[:7000]
    quotes_block = "\n- " + "\n- ".join(q[:400] for q in quotes[:50]) if quotes else "(sin citas)"
    return summary, quotes_block


def stable_id(row: dict, idx: int) -> str:
    seed = row.get("Email") or row.get("Phone") or row.get("Link de grabacion")
    if not seed:
        # buscar URL fathom.video en cualquier columna
        for v in row.values():
            if isinstance(v, str) and "fathom.video" in v:
                seed = v
                break
    seed = (seed or f"row{idx}").strip().lower()
    return f"call_{hashlib.sha1(seed.encode('utf-8')).hexdigest()[:10]}"


def call_gemini(api_key: str, prompt: str, retries: int = 3) -> dict | None:
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"},
    }
    data = json.dumps(body).encode("utf-8")
    url = f"{GEMINI_URL}?key={api_key}"
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=180) as resp:
                payload = json.loads(resp.read())
            text = payload["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text)
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code}: {e.read()[:200].decode('utf-8','ignore')}"
            time.sleep(2 ** attempt)
        except Exception as e:
            last_err = str(e)
            time.sleep(2 ** attempt)
    print(f"    ! gemini fail: {last_err}", file=sys.stderr)
    return None


def load_processed_ids(out_path: Path) -> set[str]:
    if not out_path.exists():
        return set()
    ids = set()
    with out_path.open("r", encoding="utf-8") as f:
        for line in f:
            try:
                ids.add(json.loads(line)["id"])
            except Exception:
                pass
    return ids


def load_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key
    env_path = Path(__file__).resolve().parent.parent / ".env.local"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("GEMINI_API_KEY="):
                return line.split("=", 1)[1].strip()
    raise SystemExit("GEMINI_API_KEY no encontrado")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--out", default="scripts/data/profiles.jsonl")
    ap.add_argument("--nicho", default="trading")
    ap.add_argument("--limit", type=int, default=5)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--min-words", type=int, default=200)
    ap.add_argument("--sleep", type=float, default=0.4, help="segundos entre requests")
    args = ap.parse_args()

    api_key = load_api_key()
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    done = load_processed_ids(out_path)
    print(f"Ya procesadas: {len(done)}")

    with open(args.csv, "r", encoding="utf-8-sig") as f:
        all_rows = list(csv.DictReader(f))
    print(f"Filas CSV: {len(all_rows)}")

    candidates = []
    for i, row in enumerate(all_rows):
        if row.get("status") == "empty":
            continue
        try:
            wc = int(row.get("word_count") or 0)
        except ValueError:
            wc = 0
        if wc < args.min_words:
            continue
        candidates.append((i, row))
    print(f"Candidatas (status ok + words>={args.min_words}): {len(candidates)}")
    candidates = candidates[args.offset : args.offset + args.limit]
    print(f"Ventana a procesar: {len(candidates)}\n")

    written = 0
    failed = 0
    with out_path.open("a", encoding="utf-8") as out_f:
        for n, (idx, row) in enumerate(candidates, 1):
            cid = stable_id(row, idx)
            if cid in done:
                continue
            summary, quotes = clean_transcript_text(row.get("transcript_text", ""))
            if not summary and quotes == "(sin citas)":
                continue
            prompt = EXTRACTION_PROMPT.format(nicho=args.nicho, summary=summary, quotes=quotes)
            nombre = (row.get("Nombre y apellido") or "?")[:38]
            print(f"[{n}/{len(candidates)}] {cid}  {nombre:38s}  ({row.get('word_count')} pal)")
            perfil = call_gemini(api_key, prompt)
            if not perfil:
                failed += 1
                continue
            record = {
                "id": cid,
                "nicho": args.nicho,
                "nombre": row.get("Nombre y apellido"),
                "email": row.get("Email"),
                "closer": row.get("Otro Closer") or row.get("Closer"),
                "link": row.get("Link de grabacion"),
                "duration_minutes": row.get("duration_minutes"),
                "word_count": row.get("word_count"),
                "summary_clean": summary,
                "perfil": perfil,
            }
            out_f.write(json.dumps(record, ensure_ascii=False) + "\n")
            out_f.flush()
            written += 1
            if args.sleep:
                time.sleep(args.sleep)

    print(f"\nEscritos: {written}  Fallidos: {failed}  ->  {out_path}")


if __name__ == "__main__":
    main()
