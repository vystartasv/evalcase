# Control Plane MCP evaluation coverage

Inventory: `control-plane-mcp-v1` v1; 95 actions. Base schemas: `9c2c4499c9f9a1c1538af24d4f4519add12f1b59` in `internal/agentapi/actions.json`; all schema descriptions were synchronized against the current source tree.

Coverage here means local pack definition and validation. Nine core Control Plane reads have fresh deployed manual-run evidence on SHA `76fb203be445be854c3ae4586c259664c67af98d`; SharePoint item/site operations remain without fresh positive evidence. The 95-case schema-guard pack checks one unknown-field rejection per action without calling a service; this gives all 95 operations safe local case coverage, including operations whose positive calls remain gated. Evalcase reports this separately from positive coverage and live-policy status. A separate batch guard rejects empty create/update arrays. Positive manual packs cover all 18 read-only operations and 11 run-owned SharePoint CRUD/seed operations, two exact-job status reads, and the one-time confirmed site create. Seed continuation has a valid positive pack but requires a naturally interrupted job with untouched rows; no fault is injected to manufacture that recovery state. Tenant-wide catalog enumeration and side-effectful provisioning remain gated or not started.

## Pack-defined positive coverage

| Pack | Positive operations | Status |
|---|---|---|
| `sharepoint-list-crud.pack.json` | `deployment_list_changes`, `deployment_site_lists`, `deployment_site_list_create`, `deployment_site_list_rename`, `deployment_site_list_delete`, `deployment_list_columns`, `deployment_list_column_create`, `deployment_list_items`, `deployment_list_items_batch`, `deployment_list_items_batch_create`, `deployment_list_items_batch_update`, `deployment_list_item_read`, `deployment_list_item_create`, `deployment_list_item_update`, `deployment_list_item_delete` | locally validated; not live-verified |
| `sharepoint-list-seed.automation-pack.json` | `deployment_list_seed` | locally validated; temporary list and row require cleanup; not live-verified |
| `sharepoint-list-seed-status.automation-pack.json` | `deployment_list_seed_status` | locally validated; exact job ID only; remains gated for unrelated jobs; not live-verified |
| `sharepoint-list-seed-continue.automation-pack.json` | `deployment_list_seed_continue` | locally validated; exact job/site/list target; positive live run requires naturally pending untouched rows; not live-verified |
| `sharepoint-site-create-status.automation-pack.json` | `deployment_site_create_status` | locally validated; exact job ID only; remains gated for unrelated jobs; not live-verified |
| `sharepoint-site-create.automation-pack.json` | `deployment_site_create` | locally validated; one-time exact URL/title/owner confirmation; not live-verified |
| `sharepoint-site-read.automation-pack.json` | `deployment_site_lists`, `deployment_recycle_bin_assess` | locally validated; exact-site target; not live-verified |
| `control-plane-readonly.automation-pack.json` | `work_list`, `automation_list`, `automation_templates`, `automation_inbox`, `settings_read`, `diagnostics_status`, `diagnostics_export`, `integrations_list`, `agents_list` | locally validated; each action live-verified in the split workflows below |
| `control-plane-work-list.automation-pack.json` and `control-plane-readonly-remainder.automation-pack.json` | same nine reads split as one isolated `work_list` and an independent eight-action remainder | locally validated with separate matchers; both ordinary manual runs succeeded and both matchers returned `yes=true` on deployed SHA `76fb203` |
| `work-results-read.automation-pack.json` | `work_results` | locally validated; exact work-item target; not live-verified |
| `feed-read.automation-pack.json` | `feed_read` | locally validated; exact subscriber target; not live-verified |

### Fresh manual read evidence

| Deployed SHA | Target pack | Workflow ID | Run ID | Result |
|---|---|---|---|---|
| `5a79d6c` | isolated `work_list` | `6c6f3980-9cf5-4eaf-90d9-35e1fd3aa9c7` | `automation-manual-cf142aff-362f-430c-8a9f-c0a68ac23784` | succeeded; `work_list` HTTP 200; matcher `control-plane-work-list` returned `yes=true` |
| `5a79d6c` | eight-action remainder | `7204b976-2250-464c-85b9-ee6c70b0fab9` | `automation-manual-b6b56d6b-222f-4f23-a3a5-3b87be7bf6e6` | succeeded; all eight actions HTTP 200; matcher `control-plane-readonly-remainder` returned `yes=true` |
| `76fb203` | isolated `work_list` | `6c6f3980-9cf5-4eaf-90d9-35e1fd3aa9c7` | `automation-manual-9ed877e9-b032-40a3-8860-4772ad02c038` | succeeded; `work_list` HTTP 200; matcher `control-plane-work-list` returned `yes=true` |
| `76fb203` | eight-action remainder | `7204b976-2250-464c-85b9-ee6c70b0fab9` | `automation-manual-2f0a57de-1b7b-4c93-8f62-25807b635c76` | succeeded; all eight actions HTTP 200; matcher `control-plane-readonly-remainder` returned `yes=true` |

