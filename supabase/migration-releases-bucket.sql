-- Публичный бакет releases для авто-обновления десктопа (Tauri updater).
-- Хранит установщики (.exe) и latest.json, на который смотрит updater.
-- Запустить один раз (через SQL Editor в панели Supabase или supabase db).

insert into storage.buckets (id, name, public)
values ('releases', 'releases', true)
on conflict (id) do update set public = true;

-- Отдельная политика чтения НЕ нужна: у публичного бакета файлы отдаются по
-- публичной ссылке (.../object/public/releases/...), а загрузка идёт под
-- service_role (обходит RLS). Политику SELECT на storage.objects не создаём,
-- иначе Supabase предупреждает, что клиенты могут получить список всех файлов.
-- Если такая политика осталась от старой версии — снимаем её.
drop policy if exists "Public read releases" on storage.objects;
