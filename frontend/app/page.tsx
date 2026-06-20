import { redirect } from "next/navigation";

// The pilot is ITSM-only. Land everyone on the One Helpdesk home (the helpdesk
// selector + attention panel); the ITSM auth guard bounces unauthenticated
// visitors to /itsm-login.
export default function Home() {
  redirect("/home");
}
