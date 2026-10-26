// Подключение к Supabase (см. docs/SUPABASE.md).
// Publishable-ключ публичный по назначению: доступ к данным защищают правила RLS из supabase/schema.sql.
// Секретный ключ (sb_secret_…) сюда класть нельзя.
window.TREKER_CONFIG = {
  supabaseUrl: 'https://sddozpkibkguwbwwfmqk.supabase.co',
  supabaseKey: 'sb_publishable_2O3BFUab55cJqwz3VfhpHg_wXM7L4Cu',
  // Домен служебных e-mail вида <номер>@<домен>. Совпадает с app_email_domain() в supabase/schema.sql. Не менять.
  loginDomain: 'treker.local',
};
