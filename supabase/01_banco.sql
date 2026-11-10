-- =====================================================================================
-- NoisFit — banco de dados (Supabase / Postgres)
--
-- Como usar: num projeto Supabase NOVO, abra SQL Editor > New query, cole este arquivo
-- inteiro e clique em Run. Rode uma única vez.
--
-- O que este script cria:
--   * perfis, tipos de treino, treinos, refeições, água e avaliações físicas
--   * desafios com código de convite, participantes e pontuação diária
--   * pontuação calculada no próprio banco (ninguém consegue editar a própria nota)
--   * encerramento manual (só o criador) e automático às 23:59 de Brasília
--   * ranking final com a avaliação física valendo peso 2
--   * fila de notificações push (resultado do desafio e lembretes de água)
--   * buckets de arquivos: comprovacoes (fotos) e exames (bioimpedância)
--
-- Regras de nota (iguais ao NoisFit original):
--   Dieta  : calorias dentro de ±10% da meta = 5; cada macro (P, C, G) dentro de ±10% = 5/3. Máx. 10/dia.
--   Treino : com foto de comprovação = 10; sem foto = 5; sem treino = 0.
--   Água   : 10 × (consumido ÷ meta), máx. 10.
--   Final  : cada pilar vira 0–100; Final = (Dieta + Treino + Água + 2 × Avaliação) ÷ 5.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Funções auxiliares (puras)
-- -------------------------------------------------------------------------------------

-- Data de hoje no fuso de Brasília.
create or replace function public.hoje_sp() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

-- Quantos dias para trás um registro (treino, refeição, água) pode ser lançado ou alterado.
-- 1 = hoje e ontem. Evita lançar treino de semanas atrás para ganhar pontos.
create or replace function public.dias_retroativos() returns int
language sql immutable set search_path = '' as $$ select 1 $$;

create or replace function public.na_meta(valor numeric, meta numeric) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(meta, 0) > 0 and abs(coalesce(valor, 0) - meta) <= meta * 0.10
$$;

-- Dieta: calorias na meta (5) + cada macro na meta (5/3). Sem refeições = 0.
create or replace function public.nota_dieta(
  refeicoes int, kcal numeric, prot numeric, carb numeric, gord numeric,
  meta_kcal numeric, meta_prot numeric, meta_carb numeric, meta_gord numeric
) returns numeric
language sql immutable set search_path = '' as $$
  select case when coalesce(refeicoes, 0) = 0 then 0 else round(
      (case when public.na_meta(kcal, meta_kcal) then 5 else 0 end)
    + (case when public.na_meta(prot, meta_prot) then 5.0 / 3 else 0 end)
    + (case when public.na_meta(carb, meta_carb) then 5.0 / 3 else 0 end)
    + (case when public.na_meta(gord, meta_gord) then 5.0 / 3 else 0 end), 1) end
$$;

-- Treino: com foto 10, sem foto 5, nenhum 0.
create or replace function public.nota_treino(treinos int, algum_com_foto boolean) returns numeric
language sql immutable set search_path = '' as $$
  select case when coalesce(treinos, 0) = 0 then 0 when algum_com_foto then 10 else 5 end
$$;

-- Água: proporcional à meta, máx. 10.
create or replace function public.nota_agua(ml numeric, meta_ml numeric) returns numeric
language sql immutable set search_path = '' as $$
  select case when coalesce(meta_ml, 0) <= 0 then 0
              else round(10 * least(1, coalesce(ml, 0) / meta_ml), 1) end
$$;

-- Calorias do treino: MET × peso (kg) × horas × dificuldade (Leve 0,85 · Moderada 1,0 · Intensa 1,15).
create or replace function public.calorias_treino(met numeric, peso_kg numeric, duracao_min int, dificuldade int)
returns numeric
language sql immutable set search_path = '' as $$
  select case when coalesce(met, 0) <= 0 or coalesce(peso_kg, 0) <= 0 or coalesce(duracao_min, 0) <= 0 then 0
         else round(met * peso_kg * (duracao_min / 60.0)
                    * (case dificuldade when 0 then 0.85 when 2 then 1.15 else 1.0 end)) end
$$;

-- % de gordura por Jackson & Pollock 7 dobras + Siri. Retorna null se faltar alguma dobra.
create or replace function public.gordura_pollock7(dobras jsonb, masculino boolean, idade int) returns numeric
language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v numeric;
  s numeric := 0;
  dc numeric;
begin
  if dobras is null or coalesce(idade, 0) <= 0 then return null; end if;
  foreach k in array array['tricipital','subescapular','peitoral','axilarMedia','suprailiaca','abdominal','coxa'] loop
    v := nullif(dobras ->> k, '')::numeric;
    if v is null or v <= 0 then return null; end if;
    s := s + v;
  end loop;
  if masculino then
    dc := 1.112 - 0.00043499 * s + 0.00000055 * s * s - 0.00028826 * idade;
  else
    dc := 1.097 - 0.00046971 * s + 0.00000056 * s * s - 0.00012828 * idade;
  end if;
  return round(495 / dc - 450, 1);
end $$;

