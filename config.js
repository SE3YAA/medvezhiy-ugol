// config.js — куда приложение отправляет данные.
// Ключ publishable не секретный: он и должен лежать в коде сайта. Доступ ограничивают правила в базе.
// Секретный ключ (secret / service_role) сюда НИКОГДА не вставляется.
// Чтобы работать без сервера, только в памяти телефона, оставьте supabaseUrl пустым.
window.MU_CONFIG = {
  supabaseUrl: 'https://xrzzbxnwijqberrrzuow.supabase.co',
  supabaseKey: 'sb_publishable_TUAxmn06mkqN28ArYc50dQ_hcseeUDL',
  pollSeconds: 5          // как часто проверять, что нового на сервере
};
