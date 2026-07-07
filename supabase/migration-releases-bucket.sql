-- Публичный бакет releases для авто-обновления десктопа (Tauri updater).
-- Хранит установщики (.exe) и latest.json, на который смотрит updater.
-- Запустить один раз (через SQL Editor в панели Supabase или supabase db).

insert into storage.buckets (id, name, public)
values ('releases', 'releases', true)
on conflict (id) do update set public = true;

-- Публичное чтение файлов из бакета releases (скачивание обновлений без авторизации).
drop policy if exists "Public read releases" on storage.objects;
create policy "Public read releases"
  on storage.objects for select
  using (bucket_id = 'releases');
