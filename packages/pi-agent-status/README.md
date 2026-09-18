# pi-agent-status

Adds an explicit `request_user_input` tool for Pi agents. The tool records a question, context, a recommended answer, and rationale in the transcript, then ends the current run without opening a modal. Reply through Pi's normal editor with unrestricted free text to continue work.

The transcript card uses two columns when the terminal is wide enough and the content fits both columns without a large height imbalance. Narrow or context-heavy requests use one ordered column. Recommended answer and rationale have a tinted background in both layouts.

An unanswered request survives session resume. The first nonblank interactive response records its resolution before Pi stores the user message.

In TUI mode, the status widget shows each non-running agent state with the machine-local time and date captured when that state begins: `Ready · 14:06:09 -- 13:09:2026`. The timestamp remains fixed until the state changes, and the widget is hidden while the agent runs.
