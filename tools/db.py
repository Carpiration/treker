"""Задачи в Supabase из командной строки — чтобы смотреть и вносить записи без браузера (в том числе Claude).

Ключ берётся из файла .env в корне проекта (он не попадает в git):
    SUPABASE_SECRET_KEY=sb_secret_...
    SUPABASE_URL=https://xxxx.supabase.co   # необязательно: по умолчанию берётся из config.js
Секретный ключ обходит правила доступа и даёт полный доступ к базе — храните его только на своём компьютере.

Команды (запуск из корня проекта):
    python tools/db.py users                          профили, включая заявки на вход
    python tools/db.py list [--who КТО] [--done]
    python tools/db.py add "Название" [--to КТО] [--desc "..."] [--status todo|doing|done]
    python tools/db.py add-many ФАЙЛ [--to КТО]       по задаче на строку; пустые строки пропускаются
    python tools/db.py set ID [--title ...] [--desc ...] [--status ...] [--to КТО]
    python tools/db.py delete ID
КТО — номер телефона или часть имени. ID можно сокращать до первых символов (как в выводе list).
По умолчанию list показывает незавершённые задачи всех; --done добавляет выполненные.
"""
import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Вывод в UTF-8 и при перенаправлении в файл или другой программе (в консоли Windows иначе кракозябры).
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
STATUS = {"todo": "Не начато", "doing": "В процессе", "done": "Готово"}


def load_env():
    env = {}
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            m = re.match(r"\s*([A-Z_]+)\s*=\s*(.*?)\s*$", line)
            if m and not line.lstrip().startswith("#"):
                env[m.group(1)] = m.group(2).strip("'\"")
    if not env.get("SUPABASE_URL"):
        m = re.search(r"supabaseUrl:\s*'([^']*)'", (ROOT / "config.js").read_text(encoding="utf-8"))
        env["SUPABASE_URL"] = m.group(1) if m else ""
    if not env.get("SUPABASE_URL") or not env.get("SUPABASE_SECRET_KEY"):
        sys.exit("Нет SUPABASE_SECRET_KEY в .env (и/или адреса в config.js). Образец — .env.example.")
    return env["SUPABASE_URL"].rstrip("/"), env["SUPABASE_SECRET_KEY"]


URL, KEY = load_env()


def api(method, path, body=None):
    headers = {"apikey": KEY, "Content-Type": "application/json", "Prefer": "return=representation"}
    if KEY.startswith("eyJ"):  # старый service_role-ключ (JWT) нужно передавать и в Authorization
        headers["Authorization"] = f"Bearer {KEY}"
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        sys.exit(f"Ошибка {e.code}: {e.read().decode(errors='replace')}")
    except urllib.error.URLError as e:
        sys.exit(f"Нет связи с {URL}: {e.reason}")


def norm_phone(s):
    d = re.sub(r"\D", "", s)
    if len(d) == 11 and d[0] == "8":
        d = "7" + d[1:]
    if len(d) == 10 and d[0] == "9":
        d = "7" + d
    return d


def fmt_phone(p):
    if re.fullmatch(r"7\d{10}", p or ""):
        return f"+7 {p[1:4]} {p[4:7]}-{p[7:9]}-{p[9:]}"
    return p or ""


def users():
    return api("GET", "profiles?select=*&order=created_at")


def find_user(who, people):
    d = norm_phone(who)
    hits = [u for u in people if d and u["login"] == d] or [u for u in people if who.lower() in u["name"].lower()]
    if len(hits) != 1:
        names = ", ".join(u["name"] for u in hits) or "никого"
        sys.exit(f"«{who}»: найдено {len(hits)} ({names}). Уточните номер или имя.")
    return hits[0]


def find_task(prefix):
    hits = [t for t in api("GET", "tasks?select=id") if t["id"].startswith(prefix)]
    if len(hits) != 1:
        sys.exit(f"ID «{prefix}»: найдено задач — {len(hits)}. Укажите больше символов.")
    return hits[0]["id"]


def now():
    return datetime.now(timezone.utc).isoformat()


def cmd_users(a):
    for u in users():
        state = "заявка" if u.get("pending") and not u["active"] else ("" if u["active"] else "отключён")
        role = "админ" if u["role"] == "admin" else "участник"
        print(f"{u['name']:<32} {fmt_phone(u['login']):<18} {role:<9} {state}")


