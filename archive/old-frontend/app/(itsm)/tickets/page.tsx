import { redirect } from "next/navigation";

// "Tickets" in the nav is the same listing as Queues. Redirect to keep one
// source of truth for the table/filter logic.
export default function TicketsIndexPage() {
  redirect("/queues");
}
