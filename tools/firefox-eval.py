#!/usr/bin/env python3
"""Evaluate JS in Firefox/Zen Browser chrome context via DevTools RDP.

Usage: python3 tools/firefox-eval.py 'js expression'
       echo 'js expression' | python3 tools/firefox-eval.py

Connects to 127.0.0.1:6000 (Firefox remote debugging port).
JS runs in chrome-privileged parent process — same scope as experiment/api.js.
Access browser window via: Services.wm.getMostRecentWindow("navigator:browser")
"""

import socket, json, time, sys

HOST = "127.0.0.1"
PORT = 6000

def parse_messages(buf):
    # The RDP length prefix counts UTF-8 BYTES, not characters. We must slice
    # the byte buffer, not the decoded string — multibyte characters (e.g. em
    # dashes in window titles) otherwise misalign and silently drop messages.
    results = []
    pos = 0
    while pos < len(buf):
        c = buf.find(b":", pos)
        if c == -1:
            break
        try:
            length = int(buf[pos:c])
        except ValueError:
            break
        bs = c + 1
        be = bs + length
        if be > len(buf):
            break
        try:
            results.append(json.loads(buf[bs:be].decode("utf-8", errors="replace")))
        except json.JSONDecodeError:
            pass
        pos = be
    return results

def send_recv(sock, msg, wait=2):
    data = json.dumps(msg).encode("utf-8")
    sock.sendall(str(len(data)).encode() + b":" + data)
    time.sleep(wait)
    buf = b""
    while True:
        try:
            chunk = sock.recv(262144)
            if not chunk:
                break
            buf += chunk
        except socket.timeout:
            break
    return parse_messages(buf)

def main():
    if len(sys.argv) > 1:
        js = sys.argv[1]
    else:
        js = sys.stdin.read()

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.connect((HOST, PORT))
    sock.settimeout(5)

    # Read greeting
    buf = b""
    while True:
        try:
            buf += sock.recv(65536)
        except socket.timeout:
            break
        c = buf.find(b":")
        if c > 0:
            try:
                length = int(buf[:c])
                if len(buf) >= c + 1 + length:
                    break
            except ValueError:
                pass

    # Get parent process console actor
    results = send_recv(sock, {"to": "root", "type": "getProcess", "id": 0}, wait=1)
    proc_actor = None
    for r in results:
        if "processDescriptor" in r:
            proc_actor = r["processDescriptor"]["actor"]
    if not proc_actor:
        print("Error: could not get process actor", file=sys.stderr)
        sys.exit(1)

    results = send_recv(sock, {"to": proc_actor, "type": "getTarget"}, wait=1)
    console_actor = None
    for r in results:
        if "process" in r:
            console_actor = r["process"].get("consoleActor")
    if not console_actor:
        print("Error: could not get console actor", file=sys.stderr)
        sys.exit(1)

    def print_result(msg):
        val = msg["result"]
        if isinstance(val, str):
            print(val)
        else:
            print(json.dumps(val, indent=2))

    # Evaluate JS
    results = send_recv(sock, {"to": console_actor, "type": "evaluateJSAsync", "text": js}, wait=3)
    # Newer Firefox/Zen builds often send resultID and evaluationResult in the
    # same packet. Prefer any concrete result already present before waiting
    # for a later packet, otherwise a successful eval can appear to hang.
    for r in results:
        if "result" in r:
            print_result(r)
            sock.close()
            return

    for r in results:
        if "resultID" in r:
            time.sleep(2)
            buf2 = b""
            while True:
                try:
                    buf2 += sock.recv(262144)
                except socket.timeout:
                    break
            for r2 in parse_messages(buf2):
                if "result" in r2:
                    print_result(r2)
                    sock.close()
                    return

    print("Error: no result received", file=sys.stderr)
    sock.close()
    sys.exit(1)

if __name__ == "__main__":
    main()
