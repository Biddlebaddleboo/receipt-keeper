import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { API_BASE_URL } from "@/config";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

interface AIAccessStatus {
  enabled: boolean;
  key_prefix?: string;
  created_at?: string | null;
}

interface AIAccessCreateResponse extends AIAccessStatus {
  api_key: string;
}

export function AIAccessSettings() {
  const { token } = useAuth();
  const [status, setStatus] = useState<AIAccessStatus | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const response = await apiFetch(`${API_BASE_URL}/ai-access/token`);
      if (!response.ok) throw new Error("Failed to load AI access status");
      const payload = (await response.json()) as AIAccessStatus;
      setStatus(payload);
    } catch (error) {
      setStatus(null);
      toast({
        title: "Unable to load AI access",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const createToken = async () => {
    if (status?.enabled) {
      const confirmed = window.confirm("Regenerating the AI access key will immediately revoke the current key. Continue?");
      if (!confirmed) return;
    }
    setIsMutating(true);
    try {
      const response = await apiFetch(`${API_BASE_URL}/ai-access/token`, { method: "POST" });
      if (!response.ok) throw new Error("Failed to generate AI access key");
      const payload = (await response.json()) as AIAccessCreateResponse;
      setApiKey(payload.api_key);
      setStatus({
        enabled: payload.enabled,
        key_prefix: payload.key_prefix,
        created_at: payload.created_at,
      });
      toast({
        title: status?.enabled ? "AI access key regenerated" : "AI access key generated",
        description: "Copy the key now. It will not be shown again after you leave this page.",
      });
    } catch (error) {
      toast({
        title: "Unable to generate AI access key",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsMutating(false);
    }
  };

  const revokeToken = async () => {
    const confirmed = window.confirm("Revoke AI receipt access? The current key will stop working immediately.");
    if (!confirmed) return;
    setIsMutating(true);
    try {
      const response = await apiFetch(`${API_BASE_URL}/ai-access/token`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to revoke AI access key");
      setApiKey(null);
      setStatus({ enabled: false });
      toast({ title: "AI access revoked" });
    } catch (error) {
      toast({
        title: "Unable to revoke AI access",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsMutating(false);
    }
  };

  const copyKey = async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      toast({ title: "AI access key copied" });
    } catch {
      toast({ title: "Unable to copy key", variant: "destructive" });
    }
  };

  const createdLabel = status?.created_at
    ? new Date(status.created_at).toLocaleString()
    : null;

  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-2">
        Integrations
      </h2>
      <div className="rounded-xl bg-card receipt-shadow p-4 space-y-4">
        <div className="flex items-start gap-3.5">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <KeyRound className="w-4.5 h-4.5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium block">AI Receipt Access</span>
            <span className="text-xs text-muted-foreground block mt-0.5">
              Read-only access for an AI assistant. Upload, edit, delete, billing, and account actions are not available with this key.
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading AI access status…
          </div>
        ) : (
          <>
            {status?.enabled ? (
              <div className="text-xs text-muted-foreground space-y-1">
                <div>
                  Status: <span className="font-medium text-foreground">Enabled</span>
                </div>
                {status.key_prefix && (
                  <div>
                    Key: <code className="text-foreground">{status.key_prefix}••••••••</code>
                  </div>
                )}
                {createdLabel && <div>Created: {createdLabel}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No AI access key is active.
              </p>
            )}

            {apiKey && (
              <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
                <div className="text-xs font-medium">Copy this key now</div>
                <code className="block text-xs break-all select-all">{apiKey}</code>
                <p className="text-xs text-muted-foreground">
                  The backend stores only a hash. This full key cannot be retrieved again after leaving this page.
                </p>
                <Button type="button" variant="secondary" size="sm" onClick={copyKey} className="w-full">
                  <Copy className="w-4 h-4 mr-2" />
                  Copy key
                </Button>
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              <Button type="button" onClick={createToken} disabled={isMutating} size="sm">
                {isMutating ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : status?.enabled ? (
                  <RefreshCw className="w-4 h-4 mr-2" />
                ) : (
                  <KeyRound className="w-4 h-4 mr-2" />
                )}
                {status?.enabled ? "Regenerate key" : "Generate key"}
              </Button>
              {status?.enabled && (
                <Button type="button" variant="destructive" onClick={revokeToken} disabled={isMutating} size="sm">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Revoke
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
