"use client";

/** Client-side mirror of the backend branded email shell
 *  (`apps/itsm_notifications/templates/itsm_notifications/email_base.html` +
 *  `services/email_layout.py`). It wraps the per-event body — the only part
 *  stored in the editable template — in the same header / details card / CTA /
 *  footer that recipients actually receive, so the Preview tab is faithful.
 *  Keep the colours + structure in sync with `email_layout.EVENT_ACCENTS`. */

type Accent = { color: string; headline: string };

const BLUE = "#1d4ed8";
const GREEN = "#16794a";
const AMBER = "#b45309";
const RED = "#b91c1c";

const EVENT_ACCENTS: Record<string, Accent> = {
  TicketCreated: { color: BLUE, headline: "New ticket created" },
  TicketUpdated: { color: BLUE, headline: "Ticket updated" },
  StatusChanged: { color: BLUE, headline: "Status changed" },
  Assigned: { color: BLUE, headline: "Assigned to you" },
  CommentAdded: { color: BLUE, headline: "New comment" },
  CommentAddedPrivate: { color: BLUE, headline: "Internal note added" },
  Mentioned: { color: BLUE, headline: "You were mentioned" },
  Resolved: { color: GREEN, headline: "Ticket resolved" },
  Closed: { color: GREEN, headline: "Ticket closed" },
  SLAWarning: { color: AMBER, headline: "SLA at risk" },
  SLABreach: { color: RED, headline: "SLA breached" },
};
const DEFAULT_ACCENT: Accent = { color: BLUE, headline: "Ticket notification" };

const BRAND_NAME = "One Helpdesk";

export function EmailShellPreview({
  eventType,
  contentHtml,
  sample,
}: {
  eventType: string;
  contentHtml: string;
  sample: Record<string, string>;
}) {
  const accent = EVENT_ACCENTS[eventType] ?? DEFAULT_ACCENT;
  const rows: Array<[string, string | undefined]> = [
    ["Ticket", sample["ticket.number"]],
    ["Status", sample["ticket.status"]],
    ["Priority", sample["ticket.priority"]],
    ["Assignee", sample["ticket.assignee"]],
    ["Group", sample["ticket.group"]],
  ];
  const details = rows.filter(([, v]) => Boolean(v));

  return (
    <div className="min-h-[180px] rounded-md" style={{ background: "#f1f5f9", padding: 16 }}>
      <div
        style={{
          maxWidth: 600,
          margin: "0 auto",
          background: "#ffffff",
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #e2e8f0",
          fontFamily:
            "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
        }}
      >
        <div style={{ background: accent.color, padding: "16px 28px" }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "#ffffff", letterSpacing: "-0.2px" }}>
            {BRAND_NAME}
          </span>
        </div>

        <div style={{ padding: "24px 28px 0" }}>
          <h1 style={{ margin: 0, fontSize: 19, lineHeight: 1.3, fontWeight: 700, color: "#0f172a" }}>
            {accent.headline}
          </h1>
        </div>

        {/* Safe: same Tiptap-constrained + server-sanitised body as the editor preview. */}
        <div
          style={{ padding: "8px 28px 4px", fontSize: 15, lineHeight: 1.6, color: "#334155" }}
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />

        {details.length ? (
          <div style={{ padding: "12px 28px 0" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
              }}
            >
              <tbody>
                {details.map(([label, value], i) => (
                  <tr
                    key={label}
                    style={{
                      borderBottom: i < details.length - 1 ? "1px solid #eef2f6" : undefined,
                    }}
                  >
                    <td style={{ padding: "9px 14px", fontSize: 13, color: "#64748b", width: 110 }}>
                      {label}
                    </td>
                    <td style={{ padding: "9px 14px", fontSize: 13, fontWeight: 600, color: "#0f172a" }}>
                      {value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div style={{ padding: "22px 28px 18px" }}>
          <span
            style={{
              display: "inline-block",
              padding: "11px 26px",
              fontSize: 15,
              fontWeight: 600,
              color: "#ffffff",
              borderRadius: 8,
              background: accent.color,
            }}
          >
            View ticket →
          </span>
        </div>

        <div
          style={{
            padding: "18px 28px",
            background: "#f8fafc",
            borderTop: "1px solid #e2e8f0",
            fontSize: 12,
            lineHeight: 1.6,
            color: "#94a3b8",
          }}
        >
          This is an automated message from {BRAND_NAME}. You&rsquo;re receiving it because
          you&rsquo;re involved with this ticket.
        </div>
      </div>
    </div>
  );
}
