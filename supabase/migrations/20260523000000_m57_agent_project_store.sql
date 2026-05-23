create extension if not exists pgcrypto;

create table if not exists public.ad_agent_projects (
  id text primary key,
  schema_version integer not null default 1,
  title text not null,
  product_name text,
  mode text not null,
  lifecycle text not null,
  active_session_id text,
  record jsonb not null,
  archived_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.ad_agent_sessions (
  id text primary key,
  project_id text not null references public.ad_agent_projects(id) on delete cascade,
  schema_version integer not null default 1,
  session jsonb not null,
  runtime_summary jsonb,
  record jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.ad_agent_artifacts (
  id text primary key,
  project_id text not null references public.ad_agent_projects(id) on delete cascade,
  session_id text,
  artifact_type text not null,
  artifact_key text not null,
  status text not null,
  source text not null,
  version integer not null,
  body jsonb not null,
  summary jsonb not null,
  evidence_refs jsonb not null default '[]'::jsonb,
  linked_node_ids text[] not null default '{}',
  linked_task_ids text[] not null default '{}',
  record jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (project_id, artifact_key, version)
);

create table if not exists public.ad_approval_requests (
  id text primary key,
  project_id text not null references public.ad_agent_projects(id) on delete cascade,
  session_id text,
  kind text not null,
  status text not null,
  action_hash text not null,
  idempotency_key text not null,
  estimated_credits numeric,
  actual_credits numeric,
  record jsonb not null,
  requested_at timestamptz not null,
  responded_at timestamptz,
  executed_at timestamptz,
  unique (project_id, idempotency_key)
);

create table if not exists public.ad_generation_tasks (
  id text primary key,
  project_id text not null references public.ad_agent_projects(id) on delete cascade,
  session_id text,
  approval_request_id text,
  provider text not null,
  provider_task_id text,
  idempotency_key text not null,
  status text not null,
  progress numeric not null default 0,
  output_asset_id text,
  record jsonb not null,
  created_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null,
  unique (project_id, idempotency_key),
  unique (provider, provider_task_id)
);

create table if not exists public.ad_media_assets (
  id text primary key,
  project_id text not null references public.ad_agent_projects(id) on delete cascade,
  session_id text,
  kind text not null,
  role text not null,
  source text not null,
  storage_provider text,
  storage_key text,
  recoverable boolean,
  record jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (project_id, storage_provider, storage_key)
);

create table if not exists public.ad_canvas_graphs (
  project_id text primary key references public.ad_agent_projects(id) on delete cascade,
  schema_version integer not null default 1,
  graph_version text not null,
  nodes jsonb not null default '[]'::jsonb,
  edges jsonb not null default '[]'::jsonb,
  record jsonb not null,
  updated_at timestamptz not null
);

create table if not exists public.ad_canvas_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.ad_agent_projects(id) on delete cascade,
  derived_from_graph_version text not null,
  record jsonb not null,
  created_at timestamptz not null,
  unique (project_id, derived_from_graph_version)
);

create table if not exists public.ad_agent_events (
  id text primary key,
  project_id text not null references public.ad_agent_projects(id) on delete cascade,
  session_id text,
  sequence integer not null,
  actor_type text not null,
  event_type text not null,
  object_type text,
  object_id text,
  correlation_id text,
  request_id text,
  payload jsonb not null default '{}'::jsonb,
  record jsonb not null,
  created_at timestamptz not null,
  unique (project_id, sequence),
  unique (project_id, id)
);

alter table public.ad_agent_projects enable row level security;
alter table public.ad_agent_sessions enable row level security;
alter table public.ad_agent_artifacts enable row level security;
alter table public.ad_approval_requests enable row level security;
alter table public.ad_generation_tasks enable row level security;
alter table public.ad_media_assets enable row level security;
alter table public.ad_canvas_graphs enable row level security;
alter table public.ad_canvas_snapshots enable row level security;
alter table public.ad_agent_events enable row level security;

create or replace function public.ad_agent_events_prevent_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ad_agent_events is append-only';
end;
$$;

drop trigger if exists ad_agent_events_prevent_update on public.ad_agent_events;
create trigger ad_agent_events_prevent_update
before update on public.ad_agent_events
for each row execute function public.ad_agent_events_prevent_mutation();

drop trigger if exists ad_agent_events_prevent_delete on public.ad_agent_events;
create trigger ad_agent_events_prevent_delete
before delete on public.ad_agent_events
for each row execute function public.ad_agent_events_prevent_mutation();

create or replace function public.ad_studio_canvas_snapshot_from_graph(p_graph jsonb)
returns jsonb
language sql
stable
as $$
  with nodes as (
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', node ->> 'id',
      'kind', node ->> 'kind',
      'businessType', node ->> 'businessType',
      'title', node ->> 'title',
      'status', node ->> 'status',
      'locked', node -> 'locked',
      'parentNodeIds', coalesce(node -> 'parentNodeIds', '[]'::jsonb),
      'staleReason', node ->> 'staleReason'
    ))), '[]'::jsonb) as items
    from jsonb_array_elements(coalesce(p_graph -> 'nodes', '[]'::jsonb)) as node
  ),
  edges as (
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', edge ->> 'id',
      'source', edge ->> 'source',
      'target', edge ->> 'target',
      'label', edge ->> 'label'
    ))), '[]'::jsonb) as items
    from jsonb_array_elements(coalesce(p_graph -> 'edges', '[]'::jsonb)) as edge
  ),
  locked_nodes as (
    select coalesce(jsonb_agg(node ->> 'id'), '[]'::jsonb) as ids
    from jsonb_array_elements(coalesce(p_graph -> 'nodes', '[]'::jsonb)) as node
    where coalesce((node ->> 'locked')::boolean, false)
  ),
  stale_nodes as (
    select coalesce(jsonb_agg(node ->> 'id'), '[]'::jsonb) as ids
    from jsonb_array_elements(coalesce(p_graph -> 'nodes', '[]'::jsonb)) as node
    where node ->> 'status' = 'stale' or nullif(node ->> 'staleReason', '') is not null
  )
  select jsonb_build_object(
    'schemaVersion', 1,
    'projectId', p_graph ->> 'projectId',
    'derivedFromGraphVersion', p_graph ->> 'graphVersion',
    'createdAt', now(),
    'nodes', nodes.items,
    'edges', edges.items,
    'lockedNodeIds', locked_nodes.ids,
    'staleNodeIds', stale_nodes.ids
  )
  from nodes, edges, locked_nodes, stale_nodes;
