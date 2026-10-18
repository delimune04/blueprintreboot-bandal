# LabVium collaboration v1 implementation contract

Scope: shared workspace calendar, two-way idea review/comments, assigned tasks and
in-app inbox. No email, SMS, push service or Google Calendar integration is
implied. Existing owner/editor/viewer workspace access and D1/R2 isolation stay.

## Shared API

GET `/collaboration` returns `{revision,actor,members,events,ideas,tasks,comments,
notifications,permissions,mode,time_zone}`. revision is the existing 64-hex revision
encoding of collaboration.revision. actor/member `{id,name,email,role,accepted}`;
member id is a stable authenticated workspace member key, never a body-supplied
identity. Only accepted members are selectable recipients/assignees. Owner is
included (a generic workspace-admin label is allowed if its name is unavailable).
mode `cloud` or `browser`; browser contains only its actual local actor, no fake
colleagues. time_zone `Asia/Seoul` and UI explicitly says Korean time.

All mutations require `expected_revision`. Create actions also accept required
`request_id` (UUID) for idempotent retry; reuse with different body must conflict.
Server supplies author/actor IDs, names and timestamps. Body spoofing is rejected.
Unknown fields, dangling source IDs and recipients outside this workspace reject.

POST `/collaboration/events`: `{event:{title,description,start_date,end_date,
all_day,start_time,end_time,participant_ids,project_id},expected_revision,request_id}`.
Dates are real Gregorian YYYY-MM-DD, end date inclusive, optional times HH:mm
for timed events, all day clears times. Participant IDs may be empty for everyone.
PATCH `/collaboration/events/:id`: `{changes:<partial event>,expected_revision}`.
DELETE same path: `{expected_revision,confirm:true}`. All editors may edit shared
calendar items. Dates/times are always interpreted in Asia/Seoul. No implicit
conversion from date-only strings through UTC.

POST `/collaboration/ideas`: `{idea:{title,body,recipient_ids,source},
expected_revision,request_id}`. Empty recipient_ids means the workspace audience.
source `{type:'paper'|'project'|'page'|'none',id,title,excerpt}` with empty optional
strings permitted; server verifies non-none source ID in the selected workspace.
One-click source sharing pre-fills title, body '이 아이디어 어때요?' and source;
posts to the shared workspace, then opens the comment thread. Normal composer can
select exact recipients. Every accepted editor can ask and respond, either way.
PATCH `/collaboration/ideas/:id`: `{changes:{status:'open'|'resolved'},expected_revision}`
(author or owner). POST `/collaboration/ideas/:id/comments`:
`{body,expected_revision,request_id}`. Plain text comments, author from session.

POST `/collaboration/tasks`: `{task:{title,description,assignee_id,due_date,
priority:'normal'|'high',project_id,source_idea_id},expected_revision,request_id}`.
Due date is YYYY-MM-DD, due at the end of that Korean calendar day. Default UI
shortcut is +6 calendar days with its explicit resulting date shown.
PATCH `/collaboration/tasks/:id`: `{changes:{...fields,status},expected_revision}`.
Statuses `todo|in_progress|submitted|done|cancelled`. Assignee may change status to
in_progress/submitted; assigning author or owner may edit fields, complete or
cancel. Creator/owner can also change other statuses. Post task comments through
`/collaboration/tasks/:id/comments` with same comment body contract.
Calendar also displays task due dates without duplicating persistent events.

POST `/collaboration/notifications/read`: `{ids:[...],expected_revision}`. Read
only caller's notifications; empty list marks caller's inbox read. New questions,
replies, assignments and submissions create member-scoped in-app notifications.
Read snapshots expose only caller's notification rows, shared content stays
visible to this workspace. No automatic notification emails are sent.
GET `/collaboration/summary` returns only `{unread_count,revision}` for the
current actor. The top navigation polls this lightweight endpoint while visible.

## State/model

Optional `state.collaboration` extension: `{version:1,revision:1,events:[],ideas:[],
tasks:[],comments:[],notifications:[],requests:[]}`. Existing state/schema version
stays; missing extension reads empty without writes. Every event/idea/task/comment
has id, created_at/updated_at as appropriate, actor ID/name (created_by,author_id,
assigned_by), and bounded text. No silent dropping of records at capacity.
Exports/restores preserve this extension and its member references without merging
it into foreign memberships. Deleted source records do not erase shared discussion;
retain source label and show unavailable link without granting new access.
Actual restore advances the collaboration revision beyond both current and
archived values. Restoring a legacy archive over collaboration data explicitly
clears the collaboration collections with a fresh revision; validation and export
do not change archive bytes. Open pre-restore forms cannot overwrite restored data.

UI refreshes shared snapshots rather than providing simultaneous text coauthoring.
Event/task edit forms retain the revision captured when opened. A stale save keeps
the draft and requires an explicit review/rebase action before retrying.

Shared pure module `frontend/app/lib/collaboration/model.mjs` exports
`emptyCollaboration()`, `validateCollaboration(value)`,
`getCollaborationSnapshot(state,ctx)`,
`applyCollaborationCommand(state,parts,method,body,ctx)`.
ctx `{actor:{id,name,email,role},members:[...],mode:'cloud'|'browser',now?:()=>ISO,id?:()=>UUID}`.
parts begin with 'collaboration'. Errors carry status/code; no shared module
imports hosting/core (avoid cycles). Model checks owner/editor on writes.

UI export `CollaborationView({initialTab?,ideaId?,taskId?})` with calendar/ideas/
tasks/inbox tabs, default calendar. Root owns nav/routes and quick-source sharing
integration. UI agent owns view/new components and its scoped CSS. Browser and
hosted adapters delegate to same pure model. Server rechecks workspace membership
at save CAS, as for existing domains. Date helpers can be exported from separate
`calendar.mjs` module by model owner, with declarations if needed.
