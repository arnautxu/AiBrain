"""Synthetic-only contract/security tests. No customer mailbox/network access."""
import base64
import importlib.util
import io
from pathlib import Path
import smtplib
import socket
import ssl
import unittest
from unittest.mock import MagicMock, patch

SPEC = importlib.util.spec_from_file_location("nominalia_mail", Path(__file__).with_name("nominalia-mail.py"))
mail = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mail)

CREDS = {"email": "test@example.com", "password": "synthetic-only-password"}
REF = {"folder": "INBOX", "uid": "7", "uidValidity": "123"}
COMPOSE = {"to": ["recipient@example.net"], "cc": [], "bcc": [], "subject": "Synthetic", "text": "Test", "messageId": "<stable-id@example.com>"}
RAW = b"From: sender@example.net\r\nTo: test@example.com\r\nSubject: Synthetic\r\nMessage-ID: <test@example.net>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello\r\n"


def imap_mock(raw=RAW, flags=b"", size=None):
    imap = MagicMock()
    imap.login.return_value = ("OK", [b"logged in"])
    imap.select.return_value = ("OK", [b"1"])
    imap.list.return_value = ("OK", [b'(\\HasNoChildren) "/" "INBOX"', b'(\\Drafts) "/" "Drafts"', b'(\\Sent) "/" "Sent"'])
    imap.response.side_effect = lambda key: (key, [b"123" if key == "UIDVALIDITY" else b"123 8"])
    imap.capabilities = (b"IMAP4rev1", b"UIDPLUS")
    def uid(operation, *args):
        if operation == "FETCH":
            if "RFC822.SIZE" in args[1]:
                return "OK", [b"1 (UID 7 RFC822.SIZE " + str(size if size is not None else len(raw)).encode() + b" FLAGS (" + flags + b"))"]
            return "OK", [(b"1 (UID 7 BODY[] {" + str(len(raw)).encode() + b"}", raw), b")"]
        if operation == "SEARCH":
            return "OK", [b"7"]
        return "OK", [b"done"]
    imap.uid.side_effect = uid
    imap.append.return_value = ("OK", [b"stored"])
    return imap


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.box = mail.Mailbox(CREDS)
        self.imap = imap_mock()
        self.box.imap = self.imap

    def assertCode(self, code, fn, *args):
        with self.assertRaises(mail.MailError) as caught:
            fn(*args)
        self.assertEqual(code, caught.exception.code)

    def test_fixed_hosts_and_verified_imap_context(self):
        raw = MagicMock()
        context = ssl.create_default_context()
        self.assertTrue(context.check_hostname)
        self.assertEqual(ssl.CERT_REQUIRED, context.verify_mode)
        with patch.object(mail, "connect_socket", return_value=raw) as connect, patch.object(mail.ssl, "create_default_context", return_value=MagicMock()) as make_context:
            mail.NominaliaIMAP._create_socket(None, 1)
        connect.assert_called_once_with("pop.securemail.pro", 993)
        make_context.return_value.wrap_socket.assert_called_once_with(raw, server_hostname="pop.securemail.pro")

    def test_smtp_starttls_before_auth(self):
        smtp = MagicMock()
        events = []
        smtp.ehlo.side_effect = lambda: events.append("ehlo")
        smtp.has_extn.return_value = True
        smtp.starttls.side_effect = lambda **kw: events.append("tls")
        smtp.login.side_effect = lambda *args: events.append("login")
        with patch.object(mail, "NominaliaSMTP", return_value=smtp) as factory:
            self.box.smtp()
        factory.assert_called_once_with("authsmtp.securemail.pro", 587, timeout=15)
        self.assertEqual(["ehlo", "tls", "ehlo", "login"], events)
        context = smtp.starttls.call_args.kwargs["context"]
        self.assertTrue(context.check_hostname)
        self.assertEqual(ssl.CERT_REQUIRED, context.verify_mode)

    def test_smtp_rejects_starttls_downgrade(self):
        smtp = MagicMock()
        smtp.has_extn.return_value = False
        with patch.object(mail, "NominaliaSMTP", return_value=smtp):
            self.assertCode("TLS_REQUIRED", self.box.smtp)
        smtp.login.assert_not_called()
        smtp.close.assert_called_once()

    def test_proxy_connect_has_fixed_destination_and_auth(self):
        raw = MagicMock()
        response = b"HTTP/1.1 200 Connection established\r\n\r\n"
        raw.recv.side_effect = [bytes([byte]) for byte in response]
        with patch.dict(mail.os.environ, {"AIBRAIN_EGRESS_PROXY_URL": "http://egress-gateway:8080", "AIBRAIN_EGRESS_SERVER_TOKEN": "synthetic-token"}, clear=True), patch.object(mail.socket, "create_connection", return_value=raw) as create:
            self.assertIs(raw, mail.connect_socket(mail.IMAP_HOST, 993))
        create.assert_called_once_with(("egress-gateway", 8080), 15)
        sent = raw.sendall.call_args.args[0]
        self.assertIn(b"CONNECT pop.securemail.pro:993 HTTP/1.1", sent)
        self.assertIn(base64.b64encode(b"aibrain:synthetic-token"), sent)
        self.assertNotIn(CREDS["password"].encode(), sent)

    def test_proxy_denial_and_invalid_config_never_fallback_direct(self):
        raw = MagicMock()
        raw.recv.side_effect = [bytes([byte]) for byte in b"HTTP/1.1 403 Denied\r\n\r\n"]
        with patch.dict(mail.os.environ, {"AIBRAIN_EGRESS_PROXY_URL": "http://egress-gateway:8080", "AIBRAIN_EGRESS_SERVER_TOKEN": "x"}, clear=True), patch.object(mail.socket, "create_connection", return_value=raw) as create:
            self.assertCode("PROXY_CONNECTION_FAILED", mail.connect_socket, mail.IMAP_HOST, 993)
        self.assertEqual(1, create.call_count)
        raw.close.assert_called_once()
        with patch.dict(mail.os.environ, {"AIBRAIN_EGRESS_PROXY_URL": "https://wrong", "AIBRAIN_EGRESS_SERVER_TOKEN": "x"}, clear=True), patch.object(mail.socket, "create_connection") as create:
            self.assertCode("PROXY_CONFIGURATION_INVALID", mail.connect_socket, mail.IMAP_HOST, 993)
        create.assert_not_called()

    def test_development_direct_socket(self):
        with patch.dict(mail.os.environ, {}, clear=True), patch.object(mail.socket, "create_connection") as create:
            mail.connect_socket(mail.SMTP_HOST, 587)
        create.assert_called_once_with((mail.SMTP_HOST, 587), 15)

    def test_folders_modified_utf7_and_quotes(self):
        name = 'Esborranys "Júlia" & altres'
        self.assertEqual(name, mail.decode_folder(mail.encode_folder(name)))
        self.assertEqual(["INBOX", "Drafts", "Sent"], [row["name"] for row in self.box.folders()["folders"]])

    def test_verify_authenticates_both_without_sending(self):
        smtp = MagicMock()
        with patch.object(mail, "NominaliaIMAP", return_value=self.imap), patch.object(mail.Mailbox, "smtp", return_value=smtp):
            result = mail.execute({"operation": "verify", "credentials": CREDS})
        self.assertTrue(result["verified"])
        self.imap.login.assert_called_once_with(CREDS["email"], CREDS["password"])
        smtp.data.assert_not_called()
        self.imap.append.assert_not_called()

    def test_list_stable_uid_and_peek(self):
        result = self.box.list_messages({"folder": "INBOX", "limit": 20})
        self.assertEqual("7", result["messages"][0]["uid"])
        self.assertEqual("123", result["messages"][0]["uidValidity"])
        self.assertTrue(result["messages"][0]["unread"])
        fetches = [call.args[2] for call in self.imap.uid.call_args_list if call.args[0] == "FETCH"]
        self.assertIn("BODY.PEEK[HEADER.FIELDS", fetches[-1])
        self.imap.store.assert_not_called()

    def test_read_preserves_unseen(self):
        result = self.box.read({"message": REF})
        self.assertEqual("Hello\r\n", result["text"])
        self.assertTrue(result["unread"])
        self.imap.select.assert_called_with('"INBOX"', readonly=True)
        self.assertEqual("(UID BODY.PEEK[])", self.imap.uid.call_args_list[-1].args[2])

    def test_stale_ref_and_injected_uid_rejected_before_fetch(self):
        self.assertCode("STALE_MESSAGE_REF", self.box.read, {"message": {**REF, "uidValidity": "124"}})
        self.imap.uid.assert_not_called()
        self.assertCode("INVALID_INPUT", self.box.read, {"message": {**REF, "uid": "1:*"}})
        self.assertCode("INVALID_INPUT", self.box.read, {"message": {**REF, "folder": "INBOX\r\nLOGOUT"}})

    def test_large_message_rejected_before_body_fetch(self):
        self.box.imap = imap_mock(size=mail.MAX_MESSAGE + 1)
        self.assertCode("MESSAGE_TOO_LARGE", self.box.read, {"message": REF})
        self.assertEqual(1, self.box.imap.uid.call_count)
        self.assertCode("MESSAGE_TOO_LARGE", mail.NominaliaIMAP.read, None, mail.MAX_MESSAGE + 1)

    def test_large_message_still_visible_in_header_listing(self):
        self.box.imap = imap_mock(size=mail.MAX_MESSAGE + 1)
        result = self.box.list_messages({})
        self.assertEqual(mail.MAX_MESSAGE + 1, result["messages"][0]["size"])

    def test_search_escapes_values_and_only_permitted_criteria(self):
        self.box.list_messages({"query": {"subject": 'hello" OR ALL', "since": "2026-10-01", "unread": True}})
        search = self.imap.uid.call_args_list[0].args
        self.assertEqual(("SEARCH", "CHARSET", "UTF-8", b"SUBJECT", b'"hello\\" OR ALL"', b"SINCE", b"01-Oct-2026", b"UNSEEN"), search)
        self.assertCode("INVALID_INPUT", self.box.list_messages, {"query": {"raw": "ALL"}})
        self.assertCode("INVALID_INPUT", self.box.list_messages, {"query": "ALL"})
        self.assertCode("INVALID_INPUT", self.box.list_messages, {"query": {"since": "2026-02-30"}})
        self.assertCode("INVALID_INPUT", self.box.list_messages, {"limit": 51})

    def test_bounded_body_and_attachments(self):
        message = mail.EmailMessage()
        message.set_content("x" * (mail.MAX_TEXT + 20))
        message.add_attachment(b"file data", maintype="application", subtype="pdf", filename="test.pdf")
        self.box.imap = imap_mock(message.as_bytes())
        result = self.box.read({"message": REF})
        self.assertEqual(mail.MAX_TEXT, len(result["text"]))
        self.assertTrue(result["bodyTruncated"])
        self.assertEqual("test.pdf", result["attachments"][0]["filename"])
        attachment = self.box.read({"message": REF, "partId": result["attachments"][0]["partId"]}, attachment=True)
        self.assertEqual(b"file data", base64.b64decode(attachment["dataBase64"]))

    def test_flags_only_selected_uid(self):
        self.assertEqual({"updated": True}, self.box.flags({"message": REF, "seen": True, "flagged": False}))
        stores = [call.args for call in self.imap.uid.call_args_list if call.args[0] == "STORE"]
        self.assertEqual([("STORE", "7", "+FLAGS.SILENT", "(\\Seen)"), ("STORE", "7", "-FLAGS.SILENT", "(\\Flagged)")], stores)
        self.imap.select.assert_called_with('"INBOX"', readonly=False)

    def test_invalid_flags_do_not_partially_modify(self):
        self.assertCode("INVALID_INPUT", self.box.flags, {"message": REF, "seen": True, "flagged": "yes"})
        self.assertFalse(any(call.args[0] == "STORE" for call in self.imap.uid.call_args_list))

    def test_move_uses_uid_expunge_only(self):
        self.box.move({"message": REF, "destination": "Archive"})
        effects = [call.args for call in self.imap.uid.call_args_list if call.args[0] != "FETCH"]
        self.assertEqual([("COPY", "7", '"Archive"'), ("STORE", "7", "+FLAGS.SILENT", "(\\Deleted)"), ("EXPUNGE", "7")], effects)
        self.imap.expunge.assert_not_called()

    def test_move_capability_and_fail_closed_without_uidplus(self):
        self.imap.capabilities = (b"MOVE",)
        self.box.move({"message": REF, "destination": "Archive"})
        self.imap.uid.assert_called_with("MOVE", "7", '"Archive"')
        self.imap.reset_mock()
        self.imap.capabilities = (b"IMAP4rev1",)
        self.assertCode("SAFE_MOVE_UNSUPPORTED", self.box.move, {"message": REF, "destination": "Archive"})
        self.assertFalse(any(call.args[0] in ("STORE", "COPY", "EXPUNGE", "MOVE") for call in self.imap.uid.call_args_list))

    def test_move_copy_followed_by_failure_is_explicitly_ambiguous(self):
        previous = self.imap.uid.side_effect
        def uid(operation, *args):
            if operation == "STORE":
                raise OSError("synthetic failure after copy")
            return previous(operation, *args)
        self.imap.uid.side_effect = uid
        self.assertCode("MOVE_OUTCOME_UNKNOWN", self.box.move, {"message": REF, "destination": "Archive"})
        self.assertEqual(1, len([call for call in self.imap.uid.call_args_list if call.args[0] == "COPY"]))

    def test_header_injection_sender_spoof_and_missing_messageid_denied(self):
        self.assertCode("INVALID_INPUT", self.box.compose, {**COMPOSE, "subject": "x\r\nBcc: attacker@example.net"})
        self.assertCode("INVALID_INPUT", self.box.compose, {**COMPOSE, "from": "other@example.net"})
        self.assertCode("INVALID_INPUT", self.box.compose, {**COMPOSE, "to": ["a@example.net\r\nDATA"]})
        self.assertCode("INVALID_INPUT", self.box.compose, {**COMPOSE, "messageId": ""})

    def test_attachment_total_limit_invalid_base64_and_type(self):
        self.assertCode("INVALID_INPUT", self.box.compose, {**COMPOSE, "attachments": [{"filename": "a", "dataBase64": "invalid!"}]})
        self.assertCode("INVALID_INPUT", self.box.compose, {**COMPOSE, "attachments": [{"filename": "a", "contentType": "x/y; header", "dataBase64": ""}]})
        encoded = base64.b64encode(b"x" * (mail.MAX_ATTACHMENTS // 2 + 1)).decode()
        self.assertCode("ATTACHMENT_TOO_LARGE", self.box.compose, {**COMPOSE, "attachments": [{"filename": "a", "dataBase64": encoded}, {"filename": "b", "dataBase64": encoded}]})

    def test_draft_is_imap_append_only_preserves_bcc(self):
        with patch.object(self.box, "smtp") as smtp:
            result = self.box.draft({**COMPOSE, "bcc": ["hidden@example.net"]})
        self.assertTrue(result["saved"])
        self.assertEqual("8", result["uid"])
        self.assertEqual("123", result["uidValidity"])
        self.assertEqual('"Drafts"', self.imap.append.call_args.args[0])
        self.assertEqual("(\\Draft)", self.imap.append.call_args.args[1])
        self.assertIn(b"Bcc: hidden@example.net", self.imap.append.call_args.args[3])
        smtp.assert_not_called()

    def smtp_mock(self):
        smtp = MagicMock()
        smtp.mail.return_value = (250, b"OK")
        smtp.rcpt.return_value = (250, b"OK")
        smtp.data.return_value = (250, b"OK")
        return smtp

    def test_send_stable_id_bcc_private_and_sent_copy(self):
        smtp = self.smtp_mock()
        with patch.object(self.box, "smtp", return_value=smtp):
            result = self.box.send({**COMPOSE, "bcc": ["hidden@example.net"]})
        self.assertTrue(result["sent"])
        self.assertTrue(result["sentCopySaved"])
        self.assertEqual("<stable-id@example.com>", result["messageId"])
        raw = smtp.data.call_args.args[0]
        self.assertIn(b"Message-ID: <stable-id@example.com>", raw)
        self.assertNotIn(b"Bcc:", raw)
        self.assertIn(unittest.mock.call("hidden@example.net"), smtp.rcpt.call_args_list)
        self.assertEqual(raw, self.imap.append.call_args.args[3])

    def test_refused_recipient_sends_no_data(self):
        smtp = self.smtp_mock()
        smtp.rcpt.side_effect = [(250, b"ok"), (550, b"no")]
        with patch.object(self.box, "smtp", return_value=smtp):
            self.assertCode("RECIPIENT_REJECTED", self.box.send, {**COMPOSE, "cc": ["refused@example.net"]})
        smtp.data.assert_not_called()
        smtp.rset.assert_called_once()
        self.imap.append.assert_not_called()

    def test_ambiguous_send_is_never_retried_or_copied(self):
        smtp = self.smtp_mock()
        smtp.data.side_effect = socket.timeout("secret provider diagnostic")
        with patch.object(self.box, "smtp", return_value=smtp):
            self.assertCode("SEND_OUTCOME_UNKNOWN", self.box.send, COMPOSE)
        self.assertEqual(1, smtp.data.call_count)
        self.imap.append.assert_not_called()

    def test_send_success_copy_failure_stays_success(self):
        smtp = self.smtp_mock()
        self.imap.append.side_effect = OSError("private provider error")
        with patch.object(self.box, "smtp", return_value=smtp):
            result = self.box.send(COMPOSE)
        self.assertTrue(result["sent"])
        self.assertFalse(result["sentCopySaved"])
        self.assertEqual("SENT_COPY_FAILED", result["warning"])
        self.assertEqual(1, smtp.data.call_count)

    def test_mime_depth_is_bounded(self):
        message = mail.EmailMessage()
        message.set_content("x")
        for _ in range(mail.MAX_PARTS + 2):
            outer = mail.EmailMessage()
            outer.make_mixed()
            outer.attach(message)
            message = outer
        self.assertCode("MESSAGE_TOO_COMPLEX", list, mail.iter_parts(message))

    def test_main_sanitizes_errors_and_no_credential_output(self):
        import json
        request = json.dumps({"operation": "verify", "credentials": CREDS}).encode()
        stdin = MagicMock(buffer=io.BytesIO(request))
        stdout = io.StringIO()
        with patch.object(mail.sys, "stdin", stdin), patch.object(mail.sys, "stdout", stdout), patch.object(mail, "execute", side_effect=OSError(CREDS["password"])):
            mail.main()
        self.assertEqual({"ok": False, "error": {"code": "PROVIDER_UNAVAILABLE"}}, json.loads(stdout.getvalue()))
        self.assertNotIn(CREDS["password"], stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
