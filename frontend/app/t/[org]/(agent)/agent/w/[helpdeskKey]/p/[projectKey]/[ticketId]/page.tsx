"use client";

import { useParams } from "next/navigation";

import { TicketDetailView } from "@/components/tickets/ticket-detail";

export default function TicketDetailPage() {
  const { projectKey, ticketId } = useParams<{ projectKey: string; ticketId: string }>();
  return <TicketDetailView ticketId={ticketId} projectKey={projectKey} />;
}
