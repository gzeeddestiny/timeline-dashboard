# MAGIC Timeline V2 — repository assessment

Research snapshot: **20 September 2026**. Window: **20 September 2025–20 September 2026**. Stars are total stars at inspection, not stars gained during the window. GitHub repository metadata and default-branch commit history were checked through the public API. Search categories: Gantt, project management, React calendar, Kanban, data tables, charts, search and collaboration. This is a relevant shortlist, not an exhaustive inventory of GitHub.

## Direct dependencies

All selected repositories had a default-branch commit in the window. React peer dependencies were checked against the existing React 19 installation. Exact installed versions are pinned in package.json and package-lock.json.

| Repository | Stars | Last commit in window | License | Package version | Use |
|---|---:|---|---|---|---|
| [TanStack/query](https://github.com/TanStack/query) | 50,335 | 2026-09-19 | MIT | @tanstack/react-query 5.103.1 | V2-only cache and invalidation; automatic focus/reconnect refetch disabled |
| [TanStack/table](https://github.com/TanStack/table) | 28,443 | 2026-09-16 | MIT | @tanstack/react-table 9.2.4 | v9 feature API, sorting; app-owned grouping and column preferences |
| [recharts/recharts](https://github.com/recharts/recharts) | 27,574 | 2026-09-19 | MIT | recharts 3.10.1 | Status and actual daily snapshot charts |
| [react-grid-layout/react-grid-layout](https://github.com/react-grid-layout/react-grid-layout) | 22,428 | 2026-08-31 | MIT | react-grid-layout 2.2.4 | Personal draggable/resizable dashboard |
| [fullcalendar/fullcalendar](https://github.com/fullcalendar/fullcalendar) | 20,642 | 2026-09-05 | MIT (standard) | @fullcalendar/react 7.1.0 | Month/week/list views; no premium scheduler |
| [krisk/Fuse](https://github.com/krisk/Fuse) | 20,487 | 2026-08-09 | Apache-2.0 | fuse.js 7.5.0 | Thai-friendly fuzzy lookup across task/brand/project/owner |
| [clauderic/dnd-kit](https://github.com/clauderic/dnd-kit) | 17,655 | 2026-09-12 | MIT | @dnd-kit/react 0.5.0 | Current React drag/drop API; explicit select alternative |
| [dip/cmdk](https://github.com/dip/cmdk) (formerly pacocoursey/cmdk) | 12,974 | 2025-10-29 | MIT | cmdk 1.1.1 | Keyboard command dialog, capped search result rendering |
| [TanStack/virtual](https://github.com/TanStack/virtual) | 7,114 | 2026-09-14 | MIT | @tanstack/react-virtual 3.14.13 | Large-table row virtualization |
| [frappe/gantt](https://github.com/frappe/gantt) | 6,123 | 2026-03-05 | MIT | frappe-gantt 1.2.2 | Plan intervals and dependency arrows; 200-row page limit |

## Other repositories assessed

Activity below is GitHub `pushed_at` at research time; it is not presented as a verified default-branch commit. `NOASSERTION` means GitHub did not identify a single SPDX license; it is not a license grant.

| Repository | Stars | Recent activity | License metadata | Decision |
|---|---:|---|---|---|
| [AppFlowy-IO/AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) | 76,858 | 2026-09-19 | AGPL-3.0 | Multi-view workspace reference; Flutter/Rust platform is not embedded |
| [makeplane/plane](https://github.com/makeplane/plane) | 59,664 | 2026-09-18 | AGPL-3.0 | Task detail, views and filtering reference; no platform migration |
| [novuhq/novu](https://github.com/novuhq/novu) | 40,021 | 2026-09-20 | NOASSERTION | Keep existing notification queue, scheduler and email behavior |
| [frappe/erpnext](https://github.com/frappe/erpnext) | 39,393 | 2026-09-20 | GPL-3.0 | ERP scope exceeds timeline requirements |
| [xyflow/xyflow](https://github.com/xyflow/xyflow) | 38,439 | 2026-09-17 | MIT | Separate graph editor unnecessary for finish-to-start dependencies |
| [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban) | 28,140 | 2026-09-19 | Apache-2.0 | Coding-agent task workflow is outside this business dashboard |
| [hcengineering/platform](https://github.com/hcengineering/platform) | 27,732 | 2026-09-17 | EPL-2.0 | Huly collaboration reference; no separate chat/document backend |
| [mattermost-community/focalboard](https://github.com/mattermost-community/focalboard) | 26,479 | 2026-05-18 | NOASSERTION | Board reference; current app needs embedded UI, not another server |
| [nocobase/nocobase](https://github.com/nocobase/nocobase) | 24,299 | 2026-09-20 | NOASSERTION | No-code platform would duplicate the Supabase data layer |
| [wekan/wekan](https://github.com/wekan/wekan) | 21,091 | 2026-09-20 | MIT | Board interaction reference; Meteor backend not adopted |
| [cft0808/edict](https://github.com/cft0808/edict) | 16,903 | 2026-09-07 | MIT | Agent orchestration outside scope |
| [opf/openproject](https://github.com/opf/openproject) | 16,161 | 2026-09-20 | GPL-3.0 | Planning/dependency reference; preserve current deployment architecture |
| [theonedev/onedev](https://github.com/theonedev/onedev) | 15,259 | 2026-09-20 | MIT | Developer/CI platform outside scope |
| [Leantime/leantime](https://github.com/Leantime/leantime) | 11,619 | 2026-09-07 | AGPL-3.0 | Project planning reference, separate app not embedded |
| [leeoniya/uPlot](https://github.com/leeoniya/uPlot) | 10,507 | 2026-09-20 | MIT | Good time-series option; Recharts covers current charts with one React library |
| [wix/react-native-calendars](https://github.com/wix/react-native-calendars) | 10,311 | 2026-04-23 | MIT | Native-mobile target, not this web application |
| [bigcalendar/react-big-calendar](https://github.com/bigcalendar/react-big-calendar) | 8,755 | 2026-06-01 | MIT | Alternative; FullCalendar selected for standard view coverage |
| [gpbl/react-day-picker](https://github.com/gpbl/react-day-picker) | 6,853 | 2026-08-26 | MIT | Date picker, not a full task calendar |
| [wojtekmaj/react-calendar](https://github.com/wojtekmaj/react-calendar) | 3,789 | 2026-09-09 | MIT | Date selection rather than task/event scheduling |
| [neuronetio/gantt-schedule-timeline-calendar](https://github.com/neuronetio/gantt-schedule-timeline-calendar) | 3,629 | 2026-06-11 | NOASSERTION | Frappe selected with verified MIT metadata and narrower scope |
| [schedule-x/schedule-x](https://github.com/schedule-x/schedule-x) | 2,578 | 2026-09-19 | MIT | Alternative calendar; avoid duplicate calendar engines |
| [DevExpress/DevExtreme](https://github.com/DevExpress/DevExtreme) | 1,916 | 2026-09-18 | NOASSERTION | Broad commercial-oriented suite unnecessary |
| [svar-widgets/react-gantt](https://github.com/svar-widgets/react-gantt) | 210 | 2026-09-09 | MIT core | Useful React-native alternative; fewer stars, advanced features in PRO |
| [hoppscotch/hoppscotch](https://github.com/hoppscotch/hoppscotch) | 80,422 | 2026-09-20 | MIT | API testing product; not an application dependency |

## Official implementation sources

- React lazy loading: https://react.dev/reference/react/lazy
- Query refresh defaults: https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults
- TanStack v9 API: installed `@tanstack/react-table` declarations and bundled getting-started guide, corresponding to the pinned version; do not use v8 `useReactTable` examples.
- Virtualizer: https://tanstack.com/virtual/latest/docs/api/virtualizer
- Current dnd-kit API: https://dndkit.com/react/quickstart/
- FullCalendar v7 React integration: https://fullcalendar.io/docs/react
- Frappe defaults/source: https://github.com/frappe/gantt/blob/master/src/defaults.js — `move_dependencies: false`, date-only app adapter and escaped task labels.
- Grid layout API: https://github.com/react-grid-layout/react-grid-layout and the pinned v2 declarations (`gridConfig`, `dragConfig`).

No source from the standalone AGPL/GPL/EPL platforms was copied into MAGIC. Their product capabilities informed the feature comparison. Direct-library license notices are published at `/v2-licenses.txt`.

FullCalendar 7.1.0 has a local, version/hash-checked resize scheduling patch applied by `scripts/patch-fullcalendar.mjs` during postinstall. See `v2-rollout.md` for maintenance details. No global error suppression is used.