-- -------------------------------------------------------------------------------------
-- 2. Tabelas
-- -------------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null default '' check (char_length(nome) <= 60),
  sexo text not null default 'F' check (sexo in ('M', 'F')),
  nascimento date,
  peso_kg numeric(5,1) not null default 0 check (peso_kg >= 0 and peso_kg <= 400),
  altura_cm numeric(5,1) not null default 0 check (altura_cm >= 0 and altura_cm <= 250),
  meta_agua_ml int not null default 2500 check (meta_agua_ml between 500 and 8000),
  meta_kcal numeric(6,0) not null default 0 check (meta_kcal = 0 or meta_kcal between 800 and 6000),
  meta_proteina numeric(5,0) not null default 0 check (meta_proteina between 0 and 1000),
  meta_carbo numeric(5,0) not null default 0 check (meta_carbo between 0 and 1500),
  meta_gordura numeric(5,0) not null default 0 check (meta_gordura between 0 and 1000),
  lembrete_agua boolean not null default false,
  lembrete_inicio int not null default 7 check (lembrete_inicio between 0 and 23),
  lembrete_fim int not null default 22 check (lembrete_fim between 1 and 24),
  lembrete_intervalo_min int not null default 90 check (lembrete_intervalo_min between 30 and 480),
  ultimo_lembrete_em timestamptz,
  criado_em timestamptz not null default now()
);
comment on table public.profiles is 'Perfil e metas. Visível só para o próprio usuário.';

create table public.workout_types (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 1 and 40),
  met numeric(4,1) not null check (met > 0 and met <= 25),
  categoria text not null default '' check (char_length(categoria) <= 30),
  criado_por uuid not null default auth.uid() references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now()
);

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tipo_nome text not null check (char_length(tipo_nome) between 1 and 40),
  data_hora timestamptz not null default now(),
  dia date not null,                           -- preenchido pelo banco (fuso de Brasília)
  met numeric(4,1) not null check (met > 0 and met <= 25),
  duracao_min int not null check (duracao_min between 1 and 600),
  dificuldade int not null default 1 check (dificuldade between 0 and 2),  -- 0 Leve, 1 Moderada, 2 Intensa
  kcal_estimado numeric(6,0) not null default 0,  -- calculado pelo banco
  kcal_dispositivo numeric(6,0) check (kcal_dispositivo is null or kcal_dispositivo between 0 and 5000),
  foto_treino_path text,                       -- comprovação (bucket comprovacoes)
  foto_calorias_path text,                     -- print do relógio (bucket comprovacoes)
  criado_em timestamptz not null default now()
);
create index on public.workouts (user_id, dia);

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tipo text not null check (tipo in ('Café', 'Almoço', 'Lanche', 'Jantar', 'Ceia')),
  data_hora timestamptz not null default now(),
  dia date not null,
  kcal numeric(6,0) not null default 0 check (kcal between 0 and 10000),
  proteina numeric(5,1) not null default 0 check (proteina between 0 and 1000),
  carbo numeric(5,1) not null default 0 check (carbo between 0 and 1500),
  gordura numeric(5,1) not null default 0 check (gordura between 0 and 1000),
  observacao text not null default '' check (char_length(observacao) <= 300),
  foto_path text,
  criado_em timestamptz not null default now()
);
create index on public.meals (user_id, dia);

create table public.water_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data_hora timestamptz not null default now(),
  dia date not null,
  ml int not null check (ml between 1 and 3000),
  criado_em timestamptz not null default now()
);
create index on public.water_logs (user_id, dia);

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data date not null default public.hoje_sp(),
  sexo text check (sexo in ('M', 'F')),       -- se vazio, vem do perfil
  idade int check (idade between 5 and 120),  -- se vazio, vem do perfil
  peso numeric(5,1) not null check (peso > 0 and peso <= 400),
  altura numeric(5,1) check (altura is null or (altura > 0 and altura <= 250)),
  gordura_bio numeric(4,1) check (gordura_bio is null or (gordura_bio > 0 and gordura_bio < 70)),
  massa_magra_bio numeric(5,1) check (massa_magra_bio is null or massa_magra_bio > 0),
  circunferencias jsonb not null default '{}'::jsonb,  -- cm: pescoco, ombro, peito, cintura, quadril, bracoD...
  dobras jsonb not null default '{}'::jsonb,           -- mm: tricipital, bicipital, subescapular, peitoral...
  gordura_pollock numeric(4,1),                        -- calculado pelo banco
  gordura numeric(4,1),                                -- Pollock se houver dobras; senão bioimpedância
  bio_path text,                                       -- exame (bucket exames)
  criado_em timestamptz not null default now()
);
create index on public.assessments (user_id, data);

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 1 and 60),
  descricao text not null default '' check (char_length(descricao) <= 500),
  inicio date not null,
  fim date not null,
  codigo text not null unique,                 -- código de convite (gerado pelo banco)
  criador_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  criador_nome text not null default '',
  status text not null default 'aberto' check (status in ('aberto', 'encerrado')),
  mensagem_final text not null default '' check (char_length(mensagem_final) <= 400),
  participantes_qtd int not null default 0,
  ranking_final jsonb,
  encerrado_em timestamptz,
  encerrado_por text,                          -- 'criador' | 'automatico'
  fim_efetivo date,
  criado_em timestamptz not null default now(),
  check (fim >= inicio and fim - inicio <= 365)
);

