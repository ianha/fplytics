import { useState } from "react";
import { Check, Copy, Download, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { API_ORIGIN } from "@/api/client";

interface ShareRecapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: number;
  gameweek: number;
  teamName: string;
}

// Returns true if the browser supports writing image blobs to the clipboard.
// Evaluated lazily (not at module load) so tests can stub window.ClipboardItem.
function supportsClipboardImage(): boolean {
  return typeof window !== "undefined" && "ClipboardItem" in window && !!window.ClipboardItem;
}

export function ShareRecapDialog({ open, onOpenChange, accountId, gameweek, teamName }: ShareRecapDialogProps) {
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState(false);

  const recapUrl = `/api/my-team/${accountId}/recap/${gameweek}`;
  const absoluteUrl = `${API_ORIGIN}${recapUrl}`;
  const shareText = `GW${gameweek} Recap 📊 #FPL #GW${gameweek}`;

  const canShareFiles = typeof navigator !== "undefined" && "canShare" in navigator;
  const canCopyImage = supportsClipboardImage();

  async function copyImage() {
    setCopying(true);
    setCopyError(false);
    try {
      const res = await fetch(recapUrl);
      if (!res.ok) throw new Error("fetch failed");
      if (canCopyImage) {
        // Copy the actual PNG binary to the clipboard — user can paste it as an image
        const blob = await res.blob();
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      } else {
        // Fallback: copy the direct PNG URL
        await navigator.clipboard.writeText(absoluteUrl);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
      setTimeout(() => setCopyError(false), 3000);
    } finally {
      setCopying(false);
    }
  }

  async function shareImageNative() {
    setSharing(true);
    setShareError(false);
    try {
      const res = await fetch(recapUrl);
      if (!res.ok) throw new Error("Failed to fetch recap image");
      const blob = await res.blob();
      const file = new File([blob], `fplytics-gw${gameweek}-recap.png`, { type: "image/png" });
      await navigator.share({ files: [file], title: `GW${gameweek} Recap`, text: shareText });
    } catch (err) {
      // AbortError means the user cancelled — don't treat that as an error
      if (err instanceof Error && err.name !== "AbortError") {
        setShareError(true);
      }
    } finally {
      setSharing(false);
    }
  }

  const copyLabel = copying ? "Copying…" : copied ? "Copied!" : canCopyImage ? "Copy image" : "Copy link";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Share GW{gameweek} Recap</DialogTitle>
          <DialogDescription>{teamName}</DialogDescription>
        </DialogHeader>

        {/* Preview image */}
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
          <img
            src={recapUrl}
            alt={`GW${gameweek} Recap Card`}
            className="w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>

        <div className="space-y-2 pt-1">
          {/* Web Share API — native OS share sheet (mobile only) */}
          {canShareFiles && (
            <Button
              variant="outline"
              className="w-full justify-start gap-3"
              onClick={shareImageNative}
              disabled={sharing}
            >
              {sharing ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <Share2 className="h-4 w-4" />
              )}
              {sharing ? "Preparing…" : "Share image"}
            </Button>
          )}

          {shareError && (
            <p className="text-xs text-red-400">Couldn&apos;t share the image. Try saving it instead.</p>
          )}

          <div className="grid grid-cols-2 gap-2">
            {/* Copy image (ClipboardItem) or copy link fallback */}
            <Button
              variant="outline"
              className="justify-start gap-2 px-3 !text-xs"
              onClick={copyImage}
              disabled={copying}
            >
              {copying ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : copied ? (
                <Check className="h-4 w-4 text-accent" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copyLabel}
            </Button>

            {/* Download / save image */}
            <a
              href={recapUrl}
              download={`fplytics-gw${gameweek}-recap.png`}
              className="inline-flex items-center justify-start gap-2 rounded-lg border border-border bg-transparent px-3 py-2 text-xs font-medium transition-all duration-200 hover:bg-secondary hover:text-foreground"
            >
              <Download className="h-4 w-4" />
              Save image
            </a>
          </div>

          {copyError && (
            <p className="text-xs text-red-400">Couldn&apos;t copy. Try saving the image instead.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
