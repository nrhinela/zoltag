"""Email sending via Resend API."""

import logging
from typing import Optional

from zoltag.settings import settings

logger = logging.getLogger(__name__)

try:
    import resend  # type: ignore
except Exception:  # pragma: no cover - optional dependency in local dev
    resend = None


def _resend_available() -> bool:
    if resend is None:
        logger.error("Resend SDK is not installed. Install with: pip install resend")
        return False
    if not settings.email_resend_api_key:
        logger.error("EMAIL_RESEND_API_KEY not configured - cannot send email")
        return False
    return True


def _masked_api_key() -> str:
    raw = str(settings.email_resend_api_key or "").strip()
    if not raw:
        return "(missing)"
    if len(raw) <= 10:
        return f"{raw[:2]}***"
    return f"{raw[:6]}...{raw[-4:]}"


def _extract_resend_message_id(response: object) -> str | None:
    if isinstance(response, dict):
        value = response.get("id")
        return str(value).strip() if value else None
    value = getattr(response, "id", None)
    if value:
        return str(value).strip()
    if hasattr(response, "get"):
        try:
            maybe = response.get("id")
            return str(maybe).strip() if maybe else None
        except Exception:
            return None
    return None


def send_guest_invite_email(
    to_email: str,
    invite_link: str,
    list_name: Optional[str] = None,
    inviter_name: Optional[str] = None,
    tenant_name: Optional[str] = None,
) -> bool:
    """Send a guest invitation email via Resend.

    Args:
        to_email: Recipient email address
        invite_link: The full invite link URL
        list_name: Name of the photo list being shared (optional)
        inviter_name: Name of person sending the invite (optional)
        tenant_name: Tenant/org name for "on behalf of" text (optional)

    Returns:
        True if email sent successfully, False otherwise
    """
    if not _resend_available():
        return False

    # Set the API key
    resend.api_key = settings.email_resend_api_key

    # Build email subject and body
    subject = "You're invited to view shared media"
    if list_name:
        subject = f'Invitation to view "{list_name}"'

    list_phrase_html = (
        f'the collection "<strong>{list_name}</strong>"'
        if list_name
        else "a shared collection"
    )
    list_phrase_text = f'the collection "{list_name}"' if list_name else "a shared collection"
    tenant_phrase_html = f" on behalf of <strong>{tenant_name}</strong>" if tenant_name else ""
    tenant_phrase_text = f" on behalf of {tenant_name}" if tenant_name else ""
    invite_intro = (
        f"<strong>{inviter_name}</strong> has invited you to view {list_phrase_html}{tenant_phrase_html}."
        if inviter_name
        else f"You've been invited to view {list_phrase_html}{tenant_phrase_html}."
    )
    invite_intro_text = (
        f"{inviter_name} has invited you to view {list_phrase_text}{tenant_phrase_text}."
        if inviter_name
        else f"You've been invited to view {list_phrase_text}{tenant_phrase_text}."
    )

    # HTML email body (Option A: App Card)
    html_body = f"""
    <html>
    <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:28px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;">
              <tr>
                <td style="padding:0 0 12px 0;">
                  <div style="margin-top:4px;font-size:14px;line-height:1.4;color:#6b7280;">Guest collection</div>
                </td>
              </tr>
              <tr>
                <td style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 1px 3px rgba(15,23,42,0.08);padding:24px;">
                  <div style="font-size:22px;font-weight:800;line-height:1.2;color:#111827;margin:0 0 12px 0;">Your'e Invited</div>
                  <div style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 14px 0;">{invite_intro}</div>
                  <div style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 20px 0;">
                    This invitation includes your secure sign-in link. Use the button below to open the shared media.
                  </div>

                  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                    <tr>
                      <td style="border-radius:10px;background:#2563eb;">
                        <a href="{invite_link}" style="display:inline-block;padding:12px 20px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border:1px solid #2563eb;border-radius:10px;">
                          Sign In &amp; View Shared Media
                        </a>
                      </td>
                    </tr>
                  </table>

                  <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;font-size:13px;line-height:1.5;color:#4b5563;">
                    <div>This invitation was sent to <strong>{to_email}</strong>.</div>
                    <div style="margin-top:6px;">This sign-in link is one-time and expires for security.</div>
                    <div style="margin-top:6px;">If you didn't expect this invitation, you can safely ignore this email.</div>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
    """

    # Plain text fallback
    text_body = f"""
{invite_intro_text}

This invitation includes your secure sign-in link.
Click this link to open the shared media:
{invite_link}

---
This invitation was sent to {to_email}
If you didn't expect this invitation, you can safely ignore this email.
    """.strip()

    try:
        params = {
            "from": settings.email_from_address,
            "to": [to_email],
            "subject": subject,
            "html": html_body,
            "text": text_body,
        }

        logger.info(
            "Sending invite email to %s via Resend (from=%s, key=%s)",
            to_email,
            settings.email_from_address,
            _masked_api_key(),
        )
        response = resend.Emails.send(params)
        message_id = _extract_resend_message_id(response)
        if not message_id:
            logger.error("Resend returned no message id for invite email to %s. Raw response=%r", to_email, response)
            return False
        logger.info("✅ Email accepted by Resend for %s, ID: %s", to_email, message_id)
        return True

    except Exception as e:
        logger.error(f"❌ Failed to send email to {to_email}: {e}")
        return False


