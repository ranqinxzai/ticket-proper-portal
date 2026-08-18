"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { brandingApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { BrandingConfig } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

/** Tenant admin form for white-label branding: client name, logo, and contact
 *  details. The client name + logo appear on the login page and the printed
 *  ticket sheet. The logo is uploaded as multipart; contact fields are stored
 *  for future use. */
export function BrandingConfigForm({ canManage }: { canManage: boolean }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [clientName, setClientName] = useState("");
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");
  // The currently-saved logo URL (from the server) and, when the admin picks a
  // new file, a local object-URL preview + the File to upload.
  const [logoUrl, setLogoUrl] = useState("");
  const [newLogo, setNewLogo] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function hydrate(c: BrandingConfig) {
    setClientName(c.client_name ?? "");
    setAddress(c.address ?? "");
    setWebsite(c.website ?? "");
    setEmail(c.email ?? "");
    setLogoUrl(c.logo_url ?? "");
    setNewLogo(null);
    setPreview("");
  }

  useEffect(() => {
    let active = true;
    brandingApi
      .get()
      .then((c) => active && hydrate(c))
      .catch(() => active && toast.error("Could not load branding settings."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  // Revoke the object URL when the preview changes/unmounts (avoid leaks).
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function pickLogo(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file (PNG, JPG or SVG).");
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setNewLogo(file);
    setPreview(URL.createObjectURL(file));
  }

  function clearLogo() {
    if (preview) URL.revokeObjectURL(preview);
    setNewLogo(null);
    setPreview("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function save() {
    const form = new FormData();
    form.append("client_name", clientName.trim());
    form.append("address", address.trim());
    form.append("website", website.trim());
    form.append("email", email.trim());
    if (newLogo) form.append("logo", newLogo);

    setSaving(true);
    try {
      const updated = await brandingApi.update(form);
      hydrate(updated);
      toast.success("Branding saved.");
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not save branding.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }

  const fieldsDisabled = !canManage || saving;
  const shownLogo = preview || logoUrl;

  return (
    <div className="space-y-6">
      {/* Logo */}
      <div className="space-y-2">
        <Label>Client logo</Label>
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-32 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted/30">
            {shownLogo ? (
              // eslint-disable-next-line @next/next/no-img-element -- user-uploaded asset
              <img src={shownLogo} alt="Client logo" className="max-h-14 max-w-[7rem] object-contain" />
            ) : (
              <ImageIcon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            )}
          </div>
          {canManage ? (
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => pickLogo(e.target.files?.[0] ?? null)}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={saving}>
                <Upload className="mr-2 h-4 w-4" /> {shownLogo ? "Replace logo" : "Upload logo"}
              </Button>
              {preview ? (
                <Button type="button" variant="ghost" size="sm" onClick={clearLogo} disabled={saving}>
                  <X className="mr-1 h-4 w-4" /> Cancel
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Shown on the login page and printed tickets. Use a wide (landscape) PNG or SVG for best results.
        </p>
      </div>

      <Separator />

      {/* Client name */}
      <div className="space-y-1.5">
        <Label htmlFor="brand-name">Client name</Label>
        <Input
          id="brand-name"
          value={clientName}
          disabled={fieldsDisabled}
          placeholder="e.g. GridCrest"
          onChange={(e) => setClientName(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Appears in the print heading as “OneDesk - {clientName || "Client"}”.
        </p>
      </div>

      {/* Contact details (stored for future use) */}
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="brand-address">Address</Label>
          <textarea
            id="brand-address"
            value={address}
            disabled={fieldsDisabled}
            rows={2}
            placeholder="Street, city, postcode"
            onChange={(e) => setAddress(e.target.value)}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="brand-website">Website</Label>
            <Input
              id="brand-website"
              type="url"
              value={website}
              disabled={fieldsDisabled}
              placeholder="https://example.com"
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brand-email">Email</Label>
            <Input
              id="brand-email"
              type="email"
              value={email}
              disabled={fieldsDisabled}
              placeholder="support@example.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
      </div>

      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      ) : null}
    </div>
  );
}