All runs were ordinary manual workflows targeting `control-plane` / `automation-api` / `scope=workspace`, with no side effects. SHA `76fb203be445be854c3ae4586c259664c67af98d` was deployed by [delivery run 43497036794](https://github.com/vystartasv/control-plane/actions/runs/43497036794); its check job and dev deployment succeeded, and web/worker containers reported healthy. Earlier failed smoke runs remain in ordinary logs as failure evidence. No SharePoint site/list writes were part of these successful reads.

## Operation policy matrix

### read-only (18)

- `work_list` — live-verified (deployed `76fb203`; isolated manual read run)
- `work_results` — pack-defined-not-live-verified
- `automation_list` — live-verified (deployed `76fb203`; read-only remainder run)
- `automation_templates` — live-verified (deployed `76fb203`; read-only remainder run)
- `automation_inbox` — live-verified (deployed `76fb203`; read-only remainder run)
- `deployment_recycle_bin_assess` — pack-defined-not-live-verified
- `deployment_list_changes` — pack-defined-not-live-verified
- `deployment_site_lists` — pack-defined-not-live-verified
- `deployment_list_columns` — pack-defined-not-live-verified
- `deployment_list_items` — pack-defined-not-live-verified
- `deployment_list_items_batch` — pack-defined-not-live-verified
- `deployment_list_item_read` — pack-defined-not-live-verified
- `settings_read` — live-verified (deployed `76fb203`; read-only remainder run)
- `diagnostics_status` — live-verified (deployed `76fb203`; read-only remainder run)
- `diagnostics_export` — live-verified (deployed `76fb203`; read-only remainder run)
- `integrations_list` — live-verified (deployed `76fb203`; read-only remainder run)
- `agents_list` — live-verified (deployed `76fb203`; read-only remainder run)
- `feed_read` — pack-defined-not-live-verified

### run-owned-resource-cleanup-required (11)

- `deployment_site_list_create` — pack-defined-not-live-verified; create sharepoint-list
- `deployment_site_list_rename` — pack-defined-not-live-verified; update sharepoint-list
- `deployment_site_list_delete` — pack-defined-not-live-verified; delete sharepoint-list
- `deployment_list_column_create` — pack-defined-not-live-verified; create sharepoint-column
- `deployment_list_seed` — pack-defined-not-live-verified; create sharepoint-list
- `deployment_list_seed_continue` — pack-defined-not-live-verified; continue untouched rows on a saved list-seed job
- `deployment_list_items_batch_create` — pack-defined-not-live-verified; create sharepoint-list-item
- `deployment_list_items_batch_update` — pack-defined-not-live-verified; update sharepoint-list-item
- `deployment_list_item_create` — pack-defined-not-live-verified; create sharepoint-list-item
- `deployment_list_item_update` — pack-defined-not-live-verified; update sharepoint-list-item
- `deployment_list_item_delete` — pack-defined-not-live-verified; delete sharepoint-list-item

### one-time-confirmed-target-required (2)

- `deployment_site_create` — pack-defined-not-live-verified; create sharepoint-site; one-time exact confirmation
- `deployment_site_create_continue` — uncovered; update sharepoint-site

### gated-outside-authorized-scope (37)

- `automation_recovery_decision` — uncovered
- `deployment_list` — uncovered
- `deployment_site_catalogs` — uncovered
- `deployment_site_create_status` — pack-defined-not-live-verified; exact job ID only
- `deployment_list_seed_status` — pack-defined-not-live-verified; exact job ID only
- `deployment_upload` — uncovered
- `deployment_blueprint_save` — uncovered
- `deployment_blueprint_plan` — uncovered
- `deployment_copy_plan` — uncovered
- `deployment_copy_start` — uncovered
- `deployment_copy_continue` — uncovered
- `deployment_page` — uncovered
- `deployment_page_status` — uncovered
- `deployment_page_reconcile` — uncovered
- `deployment_site_install` — uncovered
- `deployment_package` — uncovered
- `sharepoint_status` — uncovered
- `sharepoint_list_subscriptions` — uncovered
- `sharepoint_subscription_create` — uncovered
- `sharepoint_subscription_renew` — uncovered
- `sharepoint_subscription_reconcile` — uncovered
- `sharepoint_handoff` — uncovered
- `sharepoint_certificate` — uncovered
- `sharepoint_bootstrap` — uncovered
- `sharepoint_setup_instructions` — uncovered
- `sharepoint_save_setup` — uncovered
- `sharepoint_manual` — uncovered
- `sharepoint_destination` — uncovered
- `sharepoint_attach` — uncovered
- `sharepoint_guide` — uncovered
- `sharepoint_verify` — uncovered
- `sharepoint_rotate` — uncovered
- `sharepoint_activate` — uncovered
- `sharepoint_rollback` — uncovered
- `sharepoint_finish_rotation` — uncovered
- `sharepoint_disconnect` — uncovered
- `deployment_site_uninstall` — uncovered; delete sharepoint-installation

### unsafe-or-not-started (27)

- `work_group` — uncovered
- `work_create` — uncovered
- `work_send` — uncovered
- `work_close` — uncovered
- `work_retry_mail` — uncovered
- `work_save_template` — uncovered
- `work_use_template` — uncovered
- `work_template_enabled` — uncovered
- `work_invite_account` — uncovered
- `work_account_enabled` — uncovered
- `automation_connection` — uncovered
- `automation_preview` — uncovered
- `automation_inbox_read` — uncovered
- `automation_failure_recipients` — uncovered
- `automation_workflow` — uncovered
- `automation_subscribe` — uncovered
- `automation_workflow_enabled` — uncovered
- `automation_subscriber_enabled` — uncovered
- `automation_read` — uncovered
- `automation_run` — uncovered
- `settings_save_email` — uncovered
- `settings_verify_email` — uncovered
- `diagnostics_toggle` — uncovered
- `diagnostics_ingest` — uncovered
- `integrations_create` — uncovered
- `integrations_revoke` — uncovered
- `event_emit` — uncovered

## SharePoint and Graph route/shape audit

This is a bounded contract cross-check against the PnPjs docs and the Go routes already used by the integrated catalog. PnPjs is a reference, not a dependency or a claim that every SharePoint edge case is implemented. `sharepoint_*` connection/setup actions are Control Plane setup APIs; the provider operations below are the SharePoint/Graph calls reached through `deployment_*` actions.

| Catalog actions | Current provider route and request/response shape | Contract notes and local evidence |
|---|---|---|
| `deployment_site_lists`, `deployment_site_list_create`, `deployment_site_list_rename`, `deployment_site_list_delete` | Resolve the exact site by Graph host/path, then use `/v1.0/sites/{siteId}/lists`; create sends `{displayName,list:{template:"genericList"}}` plus optional `columns`; update patches `displayName`; delete uses the exact list ID. Responses are Graph list objects (`id`, `displayName`, `list.template`) or `{value,@odata.nextLink}`. | Create read-backs the exact ID/template and optional columns; a same-name result is accepted only after exact template/column verification. Conflicts are not swallowed. Exact IDs and opaque next links are bound to the site. Local coverage: `lists_test.go`. PnPjs also distinguishes ensured/existing lists and warns that ensure is not batchable. [SP lists](https://pnp.github.io/pnpjs/sp/lists/), [Graph sites](https://pnp.github.io/pnpjs/graph/sites/), [Graph lists](https://pnp.github.io/pnpjs/graph/lists/). |
| `deployment_list_columns`, `deployment_list_column_create` | Read uses Graph `/sites/{siteId}/lists/{listId}/columns`; create uses SharePoint REST `/_api/web/lists(guid'{listId}')/Fields` with an `SP.Field*` body, followed by metadata readback. | Internal field names/type facets matter. Only the catalog’s supported field types are exposed. Content types, site fields, and Enhanced rich text/XML remain product gaps. Local coverage: `column_create_test.go`, `lists_test.go`. [SP fields](https://pnp.github.io/pnpjs/sp/fields/), [SP webs](https://pnp.github.io/pnpjs/sp/webs/). |
| `deployment_list_items`, `deployment_list_item_read`, `deployment_list_item_create`, `deployment_list_item_update`, `deployment_list_item_delete` | Graph `/sites/{siteId}/lists/{listId}/items`; reads return `{value:[{id,eTag,fields}],@odata.nextLink}`; create POSTs `{fields:{...}}`; update PATCHes `/items/{itemId}/fields` with `If-Match`; delete also uses the current ETag. Mutations read back or verify absence. | Continuation links are opaque, validated, and bound to exact site/list/projection/filter. Lookup writes serialize only a supported single lookup as `<internalName>LookupId`; multi-value lookup is rejected. The API currently exposes lookup IDs from Graph `fields`, but no title expansion projection. SP REST’s `Lookup/Title` plus `$expand=Lookup` syntax must not be copied onto Graph routes. Local coverage: `items_test.go`; safe Graph GET retry/error tests: `retry_test.go`. [SP items](https://pnp.github.io/pnpjs/sp/items/), [Graph items](https://pnp.github.io/pnpjs/graph/items/), [async paging](https://pnp.github.io/pnpjs/concepts/async-paging/). |
| `deployment_list_changes`, `sharepoint_subscription_create`, `sharepoint_subscription_renew`, `sharepoint_subscription_reconcile` | Graph list-item `/delta` continuation and `/subscriptions`; subscription JSON binds the resource to exact site/list and includes expiration/change notification fields. | Delta links are opaque and site/list-bound; delta is latest-state synchronization, not a full event history. Reconciliation applies idempotently before committing the next cursor. Graph list-item capability is supported by this backend even though current PnPjs Graph list docs say the SDK does not expose item listing. Local coverage: `delta_test.go`, `subscriptions_test.go`, `notifications_test.go`. [Graph lists](https://pnp.github.io/pnpjs/graph/lists/). |
| `deployment_list_items_batch`, `deployment_list_items_batch_create`, `deployment_list_items_batch_update` | Microsoft Graph `POST /v1.0/$batch` with `{requests:[{id,method,url,headers,body?}]}` and per-request `{id,status,headers,body}` results. | This is Graph batching; it is separate from SharePoint REST `$batch`. Batch size is capped at 20, per-item outcomes are retained, successful writes are read back, and mutation batches are never automatically retried. Local coverage: `item_batch*_test.go`. PnPjs warns not to reuse queryable instances inside a batch. [Batching](https://pnp.github.io/pnpjs/concepts/batching/). |
| `deployment_site_create`, `deployment_site_create_status`, `deployment_site_create_continue` | SharePoint tenant admin REST `/_api/SPSiteManager/create` and exact-URL `/status`; request uses `SiteCreationProperties`, response/status carry `SiteId`, `SiteUrl`, and `SiteStatus` (0 Not Found, 1 Provisioning, 2 Ready, 3 Error, 4 URL exists). | Existing job `b8e2e701-68a1-46a0-8d57-17b41a86e0b0` returned create status 3, then exact status 0; it remains failed and no further retry is authorized. That identifies provisioning failure, but the API response has no underlying reason. The saved owner is `owner@workswithagents.com`; source only validates email syntax, and app-only site creation requires a real tenant owner. Code now treats a future create response with status 3 as terminal and surfaces that status instead of classifying it as uncertain and automatically repeating the same request. This does not prove which tenant policy or owner condition failed, and is not positive site evidence. Local coverage: `site_create_test.go`. [Microsoft SPSiteManager contract](https://learn.microsoft.com/en-us/sharepoint/dev/apis/site-creation-rest). |
| `deployment_recycle_bin_assess` | SharePoint REST `/_api/site/RecycleBin` with bounded `$top` and opaque `__next` paging; response accepts the documented verbose `d.results` shape. | Cursor is exact-site-bound; malformed/foreign next links are rejected. Local coverage: `handler_test.go`. |
| `deployment_page`, `deployment_page_status`, `deployment_page_reconcile`, `deployment_upload`, `deployment_site_install`, `deployment_package`, `deployment_site_uninstall` | Microsoft Graph site pages and SharePoint tenant app-catalog REST/package routes, depending on action; page writes are Graph JSON with readback, package/install operations inspect catalog state. | Not equivalent to ordinary list item operations; app-catalog and provisioning work remains gated by current live-write policy. No broad migration, theme, navigation, or content-type support is implied. |

Cross-cutting checks: site and list IDs are explicit; Graph response bodies are not interpreted using SharePoint REST conventions. Paging cursors remain opaque and target-bound. Graph SDK calls use Kiota’s bounded retry middleware. Direct Graph list-item GETs now retry only 429/503/504, at most three times, honoring bounded `Retry-After`; POST/PATCH/DELETE and mutation batches remain single-attempt. Final Graph list-item GET errors retain bounded provider code/message/request IDs in `ProviderError`; some direct mutation failure branches still return status-only errors, and provider details are not yet consistently surfaced to automation logs. No cache is configured on provider writes or action responses (`Cache-Control: no-store`). PnPjs’ retry, error, and cache examples are advisory; they do not authorize retrying non-idempotent creates/updates. SP and Graph paging, query expansion, and batch payloads are separate contracts. [Error handling](https://pnp.github.io/pnpjs/concepts/error-handling/), [Queryable behaviors](https://pnp.github.io/pnpjs/queryable/behaviors/), [Batching](https://pnp.github.io/pnpjs/concepts/batching/), [Batching and caching](https://pnp.github.io/pnpjs/concepts/batching-caching/).

Focused portable-pack gaps: `sharepoint-list-crud.pack.json` exercises the first Graph item page and item mutations but does not force a non-empty continuation cursor, lookup projection, or provider-error response payload. Package tests already cover exact cursor binding, selected fields/filters, single-lookup-ID serialization, normalized error payloads, bounded GET retries, and mutation no-retry (`items_test.go`, `provider_error_test.go`, `retry_test.go`). The existing temporary-list API creates only text columns, so it cannot safely manufacture a lookup column; forcing a provider error would need an injected failure. No live lookup or synthetic error workflow case is added. Keep these as pack-evidence gaps until a real suitable list target or safe fixture capability exists.

## Evidence limits

- Safe local case coverage: 95/95 operations have a schema-rejection case; this does not count as positive or live coverage.
- Positive local pack definitions: 32 operations; this does not mean all 95 operations are positive or live-tested.
- Live-verified operations: 9/95 total; 9/18 read-only operations.
- `deployment_site_create` has a positive one-time pack, but its unique dedicated dev-site creation still requires the deployed workflow and exact target confirmation.
- `deployment_list_seed` has a positive manual pack; its fresh-site run and exact-list cleanup are pending deployment confirmation.
- `deployment_list_seed_continue` has a positive manual pack, but a live success requires an untouched pending row left by a genuine interrupted job. No such job is available, and no interruption will be manufactured.
- Exact-job reads for `deployment_list_seed_status` and `deployment_site_create_status` have positive manual packs; their broader live policies remain gated.
- Tenant-wide app-catalog enumeration (`deployment_site_catalogs`) is gated under the no-app-catalog boundary.
- All nine standard starter templates have structural tests. The service-scope pack reads the template catalog, but no template with external schedule, email, event, or AI effects has run evidence.
- Live run authorization requires all local corrections and validations complete, a new deployment at the exact reviewed SHA, and one fresh dedicated WorksWithAgents dev site. No existing failed site job is reusable.
- Email delivery, account invitations, production/root/app-catalog targets, and unrelated tenant writes remain out of scope.

## Recovery and client-delivery gaps

- The recovery menu is action-aware. Repeatable reads offer immediate and delayed retry; HTTP 429 stops automatic retries and carries a safe `Retry-After`; create conflicts direct inspection; update conflicts require fresh state or ETag; deletes require absence verification. The portal records the selected suggestion only. Choosing “Retry safely” does not replay the action, and neither the API nor UI sends email or contacts an agent.
- The matcher now checks ordinary run/step state, action, replay mode, recovery options, excluded unsafe retries, and a recorded recovery choice. Successful API response bodies are not exposed in run logs; captures are used within workflows only.
- All nine standard starter templates have structural tests, including the template types and their email-using cases. The template-list read is locally packed, but no scheduled, event-triggered, email, or AI-summary template has run evidence or client delivery approval.
- Workflow authoring and template selection remain agent/API-facing; the portal is for human review of definitions, runs, and outcomes. A human authoring editor/template picker is not implemented.
- SharePoint theme/brand, navigation, content types, and full content/history/permission migration remain unsupported. Site create, package deployment, and site-scoped installation still require fresh deployed evidence. Tenant-wide site-catalog enumeration stays gated by the current no-app-catalog boundary.
