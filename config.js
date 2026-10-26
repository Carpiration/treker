// Подключение к Supabase (см. docs/SUPABASE.md).
// Пустые значения — приложение работает локально: данные только в этом браузере, без синхронизации.
// Publishable (anon) ключ публичный по назначению: доступ к данным защищают правила RLS из supabase/schema.sql.
// Секретный ключ (service_role / sb_secret_…) сюда класть нельзя.
window.TREKER_CONFIG = {
  supabaseUrl: '',
  supabaseKey: '',
  // Домен для служебных e-mail вида <логин>@<домен>. После создания первых профилей не менять.
  loginDomain: 'treker.local',
};
