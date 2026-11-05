import { useState } from "react";
import { Upload, ShieldCheck } from "lucide-react";
import { inspectBackup } from "./backup-client";
import type { ParsedBackup } from "./backup";
import { restoreBundle } from "./db";
import { type Tree, friendlyError } from "./domain";
import { Modal, Busy, formatTime } from "./ui";
export function RestoreWelcome({
  onClose,
  onRestored,
}: {
  onClose: () => void;
  onRestored: (tree: Tree) => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [password, setPassword] = useState(""),
    [preview, setPreview] = useState<ParsedBackup | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function inspect() {
    if (!file) return;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      if (file.size > 104 * 1024 * 1024)
        throw new Error("This file exceeds the backup size limit.");
      setPreview(
        await inspectBackup(new Uint8Array(await file.arrayBuffer()), password),
      );
      setPassword("");
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      onRestored(await restoreBundle(preview));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Bring your family tree home" onClose={onClose}>
      <div className="form">
        <p className="muted">
          Choose a Generations backup from this computer or a USB drive. We will
          check it before importing anything.
        </p>
        <label className="file-drop">
          <Upload size={24} />
          <strong>{file?.name || "Choose a backup file"}</strong>
          <span>ZIP or encrypted .ftbackup</span>
          <input
            type="file"
            aria-label="Choose backup file"
            accept=".zip,.ftbackup"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setPreview(null);
            }}
          />
        </label>
        <label>
          Passphrase, if encrypted
          <input
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {preview ? (
          <div className="restore-preview">
            <span className="success-text">
              <ShieldCheck size={16} />
              All integrity checks passed
            </span>
            <h3>{preview.data.tree.name}</h3>
            <p>
              {preview.data.people.length} people ·{" "}
              {preview.data.relations.length} relationships ·{" "}
              {preview.data.media.length} files
            </p>
            <small>Created {formatTime(preview.createdAt)}</small>
            <p>
              A separate tree will be created. Existing trees will not be
              replaced.
            </p>
            <button className="button" onClick={restore} disabled={busy}>
              {busy ? <Busy /> : "Import family tree"}
            </button>
          </div>
        ) : (
          <button className="button" disabled={!file || busy} onClick={inspect}>
            {busy ? <Busy label="Checking backup…" /> : "Validate & preview"}
          </button>
        )}
      </div>
    </Modal>
  );
}
