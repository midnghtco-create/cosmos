#!/usr/bin/env python3
"""
Cutroom proxy helper: makes smooth-streaming review copies of your Drive videos.

Run it on your Mac (needs Python 3.9+ and ffmpeg):

    python3 proxy-helper.py

then open Cutroom, go to a project and click "Make proxies".

For each video the helper:
  1. downloads the original from Google Drive (with the sign-in Cutroom gives it),
  2. converts it with ffmpeg to an H.264/AAC MP4: max 1080p (or 720p), a keyframe
     every second for instant seeking and frame stepping, "faststart" for
     streaming, original frame timing kept so note timecodes still line up,
  3. uploads it to a "Cutroom proxies" folder inside the same Drive folder.

It only listens on 127.0.0.1 (this computer), only accepts requests from the
Cutroom site, keeps the Google sign-in in memory only, and deletes temporary
files when each video is done. Uses only the Python standard library.
"""
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("CUTROOM_HELPER_PORT", "8765"))
ALLOWED_ORIGINS = {
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "https://midnghtco-create.github.io",
}
ALLOWED_ORIGINS |= {o.strip() for o in os.environ.get("CUTROOM_ORIGINS", "").split(",") if o.strip()}
PROXY_FOLDER = "Cutroom proxies"
API = "https://www.googleapis.com/drive/v3"
UPLOAD = "https://www.googleapis.com/upload/drive/v3"
CHUNK = 16 * 1024 * 1024  # resumable upload chunk (multiple of 256 KiB)

FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")


