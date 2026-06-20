"""Seed KB categories + a few sample articles. Idempotent by slug."""

from __future__ import annotations

from django.utils import timezone

# (helpdesk_key, slug, name)
CATEGORIES = [
    ("IT", "it-howto", "IT How-To"),
    ("HR", "hr-policies", "HR Policies"),
    ("FAC", "fac-guides", "Facilities Guides"),
]

# (cat_slug, slug, title, summary, status, visibility, body)
ARTICLES = [
    ("it-howto", "reset-your-password", "How to reset your password",
     "Step-by-step guide to resetting your corporate password.", "published", "portal",
     "<h2>Reset your password</h2><p>Go to the self-service portal, choose "
     "<strong>Forgot password</strong>, and follow the email link. Passwords must be at "
     "least 12 characters.</p>"),
    ("it-howto", "set-up-vpn", "Setting up the VPN client",
     "Install and connect the corporate VPN on Windows and macOS.", "published", "portal",
     "<h2>VPN setup</h2><p>Download the client from the software catalog, sign in with your "
     "corporate account, and select the nearest gateway.</p>"),
    ("it-howto", "agent-runbook-mfa", "Internal: MFA reset runbook",
     "Agent-only runbook for resetting a user's MFA token.", "published", "internal",
     "<h2>MFA reset (agents)</h2><p>Verify identity, then reset the token in the admin "
     "console. Log the action on the ticket.</p>"),
    ("hr-policies", "leave-policy", "Leave & time-off policy",
     "How annual leave, sick leave and carry-over work.", "published", "portal",
     "<h2>Leave policy</h2><p>Full-time employees accrue 20 days of annual leave per year. "
     "Submit requests via the HR portal at least 5 working days in advance.</p>"),
    ("fac-guides", "visitor-access", "Visitor access procedure",
     "How to register and host a visitor on site.", "published", "portal",
     "<h2>Visitor access</h2><p>Register your visitor at least one day ahead via the Facilities "
     "portal. Visitors must be badged and escorted.</p>"),
]


def run():
    from apps.itsm_core.services.html import html_to_text, sanitize_html
    from apps.itsm_helpdesks.models import Helpdesk

    from .models import Article, KBCategory

    cats = {}
    for hk, slug, name in CATEGORIES:
        hd = Helpdesk.objects.filter(key=hk).first()
        cat, _ = KBCategory.objects.get_or_create(slug=slug, defaults={"name": name, "helpdesk": hd})
        cats[slug] = cat

    created = 0
    for cat_slug, slug, title, summary, status, visibility, body in ARTICLES:
        cat = cats.get(cat_slug)
        _, was_created = Article.objects.get_or_create(
            slug=slug,
            defaults={
                "category": cat, "helpdesk": getattr(cat, "helpdesk", None), "title": title,
                "summary": summary, "status": status, "visibility": visibility,
                "body_html": sanitize_html(body), "body_text": html_to_text(body),
                "published_at": timezone.now() if status == "published" else None,
            },
        )
        created += int(was_created)

    return {"categories": len(cats), "articles": len(ARTICLES), "created": created}