$$;

create or replace function public.ad_studio_upsert_agent_project_bundle(p_bundle jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_project jsonb := p_bundle -> 'project';
  v_project_id text := v_project ->> 'id';
  v_canvas_graph jsonb := p_bundle -> 'canvasGraph';
  v_snapshot jsonb;
begin
  if v_project_id is null or v_project_id = '' then
    raise exception 'missing project id';
  end if;

  insert into public.ad_agent_projects (
    id, schema_version, title, product_name, mode, lifecycle, active_session_id, record,
    archived_at, created_at, updated_at
  )
  values (
    v_project_id,
    coalesce((v_project ->> 'schemaVersion')::integer, 1),
    coalesce(v_project ->> 'title', '未命名项目'),
    v_project ->> 'productName',
    coalesce(v_project ->> 'mode', 'clone'),
    coalesce(v_project ->> 'lifecycle', 'empty'),
    v_project ->> 'activeSessionId',
    v_project,
    nullif(v_project ->> 'archivedAt', '')::timestamptz,
    coalesce(nullif(v_project ->> 'createdAt', '')::timestamptz, now()),
    coalesce(nullif(v_project ->> 'updatedAt', '')::timestamptz, now())
  )
  on conflict (id) do update set
    schema_version = excluded.schema_version,
    title = excluded.title,
    product_name = excluded.product_name,
    mode = excluded.mode,
    lifecycle = excluded.lifecycle,
    active_session_id = excluded.active_session_id,
    record = excluded.record,
    archived_at = excluded.archived_at,
    updated_at = excluded.updated_at;

  delete from public.ad_agent_sessions
  where project_id = v_project_id
    and id not in (
      select item ->> 'id'
      from jsonb_array_elements(coalesce(p_bundle -> 'sessions', '[]'::jsonb)) as item
    );

  insert into public.ad_agent_sessions (id, project_id, schema_version, session, runtime_summary, record, created_at, updated_at)
  select
    item ->> 'id',
    v_project_id,
    coalesce((item ->> 'schemaVersion')::integer, 1),
    coalesce(item -> 'session', '{}'::jsonb),
    item -> 'runtimeSummary',
    item,
    coalesce(nullif(item ->> 'createdAt', '')::timestamptz, now()),
    coalesce(nullif(item ->> 'updatedAt', '')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_bundle -> 'sessions', '[]'::jsonb)) as item
  on conflict (id) do update set
    project_id = excluded.project_id,
    schema_version = excluded.schema_version,
    session = excluded.session,
    runtime_summary = excluded.runtime_summary,
    record = excluded.record,
    updated_at = excluded.updated_at;

  delete from public.ad_agent_artifacts
  where project_id = v_project_id
    and id not in (
      select item ->> 'id'
      from jsonb_array_elements(coalesce(p_bundle -> 'artifacts', '[]'::jsonb)) as item
    );

  insert into public.ad_agent_artifacts (
    id, project_id, session_id, artifact_type, artifact_key, status, source, version,
    body, summary, evidence_refs, linked_node_ids, linked_task_ids, record, created_at, updated_at
  )
  select
    item ->> 'id',
    v_project_id,
    item ->> 'sessionId',
    item ->> 'artifactType',
    item ->> 'artifactKey',
    item ->> 'status',
    item ->> 'source',
    coalesce((item ->> 'version')::integer, 1),
    coalesce(item -> 'body', '{}'::jsonb),
    coalesce(item -> 'summary', '{}'::jsonb),
    coalesce(item -> 'evidenceRefs', '[]'::jsonb),
    coalesce(array(select jsonb_array_elements_text(coalesce(item -> 'linkedNodeIds', '[]'::jsonb))), '{}'),
    coalesce(array(select jsonb_array_elements_text(coalesce(item -> 'linkedTaskIds', '[]'::jsonb))), '{}'),
    item,
    coalesce(nullif(item ->> 'createdAt', '')::timestamptz, now()),
    coalesce(nullif(item ->> 'updatedAt', '')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_bundle -> 'artifacts', '[]'::jsonb)) as item
  on conflict (id) do update set
    session_id = excluded.session_id,
    artifact_type = excluded.artifact_type,
    artifact_key = excluded.artifact_key,
    status = excluded.status,
    source = excluded.source,
    version = excluded.version,
    body = excluded.body,
    summary = excluded.summary,
    evidence_refs = excluded.evidence_refs,
    linked_node_ids = excluded.linked_node_ids,
    linked_task_ids = excluded.linked_task_ids,
    record = excluded.record,
    updated_at = excluded.updated_at;

  delete from public.ad_approval_requests
  where project_id = v_project_id
    and id not in (
      select item ->> 'id'
      from jsonb_array_elements(coalesce(p_bundle -> 'approvalRequests', '[]'::jsonb)) as item
    );

  insert into public.ad_approval_requests (
    id, project_id, session_id, kind, status, action_hash, idempotency_key,
    estimated_credits, actual_credits, record, requested_at, responded_at, executed_at
  )
  select
    item ->> 'id',
    v_project_id,
    item ->> 'sessionId',
    item ->> 'kind',
    item ->> 'status',
    item ->> 'actionHash',
    item ->> 'idempotencyKey',
    nullif(item ->> 'estimatedCredits', '')::numeric,
    nullif(item ->> 'actualCredits', '')::numeric,
    item,
    coalesce(nullif(item ->> 'requestedAt', '')::timestamptz, now()),
    nullif(item ->> 'respondedAt', '')::timestamptz,
    nullif(item ->> 'executedAt', '')::timestamptz
  from jsonb_array_elements(coalesce(p_bundle -> 'approvalRequests', '[]'::jsonb)) as item
  on conflict (id) do update set
    session_id = excluded.session_id,
    kind = excluded.kind,
    status = excluded.status,
    action_hash = excluded.action_hash,
    idempotency_key = excluded.idempotency_key,
    estimated_credits = excluded.estimated_credits,
    actual_credits = excluded.actual_credits,
    record = excluded.record,
    responded_at = excluded.responded_at,
    executed_at = excluded.executed_at;

  delete from public.ad_generation_tasks
  where project_id = v_project_id
    and id not in (
      select item ->> 'id'
      from jsonb_array_elements(coalesce(p_bundle -> 'generationTasks', '[]'::jsonb)) as item
    );

  insert into public.ad_generation_tasks (
    id, project_id, session_id, approval_request_id, provider, provider_task_id,
    idempotency_key, status, progress, output_asset_id, record, created_at, started_at, completed_at, updated_at
  )
  select
    item ->> 'id',
    v_project_id,
    item ->> 'sessionId',
    item ->> 'approvalRequestId',
    item ->> 'provider',
    item ->> 'providerTaskId',
    item ->> 'idempotencyKey',
    item ->> 'status',
    coalesce(nullif(item ->> 'progress', '')::numeric, 0),
    item ->> 'outputAssetId',
    item,
    coalesce(nullif(item ->> 'createdAt', '')::timestamptz, now()),
    nullif(item ->> 'startedAt', '')::timestamptz,
    nullif(item ->> 'completedAt', '')::timestamptz,
    coalesce(nullif(item ->> 'updatedAt', '')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_bundle -> 'generationTasks', '[]'::jsonb)) as item
  on conflict (id) do update set
    session_id = excluded.session_id,
    approval_request_id = excluded.approval_request_id,
    provider = excluded.provider,
    provider_task_id = excluded.provider_task_id,
    idempotency_key = excluded.idempotency_key,
    status = excluded.status,
    progress = excluded.progress,
    output_asset_id = excluded.output_asset_id,
    record = excluded.record,
    started_at = excluded.started_at,
    completed_at = excluded.completed_at,
    updated_at = excluded.updated_at;

  delete from public.ad_media_assets
  where project_id = v_project_id
    and id not in (
      select item ->> 'id'
      from jsonb_array_elements(coalesce(p_bundle -> 'mediaAssets', '[]'::jsonb)) as item
    );

  insert into public.ad_media_assets (
    id, project_id, session_id, kind, role, source, storage_provider, storage_key,
    recoverable, record, created_at, updated_at
  )
  select
    item ->> 'id',
    v_project_id,
    item ->> 'sessionId',
    item ->> 'kind',
    item ->> 'role',
    item ->> 'source',
    item #>> '{storage,provider}',
    item #>> '{storage,key}',
    nullif(item ->> 'recoverable', '')::boolean,
    item,
    coalesce(nullif(item ->> 'createdAt', '')::timestamptz, now()),
    coalesce(nullif(item ->> 'updatedAt', '')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_bundle -> 'mediaAssets', '[]'::jsonb)) as item
  on conflict (id) do update set
    session_id = excluded.session_id,
    kind = excluded.kind,
    role = excluded.role,
    source = excluded.source,
    storage_provider = excluded.storage_provider,
    storage_key = excluded.storage_key,
    recoverable = excluded.recoverable,
    record = excluded.record,
    updated_at = excluded.updated_at;

  if v_canvas_graph is not null then
    insert into public.ad_canvas_graphs (project_id, schema_version, graph_version, nodes, edges, record, updated_at)
    values (
      v_project_id,
      coalesce((v_canvas_graph ->> 'schemaVersion')::integer, 1),
      coalesce(v_canvas_graph ->> 'graphVersion', 'graph-' || v_project_id),
      coalesce(v_canvas_graph -> 'nodes', '[]'::jsonb),
      coalesce(v_canvas_graph -> 'edges', '[]'::jsonb),
      v_canvas_graph,
      coalesce(nullif(v_canvas_graph ->> 'updatedAt', '')::timestamptz, now())
    )
    on conflict (project_id) do update set
      schema_version = excluded.schema_version,
      graph_version = excluded.graph_version,
      nodes = excluded.nodes,
      edges = excluded.edges,
      record = excluded.record,
      updated_at = excluded.updated_at;

    v_snapshot := public.ad_studio_canvas_snapshot_from_graph(v_canvas_graph);
    insert into public.ad_canvas_snapshots (project_id, derived_from_graph_version, record, created_at)
    values (v_project_id, v_canvas_graph ->> 'graphVersion', v_snapshot, now())
    on conflict (project_id, derived_from_graph_version) do nothing;
  end if;

  insert into public.ad_agent_events (
    id, project_id, session_id, sequence, actor_type, event_type, object_type, object_id,
    correlation_id, request_id, payload, record, created_at
  )
  select
    item ->> 'id',
    v_project_id,
    item ->> 'sessionId',
    coalesce((item ->> 'sequence')::integer, 1),
    item ->> 'actorType',
    item ->> 'eventType',
    item ->> 'objectType',
    item ->> 'objectId',
    item ->> 'correlationId',
    item ->> 'requestId',
    coalesce(item -> 'payload', '{}'::jsonb),
    item,
    coalesce(nullif(item ->> 'createdAt', '')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_bundle -> 'events', '[]'::jsonb)) as item
  on conflict (project_id, id) do nothing;

  return public.ad_studio_get_agent_project_bundle(v_project_id);
