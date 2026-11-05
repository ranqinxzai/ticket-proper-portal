"use client";

import { useParams } from "next/navigation";

import { TicketDetailView } from "@/components/tickets/ticket-detail";
import { useWorkbench } from "@/components/tickets/workbench/workbench-context";

export default function TicketDetailPage() {
  const { projectKey, ticketId } = useParams<{ projectKey: string; ticketId: string }>();
  // Inside the Modern workbench (lg+) the ticket is a card beside the queue.
  const docked = !!useWorkbench();
  return <TicketDetailView ticketId={ticketId} projectKey={projectKey} variant={docked ? "docked" : "page"} />;
}
