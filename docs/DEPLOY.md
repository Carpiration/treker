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

Сборка кладет два файла: `Treker-<версия>.apk` в корень и `download/Treker.apk` — копию с постоянным именем
для сайта. Опубликуйте ее (`git add -A && git commit -m "APK 2.2" && git push`), и телефон скачает APK по ссылке
https://carpiration.github.io/treker/download/Treker.apk — ссылка не меняется от версии к версии.
Дополнительно APK можно приложить к релизу на GitHub (Releases), но файлы релизов отдаются с
`objects.githubusercontent.com`, а этот адрес у части мобильных провайдеров не открывается
(«Не удалось скачать файл»), поэтому основная ссылка — с сайта.

Ключ подписи `android/signing/` в репозиторий не попадает (`.gitignore`). Сохраните его копию:
без него обновление APK не встанет поверх установленного.