create table public.challenge_members (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  nome text not null default '',
  entrou_em timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
create index on public.challenge_members (user_id);

-- Pontuação diária: escrita apenas pelo banco.
create table public.daily_points (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  dia date not null,
  dieta numeric(4,1) not null default 0,
  treino numeric(4,1) not null default 0,
  agua numeric(4,1) not null default 0,
  total numeric(4,1) not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (challenge_id, user_id, dia)
);

-- Análises da IA (gravadas pela Edge Function).
create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  inicial_id uuid references public.assessments (id) on delete set null,
  final_id uuid references public.assessments (id) on delete set null,
  destaque text not null default '',
  detalhe_destaque text not null default '',
  resumo text not null default '',
  recomendacoes jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now()
);
create index on public.analyses (user_id, criado_em desc);

-- Push: inscrições por aparelho e fila de envio.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  criado_em timestamptz not null default now()
);
create index on public.push_subscriptions (user_id);

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  titulo text not null,
  corpo text not null,
  url text not null default './',
  tag text not null default '',
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  tentativas int not null default 0,
  erro text
);
create index on public.notifications (enviado_em) where enviado_em is null;
create index on public.notifications (user_id, criado_em desc);

-- -------------------------------------------------------------------------------------
-- 3. Funções de acesso (usadas pelas regras de segurança)
-- -------------------------------------------------------------------------------------

create or replace function public.sou_membro(p_challenge uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.challenge_members m
                 where m.challenge_id = p_challenge and m.user_id = auth.uid())
$$;

-- Verdadeiro se eu divido algum desafio com o usuário dono da pasta (id em texto).
create or replace function public.compartilha_desafio(p_outro text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.challenge_members eu
    join public.challenge_members ele on ele.challenge_id = eu.challenge_id
    where eu.user_id = auth.uid() and ele.user_id::text = p_outro)
$$;

-- -------------------------------------------------------------------------------------
-- 4. Pontuação diária
-- -------------------------------------------------------------------------------------

