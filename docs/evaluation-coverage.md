# Control Plane MCP evaluation coverage

Inventory: `control-plane-mcp-v1` v1; 95 actions. Base schemas: `9c2c4499c9f9a1c1538af24d4f4519add12f1b59` in `internal/agentapi/actions.json`; all schema descriptions were synchronized against the current source tree.

Coverage here means local pack definition and validation only. No action has fresh deployed run evidence. The 95-case schema-guard pack checks one unknown-field rejection per action without calling a service; this gives all 95 operations safe local case coverage, including operations whose positive calls remain gated. Evalcase reports this separately from positive coverage and live-policy status. A separate batch guard rejects empty create/update arrays. Positive manual packs now cover all 18 read-only operations and 11 run-owned SharePoint CRUD/seed operations, two exact-job status reads, and the one-time confirmed site create. Seed continuation has a valid positive pack but requires a naturally interrupted job with untouched rows; no fault is injected to manufacture that recovery state. Tenant-wide catalog enumeration and side-effectful provisioning remain gated or not started.

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
| `control-plane-readonly.automation-pack.json` | `work_list`, `automation_list`, `automation_templates`, `automation_inbox`, `settings_read`, `diagnostics_status`, `diagnostics_export`, `integrations_list`, `agents_list` | locally validated; service-scope target; not live-verified |
| `work-results-read.automation-pack.json` | `work_results` | locally validated; exact work-item target; not live-verified |
| `feed-read.automation-pack.json` | `feed_read` | locally validated; exact subscriber target; not live-verified |

## Operation policy matrix

### read-only (18)

- `work_list` — pack-defined-not-live-verified
- `work_results` — pack-defined-not-live-verified
- `automation_list` — pack-defined-not-live-verified
- `automation_templates` — pack-defined-not-live-verified
- `automation_inbox` — pack-defined-not-live-verified
- `deployment_recycle_bin_assess` — pack-defined-not-live-verified
- `deployment_list_changes` — pack-defined-not-live-verified
- `deployment_site_lists` — pack-defined-not-live-verified
- `deployment_list_columns` — pack-defined-not-live-verified
- `deployment_list_items` — pack-defined-not-live-verified
- `deployment_list_items_batch` — pack-defined-not-live-verified
- `deployment_list_item_read` — pack-defined-not-live-verified
- `settings_read` — pack-defined-not-live-verified
- `diagnostics_status` — pack-defined-not-live-verified
- `diagnostics_export` — pack-defined-not-live-verified
- `integrations_list` — pack-defined-not-live-verified
- `agents_list` — pack-defined-not-live-verified
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

## Evidence limits

- Safe local case coverage: 95/95 operations have a schema-rejection case; this does not count as positive or live coverage.
- Positive local pack definitions: 32 operations; this does not mean all 95 operations are positive or live-tested.
- Live-verified operations: 0.
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
