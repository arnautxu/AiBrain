alter table public.thread_messages
  add column attachments jsonb not null default '[]'::jsonb;

alter table public.thread_messages
  add column artifacts jsonb not null default '[]'::jsonb;

alter table public.thread_messages
  add constraint thread_messages_attachments_array
    check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 3),
  add constraint thread_messages_attachments_size
    check (octet_length(attachments::text) <= 16384);

alter table public.thread_messages
  add constraint thread_messages_artifacts_array
    check (jsonb_typeof(artifacts) = 'array' and jsonb_array_length(artifacts) <= 12),
  add constraint thread_messages_artifacts_size
    check (octet_length(artifacts::text) <= 65536);