create or replace function public.comprovacao_existe(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_path is not null and exists (
    select 1 from storage.objects o where o.bucket_id = 'comprovacoes' and o.name = p_path)
$$;

create or replace function public.recalcular_dia(p_user uuid, p_dia date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  n_ref int; s_kcal numeric; s_p numeric; s_c numeric; s_g numeric;
  n_trei int; com_foto boolean;
  s_ml numeric;
  v_dieta numeric; v_treino numeric; v_agua numeric;
begin
  if p_user is null or p_dia is null then return; end if;
  -- Só calcula se o usuário estiver em algum desafio aberto que cubra o dia.
  if not exists (select 1 from public.challenge_members m join public.challenges c on c.id = m.challenge_id
                 where m.user_id = p_user and c.status = 'aberto' and p_dia between c.inicio and c.fim) then
    return;
  end if;

  select * into p from public.profiles where id = p_user;
  if not found then return; end if;

  select count(*), coalesce(sum(kcal), 0), coalesce(sum(proteina), 0), coalesce(sum(carbo), 0), coalesce(sum(gordura), 0)
    into n_ref, s_kcal, s_p, s_c, s_g
    from public.meals where user_id = p_user and dia = p_dia;

  select count(*), coalesce(bool_or(public.comprovacao_existe(foto_treino_path)), false)
    into n_trei, com_foto
    from public.workouts where user_id = p_user and dia = p_dia;

  select coalesce(sum(ml), 0) into s_ml from public.water_logs where user_id = p_user and dia = p_dia;

  v_dieta := public.nota_dieta(n_ref, s_kcal, s_p, s_c, s_g, p.meta_kcal, p.meta_proteina, p.meta_carbo, p.meta_gordura);
  v_treino := public.nota_treino(n_trei, com_foto);
  v_agua := public.nota_agua(s_ml, p.meta_agua_ml);

  insert into public.daily_points as d (challenge_id, user_id, dia, dieta, treino, agua, total, atualizado_em)
  select c.id, p_user, p_dia, v_dieta, v_treino, v_agua, v_dieta + v_treino + v_agua, now()
    from public.challenges c
    join public.challenge_members m on m.challenge_id = c.id and m.user_id = p_user
   where c.status = 'aberto' and p_dia between c.inicio and c.fim
  on conflict (challenge_id, user_id, dia) do update
     set dieta = excluded.dieta, treino = excluded.treino, agua = excluded.agua,
         total = excluded.total, atualizado_em = now();
end $$;

-- Recalcula todos os dias já corridos de um participante num desafio (ao entrar com o desafio em andamento).
create or replace function public.recalcular_participante(p_challenge uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.challenges;
  d date;
begin
  select * into c from public.challenges where id = p_challenge;
  if not found or c.status <> 'aberto' then return; end if;
  d := c.inicio;
  while d <= least(c.fim, public.hoje_sp()) loop
    perform public.recalcular_dia(p_user, d);
    d := d + 1;
  end loop;
end $$;

-- -------------------------------------------------------------------------------------
-- 5. Gatilhos dos registros (treino, refeição, água, avaliação)
-- -------------------------------------------------------------------------------------

-- Preenche o dia (fuso de Brasília) e impede lançar/alterar fora da janela permitida.
create or replace function public.tg_preparar_registro() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.dia := (new.data_hora at time zone 'America/Sao_Paulo')::date;
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'Não é possível mudar o dono do registro.';
  end if;
  -- A janela vale para quem usa o app (auth.uid() presente); o administrador (SQL Editor) pode corrigir dados antigos.
  if auth.uid() is not null then
    if new.dia > public.hoje_sp() then
      raise exception 'Não é possível lançar em data futura.';
    end if;
    if new.dia < public.hoje_sp() - public.dias_retroativos()
       or (tg_op = 'UPDATE' and old.dia < public.hoje_sp() - public.dias_retroativos()) then
      raise exception 'Só é possível lançar ou alterar registros de hoje e de ontem.';
    end if;
  end if;
  return new;
end $$;

create or replace function public.tg_bloquear_exclusao_antiga() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and old.dia < public.hoje_sp() - public.dias_retroativos() then
    raise exception 'Só é possível excluir registros de hoje e de ontem.';
  end if;
  return old;
end $$;

-- Arquivos precisam estar na pasta do próprio usuário.
create or replace function public.caminho_do_usuario(p_path text, p_user uuid) returns boolean
language sql immutable set search_path = '' as $$
  select p_path is null or (p_path like p_user::text || '/%' and position('..' in p_path) = 0)
$$;

create or replace function public.tg_preparar_treino() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_peso numeric;
begin
  if not public.caminho_do_usuario(new.foto_treino_path, new.user_id)
     or not public.caminho_do_usuario(new.foto_calorias_path, new.user_id) then
    raise exception 'Foto em pasta inválida.';
  end if;
  select peso_kg into v_peso from public.profiles where id = new.user_id;
  new.kcal_estimado := public.calorias_treino(new.met, coalesce(v_peso, 0), new.duracao_min, new.dificuldade);
  return new;
end $$;

create or replace function public.tg_preparar_refeicao() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.caminho_do_usuario(new.foto_path, new.user_id) then
    raise exception 'Foto em pasta inválida.';
  end if;
  return new;
end $$;

create or replace function public.tg_preparar_avaliacao() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'Não é possível mudar o dono do registro.';
  end if;
  if auth.uid() is not null and new.data > public.hoje_sp() then
    raise exception 'Não é possível lançar avaliação em data futura.';
  end if;
  if not public.caminho_do_usuario(new.bio_path, new.user_id) then
    raise exception 'Arquivo em pasta inválida.';
  end if;
  select * into p from public.profiles where id = new.user_id;
  if new.sexo is null then new.sexo := coalesce(p.sexo, 'F'); end if;
  if new.idade is null and p.nascimento is not null then
    new.idade := extract(year from age(new.data, p.nascimento))::int;
  end if;
  new.gordura_pollock := public.gordura_pollock7(new.dobras, new.sexo = 'M', new.idade);
  new.gordura := coalesce(new.gordura_pollock, new.gordura_bio);
  return new;
end $$;

-- Depois de qualquer mudança, recalcula a nota do dia (e do dia antigo, se a data mudou).
create or replace function public.tg_recalcular() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.recalcular_dia(old.user_id, old.dia);
  end if;
  if tg_op = 'INSERT'
     or (tg_op = 'UPDATE' and (new.user_id, new.dia) is distinct from (old.user_id, old.dia)) then
    perform public.recalcular_dia(new.user_id, new.dia);
  end if;
  return null;
end $$;

create trigger preparar before insert or update on public.workouts
  for each row execute function public.tg_preparar_registro();
create trigger preparar_treino before insert or update on public.workouts
  for each row execute function public.tg_preparar_treino();
create trigger bloquear_exclusao before delete on public.workouts
  for each row execute function public.tg_bloquear_exclusao_antiga();
create trigger recalcular after insert or update or delete on public.workouts
  for each row execute function public.tg_recalcular();

create trigger preparar before insert or update on public.meals
  for each row execute function public.tg_preparar_registro();
create trigger preparar_refeicao before insert or update on public.meals
  for each row execute function public.tg_preparar_refeicao();
create trigger bloquear_exclusao before delete on public.meals
  for each row execute function public.tg_bloquear_exclusao_antiga();
create trigger recalcular after insert or update or delete on public.meals
  for each row execute function public.tg_recalcular();

create trigger preparar before insert or update on public.water_logs
  for each row execute function public.tg_preparar_registro();
create trigger bloquear_exclusao before delete on public.water_logs
  for each row execute function public.tg_bloquear_exclusao_antiga();
create trigger recalcular after insert or update or delete on public.water_logs
  for each row execute function public.tg_recalcular();

create trigger preparar before insert or update on public.assessments
  for each row execute function public.tg_preparar_avaliacao();

-- -------------------------------------------------------------------------------------
-- 6. Perfil: criação automática no cadastro e efeitos de mudanças
-- -------------------------------------------------------------------------------------

create or replace function public.tg_novo_usuario() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, nome)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'nome', ''), 60))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger noisfit_novo_usuario after insert on auth.users
  for each row execute function public.tg_novo_usuario();

