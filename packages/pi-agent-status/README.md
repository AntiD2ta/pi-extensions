# pi-agent-status

Adds an explicit `request_user_input` tool for Pi agents. The tool records context, a question, a recommended answer, and rationale in the transcript, then ends the current run without opening a modal. Reply through Pi's normal editor with unrestricted free text to continue work.

An unanswered request survives session resume. The first nonblank interactive response records its resolution before Pi stores the user message.
