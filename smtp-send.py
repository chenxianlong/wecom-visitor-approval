"""AgentMail SMTP transport. Credentials only come from the service environment."""
import json
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

stage = "connect"
try:
    data = json.load(sys.stdin)
    inbox = os.environ["AGENTMAIL_INBOX"]
    message = EmailMessage()
    message["From"] = inbox
    message["To"] = ", ".join(data["to"])
    message["Subject"] = data["subject"]
    message["Date"] = formatdate(localtime=False)
    message["Message-ID"] = make_msgid(domain="agentmail.to")
    message.set_content(data["text"])
    if data.get("html"):
        message.add_alternative(data["html"], subtype="html")
    smtp = smtplib.SMTP_SSL("smtp.agentmail.to", 465, context=ssl.create_default_context(), timeout=20)
    try:
        smtp.login(inbox, os.environ["AGENTMAIL_API_KEY"])
        stage = "sending"
        refused = smtp.send_message(message, from_addr=inbox, to_addrs=data["to"])
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)
        stage = "accepted"
        print(json.dumps({"message_id": message["Message-ID"], "transport": "smtp"}), flush=True)
    finally:
        # QUIT failing after DATA was accepted must not turn a successful send into a retry.
        try:
            smtp.quit()
        except Exception:
            smtp.close()
except smtplib.SMTPResponseException as error:
    print(json.dumps({"error": "SMTP returned " + str(error.smtp_code), "retryable": 400 <= error.smtp_code < 500, "uncertain": False}))
except smtplib.SMTPRecipientsRefused:
    print(json.dumps({"error": "SMTP recipient rejected", "retryable": False, "uncertain": False}))
except Exception:
    if stage != "accepted":
        print(json.dumps({"error": "SMTP connection or delivery failed", "retryable": stage == "connect", "uncertain": stage == "sending"}))
