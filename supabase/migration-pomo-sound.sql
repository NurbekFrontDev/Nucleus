-- Помодоро: звук сигнала окончания фазы и громкость.
-- Хранятся в app_settings вместе с остальными настройками таймера (pomo_*).
-- Безопасно запускать повторно.

alter table app_settings add column if not exists pomo_sound text not null default 'double';
alter table app_settings add column if not exists pomo_volume int not null default 80;