create or replace function public.tg_perfil_alterado() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.nome is distinct from old.nome then
    update public.challenge_members set nome = new.nome where user_id = new.id;
    update public.challenges set criador_nome = new.nome where criador_id = new.id;
  end if;
  -- Metas mudaram: refaz a nota de hoje (os dias anteriores ficam como estavam).
  if (new.meta_agua_ml, new.meta_kcal, new.meta_proteina, new.meta_carbo, new.meta_gordura)
     is distinct from (old.meta_agua_ml, old.meta_kcal, old.meta_proteina, old.meta_carbo, old.meta_gordura) then
    perform public.recalcular_dia(new.id, public.hoje_sp());
  end if;
  return null;
end $$;

create trigger perfil_alterado after update on public.profiles
  for each row execute function public.tg_perfil_alterado();

-- -------------------------------------------------------------------------------------
-- 7. Desafios
-- -------------------------------------------------------------------------------------

create or replace function public.gerar_codigo() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1);
    end loop;
    exit when not exists (select 1 from public.challenges where codigo = c);
  end loop;
  return c;
end $$;

create or replace function public.tg_preparar_desafio() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.criador_id := coalesce(auth.uid(), new.criador_id);
  if new.criador_id is null then raise exception 'Faça login.'; end if;
  new.codigo := public.gerar_codigo();
  new.status := 'aberto';
  new.ranking_final := null;
  new.encerrado_em := null;
  new.encerrado_por := null;
  new.fim_efetivo := null;
  new.participantes_qtd := 0;
  new.criador_nome := coalesce((select nome from public.profiles where id = new.criador_id), '');
  if auth.uid() is not null and new.fim < public.hoje_sp() then
    raise exception 'A data final já passou.';
  end if;
  return new;
end $$;

create or replace function public.tg_desafio_criado() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.challenge_members (challenge_id, user_id) values (new.id, new.criador_id)
  on conflict do nothing;
  return null;
end $$;

create trigger preparar before insert on public.challenges
  for each row execute function public.tg_preparar_desafio();
create trigger criado after insert on public.challenges
  for each row execute function public.tg_desafio_criado();

create or replace function public.tg_membro_entrou() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.challenges set participantes_qtd = participantes_qtd + 1 where id = new.challenge_id;
  update public.challenge_members set nome = coalesce((select nome from public.profiles where id = new.user_id), '')
   where challenge_id = new.challenge_id and user_id = new.user_id;
  perform public.recalcular_participante(new.challenge_id, new.user_id);
  return null;
end $$;

create or replace function public.tg_membro_saiu() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.challenges set participantes_qtd = greatest(0, participantes_qtd - 1) where id = old.challenge_id;
  delete from public.daily_points where challenge_id = old.challenge_id and user_id = old.user_id;
  return null;
end $$;

create or replace function public.tg_membro_pode_sair() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.challenges;
begin
  select * into c from public.challenges where id = old.challenge_id;
  if found and auth.uid() is not null then
    if c.status <> 'aberto' then raise exception 'O desafio já foi encerrado.'; end if;
    if c.criador_id = old.user_id then raise exception 'Quem criou o desafio não pode sair; exclua o desafio.'; end if;
  end if;
  return old;
end $$;

create trigger entrou after insert on public.challenge_members
  for each row execute function public.tg_membro_entrou();
create trigger pode_sair before delete on public.challenge_members
  for each row execute function public.tg_membro_pode_sair();
create trigger saiu after delete on public.challenge_members
  for each row execute function public.tg_membro_saiu();

