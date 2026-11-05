"use client";

import { useParams } from "next/navigation";

import { TicketDetailView } from "@/components/tickets/ticket-detail";
import { useWorkbench } from "@/components/tickets/workbench/workbench-context";

/** A ticket opened from All Tickets in Modern (`/all/NUMBER`): docked beside the combined
 *  queue on lg+, a full page otherwise (and in Classic, if such a link is shared). */
export default function AllTicketDetailPage() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const docked = !!useWorkbench();
  return <TicketDetailView ticketId={ticketId} allTickets variant={docked ? "docked" : "page"} />;
}