def has_encoder(name):
    try:
        out = subprocess.run([FFMPEG, "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=20).stdout
        return name in out
    except Exception:
        return False


ENCODER = "h264_videotoolbox" if FFMPEG and sys.platform == "darwin" and has_encoder("h264_videotoolbox") else "libx264"


class AuthExpired(Exception):
    pass


class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.token = None
        self.token_event = threading.Event()
        self.jobs = {}  # id -> dict
        self.order = []
        self.q = queue.Queue()
        self.folder_cache = {}

    def set_token(self, token):
        with self.lock:
            self.token = token
        if token:
            self.token_event.set()

    def get_token(self):
        with self.lock:
            return self.token

    def update(self, job_id, **kw):
        with self.lock:
            self.jobs[job_id].update(kw)
            self.jobs[job_id]["updatedAt"] = time.time()

    def snapshot(self):
        with self.lock:
            return [dict(self.jobs[j]) for j in self.order]


S = State()


# ───────────────────────── Drive calls ─────────────────────────
def drive(method, url, data=None, headers=None, raw=False):
    """Call the Drive API. Raises AuthExpired on 401 so the job can wait for a fresh token."""
    token = S.get_token()
    if not token:
        raise AuthExpired()
    h = {"Authorization": "Bearer " + token}
    h.update(headers or {})
    if isinstance(data, (dict, list)):
        data = json.dumps(data).encode()
        h.setdefault("Content-Type", "application/json; charset=UTF-8")
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=120)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            S.set_token(None)
            S.token_event.clear()
            raise AuthExpired()
        body = e.read().decode(errors="replace")
        try:
            msg = json.loads(body)["error"]["message"]
        except Exception:
            msg = body[:300] or str(e)
        raise RuntimeError(f"Drive said: {msg} ({e.code})")
    if raw:
        return resp
    body = resp.read()
    return json.loads(body) if body else {}


def q(s):
    return s.replace("\\", "\\\\").replace("'", "\\'")


def proxy_folder(parent_id):
    if parent_id in S.folder_cache:
        return S.folder_cache[parent_id]
    params = urllib.parse.urlencode({
        "q": f"'{parent_id}' in parents and name='{PROXY_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false",
        "fields": "files(id,name)", "supportsAllDrives": "true", "includeItemsFromAllDrives": "true",
    })
    found = drive("GET", f"{API}/files?{params}").get("files", [])
    if found:
        fid = found[0]["id"]
    else:
        fid = drive("POST", f"{API}/files?supportsAllDrives=true&fields=id", {
            "name": PROXY_FOLDER, "mimeType": "application/vnd.google-apps.folder", "parents": [parent_id],
            "description": "Smaller H.264 review copies made by Cutroom. Safe to delete; Cutroom falls back to the originals.",
        })["id"]
    S.folder_cache[parent_id] = fid
    return fid


def existing_proxy(folder_id, original_id):
    params = urllib.parse.urlencode({
        "q": f"'{folder_id}' in parents and appProperties has {{ key='cutroomProxyOf' and value='{q(original_id)}' }} and trashed=false",
        "fields": "files(id,name)", "supportsAllDrives": "true", "includeItemsFromAllDrives": "true",
    })
    return drive("GET", f"{API}/files?{params}").get("files", [])


def download(job_id, file_id, size, dest):
    resp = drive("GET", f"{API}/files/{file_id}?alt=media&supportsAllDrives=true", raw=True)
    total = int(resp.headers.get("Content-Length") or size or 0)
    done = 0
    last = 0
    with open(dest, "wb") as f:
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if time.time() - last > 0.4:
                last = time.time()
                S.update(job_id, progress=done / total if total else 0, detail=f"{done / 1e6:.0f} of {total / 1e6:.0f} MB")


def upload(job_id, path, name, folder_id, original_id, resolution):
    size = os.path.getsize(path)
    meta = {
        "name": name, "parents": [folder_id], "mimeType": "video/mp4",
        "appProperties": {"cutroomProxyOf": original_id, "cutroomProxyRes": str(resolution)},
        "description": "Cutroom review proxy. Safe to delete.",
    }
    resp = drive("POST", f"{UPLOAD}/files?uploadType=resumable&supportsAllDrives=true&fields=id", meta,
                 headers={"X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": str(size)}, raw=True)
    session = resp.headers["Location"]
    sent = 0
    with open(path, "rb") as f:
        while sent < size:
            chunk = f.read(CHUNK)
            end = sent + len(chunk) - 1
            req = urllib.request.Request(session, data=chunk, method="PUT", headers={
                "Content-Length": str(len(chunk)), "Content-Range": f"bytes {sent}-{end}/{size}",
            })
            try:
                r = urllib.request.urlopen(req, timeout=300)
                body = r.read()
                return json.loads(body)["id"]
            except urllib.error.HTTPError as e:
                if e.code == 308:  # chunk accepted, keep going
                    rng = e.headers.get("Range")
                    sent = int(rng.split("-")[1]) + 1 if rng else end + 1
                    f.seek(sent)
                    S.update(job_id, progress=sent / size, detail=f"{sent / 1e6:.0f} of {size / 1e6:.0f} MB")
                    continue
                if e.code == 401:
                    raise AuthExpired()
                raise RuntimeError(f"Upload failed ({e.code}): {e.read().decode(errors='replace')[:200]}")
    raise RuntimeError("Upload ended without a file id")


# ───────────────────────── ffmpeg ─────────────────────────
def probe(path):
    out = subprocess.run([FFPROBE, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
                         capture_output=True, text=True, timeout=120)
    info = json.loads(out.stdout or "{}")
    v = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    if not v:
        raise RuntimeError("No video track found in this file")
    fps = 30.0
    for key in ("avg_frame_rate", "r_frame_rate"):
        try:
            n, d = (v.get(key) or "0/0").split("/")
            if float(d) and float(n):
                fps = float(n) / float(d)
                break
        except Exception:
            pass
    has_audio = any(s.get("codec_type") == "audio" for s in info.get("streams", []))
    duration = float(info.get("format", {}).get("duration") or v.get("duration") or 0)
    return {"fps": fps, "duration": duration, "height": int(v.get("height") or 0), "audio": has_audio}


def encode(job_id, src, dst, resolution):
    p = probe(src)
    gop = max(1, round(p["fps"]))  # a keyframe every second
    vf = f"scale=-2:'min({resolution},ih)':flags=bicubic,format=yuv420p" if resolution else "format=yuv420p"
    bitrate = {720: "5M", 1080: "9M"}.get(resolution, "14M")
    cmd = [FFMPEG, "-hide_banner", "-nostdin", "-y", "-i", src,
           "-map", "0:v:0", "-map", "0:a:0?",
           "-vf", vf, "-fps_mode", "passthrough",
           "-c:v", ENCODER, "-b:v", bitrate, "-maxrate", bitrate, "-bufsize", bitrate,
           "-g", str(gop), "-profile:v", "high",
           "-c:a", "aac", "-b:a", "160k", "-ac", "2",
           "-map_metadata", "-1", "-movflags", "+faststart",
           "-progress", "pipe:1", "-nostats", dst]
    if ENCODER == "libx264":
        cmd[cmd.index("-b:v"):cmd.index("-b:v")] = ["-preset", "veryfast"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    err_tail = []

    def read_err():
        for line in proc.stderr:
            err_tail.append(line)
            del err_tail[:-30]
    threading.Thread(target=read_err, daemon=True).start()
    for line in proc.stdout:
        m = re.match(r"out_time_us=(\d+)", line)
        if m and p["duration"]:
            done = int(m.group(1)) / 1e6
            S.update(job_id, progress=min(1, done / p["duration"]), detail=f"{done:.0f} of {p['duration']:.0f} s")
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError("ffmpeg failed: " + "".join(err_tail[-5:]).strip()[:400])


# ───────────────────────── worker ─────────────────────────
def run_job(job):
    jid = job["id"]
    tmp = tempfile.mkdtemp(prefix="cutroom-")
    try:
        while True:
            try:
                S.update(jid, state="checking", progress=0, detail="")
                folder = proxy_folder(job["folderId"])
                if not job.get("force") and existing_proxy(folder, job["fileId"]):
                    S.update(jid, state="skipped", progress=1, detail="Already has a proxy")
                    return
                ext = os.path.splitext(job["name"])[1] or ".mov"
                src = os.path.join(tmp, "original" + ext)
                dst = os.path.join(tmp, "proxy.mp4")
                S.update(jid, state="downloading", progress=0)
                download(jid, job["fileId"], job.get("size"), src)
                S.update(jid, state="encoding", progress=0)
                encode(jid, src, dst, job["resolution"])
                os.remove(src)
                S.update(jid, state="uploading", progress=0)
                base = os.path.splitext(job["name"])[0]
                pid = upload(jid, dst, f"{base} (proxy {job['resolution'] or 'full'}p).mp4", folder, job["fileId"], job["resolution"])
                S.update(jid, state="done", progress=1, detail="", proxyId=pid)
                return
            except AuthExpired:
                S.update(jid, state="waiting", detail="Waiting for Cutroom to refresh your Google sign-in")
                S.token_event.wait()
    except Exception as e:
        S.update(jid, state="error", detail=str(e))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)



# ───────────────────────── Cloudflare R2 (client review copies) ─────────────────────────
# Client links stream from R2 instead of public Drive files (Drive throttles public
# downloads). Keys live only on this Mac in ~/.cutroom/r2.json (chmod 600), entered
# with:  python3 proxy-helper.py --setup-r2
import hashlib
import hmac
import http.client
import secrets
from datetime import datetime, timezone

R2_CONFIG = os.path.expanduser("~/.cutroom/r2.json")


def load_r2():
    try:
        with open(R2_CONFIG) as f:
            c = json.load(f)
        if all(c.get(k) for k in ("accountId", "bucket", "accessKeyId", "secretAccessKey", "publicBase")):
            return c
    except Exception:
        pass
    return None


def _sign(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def r2_request(method, key, body=None, length=0, content_type=None):
    """One S3-compatible request to R2, signed with AWS SigV4 (UNSIGNED-PAYLOAD)."""
    c = load_r2()
    if not c:
        raise RuntimeError("Cloudflare R2 isn't set up. Run: python3 proxy-helper.py --setup-r2")
    host = f"{c['accountId']}.r2.cloudflarestorage.com"
    path = "/" + urllib.parse.quote(c["bucket"]) + "/" + urllib.parse.quote(key, safe="/")
    now = datetime.now(timezone.utc)
    amz_date, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    headers = {"host": host, "x-amz-content-sha256": "UNSIGNED-PAYLOAD", "x-amz-date": amz_date}
    signed = ";".join(sorted(headers))
    canonical = "\n".join([method, path, "", "".join(f"{k}:{headers[k]}\n" for k in sorted(headers)), signed, "UNSIGNED-PAYLOAD"])
    scope = f"{day}/auto/s3/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    k = _sign(_sign(_sign(_sign(("AWS4" + c["secretAccessKey"]).encode(), day), "auto"), "s3"), "aws4_request")
    sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    headers["Authorization"] = f"AWS4-HMAC-SHA256 Credential={c['accessKeyId']}/{scope}, SignedHeaders={signed}, Signature={sig}"
    if content_type:
        headers["Content-Type"] = content_type
    if body is not None:
        headers["Content-Length"] = str(length)
    conn = http.client.HTTPSConnection(host, timeout=600)
    try:
        conn.request(method, path, body=body, headers=headers)
        res = conn.getresponse()
        text = res.read().decode(errors="replace")
        if res.status >= 300:
            raise RuntimeError(f"Cloudflare R2 said {res.status}: {text[:200]}")
    finally:
        conn.close()
    return c["publicBase"].rstrip("/") + "/" + urllib.parse.quote(key, safe="/")


class _Progress:
    """File wrapper so uploads report progress."""
    def __init__(self, f, size, cb):
        self.f, self.size, self.sent, self.cb = f, size, 0, cb
    def read(self, n=-1):
        chunk = self.f.read(1024 * 1024 if n is None or n < 0 else n)
        self.sent += len(chunk)
        self.cb(self.sent / self.size if self.size else 1)
        return chunk


def run_publish(job):
    """Copy a Drive file (usually the proxy) to R2 under an unguessable path."""
    jid = job["id"]
    tmp = tempfile.mkdtemp(prefix="cutroom-pub-")
    try:
        while True:
            try:
                src = os.path.join(tmp, "video.mp4")
                S.update(jid, state="downloading", progress=0)
                download(jid, job["fileId"], job.get("size"), src)
                size = os.path.getsize(src)
                safe = re.sub(r"[^A-Za-z0-9._-]+", "-", os.path.splitext(job["name"])[0]).strip("-")[:80] or "video"
                key = f"v/{secrets.token_urlsafe(18)}/{safe}.mp4"
                S.update(jid, state="publishing", progress=0, detail="")
                last = [0]
                def cb(p):
                    if time.time() - last[0] > 0.4:
                        last[0] = time.time()
                        S.update(jid, progress=p, detail=f"{p * size / 1e6:.0f} of {size / 1e6:.0f} MB")
                with open(src, "rb") as f:
                    url = r2_request("PUT", key, body=_Progress(f, size, cb), length=size, content_type="video/mp4")
                S.update(jid, state="done", progress=1, detail="", url=url)
                return
            except AuthExpired:
                S.update(jid, state="waiting", detail="Waiting for Cutroom to refresh your Google sign-in")
                S.token_event.wait()
    except Exception as e:
        S.update(jid, state="error", detail=str(e))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def setup_r2():
    import getpass
    print("Cutroom — Cloudflare R2 setup (keys stay on this Mac in ~/.cutroom/r2.json)\n")
    old = load_r2() or {}
    def ask(label, keyname, hidden=False):
        cur = old.get(keyname, "")
        hint = " [keep current]" if cur else ""
        v = (getpass.getpass if hidden else input)(f"{label}{hint}: ").strip()
        return v or cur
    c = {
        "accountId": ask("Cloudflare account ID", "accountId"),
        "bucket": ask("R2 bucket name", "bucket"),
        "publicBase": ask("Public bucket URL (https://pub-….r2.dev)", "publicBase").rstrip("/"),
        "accessKeyId": ask("R2 Access Key ID", "accessKeyId"),
        "secretAccessKey": ask("R2 Secret Access Key (hidden)", "secretAccessKey", hidden=True),
    }
    os.makedirs(os.path.dirname(R2_CONFIG), exist_ok=True)
    with open(R2_CONFIG, "w") as f:
        json.dump(c, f)
    os.chmod(R2_CONFIG, 0o600)
    print("\nTesting: uploading and deleting a tiny file…")
    try:
        import io
        data = b"cutroom-test"
        url = r2_request("PUT", "cutroom-setup-test.txt", body=io.BytesIO(data), length=len(data), content_type="text/plain")
        pub = urllib.request.urlopen(url, timeout=30).read()
        r2_request("DELETE", "cutroom-setup-test.txt")
        print("Upload: OK   Public read: " + ("OK" if pub == data else "unexpected content"))
        print("All set. Start the helper normally:  python3 proxy-helper.py")
    except Exception as e:
        print("Test failed:", e)
        print("Check the values and run --setup-r2 again.")


def worker():
    while True:
        job = S.q.get()
        (run_publish if job.get("kind") == "publish" else run_job)(job)
        S.q.task_done()


# ───────────────────────── HTTP API ─────────────────────────
class Handler(BaseHTTPRequestHandler):
    server_version = "CutroomHelper/1"

    def log_message(self, fmt, *args):
        pass

    def origin_ok(self):
        return self.headers.get("Origin") in ALLOWED_ORIGINS

    def cors(self):
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")

    def reply(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204 if self.origin_ok() else 403)
        self.cors()
        self.end_headers()

    def read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 5_000_000:
            raise ValueError("Request too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        if not self.origin_ok():
            return self.reply(403, {"error": "This helper only talks to the Cutroom site."})
        if self.path == "/health":
            return self.reply(200, {"ok": True, "version": 1, "encoder": ENCODER, "ffmpeg": bool(FFMPEG and FFPROBE), "r2": bool(load_r2())})
        if self.path == "/status":
            return self.reply(200, {"jobs": S.snapshot(), "hasToken": bool(S.get_token())})
        self.reply(404, {"error": "Not found"})

    def do_POST(self):
        if not self.origin_ok():
            return self.reply(403, {"error": "This helper only talks to the Cutroom site."})
        try:
            data = self.read_json()
        except Exception as e:
            return self.reply(400, {"error": str(e)})
        if data.get("token"):
            S.set_token(str(data["token"]))
        if self.path == "/token":
            return self.reply(200, {"ok": True})
        if self.path == "/jobs":
            if not (FFMPEG and FFPROBE):
                return self.reply(500, {"error": "ffmpeg is not installed. Run: brew install ffmpeg"})
            res = data.get("resolution", 1080)
            res = int(res) if res in (720, 1080, "720", "1080") else 0
            created = []
            for f in data.get("files", []):
                if not re.fullmatch(r"[\w-]{10,}", str(f.get("id", ""))) or not re.fullmatch(r"[\w-]{10,}", str(data.get("folderId", ""))):
                    continue
                jid = uuid.uuid4().hex[:10]
                job = {"id": jid, "fileId": f["id"], "name": str(f.get("name") or f["id"])[:200], "size": f.get("size"),
                       "folderId": data["folderId"], "resolution": res, "force": bool(data.get("force")),
                       "state": "queued", "progress": 0, "detail": "", "proxyId": None, "createdAt": time.time()}
                with S.lock:
                    S.jobs[jid] = job
                    S.order.append(jid)
                S.q.put(dict(job))
                created.append(jid)
            return self.reply(200, {"created": created})
        if self.path == "/publish":
            if not load_r2():
                return self.reply(400, {"error": "Cloudflare R2 isn't set up on this Mac. Run: python3 proxy-helper.py --setup-r2"})
            created = []
            for f in data.get("files", []):
                if not re.fullmatch(r"[\w-]{10,}", str(f.get("id", ""))):
                    continue
                jid = uuid.uuid4().hex[:10]
                job = {"id": jid, "kind": "publish", "fileId": f["id"], "name": str(f.get("name") or f["id"])[:200], "size": f.get("size"),
                       "folderId": str(data.get("folderId", ""))[:80], "state": "queued", "progress": 0, "detail": "", "url": None, "createdAt": time.time()}
                with S.lock:
                    S.jobs[jid] = job
                    S.order.append(jid)
                S.q.put(dict(job))
                created.append({"jobId": jid, "fileId": f["id"]})
            return self.reply(200, {"created": created})
        if self.path == "/unpublish":
            c = load_r2()
            urls = [u for u in data.get("urls", []) if isinstance(u, str)]
            removed = 0
            for u in urls:
                if c and u.startswith(c["publicBase"].rstrip("/") + "/v/"):
                    try:
                        r2_request("DELETE", urllib.parse.unquote(u[len(c["publicBase"].rstrip("/")) + 1:]))
                        removed += 1
                    except Exception:
                        pass
            return self.reply(200, {"removed": removed})
        if self.path == "/clear":
            with S.lock:
                S.order = [j for j in S.order if S.jobs[j]["state"] not in ("done", "skipped", "error")]
            return self.reply(200, {"ok": True})
        self.reply(404, {"error": "Not found"})


def main():
    if not (FFMPEG and FFPROBE):
        print("ffmpeg/ffprobe not found. Install them first:  brew install ffmpeg")
        sys.exit(1)
    threading.Thread(target=worker, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Cutroom proxy helper is running on http://127.0.0.1:{PORT}  (encoder: {ENCODER})")
    print("Leave this window open, then click \"Make proxies\" in Cutroom. Press Ctrl+C to stop.")
    print("Cloudflare R2 for client links: " + ("ready" if load_r2() else "not set up (python3 proxy-helper.py --setup-r2)"))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    if "--setup-r2" in sys.argv:
        setup_r2()
    else:
        main()
