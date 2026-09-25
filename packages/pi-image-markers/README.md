# Image markers

This extension enables atomic `[Image N]` markers for images pasted with Ctrl+V in the AntiD2ta Pi fork. The number counts images in the current draft. Deleting a marker removes the image path from the draft; submitting the prompt sends the path, not the marker.

In fullscreen TUI mode, copying a complete marker with Pi-managed selection copies the path. In regular mode, terminal-native selection copies the visible marker because Pi cannot intercept it. On public Pi, the extension warns and leaves image pasting unchanged.
