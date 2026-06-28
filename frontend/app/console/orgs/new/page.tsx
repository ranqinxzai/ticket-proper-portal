"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";

import { PasswordField } from "@/components/console/password-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConsoleGuard } from "@/lib/console/auth";
import { ConsoleApiError, consoleApi, type Org } from "@/lib/console/client";

const SLUG_RE = /^[a-z][a-z0-9_-]*$/;

function FieldError({ errors, field }: { errors: Record<string, string[]>; field: string }) {
  const msg = errors[field]?.[0];
  if (!msg) return null;
  return <p className="text-xs text-destructive">{msg}</p>;
}

function NewOrgForm() {
  const ids = useId();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminFullName, setAdminFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [created, setCreated] = useState<Org | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    if (!SLUG_RE.test(slug)) {
      setErrors({ slug: ["Lowercase letters, digits, '-' and '_'; must start with a letter."] });
      return;
    }
    setBusy(true);
    try {
      const org = await consoleApi.createOrg({
        name: name.trim(),
        slug: slug.trim(),
        admin_username: adminUsername.trim(),
        admin_password: adminPassword,
        admin_email: adminEmail.trim() || undefined,
        admin_full_name: adminFullName.trim() || undefined,
      });
      setCreated(org);
    } catch (err) {
      if (err instanceof ConsoleApiError) {
        if (err.fieldErrors) setErrors(err.fieldErrors);
        else setErrors({ __all__: [err.message] });
      } else {
        setErrors({ __all__: ["Could not create the organisation."] });
      }
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="space-y-5 rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 text-success">
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-foreground">Organisation created</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{created.name}</span> (
          <span className="font-mono">{created.schema_name}</span>) is ready. The admin can sign in here:
        </p>
        <Link
          href={created.login_url}
          className="inline-flex items-center gap-1 font-mono text-sm text-primary hover:underline"
        >
          {created.login_url} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
        <div className="flex gap-2 pt-2">
          <Button asChild variant="outline">
            <Link href="/console">Back to organisations</Link>
          </Button>
          <Button
            onClick={() => {
              setCreated(null);
              setName("");
              setSlug("");
              setAdminUsername("");
              setAdminPassword("");
              setAdminEmail("");
              setAdminFullName("");
            }}
          >
            Create another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-lg border bg-card p-6 shadow-sm" noValidate>
      {errors.__all__ ? (
        <p role="alert" className="text-sm text-destructive">
          {errors.__all__[0]}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor={`${ids}-name`}>Organisation name</Label>
        <Input
          id={`${ids}-name`}
          value={name}
          disabled={busy}
          required
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Inc."
        />
        <FieldError errors={errors} field="name" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${ids}-slug`}>Slug</Label>
        <Input
          id={`${ids}-slug`}
          value={slug}
          disabled={busy}
          required
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          className="font-mono"
          placeholder="acme"
        />
        <p className="text-xs text-muted-foreground">
          URL segment — the org lives at <code className="font-mono">/t/{slug || "<slug>"}/</code>.
        </p>
        <FieldError errors={errors} field="slug" />
      </div>

      <div className="border-t pt-5">
        <h2 className="text-sm font-semibold">Initial administrator</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The first account that can sign in to this organisation.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${ids}-admin-username`}>Admin username</Label>
        <Input
          id={`${ids}-admin-username`}
          value={adminUsername}
          disabled={busy}
          required
          onChange={(e) => setAdminUsername(e.target.value)}
          autoComplete="off"
        />
        <FieldError errors={errors} field="admin_username" />
      </div>

      <div className="space-y-1.5">
        <PasswordField
          id={`${ids}-admin-password`}
          label="Admin password"
          value={adminPassword}
          onChange={setAdminPassword}
          disabled={busy}
          labelClassName=""
        />
        <FieldError errors={errors} field="admin_password" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${ids}-admin-email`}>Admin email (optional)</Label>
          <Input
            id={`${ids}-admin-email`}
            type="email"
            value={adminEmail}
            disabled={busy}
            onChange={(e) => setAdminEmail(e.target.value)}
            autoComplete="off"
          />
          <FieldError errors={errors} field="admin_email" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${ids}-admin-full-name`}>Admin full name (optional)</Label>
          <Input
            id={`${ids}-admin-full-name`}
            value={adminFullName}
            disabled={busy}
            onChange={(e) => setAdminFullName(e.target.value)}
            autoComplete="off"
          />
          <FieldError errors={errors} field="admin_full_name" />
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Create organisation
        </Button>
        <Button asChild type="button" variant="outline">
          <Link href="/console">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

export default function NewOrgPage() {
  return (
    <ConsoleGuard>
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
          <Link
            href="/console"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to organisations
          </Link>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">New organisation</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Provision an isolated tenant and its first administrator.
            </p>
          </div>
          <NewOrgForm />
        </main>
      </div>
    </ConsoleGuard>
  );
}
