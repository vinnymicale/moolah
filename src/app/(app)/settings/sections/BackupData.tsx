"use client";

import { useState } from "react";
import { Download } from "lucide-react";

export function BackupData() {
  const [busy, setBusy] = useState(false);

  const download = () => {
    setBusy(true);
    // Navigating to the route streams the backup file as a download.
    window.location.href = "/api/backup";
    setTimeout(() => setBusy(false), 2500);
  };

  return (
    <button onClick={download} disabled={busy} className="btn-primary">
      <Download size={16} /> {busy ? "Preparing…" : "Download backup"}
    </button>
  );
}
