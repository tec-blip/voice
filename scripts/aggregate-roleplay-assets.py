"""
Agrega los perfiles individuales en activos listos para el agente roleplay:
  - archetypes.json         : 8-12 arquetipos representativos (clusters)
  - objections_library.json : objeciones unicas tipadas con frecuencia y ejemplos
  - scenario_briefs.json    : 30 escenarios listos para inyectar al agente, con dificultad
  - dataset_stats.json      : estadisticas del dataset (genero, pais, dificultad, etc)

Uso:
    python scripts/aggregate-roleplay-assets.py --in scripts/data/profiles.jsonl --out scripts/data
"""
from __future__ import annotations
import argparse, json, os, sys, time, urllib.request, urllib.error
from collections import Counter, defaultdict
from pathlib import Path

GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"


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


def call_gemini(api_key: str, prompt: str, retries: int = 3) -> dict | None:
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.3, "responseMimeType": "application/json"},
    }
    data = json.dumps(body).encode("utf-8")
    url = f"{GEMINI_URL}?key={api_key}"
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=240) as resp:
                payload = json.loads(resp.read())
            return json.loads(payload["candidates"][0]["content"]["parts"][0]["text"])
        except Exception as e:
            print(f"  retry {attempt+1}: {e}", file=sys.stderr)
            time.sleep(2 ** attempt)
    return None


def load_profiles(path: Path) -> list[dict]:
    profiles = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            try:
                profiles.append(json.loads(line))
            except Exception:
                continue
    return profiles


def compute_stats(profiles: list[dict]) -> dict:
    stats = {
        "total": len(profiles),
        "nicho": Counter(p.get("nicho") for p in profiles),
        "genero": Counter(),
        "pais": Counter(),
        "nivel_experiencia": Counter(),
        "estilo_decision": Counter(),
        "relacion_con_dinero": Counter(),
        "estilo_habla": Counter(),
        "tono_inicial": Counter(),
        "dificultad_roleplay": Counter(),
        "resistencia_al_cierre": Counter(),
        "objeciones_por_tipo": Counter(),
    }
    for p in profiles:
        prf = p.get("perfil", {})
        d = prf.get("demografia", {}) or {}
        ps = prf.get("psicografia", {}) or {}
        stats["genero"][d.get("genero") or "desconocido"] += 1
        stats["pais"][d.get("pais") or "desconocido"] += 1
        stats["nivel_experiencia"][ps.get("nivel_experiencia") or "?"] += 1
        stats["estilo_decision"][ps.get("estilo_decision") or "?"] += 1
        stats["relacion_con_dinero"][ps.get("relacion_con_dinero") or "?"] += 1
        stats["estilo_habla"][ps.get("estilo_habla") or "?"] += 1
        stats["tono_inicial"][ps.get("tono_inicial") or "?"] += 1
        stats["dificultad_roleplay"][prf.get("dificultad_roleplay_1_5") or 0] += 1
        stats["resistencia_al_cierre"][ps.get("resistencia_al_cierre_1_5") or 0] += 1
        for obj in prf.get("objeciones") or []:
            stats["objeciones_por_tipo"][obj.get("tipo") or "?"] += 1
    return {k: (dict(v) if isinstance(v, Counter) else v) for k, v in stats.items()}


def build_objections_library(profiles: list[dict]) -> dict:
    by_type = defaultdict(list)
    for p in profiles:
        for obj in (p.get("perfil", {}).get("objeciones") or []):
            tipo = obj.get("tipo") or "otro"
            by_type[tipo].append({
                "objecion": obj.get("objecion"),
                "profundidad": obj.get("profundidad"),
                "orden": obj.get("orden"),
                "call_id": p.get("id"),
                "arquetipo": p.get("perfil", {}).get("arquetipo"),
            })
    return {
        "total_objeciones": sum(len(v) for v in by_type.values()),
        "tipos": {t: {"count": len(items), "ejemplos": items[:30]} for t, items in by_type.items()},
    }


def cluster_archetypes_with_llm(api_key: str, profiles: list[dict]) -> list[dict]:
    """Pide a Gemini agrupar arquetipos similares en 8-12 clusters representativos."""
    rows = []
    for p in profiles:
        prf = p.get("perfil", {})
        rows.append({
            "id": p.get("id"),
            "arquetipo": prf.get("arquetipo"),
            "tono_inicial": (prf.get("psicografia") or {}).get("tono_inicial"),
            "motivacion": (prf.get("narrativa") or {}).get("motivacion_principal"),
            "dolor": (prf.get("narrativa") or {}).get("dolor_principal"),
            "nivel": (prf.get("psicografia") or {}).get("nivel_experiencia"),
            "dificultad": prf.get("dificultad_roleplay_1_5"),
            "ocupacion": (prf.get("demografia") or {}).get("ocupacion"),
        })
    prompt = f"""Recibes una lista de etiquetas de arquetipo de clientes de ventas (nicho trading) provenientes de llamadas de venta cerradas.

Tu tarea: agrupar estos {len(rows)} clientes en 8-12 ARQUETIPOS REPRESENTATIVOS para roleplay. Cada arquetipo debe ser distinguible y util como personaje base para entrenamiento de closers.

Devuelve SOLO un JSON con esta forma:
{{
  "archetypes": [
    {{
      "id": "slug-corto-arquetipo",
      "nombre": "nombre humano corto",
      "descripcion": "1-2 frases describiendo el arquetipo",
      "tono_tipico_inicial": "string",
      "nivel_experiencia_tipico": "string",
      "dolor_caracteristico": "string",
      "motivacion_caracteristica": "string",
      "objeciones_caracteristicas": ["3-5 tipos/temas de objecion frecuentes en este arquetipo"],
      "ocupaciones_comunes": ["max 5"],
      "dificultad_promedio_1_5": 3,
      "call_ids": ["los IDs de llamadas que pertenecen a este arquetipo"]
    }}
  ]
}}

Reglas:
- Cubre el 100% de los call_ids; cada llamada debe pertenecer a exactamente un arquetipo.
- Slug del id: solo a-z y guiones, sin acentos.
- 8 a 12 arquetipos. Si forzar 12 quita distincion, usa menos.

DATOS:
{json.dumps(rows, ensure_ascii=False)}
"""
    print(f"  Clusterizando {len(rows)} arquetipos...")
    return call_gemini(api_key, prompt) or {"archetypes": []}


