# Сервер (Supabase)

Задачи и профили хранятся в проекте Supabase **treker** (регион Frankfurt, бесплатный тариф).
Подключение прописано в `config.js`, схема базы — в [`supabase/schema.sql`](../supabase/schema.sql).

## Как устроен вход
- Вход — по номеру телефона и PIN из 6 цифр. Внутри номер хранится как служебный адрес
  `79991234567@treker.local`, писем на него не отправляется.
- Профили создаёт сама база (функции `register_user` и `admin_create_user`), поэтому вход не зависит
  от проверки e-mail в Supabase.
- Первый зарегистрированный становится **администратором** и сразу входит.
- Остальные после регистрации видят «Заявка отправлена». У администратора на шестерёнке появляется точка,
  в **Настройки → Профили** — заявка с кнопкой **Одобрить**. До одобрения человек не видит задач.
- Администратор может сам добавить сотрудника (номер + PIN) — тогда одобрение не нужно.

## Новый проект с нуля
1. https://supabase.com → **New project**, регион Frankfurt.
2. **SQL Editor → New query** → вставить целиком `supabase/schema.sql` → **Run**. Повторный запуск безопасен.
3. **Project Settings → API Keys**: Project URL и Publishable key (`sb_publishable_…`) вписать в `config.js`.
   Secret key (`sb_secret_…`) в файлы сайта и в чат не отправлять.

## Работа с задачами из командной строки
Скопируйте `.env.example` в `.env` и вставьте секретный ключ (файл остаётся только на этом компьютере).
```
python tools/db.py users
python tools/db.py list --done
python tools/db.py add "Позвонить поставщику" --to "Иван" --desc "Уточнить сроки"
python tools/db.py set 3f2a1c9b --status done
```

## Если что-то пошло не так
- **Забыт PIN** — администратор задаёт новый в **Настройки → Профили**. Если забыл сам администратор —
  в SQL Editor (номер — только цифры):
  `update auth.users set encrypted_password = extensions.crypt('123456', extensions.gen_salt('bf')) where email = '79991234567@treker.local';`
- **Резервная копия** — Database → Backups (на бесплатном тарифе ежедневные, 7 дней) или
  SQL Editor → `select * from tasks` → Export CSV.
- Бесплатный проект Supabase засыпает после 7 дней без активности. Разбудить: открыть проект в панели Supabase → **Restore**.
