# Plane triage mapping

Use PI work-item state and labels as follows:

| Role | State | Labels |
| --- | --- | --- |
| `needs-triage` | Backlog | `needs-triage` |
| `needs-info` | Backlog | none; record the required maintainer response in a comment |
| `ready-for-agent` | Backlog | `ready-for-agent`, `AFK` |
| `ready-for-human` | In Review | `ready-for-agent`, `HITL` |
| `wontfix` | Cancelled | none |

`ready-for-agent` is availability. `AFK` and `HITL` are completion gates. Before any Plane write, read the work item, body, relations, and latest comments. A disposition requires one provenance comment.
