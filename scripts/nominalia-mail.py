#!/usr/bin/env python3
"""Bounded Nominalia IMAP/SMTP bridge. One JSON request on stdin, one reply.

Passwords are never accepted through argv/environment, and provider replies are
never surfaced in errors. TLS endpoint names are deliberately not configurable.
"""
import base64
import datetime
import email.policy
import email.utils
from email.message import EmailMessage
from email.parser import BytesParser
import imaplib
import json
import os
import re
import smtplib
import socket
import ssl
import sys
from urllib.parse import urlsplit

IMAP_HOST = "pop.securemail.pro"
SMTP_HOST = "authsmtp.securemail.pro"
TIMEOUT = 15
MAX_MESSAGE = 8 * 1024 * 1024
MAX_ATTACHMENTS = 5 * 1024 * 1024
MAX_REQUEST = 9 * 1024 * 1024
MAX_TEXT = 150000
MAX_PARTS = 100
UID_RE = re.compile(r"^[1-9][0-9]{0,19}$")


class MailError(Exception):
    def __init__(self, code):
        self.code = code


def fail(code):
    raise MailError(code)


def text(value, maximum=1000, empty=False):
    if not isinstance(value, str) or len(value) > maximum or (not empty and not value):
        fail("INVALID_INPUT")
    if any(c in value for c in ("\r", "\n", "\x00")):
        fail("INVALID_INPUT")
    return value


def address(value):
    value = text(value, 254)
    if not re.fullmatch(r"[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+", value):
        fail("INVALID_INPUT")
    return value


def quote(value):
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def encode_folder(name):
    name = text(name, 500)
    chunks = []
    pending = []
    def flush():
        if pending:
            chunks.append("&" + base64.b64encode("".join(pending).encode("utf-16-be")).decode().rstrip("=").replace("/", ",") + "-")
            pending.clear()
    for c in name:
        if " " <= c <= "~":
            flush()
            chunks.append("&-" if c == "&" else c)
        else:
            pending.append(c)
    flush()
    return "".join(chunks)


def decode_folder(name):
    def replace(match):
        value = match.group(1)
        if not value:
            return "&"
        return base64.b64decode(value.replace(",", "/") + "=" * (-len(value) % 4)).decode("utf-16-be")
    try:
        return re.sub(r"&([^-]*)-", replace, name)
    except (ValueError, UnicodeError):
        fail("PROVIDER_RESPONSE_INVALID")


