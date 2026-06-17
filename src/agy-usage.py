#!/usr/bin/env python3
"""
Headless driver for the Antigravity CLI (`agy`) `/usage` slash command.

`agy` is a bubbletea TUI that quits immediately unless its stdin/stdout is a
real terminal with a non-zero window size. The `/usage` slash command also only
fires when typed into the live TUI input (passing it via --print/-i makes the
agent treat it as a prompt). So we allocate a PTY, set a window size, wait for
the TUI to settle, type "/usage<Enter>", capture the rendered panel, and quit.

Prints the raw (ANSI-laden) captured bytes to stdout for server.js to parse.
Exit 0 if the usage panel was captured, non-zero otherwise.
"""

import os
import pty
import sys
import time
import select
import fcntl
import struct
import termios
import signal

# Marker that tells us the usage panel finished rendering.
READY_MARKER = b"Models & Quota"

# Timing budget (seconds).
PROMPT_SETTLE = 5.0      # let the TUI boot before typing
SETTLE_AFTER_READY = 1.5  # keep reading after the panel appears, to catch full render
HARD_CAP = 25.0          # absolute ceiling for the whole capture


def main():
    home = os.environ.get("HOME", os.path.expanduser("~"))
    env = dict(os.environ)
    env["TERM"] = "xterm-256color"
    # Make sure ~/.local/bin (where `agy` lives) is reachable.
    local_bin = os.path.join(home, ".local", "bin")
    env["PATH"] = local_bin + os.pathsep + env.get("PATH", "")

    pid, fd = pty.fork()
    if pid == 0:
        # Child: become the agy TUI on the slave side of the PTY.
        os.environ.clear()
        os.environ.update(env)
        try:
            os.execvp("agy", ["agy"])
        except Exception:
            os._exit(127)

    # Parent: give the PTY a real window size or bubbletea bails.
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 160, 0, 0))

    buf = b""
    start = time.time()
    sent = False
    ready_at = None

    while True:
        now = time.time()
        if now - start > HARD_CAP:
            break

        rlist, _, _ = select.select([fd], [], [], 0.3)
        if rlist:
            try:
                data = os.read(fd, 65536)
            except OSError:
                break
            if not data:
                break
            buf += data

        if not sent and (now - start) > PROMPT_SETTLE:
            try:
                os.write(fd, b"/usage\r")
            except OSError:
                break
            sent = True

        if sent and ready_at is None and READY_MARKER in buf:
            ready_at = now

        if ready_at is not None and (now - ready_at) > SETTLE_AFTER_READY:
            break

    # Tear down the child cleanly.
    try:
        os.kill(pid, signal.SIGTERM)
        for _ in range(20):
            wpid, _ = os.waitpid(pid, os.WNOHANG)
            if wpid:
                break
            time.sleep(0.05)
        else:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
    except Exception:
        pass

    sys.stdout.buffer.write(buf)
    sys.stdout.buffer.flush()
    # Non-zero exit if we never saw the usage panel.
    sys.exit(0 if READY_MARKER in buf else 1)


if __name__ == "__main__":
    main()