def build_scenario_briefs(profiles: list[dict], archetypes: dict) -> list[dict]:
    """Selecciona 30 escenarios diversos balanceando dificultad y arquetipo."""
    arch_by_call = {}
    for arch in archetypes.get("archetypes", []):
        for cid in arch.get("call_ids", []):
            arch_by_call[cid] = arch["id"]

    pool = []
    for p in profiles:
        prf = p.get("perfil", {})
        ps = prf.get("psicografia", {}) or {}
        diff = prf.get("dificultad_roleplay_1_5") or 0
        resist = ps.get("resistencia_al_cierre_1_5") or 0
        score = (diff or 0) + (resist or 0)
        pool.append((score, p, arch_by_call.get(p["id"])))
    # ordenar por score desc para preferir desafiantes, pero mantener variedad
    pool.sort(key=lambda x: -x[0])

    picked = []
    seen_arch = Counter()
    # primero un buen mix: preferir distintos arquetipos
    for score, p, arch_id in pool:
        if len(picked) >= 30:
            break
        if seen_arch[arch_id] >= 4:
            continue
        prf = p["perfil"]
        ps = prf.get("psicografia", {}) or {}
        d = prf.get("demografia", {}) or {}
        n = prf.get("narrativa", {}) or {}
        c = prf.get("comercial", {}) or {}
        picked.append({
            "scenario_id": f"sc_{p['id']}",
            "arquetipo_id": arch_id,
            "arquetipo_label": prf.get("arquetipo"),
            "nicho": p.get("nicho"),
            "dificultad_1_5": prf.get("dificultad_roleplay_1_5"),
            "resistencia_1_5": ps.get("resistencia_al_cierre_1_5"),
            "estado_inicial": {
                "genero": d.get("genero"),
                "pais": d.get("pais"),
                "ocupacion": d.get("ocupacion"),
                "situacion_familiar": d.get("situacion_familiar"),
                "tono_inicial": ps.get("tono_inicial"),
                "nivel_experiencia": ps.get("nivel_experiencia"),
                "estilo_decision": ps.get("estilo_decision"),
                "relacion_con_dinero": ps.get("relacion_con_dinero"),
                "estilo_habla": ps.get("estilo_habla"),
                "muletillas": ps.get("muletillas") or [],
                "regionalismos": ps.get("regionalismos") or [],
                "presupuesto_inicial": c.get("presupuesto_inicial"),
                "motivacion": n.get("motivacion_principal"),
                "dolor": n.get("dolor_principal"),
                "que_lo_trajo": n.get("que_lo_trajo_a_la_llamada"),
                "experiencia_previa": n.get("experiencia_previa_relacionada"),
            },
            "objeciones_a_plantear": [
                {"texto": o.get("objecion"), "tipo": o.get("tipo"), "profundidad": o.get("profundidad"), "orden": o.get("orden")}
                for o in (prf.get("objeciones") or [])
            ],
            "preguntas_a_hacer": prf.get("preguntas_tipicas_del_cliente") or [],
            "frases_de_estilo": prf.get("frases_cliente") or [],
            "valor_para_entrenamiento": prf.get("valor_para_entrenamiento"),
            "source_call_id": p["id"],
        })
        seen_arch[arch_id] += 1
    return picked


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", default="scripts/data/profiles.jsonl")
    ap.add_argument("--out", default="scripts/data")
    args = ap.parse_args()

    inp = Path(args.inp)
    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)

    profiles = load_profiles(inp)
    print(f"Cargados {len(profiles)} perfiles desde {inp}")
    if not profiles:
        raise SystemExit("Sin perfiles")

    print("\n[1/4] Estadisticas...")
    stats = compute_stats(profiles)
    (outdir / "dataset_stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")

    print("[2/4] Biblioteca de objeciones...")
    obj_lib = build_objections_library(profiles)
    (outdir / "objections_library.json").write_text(json.dumps(obj_lib, ensure_ascii=False, indent=2), encoding="utf-8")

    print("[3/4] Clusters de arquetipos...")
    api_key = load_api_key()
    archetypes = cluster_archetypes_with_llm(api_key, profiles)
    (outdir / "archetypes.json").write_text(json.dumps(archetypes, ensure_ascii=False, indent=2), encoding="utf-8")

    print("[4/4] Scenario briefs...")
    briefs = build_scenario_briefs(profiles, archetypes)
    (outdir / "scenario_briefs.json").write_text(json.dumps(briefs, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\nListo. Archivos generados en", outdir)
    print(" - dataset_stats.json")
    print(" - objections_library.json")
    print(f" - archetypes.json ({len(archetypes.get('archetypes', []))} arquetipos)")
    print(f" - scenario_briefs.json ({len(briefs)} escenarios)")


if __name__ == "__main__":
    main()