end;
$$;

create or replace function public.ad_studio_get_agent_project_bundle(p_project_id text)
returns jsonb
language sql
stable
as $$
  select case
    when project.record is null then null
    else jsonb_build_object(
      'schemaVersion', 1,
      'project', project.record,
      'sessions', coalesce((select jsonb_agg(record order by updated_at) from public.ad_agent_sessions where project_id = p_project_id), '[]'::jsonb),
      'artifacts', coalesce((select jsonb_agg(record order by artifact_key, version) from public.ad_agent_artifacts where project_id = p_project_id), '[]'::jsonb),
      'approvalRequests', coalesce((select jsonb_agg(record order by requested_at) from public.ad_approval_requests where project_id = p_project_id), '[]'::jsonb),
      'canvasGraph', coalesce((select record from public.ad_canvas_graphs where project_id = p_project_id), jsonb_build_object('schemaVersion', 1, 'projectId', p_project_id, 'nodes', '[]'::jsonb, 'edges', '[]'::jsonb, 'graphVersion', 'graph-empty', 'updatedAt', project.updated_at)),
      'generationTasks', coalesce((select jsonb_agg(record order by created_at) from public.ad_generation_tasks where project_id = p_project_id), '[]'::jsonb),
      'mediaAssets', coalesce((select jsonb_agg(record order by created_at) from public.ad_media_assets where project_id = p_project_id), '[]'::jsonb),
      'events', coalesce((select jsonb_agg(record order by sequence) from public.ad_agent_events where project_id = p_project_id), '[]'::jsonb),
      'updatedAt', project.updated_at
    )
  end
  from public.ad_agent_projects project
  where project.id = p_project_id;