def cmd_list(a):
    people = {u["id"]: u for u in users()}
    q = "tasks?select=*&order=created_at.desc"
    if a.who:
        q += f"&assignee_id=eq.{find_user(a.who, people.values())['id']}"
    if not a.done:
        q += "&status=neq.done"
    rows = api("GET", q)
    for t in rows:
        who = people.get(t["assignee_id"], {}).get("name", "—")
        desc = f"  — {t['descr'][:60]}" if t["descr"] else ""
        print(f"{t['id'][:8]}  [{STATUS[t['status']]:<10}] {t['title']}  · {who}{desc}")
    print(f"Всего: {len(rows)}")


def cmd_add(a):
    people = users()
    admins = [u for u in people if u["role"] == "admin" and u["active"]]
    if not admins:
        sys.exit("В базе нет администратора — сначала зарегистрируйтесь на сайте.")
    to = find_user(a.to, people) if a.to else admins[0]
    t = api("POST", "tasks", {"title": a.title, "descr": a.desc or "", "status": a.status, "assignee_id": to["id"],
                              "author_id": admins[0]["id"], "done_at": now() if a.status == "done" else None})[0]
    print(f"Добавлено: {t['id'][:8]}  {t['title']} → {to['name']}")


def cmd_add_many(a):
    titles = [ln.strip() for ln in Path(a.file).read_text(encoding="utf-8").splitlines() if ln.strip()]
    if not titles:
        sys.exit("В файле нет задач.")
    if any(len(t) > 200 for t in titles):
        sys.exit("Есть строки длиннее 200 символов — сократите их или перенесите детали в описание.")
    people = users()
    admins = [u for u in people if u["role"] == "admin" and u["active"]]
    if not admins:
        sys.exit("В базе нет администратора — сначала зарегистрируйтесь на сайте.")
    to = find_user(a.to, people) if a.to else admins[0]
    # Одним запросом: либо добавятся все, либо ни одной — повторный запуск не создаст дублей наполовину.
    rows = api("POST", "tasks", [{"title": t, "descr": "", "status": "todo", "assignee_id": to["id"],
                                  "author_id": admins[0]["id"]} for t in titles])
    for t in rows:
        print(f"{t['id'][:8]}  {t['title']}")
    print(f"Добавлено: {len(rows)} → {to['name']}")


def cmd_set(a):
    tid = find_task(a.id)
    patch = {"updated_at": now()}
    if a.title:
        patch["title"] = a.title
    if a.desc is not None:
        patch["descr"] = a.desc
    if a.status:
        patch["status"] = a.status
        patch["done_at"] = now() if a.status == "done" else None
    if a.to:
        patch["assignee_id"] = find_user(a.to, users())["id"]
    t = api("PATCH", f"tasks?id=eq.{tid}", patch)[0]
    print(f"Изменено: {t['id'][:8]}  [{STATUS[t['status']]}] {t['title']}")


def cmd_delete(a):
    tid = find_task(a.id)
    t = api("DELETE", f"tasks?id=eq.{tid}")[0]
    print(f"Удалено: {t['title']}")


def main():
    p = argparse.ArgumentParser(description="Задачи в Supabase")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("users").set_defaults(fn=cmd_users)
    s = sub.add_parser("list"); s.set_defaults(fn=cmd_list)
    s.add_argument("--who"); s.add_argument("--done", action="store_true")
    s = sub.add_parser("add"); s.set_defaults(fn=cmd_add)
    s.add_argument("title"); s.add_argument("--to"); s.add_argument("--desc")
    s.add_argument("--status", default="todo", choices=STATUS)
    s = sub.add_parser("add-many"); s.set_defaults(fn=cmd_add_many)
    s.add_argument("file"); s.add_argument("--to")
    s = sub.add_parser("set"); s.set_defaults(fn=cmd_set)
    s.add_argument("id"); s.add_argument("--title"); s.add_argument("--desc"); s.add_argument("--to")
    s.add_argument("--status", choices=STATUS)
    s = sub.add_parser("delete"); s.set_defaults(fn=cmd_delete)
    s.add_argument("id")
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
