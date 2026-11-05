import { toast } from "sonner";

/** Copy `text` to the clipboard and confirm with a toast ("Email copied."). Falls back
 *  to a hidden-textarea `execCommand("copy")` where the async Clipboard API is
 *  missing (non-secure context). Resolves `true` when the copy went through. */
export async function copyText(text: string, what = "Value"): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (!ok) throw new Error("copy failed");
    }
    toast.success(`${what} copied.`);
    return true;
  } catch {
    toast.error("Could not copy.");
    return false;
  }
}