async def send_guest_magic_link_email(
    to_email: str,
    magic_link: str,
    otp_code: Optional[str] = None,
) -> bool:
    """Send a guest magic link authentication email via Resend.

    Args:
        to_email: Recipient email address
        magic_link: The Supabase magic link URL
        otp_code: Optional OTP code for manual entry (if supported)

    Returns:
        True if email sent successfully, False otherwise
    """
    if not _resend_available():
        return False

    # Set the API key
    resend.api_key = settings.email_resend_api_key

    # Build email subject and body
    subject = "Sign in to view your shared photos on Zoltag"

    # HTML email body
    html_body = f"""
    <html>
    <head>
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background: #4f46e5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }}
            .content {{ background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }}
            .button {{ background: #4f46e5; color: white !important; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 20px 0; font-weight: bold; }}
            .code-box {{ background: white; border: 2px solid #4f46e5; padding: 16px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 4px; margin: 20px 0; border-radius: 6px; }}
            .footer {{ color: #6b7280; font-size: 12px; margin-top: 20px; text-align: center; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1 style="margin: 0;">📸 Zoltag</h1>
            </div>
            <div class="content">
                <p>You requested a sign-in link to view your shared photo collections.</p>

                <p><strong>Click the button below to sign in:</strong></p>

                <a href="{magic_link}" class="button">Sign In to Zoltag</a>

                {"<p style='margin-top: 30px;'><strong>Or enter this code on the sign-in page:</strong></p><div class='code-box'>" + otp_code + "</div>" if otp_code else ""}

                <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
                    This link will expire in 60 minutes for security purposes.
                </p>
            </div>
            <div class="footer">
                <p>This sign-in link was sent to {to_email}</p>
                <p>If you didn't request this link, you can safely ignore this email.</p>
            </div>
        </div>
    </body>
    </html>
    """

    # Plain text fallback
    text_body = f"""
You requested a sign-in link to view your shared photo collections on Zoltag.

Click this link to sign in:
{magic_link}

{"Or enter this code on the sign-in page: " + otp_code if otp_code else ""}

This link will expire in 60 minutes for security purposes.

---
This sign-in link was sent to {to_email}
If you didn't request this link, you can safely ignore this email.
    """.strip()

    try:
        params = {
            "from": settings.email_from_address,
            "to": [to_email],
            "subject": subject,
            "html": html_body,
            "text": text_body,
        }

        logger.info(
            "Sending magic link email to %s via Resend (from=%s, key=%s)",
            to_email,
            settings.email_from_address,
            _masked_api_key(),
        )
        response = resend.Emails.send(params)
        message_id = _extract_resend_message_id(response)
        if not message_id:
            logger.error("Resend returned no message id for magic link email to %s. Raw response=%r", to_email, response)
            return False
        logger.info("✅ Magic link email accepted by Resend for %s, ID: %s", to_email, message_id)
        return True

    except Exception as e:
        logger.error(f"❌ Failed to send magic link email to {to_email}: {e}")
        return False


async def send_guest_access_reminder_email(
    to_email: str,
    access_link: str,
) -> bool:
    """Send a simple access reminder email (no magic link tokens).

    User clicks link, lands on /guest, and requests a fresh magic link there.
    This avoids Supabase's email-sending behavior and redirect URL issues.

    Args:
        to_email: Recipient email address
        access_link: Simple link to /guest page (no auth tokens)

    Returns:
        True if email sent successfully, False otherwise
    """
    if not _resend_available():
        return False

    # Set the API key
    resend.api_key = settings.email_resend_api_key

    # Build email subject and body
    subject = "Access your shared photos on Zoltag"

    # HTML email body
    html_body = f"""
    <html>
    <head>
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background: #4f46e5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }}
            .content {{ background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }}
            .button {{ background: #4f46e5; color: white !important; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 20px 0; font-weight: bold; }}
            .footer {{ color: #6b7280; font-size: 12px; margin-top: 20px; text-align: center; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1 style="margin: 0;">📸 Zoltag</h1>
            </div>
            <div class="content">
                <p>You requested access to your shared photo collections.</p>

                <p><strong>Click the button below to continue:</strong></p>

                <a href="{access_link}" class="button">View Shared Photos</a>

                <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
                    After clicking the link, you'll be able to sign in securely with your email address.
                </p>
            </div>
            <div class="footer">
                <p>This access link was sent to {to_email}</p>
                <p>If you didn't request this link, you can safely ignore this email.</p>
            </div>
        </div>
    </body>
    </html>
    """

    # Plain text fallback
    text_body = f"""
You requested access to your shared photo collections on Zoltag.

Click this link to continue:
{access_link}

After clicking the link, you'll be able to sign in securely with your email address.

---
This access link was sent to {to_email}
If you didn't request this link, you can safely ignore this email.
    """.strip()

    try:
        params = {
            "from": settings.email_from_address,
            "to": [to_email],
            "subject": subject,
            "html": html_body,
            "text": text_body,
        }

        logger.info(
            "Sending access reminder email to %s via Resend (from=%s, key=%s)",
            to_email,
            settings.email_from_address,
            _masked_api_key(),
        )
        response = resend.Emails.send(params)
        message_id = _extract_resend_message_id(response)
        if not message_id:
            logger.error("Resend returned no message id for access reminder email to %s. Raw response=%r", to_email, response)
            return False
        logger.info("✅ Access reminder email accepted by Resend for %s, ID: %s", to_email, message_id)
        return True

    except Exception as e:
        logger.error(f"❌ Failed to send access reminder email to {to_email}: {e}")
        return False
