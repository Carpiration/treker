# Размещение и обновление

## Сайт — GitHub Pages
Статический сайт из корня ветки `main` репозитория: `https://carpiration.github.io/treker/`.
Сборки нет: изменения в `index.html` / `config.js` попадают на сайт через 1–2 минуты после `git push`.

```
git add -A
git commit -m "Описание изменения"
git push
```
Проверка: откройте сайт, обновите страницу (Ctrl+F5) — в Android-приложении достаточно закрыть и открыть его.

**Откат:** `git revert <коммит>` и `git push` — сайт вернётся к предыдущей версии.

## Данные — Supabase
Схема — `supabase/schema.sql`, подключение — `config.js`, инструкция — [SUPABASE.md](SUPABASE.md).
Резервная копия: Supabase → Database → Backups (на бесплатном тарифе — ежедневные, 7 дней) или
SQL Editor → `select * from tasks` → Export CSV.

## Android-приложение
APK — оболочка, открывающая сайт; обновлять его нужно только при изменении `android/`.
```
python android\build.py
```
Нужны Android SDK и JDK 17+ (есть в Android Studio). Перед новой версией увеличьте `VERSION_CODE` в `android/build.py`.
Готовый APK прикладывается к релизу на GitHub (Releases), откуда его удобно скачать на телефон.

Ключ подписи `android/signing/` в репозиторий не попадает (`.gitignore`). Сохраните его копию:
без него обновление APK не встанет поверх установленного.
