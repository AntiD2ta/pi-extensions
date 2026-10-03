# pi-agent-status

Adds an explicit `request_user_input` tool for Pi agents. The tool records a question, context, a recommended answer, and rationale in the transcript, then ends the current run without opening a modal. Reply through Pi's normal editor with unrestricted free text to continue work.

The transcript card uses two columns when the terminal is wide enough and the content fits both columns without a large height imbalance. Narrow or context-heavy requests use one ordered column. Recommended answer and rationale have a tinted background in both layouts.

An unanswered request survives session resume. The first nonblank interactive response records its resolution before Pi stores the user message.

The extension emits `herdr:blocked` while a request is unanswered and clears it on that response. Load Herdr's Pi integration before this extension so it also receives the blocked event on session resume.

In TUI mode, the status widget shows each non-running agent state with the machine-local time and date captured when that state begins: `Ready · 14:06:09 -- 13:09:2026`. The timestamp remains fixed until the state changes, and the widget is hidden while the agent runs.

## Manual Herdr block

Run `/block` in an interactive Pi terminal to mark the agent for later using Herdr's existing blocked status. Focusing the agent does not clear the mark. Repeating `/block` does not add another block.

The next nonblank interactive prompt clears the manual mark, or run `/block clear` to clear it without starting a model turn. Blank input, extension-sent prompts, built-in commands that keep the current session, such as `/reload`, and registered extension commands leave it set. Skill invocations and prompt templates clear it because they submit a prompt. Clearing the manual mark does not resolve an unanswered `request_user_input` request.

The mark survives `/reload` and resume of a saved session. Load Herdr's Pi integration before this extension, as for input requests. The command emits `herdr:blocked`; without that integration it does not change Herdr. It uses Herdr's blocked reporting, not a seen/unseen setter. Both manual marks and input requests use the label "Waiting for user input." so clearing one cannot leave the other with a stale label.