-- Entrar num desafio pelo código de convite.
create or replace function public.entrar_desafio(p_codigo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  select id into v_id from public.challenges
   where codigo = upper(trim(p_codigo)) and status = 'aberto' and fim >= public.hoje_sp();
  if v_id is null then raise exception 'Código inválido ou desafio já encerrado.'; end if;
  insert into public.challenge_members (challenge_id, user_id) values (v_id, auth.uid())
  on conflict do nothing;
  return v_id;
end $$;

-- Ranking ao vivo (pontos somados de 0 a 10 por pilar por dia).
create or replace function public.ranking_ao_vivo(p_challenge uuid)
returns table (user_id uuid, nome text, dieta numeric, treino numeric, agua numeric, total numeric, dias int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.sou_membro(p_challenge) then raise exception 'Você não participa deste desafio.'; end if;
  return query
    select m.user_id, m.nome,
           coalesce(sum(d.dieta), 0), coalesce(sum(d.treino), 0), coalesce(sum(d.agua), 0),
           coalesce(sum(d.total), 0), count(d.dia)::int
      from public.challenge_members m
      left join public.daily_points d on d.challenge_id = m.challenge_id and d.user_id = m.user_id
     where m.challenge_id = p_challenge
     group by m.user_id, m.nome
     order by 6 desc, 2;
end $$;

-- Ranking final: pilares em 0–100 e avaliação física (melhor evolução do grupo = 100).
create or replace function public.calcular_ranking_final(p_challenge uuid, p_fim date) returns jsonb
language sql stable security definer set search_path = '' as $$
  with c as (select inicio from public.challenges where id = p_challenge),
  mem as (select user_id, nome from public.challenge_members where challenge_id = p_challenge),
  dias as (select greatest(1, p_fim - c.inicio + 1) as n from c),
  somas as (
    select m.user_id,
           coalesce(sum(d.dieta), 0) as dieta, coalesce(sum(d.treino), 0) as treino, coalesce(sum(d.agua), 0) as agua
      from mem m
      left join public.daily_points d on d.challenge_id = p_challenge and d.user_id = m.user_id and d.dia <= p_fim
     group by m.user_id),
  av as (
    select a.user_id, a.data, a.peso, a.gordura,
           coalesce(nullif(a.circunferencias ->> 'cintura', '')::numeric, 0) as cintura,
           row_number() over (partition by a.user_id order by a.data, a.criado_em, a.id) as rn,
           count(*) over (partition by a.user_id) as qtd
      from public.assessments a
      join mem m on m.user_id = a.user_id
     where a.gordura is not null and a.peso > 0 and a.data <= p_fim),
  escolha as (  -- inicial: última até o início (ou a primeira depois dele); final: a última, se for outra
    select av.user_id,
           coalesce(max(rn) filter (where av.data <= c.inicio), min(rn) filter (where av.data >= c.inicio)) as rn_ini,
           max(qtd) as qtd
      from av cross join c
     group by av.user_id),
  indices as (
    select e.user_id,
           (i.gordura - f.gordura)
           + (f.peso * (1 - f.gordura / 100) - i.peso * (1 - i.gordura / 100))
           + 0.3 * (i.cintura - f.cintura) as indice
      from escolha e
      join av i on i.user_id = e.user_id and i.rn = e.rn_ini
      join av f on f.user_id = e.user_id and f.rn = e.qtd
     where e.qtd > e.rn_ini),
  melhor as (select max(indice) filter (where indice > 0) as m from indices),
  linhas as (
    select m.user_id, m.nome,
           round(least(100, 100 * s.dieta / (10 * dias.n)), 1) as dieta,
           round(least(100, 100 * s.treino / (10 * dias.n)), 1) as treino,
           round(least(100, 100 * s.agua / (10 * dias.n)), 1) as agua,
           case when i.indice is null or i.indice <= 0 or coalesce(melhor.m, 0) <= 0 then 0
                else round(100 * i.indice / melhor.m, 1) end as avaliacao,
           i.indice is null as sem_avaliacao_final
      from mem m
      join somas s on s.user_id = m.user_id
      left join indices i on i.user_id = m.user_id
      cross join melhor cross join dias),
  totais as (
    select l.*, round((l.dieta + l.treino + l.agua + 2 * l.avaliacao) / 5, 1) as total from linhas l),
  ordenado as (
    select t.*, row_number() over (order by t.total desc, t.avaliacao desc, t.nome) as posicao from totais t)
  select coalesce(jsonb_agg(jsonb_build_object(
           'posicao', o.posicao, 'uid', o.user_id, 'nome', o.nome,
           'dieta', o.dieta, 'treino', o.treino, 'agua', o.agua, 'avaliacao', o.avaliacao,
           'total', o.total, 'semAvaliacaoFinal', o.sem_avaliacao_final) order by o.posicao), '[]'::jsonb)
    from ordenado o
$$;

-- Encerra o desafio, grava o ranking final e coloca o push de resultado na fila.
create or replace function public.encerrar_interno(p_challenge uuid, p_mensagem text, p_por text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.challenges;
  v_fim date;
  v_rank jsonb;
  v_msg text;
begin
  select * into c from public.challenges where id = p_challenge for update;
  if not found then raise exception 'Desafio não encontrado.'; end if;
  if c.status = 'encerrado' then return coalesce(c.ranking_final, '[]'::jsonb); end if;

  v_fim := least(public.hoje_sp(), c.fim);   -- encerramento antecipado conta só os dias corridos
  v_rank := public.calcular_ranking_final(p_challenge, v_fim);
  v_msg := coalesce(nullif(trim(p_mensagem), ''), nullif(trim(c.mensagem_final), ''),
    'O desafio acabou, mas o hábito fica. Cada registro foi uma escolha por você. Bora manter o foco — o próximo desafio já vem aí!');

  update public.challenges
     set status = 'encerrado', ranking_final = v_rank, mensagem_final = left(v_msg, 400),
         encerrado_em = now(), encerrado_por = p_por, fim_efetivo = v_fim
   where id = p_challenge;

  insert into public.notifications (user_id, titulo, corpo, url, tag)
  select (r ->> 'uid')::uuid,
         '🏁 ' || c.nome || ' encerrado!',
         'Você ficou em ' || (r ->> 'posicao') || 'º com nota ' || regexp_replace(replace(r ->> 'total', '.', ','), ',0$', '') || '. ' || v_msg,
         './#resultado/' || c.id,
         'resultado-' || c.id
    from jsonb_array_elements(v_rank) r;

  return v_rank;
end $$;

-- Encerramento manual: só o criador.
create or replace function public.encerrar_desafio(p_challenge uuid, p_mensagem text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rank jsonb;
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  if not exists (select 1 from public.challenges where id = p_challenge and criador_id = auth.uid()) then
    raise exception 'Apenas quem criou o desafio pode encerrá-lo.';
  end if;
  v_rank := public.encerrar_interno(p_challenge, p_mensagem, 'criador');
  begin
    perform public.disparar_push();   -- envia o resultado agora, sem esperar o próximo ciclo
  exception when others then null;
  end;
  return v_rank;
end $$;

-- Encerramento automático (agendado para 23:59 de Brasília).
create or replace function public.encerramento_automatico() returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
begin
  for r in select id from public.challenges where status = 'aberto' and fim <= public.hoje_sp() loop
    begin
      perform public.encerrar_interno(r.id, null, 'automatico');
      n := n + 1;
    exception when others then
      raise warning 'Falha ao encerrar %: %', r.id, sqlerrm;
    end;
  end loop;
  begin
    perform public.disparar_push();
  exception when others then null;
  end;
  return n;
end $$;

-- -------------------------------------------------------------------------------------
-- 8. Notificações push
-- -------------------------------------------------------------------------------------

-- Salva a inscrição de push do aparelho (substitui a de outro usuário no mesmo aparelho).
create or replace function public.salvar_push(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default '')
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000 then raise exception 'Inscrição inválida.'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, left(p_p256dh, 200), left(p_auth, 100), left(coalesce(p_user_agent, ''), 300));
end $$;

-- Lembretes de água: um por vez, dentro da janela de horário, no intervalo escolhido,
-- só para quem ainda não bateu a meta do dia e tem algum aparelho inscrito.
create or replace function public.enfileirar_lembretes_agua() returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
  h int := extract(hour from now() at time zone 'America/Sao_Paulo')::int;
  hoje date := public.hoje_sp();
begin
  with alvo as (
    select p.id, p.meta_agua_ml,
           coalesce((select sum(w.ml) from public.water_logs w where w.user_id = p.id and w.dia = hoje), 0) as total
      from public.profiles p
     where p.lembrete_agua
       and h >= p.lembrete_inicio and h < p.lembrete_fim
       and (p.ultimo_lembrete_em is null
            or now() - p.ultimo_lembrete_em >= make_interval(mins => p.lembrete_intervalo_min - 2))
       and exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
  ),
  pendentes as (select * from alvo where total < meta_agua_ml),
  marcados as (
    update public.profiles p set ultimo_lembrete_em = now()
      from pendentes x where p.id = x.id
    returning p.id)
  insert into public.notifications (user_id, titulo, corpo, url, tag)
  select x.id, 'Hora de beber água 💧',
         'Você bebeu ' || x.total || ' de ' || x.meta_agua_ml || ' ml hoje.',
         './#agua', 'agua'
    from pendentes x join marcados m on m.id = x.id;
  get diagnostics n = row_count;
  return n;
end $$;

-- Chama a Edge Function "enviar-push" quando há notificações na fila.
-- Usa dois segredos do Vault: noisfit_project_url e noisfit_cron_secret (configurados depois).
create or replace function public.disparar_push() returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from public.notifications where enviado_em is null and tentativas < 5) then
    return false;
  end if;
  if to_regclass('vault.decrypted_secrets') is null or to_regnamespace('net') is null then
    return false;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_url using 'noisfit_project_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_secret using 'noisfit_cron_secret';
  if v_url is null or v_secret is null then return false; end if;
  execute 'select net.http_post(url := $1, body := ''{}''::jsonb, headers := $2, timeout_milliseconds := 20000)'
    using rtrim(v_url, '/') || '/functions/v1/enviar-push',
          jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret);
  return true;
end $$;

-- Ciclo agendado a cada 5 minutos: lembretes de água + envio + limpeza.
create or replace function public.ciclo_notificacoes() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.enfileirar_lembretes_agua();
  perform public.disparar_push();
  delete from public.notifications where criado_em < now() - interval '30 days';
end $$;

-- -------------------------------------------------------------------------------------
-- 9. Segurança (RLS): cada um vê e altera só o que é seu
-- -------------------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.workout_types enable row level security;
alter table public.workouts enable row level security;
alter table public.meals enable row level security;
alter table public.water_logs enable row level security;
alter table public.assessments enable row level security;
alter table public.challenges enable row level security;
alter table public.challenge_members enable row level security;
alter table public.daily_points enable row level security;
alter table public.analyses enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notifications enable row level security;

-- Visitantes sem login não acessam nada.
revoke all on all tables in schema public from anon;

create policy "perfil: o próprio" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "perfil: altera o próprio" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "tipos: todos leem" on public.workout_types
  for select to authenticated using (true);
create policy "tipos: cria os seus" on public.workout_types
  for insert to authenticated with check (criado_por = (select auth.uid()));
create policy "tipos: altera os seus" on public.workout_types
  for update to authenticated using (criado_por = (select auth.uid())) with check (criado_por = (select auth.uid()));
create policy "tipos: exclui os seus" on public.workout_types
  for delete to authenticated using (criado_por = (select auth.uid()));

create policy "treinos: os próprios" on public.workouts
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "refeições: as próprias" on public.meals
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "água: a própria" on public.water_logs
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "avaliações: as próprias" on public.assessments
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "desafios: participantes leem" on public.challenges
  for select to authenticated using (criador_id = (select auth.uid()) or public.sou_membro(id));
create policy "desafios: qualquer um cria" on public.challenges
  for insert to authenticated with check (criador_id = (select auth.uid()));
create policy "desafios: criador edita enquanto aberto" on public.challenges
  for update to authenticated using (criador_id = (select auth.uid()) and status = 'aberto')
  with check (criador_id = (select auth.uid()) and status = 'aberto');
create policy "desafios: criador exclui enquanto aberto" on public.challenges
  for delete to authenticated using (criador_id = (select auth.uid()) and status = 'aberto');

-- O criador só pode mudar nome, descrição e mensagem final; o resto é do banco.
revoke update on public.challenges from authenticated;
grant update (nome, descricao, mensagem_final) on public.challenges to authenticated;

create policy "membros: participantes leem" on public.challenge_members
  for select to authenticated using (public.sou_membro(challenge_id));
create policy "membros: sair do desafio" on public.challenge_members
  for delete to authenticated using (user_id = (select auth.uid()));
-- (entrar é só pela função entrar_desafio, com o código de convite)

create policy "pontos: participantes leem" on public.daily_points
  for select to authenticated using (public.sou_membro(challenge_id));

create policy "análises: as próprias" on public.analyses
  for select to authenticated using (user_id = (select auth.uid()));
create policy "análises: exclui as próprias" on public.analyses
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "push: as próprias" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "push: remove as próprias" on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "notificações: as próprias" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

-- Funções internas não podem ser chamadas pelo app.
revoke execute on function public.recalcular_dia(uuid, date) from public, anon, authenticated;
revoke execute on function public.recalcular_participante(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.calcular_ranking_final(uuid, date) from public, anon, authenticated;
revoke execute on function public.encerrar_interno(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.encerramento_automatico() from public, anon, authenticated;
revoke execute on function public.enfileirar_lembretes_agua() from public, anon, authenticated;
revoke execute on function public.disparar_push() from public, anon, authenticated;
revoke execute on function public.ciclo_notificacoes() from public, anon, authenticated;
revoke execute on function public.comprovacao_existe(text) from public, anon, authenticated;
revoke execute on function public.gerar_codigo() from public, anon, authenticated;
revoke execute on function public.entrar_desafio(text) from public, anon;
revoke execute on function public.encerrar_desafio(uuid, text) from public, anon;
revoke execute on function public.ranking_ao_vivo(uuid) from public, anon;
revoke execute on function public.salvar_push(text, text, text, text) from public, anon;
grant execute on function public.entrar_desafio(text) to authenticated;
grant execute on function public.encerrar_desafio(uuid, text) to authenticated;
grant execute on function public.ranking_ao_vivo(uuid) to authenticated;
grant execute on function public.salvar_push(text, text, text, text) to authenticated;

-- -------------------------------------------------------------------------------------
-- 10. Arquivos (Storage)
--   comprovacoes/<id do usuário>/...  fotos de treino e refeição — o grupo do desafio pode ver
--   exames/<id do usuário>/...        exame de bioimpedância — só o dono
-- -------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprovacoes', 'comprovacoes', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
       ('exames', 'exames', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

create policy "comprovações: envia na própria pasta" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'comprovacoes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "comprovações: dono e colegas de desafio veem" on storage.objects
  for select to authenticated
  using (bucket_id = 'comprovacoes' and ((storage.foldername(name))[1] = (select auth.uid())::text
                                         or public.compartilha_desafio((storage.foldername(name))[1])));
create policy "comprovações: dono altera" on storage.objects
  for update to authenticated
  using (bucket_id = 'comprovacoes' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'comprovacoes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "comprovações: dono exclui" on storage.objects
  for delete to authenticated
  using (bucket_id = 'comprovacoes' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "exames: só o dono" on storage.objects
  for all to authenticated
  using (bucket_id = 'exames' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'exames' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- -------------------------------------------------------------------------------------
-- 11. Agendamentos (pg_cron + pg_net)
--   * 23:59 de Brasília (02:59 UTC): encerra desafios cujo último dia é hoje
--   * a cada 5 minutos: lembretes de água e envio da fila de push
-- -------------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    create extension if not exists pg_net with schema extensions;
    perform cron.schedule('noisfit-encerramento', '59 2 * * *', 'select public.encerramento_automatico()');
    perform cron.schedule('noisfit-notificacoes', '*/5 * * * *', 'select public.ciclo_notificacoes()');
  else
    raise notice 'pg_cron indisponível: agendamentos não criados.';
  end if;
end $$;

-- Fim. Próximo passo: guardar os dois segredos do push no Vault (veja o README).