$$;

create or replace function public.ad_studio_append_agent_event(p_event jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_project_id text := p_event ->> 'projectId';
  v_sequence integer;
  v_record jsonb;
  v_event_id text;
begin
  if v_project_id is null or v_project_id = '' then
    raise exception 'missing event project id';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_project_id));
  select coalesce(max(sequence), 0) + 1 into v_sequence
  from public.ad_agent_events
  where project_id = v_project_id;

  v_event_id := coalesce(nullif(p_event ->> 'id', ''), 'event-' || replace(gen_random_uuid()::text, '-', ''));
  v_record := jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(p_event, '{schemaVersion}', '1'::jsonb, true),
        '{id}', to_jsonb(v_event_id), true
      ),
      '{sequence}', to_jsonb(v_sequence), true
    ),
    '{createdAt}', to_jsonb(coalesce(nullif(p_event ->> 'createdAt', ''), now()::text)), true
  );

  insert into public.ad_agent_events (
    id, project_id, session_id, sequence, actor_type, event_type, object_type, object_id,
    correlation_id, request_id, payload, record, created_at
  )
  values (
    v_event_id,
    v_project_id,
    v_record ->> 'sessionId',
    v_sequence,
    v_record ->> 'actorType',
    v_record ->> 'eventType',
    v_record ->> 'objectType',
    v_record ->> 'objectId',
    v_record ->> 'correlationId',
    v_record ->> 'requestId',
    coalesce(v_record -> 'payload', '{}'::jsonb),
    v_record,
    coalesce(nullif(v_record ->> 'createdAt', '')::timestamptz, now())
  );

  update public.ad_agent_projects
  set updated_at = coalesce(nullif(v_record ->> 'createdAt', '')::timestamptz, now())
  where id = v_project_id;

  return v_record;
end;
$$;

revoke all on function public.ad_studio_upsert_agent_project_bundle(jsonb) from public, anon, authenticated;
revoke all on function public.ad_studio_get_agent_project_bundle(text) from public, anon, authenticated;
revoke all on function public.ad_studio_append_agent_event(jsonb) from public, anon, authenticated;
grant execute on function public.ad_studio_upsert_agent_project_bundle(jsonb) to service_role;
grant execute on function public.ad_studio_get_agent_project_bundle(text) to service_role;
grant execute on function public.ad_studio_append_agent_event(jsonb) to service_role;