def connect_socket(host, port):
    proxy_url = os.environ.get("AIBRAIN_EGRESS_PROXY_URL")
    raw = None
    try:
        if proxy_url:
            proxy = urlsplit(proxy_url)
            token = os.environ.get("AIBRAIN_EGRESS_SERVER_TOKEN", "")
            if proxy.scheme != "http" or not proxy.hostname or proxy.username or proxy.password or proxy.path not in ("", "/") or proxy.query or proxy.fragment or not token or any(c in token for c in "\r\n\x00"):
                fail("PROXY_CONFIGURATION_INVALID")
            raw = socket.create_connection((proxy.hostname, proxy.port or 80), TIMEOUT)
            auth = base64.b64encode(("aibrain:" + token).encode()).decode()
            raw.sendall((f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\nProxy-Authorization: Basic {auth}\r\n\r\n").encode("ascii"))
            response = bytearray()
            while not response.endswith(b"\r\n\r\n"):
                block = raw.recv(1)
                if not block or len(response) >= 16384:
                    fail("PROXY_CONNECTION_FAILED")
                response.extend(block)
            if not re.match(rb"HTTP/1\.[01] 200(?: |\r)", response):
                fail("PROXY_CONNECTION_FAILED")
        else:
            raw = socket.create_connection((host, port), TIMEOUT)
        return raw
    except BaseException:
        if raw is not None:
            raw.close()
        raise


class NominaliaIMAP(imaplib.IMAP4_SSL):
    def _create_socket(self, timeout):
        raw = connect_socket(IMAP_HOST, 993)
        try:
            return ssl.create_default_context().wrap_socket(raw, server_hostname=IMAP_HOST)
        except BaseException:
            raw.close()
            raise

    def read(self, size):
        if size > MAX_MESSAGE:
            fail("MESSAGE_TOO_LARGE")
        return super().read(size)


class NominaliaSMTP(smtplib.SMTP):
    def _get_socket(self, host, port, timeout):
        return connect_socket(SMTP_HOST, 587)


def ok_response(response):
    if response[0] != "OK":
        fail("PROVIDER_OPERATION_FAILED")
    return response[1]


class Mailbox:
    def __init__(self, credentials):
        if not isinstance(credentials, dict):
            fail("INVALID_INPUT")
        self.email = address(credentials.get("email"))
        self.password = credentials.get("password")
        if not isinstance(self.password, str) or not self.password or len(self.password) > 4096 or "\x00" in self.password or "\r" in self.password or "\n" in self.password:
            fail("INVALID_INPUT")
        self.imap = None

    def login(self):
        if self.imap is None:
            self.imap = NominaliaIMAP(IMAP_HOST, 993, timeout=TIMEOUT)
            try:
                ok_response(self.imap.login(self.email, self.password))
            except imaplib.IMAP4.error:
                fail("AUTH_FAILED")
        return self.imap

    def smtp(self):
        client = NominaliaSMTP(SMTP_HOST, 587, timeout=TIMEOUT)
        try:
            client.ehlo()
            if not client.has_extn("starttls"):
                fail("TLS_REQUIRED")
            client.starttls(context=ssl.create_default_context())
            client.ehlo()
            client.login(self.email, self.password)
            return client
        except BaseException:
            client.close()
            raise

    def close(self):
        if self.imap:
            try:
                self.imap.logout()
            except Exception:
                pass

    def select(self, folder, writable=False):
        imap = self.login()
        ok_response(imap.select(quote(encode_folder(folder)), readonly=not writable))
        _, values = imap.response("UIDVALIDITY")
        validity = values[0].decode("ascii") if values and isinstance(values[0], bytes) else ""
        if not UID_RE.fullmatch(validity):
            fail("PROVIDER_RESPONSE_INVALID")
        return validity

    def reference(self, args, writable=False):
        ref = args.get("message")
        if not isinstance(ref, dict):
            fail("INVALID_INPUT")
        folder = text(ref.get("folder"), 500)
        uid = str(ref.get("uid", ""))
        validity = str(ref.get("uidValidity", ""))
        if not UID_RE.fullmatch(uid) or not UID_RE.fullmatch(validity):
            fail("INVALID_INPUT")
        if self.select(folder, writable) != validity:
            fail("STALE_MESSAGE_REF")
        return folder, uid, validity

    def folders(self):
        rows = ok_response(self.login().list())
        result = []
        for row in rows[:500]:
            if not isinstance(row, bytes):
                continue
            match = re.fullmatch(rb'\(([^)]*)\) (?:NIL|"(?:[^"\\]|\\.)*") (.+)', row)
            if not match:
                fail("PROVIDER_RESPONSE_INVALID")
            name = match[2].decode("ascii")
            if name.startswith('"') and name.endswith('"'):
                name = re.sub(r"\\(.)", r"\1", name[1:-1])
            result.append({"name": decode_folder(name), "attributes": match[1].decode("ascii").split()})
        return {"folders": result}

    def special_folder(self, kind):
        folders = self.folders()["folders"]
        special = "\\Drafts" if kind == "draft" else "\\Sent"
        for row in folders:
            if special.lower() in [attr.lower() for attr in row["attributes"]]:
                return row["name"]
        names = ("Drafts", "INBOX.Drafts", "Bozze", "Borradores", "Esborranys") if kind == "draft" else ("Sent", "Sent Items", "INBOX.Sent", "Posta inviata", "Enviados", "Enviats")
        for name in names:
            if any(row["name"].lower() == name.lower() for row in folders):
                return next(row["name"] for row in folders if row["name"].lower() == name.lower())
        fail("DRAFT_FOLDER_NOT_FOUND" if kind == "draft" else "SENT_FOLDER_NOT_FOUND")

    def fetch(self, uid, content=False):
        # Check RFC822.SIZE before allowing imaplib to consume a message literal.
        rows = ok_response(self.imap.uid("FETCH", uid, "(UID RFC822.SIZE FLAGS)"))
        metadata = b" ".join(row for row in rows if isinstance(row, bytes))
        match = re.search(rb"\bRFC822\.SIZE (\d+)", metadata)
        found_uid = re.search(rb"\bUID (\d+)", metadata)
        if not match or not found_uid or found_uid[1].decode() != uid:
            fail("MESSAGE_NOT_FOUND")
        if content and int(match[1]) > MAX_MESSAGE:
            fail("MESSAGE_TOO_LARGE")
        target = "BODY.PEEK[]" if content else "BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)]"
        rows = ok_response(self.imap.uid("FETCH", uid, f"(UID {target})"))
        literals = [row[1] for row in rows if isinstance(row, tuple) and isinstance(row[1], bytes)]
        if len(literals) != 1 or len(literals[0]) > MAX_MESSAGE:
            fail("PROVIDER_RESPONSE_INVALID")
        message = BytesParser(policy=email.policy.default).parsebytes(literals[0])
        flags_match = re.search(rb"FLAGS \(([^)]*)\)", metadata)
        flags = flags_match[1].split() if flags_match else []
        return message, flags, int(match[1])

    def message_view(self, message, flags, folder, uid, validity, size, content=False):
        def header(name):
            return str(message.get(name, ""))[:4000]
        result = {"folder": folder, "uid": uid, "uidValidity": validity,
                  "subject": header("Subject"), "from": header("From"), "to": header("To"), "cc": header("Cc"),
                  "date": header("Date"), "messageId": header("Message-ID"), "size": size,
                  "unread": b"\\Seen" not in flags, "flagged": b"\\Flagged" in flags}
        if content:
            plain, html, attachments = [], [], []
            total_text = 0
            for part_id, part in iter_parts(message):
                if part.get_content_maintype() == "multipart":
                    continue
                payload = part_bytes(part)
                filename = part.get_filename()
                if filename or part.get_content_disposition() == "attachment" or part.get_content_maintype() != "text":
                    attachments.append({"partId": part_id, "filename": str(filename or "attachment")[:500], "contentType": part.get_content_type(), "size": len(payload)})
                elif part.get_content_type() in ("text/plain", "text/html"):
                    try:
                        value = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
                    except LookupError:
                        value = payload.decode("utf-8", errors="replace")
                    remaining = MAX_TEXT - total_text
                    if remaining > 0:
                        (plain if part.get_content_type() == "text/plain" else html).append(value[:remaining])
                        total_text += min(len(value), remaining)
            result.update(text="\n".join(plain), html="\n".join(html), attachments=attachments, bodyTruncated=total_text >= MAX_TEXT)
        return result

    def list_messages(self, args):
        folder = text(args.get("folder", "INBOX"), 500)
        limit = args.get("limit", 20)
        if type(limit) is not int or not 1 <= limit <= 50:
            fail("INVALID_INPUT")
        query = args.get("query", {})
        if not isinstance(query, dict) or set(query) - {"text", "from", "to", "subject", "since", "before", "unread"}:
            fail("INVALID_INPUT")
        criteria = []
        for key in ("text", "from", "to", "subject"):
            if key in query:
                criteria.extend([key.upper(), quote(text(query[key], 500))])
        for key in ("since", "before"):
            if key in query:
                try:
                    date = datetime.date.fromisoformat(text(query[key], 10))
                except ValueError:
                    fail("INVALID_INPUT")
                months = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
                criteria.extend([key.upper(), f"{date.day:02d}-{months[date.month - 1]}-{date.year}"])
        if "unread" in query:
            if type(query["unread"]) is not bool:
                fail("INVALID_INPUT")
            criteria.append("UNSEEN" if query["unread"] else "SEEN")
        validity = self.select(folder)
        # UTF-8 literals are avoided: this provider supports CHARSET UTF-8 search.
        encoded = [value.encode("utf-8") for value in (criteria or ["ALL"])]
        rows = ok_response(self.imap.uid("SEARCH", "CHARSET", "UTF-8", *encoded))
        ids = b" ".join(row for row in rows if isinstance(row, bytes)).split()
        if any(not UID_RE.fullmatch(uid.decode("ascii")) for uid in ids):
            fail("PROVIDER_RESPONSE_INVALID")
        messages = []
        for raw_uid in reversed(ids[-limit:]):
            uid = raw_uid.decode("ascii")
            try:
                message, flags, size = self.fetch(uid)
                messages.append(self.message_view(message, flags, folder, uid, validity, size))
            except MailError as exc:
                if exc.code not in ("MESSAGE_NOT_FOUND", "MESSAGE_TOO_LARGE"):
                    raise
        return {"messages": messages, "folder": folder, "uidValidity": validity, "truncated": len(ids) > limit}

    def read(self, args, attachment=False):
        folder, uid, validity = self.reference(args)
        message, flags, size = self.fetch(uid, content=True)
        if attachment:
            part_id = text(args.get("partId"), 100)
            for ident, part in iter_parts(message):
                if ident == part_id and part.get_content_maintype() != "multipart":
                    data = part_bytes(part)
                    if len(data) > MAX_ATTACHMENTS:
                        fail("ATTACHMENT_TOO_LARGE")
                    return {"partId": ident, "filename": str(part.get_filename() or "attachment")[:500], "contentType": part.get_content_type(), "size": len(data), "dataBase64": base64.b64encode(data).decode()}
            fail("ATTACHMENT_NOT_FOUND")
        return self.message_view(message, flags, folder, uid, validity, size, content=True)

    def flags(self, args):
        self.reference(args, writable=True)
        uid = str(args["message"]["uid"])
        self.fetch(uid)
        changes = []
        for key, flag in (("seen", "\\Seen"), ("flagged", "\\Flagged")):
            if key in args:
                if type(args[key]) is not bool:
                    fail("INVALID_INPUT")
                changes.append((args[key], flag))
        if not changes:
            fail("INVALID_INPUT")
        for enabled, flag in changes:
            ok_response(self.imap.uid("STORE", uid, "+FLAGS.SILENT" if enabled else "-FLAGS.SILENT", f"({flag})"))
        return {"updated": True}

    def move(self, args):
        destination = text(args.get("destination"), 500)
        folder, uid, _ = self.reference(args, writable=True)
        if destination == folder:
            fail("INVALID_INPUT")
        self.fetch(uid)
        capabilities = {value.decode().upper() if isinstance(value, bytes) else value.upper() for value in self.imap.capabilities}
        if "MOVE" in capabilities:
            ok_response(self.imap.uid("MOVE", uid, quote(encode_folder(destination))))
        elif "UIDPLUS" in capabilities:
            ok_response(self.imap.uid("COPY", uid, quote(encode_folder(destination))))
            try:
                ok_response(self.imap.uid("STORE", uid, "+FLAGS.SILENT", "(\\Deleted)"))
                # UID EXPUNGE never touches another message marked deleted.
                ok_response(self.imap.uid("EXPUNGE", uid))
            except Exception:
                # COPY has succeeded. Retrying the whole move could duplicate
                # the destination; caller must reconcile the same reference.
                fail("MOVE_OUTCOME_UNKNOWN")
        else:
            fail("SAFE_MOVE_UNSUPPORTED")
        return {"moved": True, "destination": destination}

    def compose(self, args):
        message = EmailMessage(policy=email.policy.SMTP)
        if "from" in args and args["from"] != self.email:
            fail("INVALID_INPUT")
        message["From"] = self.email
        recipients = []
        for key in ("to", "cc", "bcc"):
            values = args.get(key, [])
            if not isinstance(values, list) or len(values) > 50:
                fail("INVALID_INPUT")
            values = [address(value) for value in values]
            recipients.extend(values)
            if values and key != "bcc":
                message[key.capitalize()] = ", ".join(values)
        if not recipients or len(recipients) > 50:
            fail("INVALID_INPUT")
        message["Subject"] = text(args.get("subject", ""), 1000, empty=True)
        message_id = text(args.get("messageId"), 500)
        if not re.fullmatch(r"<[^\s<>@]+@[^\s<>@]+>", message_id):
            fail("INVALID_INPUT")
        message["Message-ID"] = message_id
        message["Date"] = email.utils.formatdate(localtime=False)
        for key, header in (("inReplyTo", "In-Reply-To"), ("references", "References")):
            if args.get(key):
                message[header] = text(args[key], 2000)
        body = args.get("text", "")
        if not isinstance(body, str) or len(body) > MAX_TEXT or "\x00" in body:
            fail("INVALID_INPUT")
        message.set_content(body)
        attachments = args.get("attachments", [])
        if not isinstance(attachments, list) or len(attachments) > 20:
            fail("INVALID_INPUT")
        total = 0
        for item in attachments:
            if not isinstance(item, dict):
                fail("INVALID_INPUT")
            filename = text(item.get("filename"), 250)
            content_type = text(item.get("contentType", "application/octet-stream"), 100)
            if not re.fullmatch(r"[a-zA-Z0-9!#$&^_.+-]+/[a-zA-Z0-9!#$&^_.+-]+", content_type):
                fail("INVALID_INPUT")
            encoded = item.get("dataBase64")
            if not isinstance(encoded, str) or len(encoded) > (MAX_ATTACHMENTS * 4 // 3 + 4):
                fail("ATTACHMENT_TOO_LARGE")
            try:
                data = base64.b64decode(encoded, validate=True)
            except ValueError:
                fail("INVALID_INPUT")
            total += len(data)
            if total > MAX_ATTACHMENTS:
                fail("ATTACHMENT_TOO_LARGE")
            main, sub = content_type.split("/", 1)
            message.add_attachment(data, maintype=main, subtype=sub, filename=filename)
        raw = message.as_bytes()
        if len(raw) > MAX_MESSAGE:
            fail("MESSAGE_TOO_LARGE")
        return message, recipients, raw

    def append(self, folder, raw, draft=False):
        flags = "(\\Draft)" if draft else "(\\Seen)"
        ok_response(self.login().append(quote(encode_folder(folder)), flags, None, raw))
        # APPENDUID is the server's durable write receipt when available.
        _, values = self.imap.response("APPENDUID")
        value = values[0] if values and isinstance(values[0], bytes) else b""
        match = re.fullmatch(rb"(\d+) (\d+)", value)
        return {"folder": folder, "uidValidity": match[1].decode(), "uid": match[2].decode()} if match else {"folder": folder}

    def draft(self, args):
        message, _, raw = self.compose(args)
        # Bcc belongs in the private draft, but is never included in SMTP DATA.
        if args.get("bcc"):
            message["Bcc"] = ", ".join(args["bcc"])
            raw = message.as_bytes()
        ref = self.append(self.special_folder("draft"), raw, draft=True)
        return {"saved": True, "messageId": str(message["Message-ID"]), **ref}

    def send(self, args):
        message, recipients, raw = self.compose(args)
        # Resolve sent folder before SMTP so a missing folder never causes a
        # misleading failed send that might prompt an accidental retry.
        sent_folder = self.special_folder("sent")
        smtp = self.smtp()
        try:
            code, _ = smtp.mail(self.email)
            if code != 250:
                fail("SEND_REJECTED")
            for recipient in recipients:
                code, _ = smtp.rcpt(recipient)
                if code not in (250, 251):
                    smtp.rset()
                    fail("RECIPIENT_REJECTED")
            try:
                code, _ = smtp.data(raw)
                if code != 250:
                    fail("SEND_REJECTED")
            except smtplib.SMTPDataError:
                fail("SEND_REJECTED")
            except (OSError, smtplib.SMTPServerDisconnected, ssl.SSLError):
                # The server may have accepted DATA. Never retry automatically.
                fail("SEND_OUTCOME_UNKNOWN")
        finally:
            smtp.close()
        result = {"sent": True, "messageId": str(message["Message-ID"]), "sentCopySaved": False}
        try:
            result["sentCopy"] = self.append(sent_folder, raw)
            result["sentCopySaved"] = True
        except Exception:
            # Delivery succeeded; an IMAP failure must not turn it into retryable
            # send failure. The durable caller records this completed delivery.
            result["warning"] = "SENT_COPY_FAILED"
        return result


def part_bytes(part):
    payload = part.get_payload(decode=True)
    if payload is not None:
        return payload
    if part.get_content_type() == "message/rfc822":
        return b"\r\n".join(item.as_bytes(policy=email.policy.SMTP) for item in part.get_payload())
    return b""


def iter_parts(message):
    stack = [("1", message)]
    count = 0
    while stack:
        ident, part = stack.pop()
        count += 1
        if count > MAX_PARTS or len(ident) > 100:
            fail("MESSAGE_TOO_COMPLEX")
        yield ident, part
        if part.is_multipart() and not part.get_filename() and part.get_content_disposition() != "attachment":
            children = list(part.iter_parts())
            stack.extend((f"{ident}.{index + 1}", child) for index, child in reversed(list(enumerate(children))))


def execute(request):
    if not isinstance(request, dict) or request.get("operation") not in {"verify", "folders", "list", "search", "read", "attachment", "draft", "send", "flags", "move"}:
        fail("INVALID_INPUT")
    args = request.get("args", {})
    if not isinstance(args, dict):
        fail("INVALID_INPUT")
    mailbox = Mailbox(request.get("credentials"))
    try:
        operation = request["operation"]
        if operation == "verify":
            mailbox.login()
            smtp = mailbox.smtp()
            smtp.close()
            return {"verified": True, "email": mailbox.email, "imap": True, "smtp": True}
        if operation == "folders":
            return mailbox.folders()
        if operation in ("list", "search"):
            return mailbox.list_messages(args)
        if operation in ("read", "attachment"):
            return mailbox.read(args, attachment=operation == "attachment")
        return getattr(mailbox, operation)(args)
    finally:
        mailbox.close()


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_REQUEST + 1)
        if len(raw) > MAX_REQUEST:
            fail("REQUEST_TOO_LARGE")
        request = json.loads(raw)
        result = {"ok": True, "result": execute(request)}
    except MailError as exc:
        result = {"ok": False, "error": {"code": exc.code}}
    except (json.JSONDecodeError, UnicodeError, TypeError, ValueError, KeyError, RecursionError):
        result = {"ok": False, "error": {"code": "INVALID_INPUT"}}
    except smtplib.SMTPAuthenticationError:
        result = {"ok": False, "error": {"code": "AUTH_FAILED"}}
    except imaplib.IMAP4.error:
        result = {"ok": False, "error": {"code": "PROVIDER_OPERATION_FAILED"}}
    except ssl.SSLError:
        result = {"ok": False, "error": {"code": "TLS_VERIFICATION_FAILED"}}
    except Exception:
        result = {"ok": False, "error": {"code": "PROVIDER_UNAVAILABLE"}}
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")


if __name__ == "__main__":
    main()
