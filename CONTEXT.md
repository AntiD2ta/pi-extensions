# Pi extensions context

This glossary defines terms used by the maintained personal Pi extensions in this repository.

## Agent status

**Agent state**:
The externally visible lifecycle state of an agent session. The input protocol owns its `Needs input` state; presentation maps all states to widgets and terminal titles.
_Avoid_: mode, phase

**Session identity**:
A terminal-title label that prefers Pi’s explicit session name, otherwise a normalized preview of the first user message. It never changes session metadata.
_Avoid_: session title, generated name

**Status widget**:
A replace-in-place, one-line display above Pi’s editor that names the current non-running agent state. It is absent while the agent is Running.
_Avoid_: notification, banner

**Input request**:
An unresolved request for a user's free-text decision, created by the `request_user_input` tool. Its tool result records the request, and a later resolution entry records the next interactive-editor response.
_Avoid_: prompt, modal, dialog

## Subagents

**Subagent role**:
A trusted launch policy that fixes a child agent's model, thinking level, tool allowlist, and additional system instructions. A normal dispatch selects a role rather than supplying these settings separately.
_Avoid_: persona, agent type

**Subagent run**:
One durable execution of a task by a separate Pi session. Its identity and state survive parent wait deadlines, extension reloads, and terminal closure.
_Avoid_: job, tmux session

**Wait deadline**:
The time the parent waits for a subagent state change before regaining control. Reaching it does not stop, fail, or authorize repeating the subagent run.
_Avoid_: timeout

**Result acknowledgment**:
The durable record that the parent collected a subagent run's terminal result. It starts terminal cleanup but does not delete the result or Pi session.
_Avoid_: completion, consumption

**Child bridge**:
The explicitly loaded child-only extension that publishes run state, final output, and input requests through the durable run protocol. It does not launch or supervise the child process.
_Avoid_: runner, dispatcher

**Capability ceiling**:
The maximum tools, trusted extensions, and delegated roles available to a subagent run and all of its descendants. A requested role that exceeds the ceiling fails before launch.
_Avoid_: permissions, inherited tools

**Coordinator role**:
A subagent role allowed to dispatch children from a fixed set of roles within a maximum delegation depth. Ordinary roles cannot dispatch subagents.
_Avoid_: supervisor, master agent

**Trusted extension catalog**:
Configuration that maps stable extension names to administrator-approved extension sources and the tools they may register. Subagent calls select catalog names and never provide executable paths.
_Avoid_: extension allowlist, plugin registry

**Role source**:
A package role, user role under `~/.pi/agent/agents`, or trusted project role under `.agents/agents`. A role file's frontmatter describes and configures the role; its Markdown body is appended to the child system prompt. A higher-precedence source may replace a role with the same name, but project roles may reference only globally trusted extension names.
_Avoid_: role scope, agent directory

**Worktree run**:
A subagent run executed in a dedicated Git worktree. Under Herdr, the worktree has its own associated workspace, root tab, and root pane; outside Herdr, the headless transport uses the same deterministic branch and checkout identity.
_Avoid_: worktree tab, child workspace

**Local context overlay**:
A one-way snapshot of untracked files matched by the source repository's `.git/info/exclude`, copied into a new worktree before Pi starts. The run records copied paths and hashes; it never synchronizes overlay changes back to the source checkout.
_Avoid_: ignored files, worktree context

**Result revision**:
One terminal output published by a subagent run. New user input during the cleanup grace period reopens the run and produces a later revision without overwriting acknowledged output.
_Avoid_: retry, follow-up result
