"""Test Resend email sending directly."""

import resend
import os

# Load API key from .env
from dotenv import load_dotenv
load_dotenv()

api_key = os.getenv("EMAIL_RESEND_API_KEY")

print(f"API Key loaded: {bool(api_key)}")
print(f"API Key length: {len(api_key) if api_key else 0}")
print(f"API Key first 10 chars: {api_key[:10] if api_key else 'None'}")
print()

if not api_key:
    print("ERROR: EMAIL_RESEND_API_KEY not found in .env")
    exit(1)

# Set the API key
resend.api_key = api_key

# Send test email
try:
    print("Attempting to send test email...")

    params = {
        "from": "Zoltag <onboarding@resend.dev>",
        "to": ["ned.rhinelander@gmail.com"],
        "subject": "Test Email from Zoltag",
        "html": "<h1>Hello!</h1><p>This is a test email from Zoltag using Resend.</p>",
        "text": "Hello! This is a test email from Zoltag using Resend.",
    }

    print(f"Sending to: {params['to']}")
    print(f"From: {params['from']}")
    print()

    response = resend.Emails.send(params)

    print("✅ Email sent successfully!")
    print(f"Response: {response}")

except Exception as e:
    print(f"❌ Error sending email: {e}")
    print(f"Error type: {type(e).__name__}")
    import traceback
    traceback.print_exc()
