"""Bounded fixed-upstream HTTP relay with deterministic, signal-safe shutdown."""

import errno
import ipaddress
import os
import select
import signal
import socket
import threading
import time

HEADER_LIMIT = 8192


class FixedUpstreamRelay:
    def __init__(
        self,
        listen,
        upstream,
        *,
        max_connections=32,
        idle_timeout=15,
        header_limit=HEADER_LIMIT,
        connect_timeout=5,
    ):
        if max_connections < 1 or idle_timeout <= 0 or header_limit <= 0:
            raise ValueError("invalid_relay_limits")
        if connect_timeout <= 0:
            raise ValueError("invalid_relay_limits")
        self.upstream = upstream
        self.max_connections = max_connections
        self.idle_timeout = idle_timeout
        self.header_limit = header_limit
        self.connect_timeout = connect_timeout
        self.stopping = threading.Event()
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(max_connections)
        self.active = {}
        self.threads = set()
        self.listener = socket.socket()
        try:
            self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self.listener.settimeout(0.2)
            self.listener.bind(listen)
            self.listener.listen(max_connections)
            self.server_address = self.listener.getsockname()
        except BaseException:
            self.listener.close()
            raise
        self.acceptor = threading.Thread(
            target=self._accept_loop, name="relay-accept", daemon=True
        )

    def start(self):
        self.acceptor.start()

    def close(self):
        """Non-blocking stop: wake the accept loop and every idle worker."""
        self.stopping.set()
        self._close_listener()
        self._close_active()

    def shutdown(self):
        self.close()
        self._join()

    def _accept_loop(self):
        while not self.stopping.is_set():
            try:
                client, _ = self.listener.accept()
            except TimeoutError:
                continue
            except OSError:
                break
            with self.lock:
                if self.stopping.is_set():
                    client.close()
                    break
                if not self.slots.acquire(blocking=False):
                    client.close()
                    continue
                worker = threading.Thread(
                    target=self._worker, args=(client,), daemon=True
                )
                self.threads.add(worker)
                worker.start()

    def _worker(self, client):
        upstream = None
        try:
            with self.lock:
                self.active[client] = None
            if self.stopping.is_set():
                return
            initial = self.read_headers(client)
            if initial is None or self.stopping.is_set():
                return
            upstream = self._connect_upstream()
            upstream.settimeout(self.idle_timeout)
            client.settimeout(self.idle_timeout)
            with self.lock:
                self.active[client] = upstream
            if self.stopping.is_set():
                return
            upstream.sendall(initial)
            self._relay(client, upstream)
        except Exception:
            pass
        finally:
            for sock in (client, upstream):
                if sock is not None:
                    self._close_socket(sock)
            with self.lock:
                self.active.pop(client, None)
                self.threads.discard(threading.current_thread())
            self.slots.release()

    def _connect_upstream(self):
        """Connect to the fixed upstream, cancellable by the stop event.

        A blocking connect cannot be reliably interrupted from another thread,
        so use a non-blocking connect and poll writability while checking the
        stop flag. This keeps the whole stop sequence inside the process
        shutdown budget instead of burning the full connect timeout.
        """
        sock = socket.socket()
        try:
            sock.setblocking(False)
            code = sock.connect_ex(self.upstream)
            if code not in (0, errno.EINPROGRESS, errno.EWOULDBLOCK):
                raise OSError(code, os.strerror(code))
            deadline = time.monotonic() + self.connect_timeout
            while code != 0:
                if self.stopping.is_set():
                    raise OSError("gateway_stopping")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("upstream_connect_timeout")
                _, writable, _ = select.select([], [sock], [], min(0.1, remaining))
                if writable:
                    code = sock.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)
                    if code != 0:
                        raise OSError(code, os.strerror(code))
            if self.stopping.is_set():
                raise OSError("gateway_stopping")
            sock.setblocking(True)
            return sock
        except BaseException:
            sock.close()
            raise

    def _relay(self, client, upstream):
        forward = threading.Thread(
            target=self._pump, args=(client, upstream), daemon=True
        )
        forward.start()
        try:
            self._pump(upstream, client)
        finally:
            self._close_socket(client)
            self._close_socket(upstream)
            forward.join(self.idle_timeout + 1)
            if forward.is_alive():
                raise RuntimeError("relay_forward_did_not_stop")

    def read_headers(self, client):
        data = bytearray()
        deadline = time.monotonic() + self.idle_timeout
        while not self.stopping.is_set() and len(data) <= self.header_limit:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            client.settimeout(max(0.01, min(0.2, remaining)))
            try:
                chunk = client.recv(min(4096, self.header_limit + 1 - len(data)))
            except TimeoutError:
                continue
            if not chunk:
                return None
            data.extend(chunk)
            if len(data) > self.header_limit:
                return None
            if data.find(b"\r\n\r\n") >= 0:
                return bytes(data)
        return None

    def _pump(self, source, destination):
        try:
            while not self.stopping.is_set():
                data = source.recv(16384)
                if not data:
                    try:
                        destination.shutdown(socket.SHUT_WR)
                    except OSError:
                        pass
                    return
                destination.sendall(data)
        except OSError:
            return

    def _close_listener(self):
        try:
            self.listener.close()
        except OSError:
            pass

    def _close_active(self):
        with self.lock:
            sockets = []
            for client, upstream in self.active.items():
                sockets.append(client)
                if upstream is not None:
                    sockets.append(upstream)
        for sock in sockets:
            self._close_socket(sock)

    def _close_socket(self, sock):
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            sock.close()
        except OSError:
            pass

    def _join(self):
        deadline = time.monotonic() + self.connect_timeout + 2
        with self.lock:
            threads = list(self.threads)
        for thread in threads:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            thread.join(remaining)
        if self.acceptor is not threading.current_thread():
            remaining = deadline - time.monotonic()
            if remaining > 0:
                self.acceptor.join(remaining)
        stuck = [thread for thread in threads if thread.is_alive()]
        if self.acceptor.is_alive():
            stuck.append(self.acceptor)
        if stuck:
            raise RuntimeError("relay_worker_did_not_stop")


def main():
    host, separator, port = os.environ.get("FIXED_UPSTREAM", "").rpartition(":")
    if not separator:
        raise SystemExit(2)
    try:
        address = str(ipaddress.IPv4Address(host))
        upstream_port = int(port)
    except ValueError:
        raise SystemExit(2) from None
    if address != host or upstream_port != 8000:
        raise SystemExit(2)
    relay = FixedUpstreamRelay(("0.0.0.0", 8000), (address, upstream_port))
    previous = {}
    state = {"stop": False}

    def stop(_signum, _frame):
        # Minimal and signal-safe: a plain flag only. Never join, never touch
        # the relay lock or Event from the handler.
        state["stop"] = True

    for signum in (signal.SIGTERM, signal.SIGINT):
        previous[signum] = signal.signal(signum, stop)
    try:
        relay.start()
        while not state["stop"]:
            time.sleep(0.2)
    finally:
        # Always release the relay on every exit path, including a start or
        # shutdown failure, so no acceptor/worker/forward thread outlives the
        # process as a daemon escape.
        try:
            relay.shutdown()
        finally:
            for signum, handler in previous.items():
                signal.signal(signum, handler)


if __name__ == "__main__":
    main()
